// model.js — Trainable symptom-classification model
//
// We use a Multinomial Naive Bayes text classifier — simple, fast, and
// genuinely "trainable" from real data. It is trained ONLY on
// doctor-verified symptom_checks (status = 'verified'), so the dataset
// quality improves over time as doctors review and approve cases.
//
// The trained model is persisted to disk as JSON and reloaded on each
// prediction call, so training takes effect immediately without restarting
// the server.

const fs   = require("fs");
const path = require("path");

const MODEL_PATH = path.join(__dirname, "data", "model.json");

const STOP_WORDS = new Set([
  "a","an","the","and","or","of","in","on","with","is","am","are","was",
  "were","i","my","me","have","has","had","to","for","it","this","that",
  "feel","feeling","since","day","days","week","weeks"
]);

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 1 && !STOP_WORDS.has(w));
}

// ────────────────────────────────────────────────────────
// TRAIN
// ────────────────────────────────────────────────────────
function trainModel(db, trainedBy = null) {
  const rows = db
    .prepare(
      `SELECT symptoms_text, COALESCE(corrected_disease, predicted_disease) AS label
       FROM symptom_checks WHERE status = 'verified'`
    )
    .all();

  if (rows.length < 5) {
    throw new Error(
      `Not enough verified data to train (have ${rows.length}, need at least 5). Ask doctors to verify more symptom checks first.`
    );
  }

  const classDocCount = {};      // label -> number of docs
  const classWordCount = {};     // label -> total word count
  const wordCountPerClass = {};  // label -> { word: count }
  const vocab = new Set();

  for (const row of rows) {
    const label = row.label;
    const tokens = tokenize(row.symptoms_text);
    if (!tokens.length) continue;

    classDocCount[label] = (classDocCount[label] || 0) + 1;
    classWordCount[label] = (classWordCount[label] || 0) + tokens.length;
    wordCountPerClass[label] = wordCountPerClass[label] || {};

    for (const t of tokens) {
      vocab.add(t);
      wordCountPerClass[label][t] = (wordCountPerClass[label][t] || 0) + 1;
    }
  }

  const totalDocs = rows.length;
  const classes = Object.keys(classDocCount);

  const priors = {};
  for (const c of classes) priors[c] = classDocCount[c] / totalDocs;

  const model = {
    version: Date.now(),
    trainedAt: new Date().toISOString(),
    trainingSamples: totalDocs,
    classes,
    priors,
    classWordCount,
    wordCountPerClass,
    vocabSize: vocab.size
  };

  fs.mkdirSync(path.dirname(MODEL_PATH), { recursive: true });
  fs.writeFileSync(MODEL_PATH, JSON.stringify(model), "utf8");

  db.prepare(
    `INSERT INTO model_meta (training_samples, class_count, trained_by) VALUES (?, ?, ?)`
  ).run(totalDocs, classes.length, trainedBy);

  return { trainingSamples: totalDocs, classes, trainedAt: model.trainedAt };
}

// ────────────────────────────────────────────────────────
// PREDICT
// ────────────────────────────────────────────────────────
function loadModel() {
  if (!fs.existsSync(MODEL_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(MODEL_PATH, "utf8"));
  } catch {
    return null;
  }
}

function predictWithModel(text) {
  const model = loadModel();
  if (!model) return null;

  const tokens = tokenize(text);
  if (!tokens.length) return null;

  const ALPHA = 1; // Laplace smoothing
  let bestClass = null;
  let bestScore = -Infinity;
  const scores = {};

  for (const c of model.classes) {
    let logProb = Math.log(model.priors[c]);
    const totalWordsInClass = model.classWordCount[c] || 0;
    const wordMap = model.wordCountPerClass[c] || {};

    for (const t of tokens) {
      const wc = wordMap[t] || 0;
      logProb += Math.log((wc + ALPHA) / (totalWordsInClass + ALPHA * model.vocabSize));
    }
    scores[c] = logProb;
    if (logProb > bestScore) { bestScore = logProb; bestClass = c; }
  }

  // Convert log scores to a normalized confidence (softmax over classes)
  const maxScore = Math.max(...Object.values(scores));
  const expScores = Object.fromEntries(
    Object.entries(scores).map(([c, s]) => [c, Math.exp(s - maxScore)])
  );
  const sumExp = Object.values(expScores).reduce((a, b) => a + b, 0);
  const confidence = Math.round((expScores[bestClass] / sumExp) * 100);

  return { disease: bestClass, confidence, source: "model" };
}

function getModelStatus() {
  const model = loadModel();
  if (!model) return { trained: false };
  return {
    trained: true,
    trainedAt: model.trainingSamples ? model.trainedAt : null,
    trainingSamples: model.trainingSamples,
    classes: model.classes
  };
}

module.exports = { trainModel, predictWithModel, getModelStatus, tokenize };
