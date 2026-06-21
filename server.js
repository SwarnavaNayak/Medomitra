// server.js — MEDOMITRA Backend API v3.0
// Now with: SQLite storage, user/doctor accounts, trainable model,
// and a doctor verification workflow for AI-generated diagnoses.

const express = require("express");
const cors    = require("cors");
const multer  = require("multer");
const path    = require("path");
const fs      = require("fs");

const db    = require("./database");
const { trainModel, predictWithModel, getModelStatus } = require("./model");
const localTrainedModel = require("./localTrainedModel");
const relayAI = require("./relayAI");
const {
  hashPassword, comparePassword, signToken,
  optionalAuth, requireAuth, requireDoctor, requireAdmin
} = require("./auth");

const app = express();
app.use(cors());
app.use(express.json());

// ════════════════════════════════════════════════════════
// CERTIFICATE UPLOAD STORAGE
// Doctor registration certificates (license/degree images) are stored on
// disk under data/certificates, with only the file path saved in the
// database — storing large binary images directly as DB rows would bloat
// SQLite and slow down every query that touches the users table. This is
// the standard, recommended way to handle file uploads alongside a
// database, and is functionally "stored in our system" exactly as if it
// were stored inline.
// ════════════════════════════════════════════════════════
const CERT_DIR = path.join(__dirname, "data", "certificates");
if (!fs.existsSync(CERT_DIR)) fs.mkdirSync(CERT_DIR, { recursive: true });

const PROFILE_DIR = path.join(__dirname, "data", "profile-photos");
if (!fs.existsSync(PROFILE_DIR)) fs.mkdirSync(PROFILE_DIR, { recursive: true });

const ALLOWED_CERT_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp", "application/pdf"]);
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]);

const doctorUploadStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, file.fieldname === "profilePhoto" ? PROFILE_DIR : CERT_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || "";
    const prefix = file.fieldname === "profilePhoto" ? "photo" : "cert";
    const unique = `${prefix}-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, unique);
  }
});

// Accepts both the required certificate and an optional profile photo in
// the same multipart request. Each field gets its own type validation.
const uploadDoctorFiles = multer({
  storage: doctorUploadStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max per file
  fileFilter: (req, file, cb) => {
    if (file.fieldname === "profilePhoto") {
      if (ALLOWED_IMAGE_TYPES.has(file.mimetype)) cb(null, true);
      else cb(new Error("Profile photo must be a PNG, JPEG, or WEBP image."));
    } else {
      if (ALLOWED_CERT_TYPES.has(file.mimetype)) cb(null, true);
      else cb(new Error("Certificate must be a PNG, JPEG, WEBP image, or PDF."));
    }
  }
}).fields([{ name: "certificate", maxCount: 1 }, { name: "profilePhoto", maxCount: 1 }]);

// ════════════════════════════════════════════════════════
// ADMIN BOOTSTRAP — creates the first admin account from environment
// variables, since there's no public "register as admin" option (and
// shouldn't be — admin access controls who can act as a doctor).
//
// Set ADMIN_EMAIL and ADMIN_PASSWORD before running `npm start` the first
// time. Safe to leave set on every run: it only creates the account if no
// user with that email already exists.
// ════════════════════════════════════════════════════════
(function bootstrapAdmin() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) return;

  const existing = db.prepare("SELECT id, role FROM users WHERE email = ?").get(email.toLowerCase());
  if (existing) {
    if (existing.role !== "admin") {
      console.warn(`ADMIN_EMAIL (${email}) is already registered as a non-admin account — skipping bootstrap.`);
    }
    return;
  }

  const hash = hashPassword(password);
  db.prepare("INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'admin')")
    .run("Admin", email.toLowerCase(), hash);
  console.log(`Created admin account for ${email}.`);
})();

// ════════════════════════════════════════════════════════
// RULE-BASED SYMPTOM → DISEASE KNOWLEDGE BASE
// (Acts as a seed/fallback until the trainable model has
//  enough doctor-verified data to take over.)
// ════════════════════════════════════════════════════════
const symptomDatabase = [
  { keywords:["fever","cough","fatigue","body ache","body pain"],
    disease:"Viral Fever / Influenza (Flu)", severity:"Moderate",
    advice:"Rest, stay hydrated, take paracetamol if needed. See a doctor if fever exceeds 103°F or lasts more than 3 days." },
  { keywords:["fever","cough","shortness of breath","breathlessness","chest tightness"],
    disease:"Possible Respiratory Infection (COVID-19 / Pneumonia)", severity:"High",
    advice:"Seek immediate medical attention. Isolate yourself and get tested for COVID-19." },
  { keywords:["headache","nausea","light sensitivity","vomiting","throbbing"],
    disease:"Migraine", severity:"Moderate",
    advice:"Rest in a dark, quiet room. OTC pain relievers may help. Consult a neurologist for recurring migraines." },
  { keywords:["runny nose","sneezing","sore throat","mild fever","congestion","cold"],
    disease:"Common Cold", severity:"Mild",
    advice:"Warm fluids, rest, and steam inhalation. Usually resolves in 7-10 days." },
  { keywords:["chest pain","chest pressure","left arm pain","jaw pain","sweating"],
    disease:"Possible Cardiac Event (Heart Attack)", severity:"Critical",
    advice:"CALL EMERGENCY SERVICES IMMEDIATELY (112 / 911). Do not drive yourself. Chew aspirin if not allergic." },
  { keywords:["stomach pain","abdominal pain","nausea","vomiting","diarrhea"],
    disease:"Gastroenteritis (Stomach Flu)", severity:"Moderate",
    advice:"Stay hydrated with ORS. Eat bland foods. See a doctor if symptoms are severe or persistent." },
  { keywords:["stomach pain","bloating","acid","heartburn","burping"],
    disease:"Acid Reflux / GERD", severity:"Mild",
    advice:"Avoid spicy and fatty foods, eat smaller meals, avoid lying down after eating. Antacids may help." },
  { keywords:["joint pain","stiffness","swelling","arthritis","knee pain"],
    disease:"Arthritis / Joint Inflammation", severity:"Moderate",
    advice:"Rest the affected joint, apply ice/heat. Consult an orthopedist for persistent pain." },
  { keywords:["back pain","lower back","lumbar","spine"],
    disease:"Lumbar Strain / Back Pain", severity:"Mild to Moderate",
    advice:"Apply heat/ice, gentle stretching. Consult a doctor if pain radiates to legs." },
  { keywords:["skin rash","itching","hives","redness","allergic"],
    disease:"Allergic Dermatitis / Urticaria", severity:"Mild to Moderate",
    advice:"Identify and avoid allergens. Antihistamines can relieve itching. See a dermatologist for persistent rashes." },
  { keywords:["dizziness","vertigo","spinning","balance","lightheaded"],
    disease:"Vertigo / Inner Ear Disorder", severity:"Moderate",
    advice:"Sit or lie down when dizzy. Avoid sudden head movements. See a doctor if episodes are frequent." },
  { keywords:["sore throat","difficulty swallowing","tonsil","white patches","strep"],
    disease:"Tonsillitis / Strep Throat", severity:"Moderate",
    advice:"Gargle with warm salt water. Antibiotics may be required - see a doctor." },
  { keywords:["frequent urination","burning urination","urinary","uti","bladder pain"],
    disease:"Urinary Tract Infection (UTI)", severity:"Moderate",
    advice:"Drink plenty of water. Antibiotics are usually needed - consult a doctor promptly." },
  { keywords:["high blood pressure","hypertension","bp high","severe headache","blurred vision"],
    disease:"Hypertensive Episode", severity:"High",
    advice:"Seek medical attention. Reduce salt intake, avoid stress. Take prescribed BP medication if you have it." },
  { keywords:["blood sugar","diabetes","excessive thirst","frequent urination","blurry vision"],
    disease:"Possible Diabetes / Hyperglycemia", severity:"High",
    advice:"Check blood sugar levels if possible. Consult a diabetologist. Avoid sugary foods immediately." },
  { keywords:["eye pain","blurred vision","red eye","discharge","conjunctivitis"],
    disease:"Conjunctivitis (Pink Eye) / Eye Infection", severity:"Mild to Moderate",
    advice:"Avoid touching eyes. Wash hands frequently. Consult an ophthalmologist for prescription eye drops." },
  { keywords:["toothache","dental pain","gum pain","swollen gum","tooth sensitivity"],
    disease:"Dental Infection / Toothache", severity:"Moderate",
    advice:"Rinse with warm salt water. OTC pain relievers help temporarily. Visit a dentist promptly." },
  { keywords:["ear pain","ear ache","ear infection","discharge from ear","hearing loss"],
    disease:"Otitis Media / Ear Infection", severity:"Moderate",
    advice:"Consult a doctor - antibiotics may be needed. Avoid inserting objects into the ear." },
  { keywords:["rash","fever","spots","measles","chickenpox","blisters"],
    disease:"Viral Exanthem (Measles / Chickenpox)", severity:"Moderate to High",
    advice:"Isolate to prevent spread. Consult a doctor for antiviral treatment and supportive care." },
  { keywords:["yellow skin","yellow eyes","jaundice","dark urine","liver"],
    disease:"Jaundice / Hepatitis", severity:"High",
    advice:"Seek medical attention immediately. Rest, avoid alcohol, and follow a liver-friendly diet." }
];

const severityEmoji = { "Mild":"\ud83d\udfe2","Mild to Moderate":"\ud83d\udfe1","Moderate":"\ud83d\udfe1",
  "Moderate to High":"\ud83d\udfe0","High":"\ud83d\udd34","Critical":"\ud83d\udea8" };

function analyzeSymptomsRuleBased(input) {
  const lower = input.toLowerCase();
  let best = null, bestScore = 0;
  for (const entry of symptomDatabase) {
    const matched = entry.keywords.filter(k => lower.includes(k.toLowerCase())).length;
    const score = matched / entry.keywords.length;
    if (matched > 0 && score > bestScore) { bestScore = score; best = entry; }
  }
  if (!best || bestScore < 0.15) {
    return { disease:"Unable to determine a specific condition", severity:"Unknown",
      advice:"Please describe symptoms in more detail (e.g. 'fever, headache, fatigue') or consult a doctor.",
      confidence:0, source:"rule" };
  }
  return { disease:best.disease, severity:best.severity,
    severityEmoji:severityEmoji[best.severity]||"\u26aa", advice:best.advice,
    confidence:Math.round(bestScore*100), source:"rule" };
}

// Look up severity/advice text for a disease name, whether it came from the
// rule engine or the trained model (the model only predicts a disease label).
function lookupAdvice(diseaseName) {
  const entry = symptomDatabase.find(e => e.disease === diseaseName);
  return entry
    ? { severity: entry.severity, advice: entry.advice, emoji: severityEmoji[entry.severity] || "\u26aa" }
    : { severity: "Unknown", advice: "Please consult a doctor for a full evaluation.", emoji: "\u26aa" };
}

// ════════════════════════════════════════════════════════
// MENTAL HEALTH CHAT  (rule-based fallback, Anthropic if key set)
// ════════════════════════════════════════════════════════
const mentalHealthRules = [
  { triggers:["suicid","end my life","kill myself","don't want to live","want to die"], urgent:true,
    reply:"I'm really concerned about what you just shared. Please reach out to a crisis helpline right now \u2014 you don't have to face this alone.\n\niCall (India): 9152987821\nInternational: https://findahelpline.com\n\nI'm here with you. Can you tell me what's been happening?" },
  { triggers:["anxious","anxiety","panic attack","panic","nervous","worried","overthinking"],
    reply:"It sounds like you're dealing with a lot of anxiety right now. That feeling can be really overwhelming.\n\nA technique that often helps in the moment: try box breathing \u2014 breathe in for 4 counts, hold for 4, breathe out for 4, hold for 4. Repeat 4 times.\n\nWould you like to talk about what's been triggering your anxiety?" },
  { triggers:["depress","sad","hopeless","empty","numb","worthless","meaningless","unmotivated"],
    reply:"Thank you for trusting me with this. Feeling depressed or hopeless is genuinely hard, and it takes courage to talk about it.\n\nRemember: these feelings are not a reflection of your worth, and they can get better with the right support.\n\nHave you been able to talk to anyone close to you \u2014 a friend, family member, or counsellor?" },
  { triggers:["lonely","alone","isolated","no one cares","no friends"],
    reply:"Feeling lonely is one of the most painful human experiences. You're not alone in feeling alone \u2014 and reaching out (like you're doing now) is a meaningful step.\n\nAre there any activities or communities you've considered exploring? Sometimes small steps \u2014 a class, a hobby group, even an online community \u2014 can help bridge that gap." },
  { triggers:["stress","stressed","overwhelmed","burnout","exhausted","can't cope"],
    reply:"It sounds like you're carrying a heavy load right now. Burnout and overwhelm are real \u2014 your mind and body are telling you something important.\n\nA few things that can help:\n- Break tasks into very small steps\n- Protect even 10 minutes of quiet time daily\n- Say no to one non-essential commitment this week\n\nWhat's weighing on you the most right now?" },
  { triggers:["sleep","insomnia","can't sleep","nightmares","tired","fatigue"],
    reply:"Sleep problems can really affect every part of life. Poor sleep and mental health are closely connected \u2014 each affects the other.\n\nSome evidence-based tips:\n- Keep a consistent sleep/wake time (even weekends)\n- Avoid screens 1 hour before bed\n- Keep your bedroom cool and dark\n- Write down worries before bed so your mind can let go\n\nHow long have you been struggling with sleep?" },
  { triggers:["anger","angry","rage","furious","frustrated","irritable"],
    reply:"Feeling angry is completely valid \u2014 it's a signal that something feels wrong or unfair. The key is finding healthy ways to process it.\n\nIn the heat of the moment, try stepping away briefly and doing some physical movement (even a short walk) before responding. It genuinely helps regulate the nervous system.\n\nWhat's been making you feel this way?" },
  { triggers:["grief","loss","died","death","miss","mourning","bereaved"],
    reply:"I'm so sorry for your loss. Grief is one of the most profound experiences we go through, and there's no right or wrong way to feel it.\n\nPlease be gentle with yourself. Grief isn't linear \u2014 it comes in waves, and that's completely normal.\n\nI'm here to listen. Would you like to tell me about them?" },
  { triggers:["self harm","cutting","hurting myself","hurt myself"],
    reply:"Thank you for telling me \u2014 that takes a lot of trust. What you're feeling is real and valid, and there are people who can help.\n\nPlease reach out to a counsellor or crisis line:\niCall: 9152987821 | Vandrevala Foundation: 1860-2662-345\n\nYou deserve care and support. Are you safe right now?" },
  { triggers:["happy","good","great","better","thank","thanks","helped"],
    reply:"I'm genuinely glad to hear that. Looking after your mental health is one of the most important things you can do.\n\nIs there anything else on your mind you'd like to talk through?" },
];

const defaultReplies = [
  "I'm here to listen. Could you tell me a bit more about what you're going through?",
  "That sounds really difficult. How long have you been feeling this way?",
  "Thank you for sharing that with me. Your feelings are valid. What kind of support are you looking for right now?",
  "It takes courage to talk about what's inside. I'm listening \u2014 please go on.",
  "I want to make sure I understand. Can you describe what this feels like for you day-to-day?",
];
let defaultIndex = 0;

function mentalHealthReply(message) {
  const lower = message.toLowerCase();
  for (const rule of mentalHealthRules) {
    if (rule.triggers.some(t => lower.includes(t))) return { reply: rule.reply, urgent: !!rule.urgent };
  }
  const reply = defaultReplies[defaultIndex % defaultReplies.length];
  defaultIndex++;
  return { reply, urgent: false };
}

// ════════════════════════════════════════════════════════
// AUTH ROUTES
// ════════════════════════════════════════════════════════

// Registration accepts multipart/form-data (so doctors can attach a
// certificate file) but also works for plain JSON (patients, who have no
// file to upload). multer parses the 'certificate' field if present and
// leaves req.body populated with the other text fields either way.
app.post("/api/auth/register", uploadDoctorFiles, (req, res) => {
  const {
    name, email, password, role, specialization, registrationNumber,
    practiceType, yearsExperience, clinicName, consultationFee, bio
  } = req.body || {};

  const certificateFile = req.files?.certificate?.[0] || null;
  const profilePhotoFile = req.files?.profilePhoto?.[0] || null;

  // Cleans up any files multer already wrote to disk before we reject the
  // request — otherwise a failed registration would leave orphaned uploads.
  function cleanupUploads() {
    if (certificateFile) fs.unlink(certificateFile.path, () => {});
    if (profilePhotoFile) fs.unlink(profilePhotoFile.path, () => {});
  }

  if (!name || !email || !password) {
    cleanupUploads();
    return res.status(400).json({ error: "Name, email, and password are required." });
  }
  if (password.length < 8) {
    cleanupUploads();
    return res.status(400).json({ error: "Password must be at least 8 characters." });
  }
  const safeRole = role === "doctor" ? "doctor" : "patient";

  let safePracticeType = null;
  if (safeRole === "doctor") {
    if (!specialization) {
      cleanupUploads();
      return res.status(400).json({ error: "Specialization is required for doctor accounts." });
    }
    if (!registrationNumber || !registrationNumber.trim()) {
      cleanupUploads();
      return res.status(400).json({ error: "Medical registration number is required for doctor accounts." });
    }
    if (!certificateFile) {
      cleanupUploads();
      return res.status(400).json({ error: "A certificate image or PDF is required for doctor accounts." });
    }
    if (practiceType !== "allopathy" && practiceType !== "homeopathy") {
      cleanupUploads();
      return res.status(400).json({ error: "Please select whether you practice Allopathy or Homeopathy." });
    }
    safePracticeType = practiceType;
  }

  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email.toLowerCase());
  if (existing) {
    cleanupUploads();
    return res.status(409).json({ error: "An account with this email already exists." });
  }

  // New doctor accounts start out pending until an admin approves them.
  // Patients don't need approval, so doctor_status stays NULL for them.
  const doctorStatus = safeRole === "doctor" ? "pending" : null;
  const certificatePath = certificateFile ? path.relative(__dirname, certificateFile.path) : null;
  const profileImagePath = profilePhotoFile ? path.relative(__dirname, profilePhotoFile.path) : null;

  // Optional richer profile fields — only meaningful for doctors, and all
  // optional so a minimal registration still works.
  const safeYearsExperience = safeRole === "doctor" && yearsExperience && !isNaN(parseInt(yearsExperience))
    ? Math.max(0, parseInt(yearsExperience)) : null;
  const safeClinicName = safeRole === "doctor" && clinicName ? clinicName.trim().slice(0, 200) : null;
  const safeConsultationFee = safeRole === "doctor" && consultationFee ? consultationFee.trim().slice(0, 50) : null;
  const safeBio = safeRole === "doctor" && bio ? bio.trim().slice(0, 1000) : null;

  const hash = hashPassword(password);
  const result = db
    .prepare(
      `INSERT INTO users (
         name, email, password_hash, role, specialization, registration_number,
         certificate_path, doctor_status, practice_type, years_experience,
         clinic_name, consultation_fee, bio, profile_image_path
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      name, email.toLowerCase(), hash, safeRole, specialization || null, registrationNumber || null,
      certificatePath, doctorStatus, safePracticeType, safeYearsExperience,
      safeClinicName, safeConsultationFee, safeBio, profileImagePath
    );

  const user = { id: result.lastInsertRowid, name, email: email.toLowerCase(), role: safeRole, doctorStatus };
  const token = signToken(user);
  res.status(201).json({ token, user });
});

// Multer errors (bad file type, too large, etc.) land here instead of
// crashing the request — without this, a rejected upload would otherwise
// surface as a generic 500.
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError || err.message?.includes("Certificate must be") || err.message?.includes("Profile photo must be")) {
    return res.status(400).json({ error: err.message });
  }
  next(err);
});

app.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "Email and password are required." });

  const row = db.prepare("SELECT * FROM users WHERE email = ?").get(email.toLowerCase());
  if (!row || !comparePassword(password, row.password_hash)) {
    return res.status(401).json({ error: "Invalid email or password." });
  }

  // Doctors can still log in even if pending/rejected — the portal shows
  // them a clear status screen rather than the dashboard in that case.
  const user = { id: row.id, name: row.name, email: row.email, role: row.role, doctorStatus: row.doctor_status, adminNotes: row.admin_notes };
  const token = signToken(user);
  res.json({ token, user });
});

app.get("/api/me", requireAuth, (req, res) => {
  const row = db.prepare("SELECT id, name, email, role, specialization, doctor_status, admin_notes, created_at FROM users WHERE id = ?").get(req.user.id);
  if (!row) return res.status(404).json({ error: "User not found." });
  res.json({ user: row });
});

// ════════════════════════════════════════════════════════
// SYMPTOM CHECK  (Allopathy diagnosis - now persisted + multi-tier AI)
// ════════════════════════════════════════════════════════
//
// Priority chain:
//   1. Your locally-run trained neural network (localTrainedModel.js) —
//      runs entirely on this machine, no network call, near-instant.
//      Used when it recognizes at least one symptom AND is confident
//      (>50%, matching the original model's own validation threshold).
//   2. Cloud relay (relayAI.js) — used when tier 1 found no symptoms or
//      wasn't confident. Can diagnose ANY disease, not just the 12 the
//      local model knows, but is hard-constrained to disease-only output
//      (it will not hold a normal conversation). Only runs if an API key
//      (GEMINI_API_KEY or ANTHROPIC_API_KEY) is configured.
//   3. The doctor-verified statistical model (model.js) — your original
//      trainable fallback, still useful once doctors have verified enough
//      cases.
//   4. The static rule-based keyword engine — always available, zero
//      dependencies, guarantees the feature works even with nothing else
//      configured.
app.post("/symptom-check", optionalAuth, async (req, res) => {
  const symptoms = req.body.symptoms?.trim();
  if (!symptoms || symptoms.length < 3) {
    return res.status(400).json({ disease:"No symptoms provided.",
      disclaimer:"Please describe your symptoms (e.g. 'fever, headache, fatigue')." });
  }

  let result;
  let offTopicMessage = null;

  // Tier 1: locally-run trained neural network
  const localResult = localTrainedModel.predict(symptoms);
  if (localResult && localResult.isConfident) {
    result = localResult;
  } else {
    // Tier 2: cloud relay (only fires if an API key is configured)
    const relayResult = await relayAI.tryRelay(symptoms);
    if (relayResult && relayResult.offTopic) {
      offTopicMessage = relayResult.advice;
    } else if (relayResult) {
      const emoji = severityEmoji[relayResult.severity] || "⚪";
      result = { ...relayResult, emoji };
    } else if (localResult) {
      // Local model found symptoms but wasn't confident, and relay is
      // unavailable — still better than nothing, use it anyway.
      result = localResult;
    } else {
      // Tier 3: doctor-verified statistical model
      const modelResult = predictWithModel(symptoms);
      if (modelResult && modelResult.confidence >= 50) {
        const { severity, advice, emoji } = lookupAdvice(modelResult.disease);
        result = { disease: modelResult.disease, severity, advice, emoji, confidence: modelResult.confidence, source: "model" };
      } else {
        // Tier 4: rule-based fallback — always available
        const ruleResult = analyzeSymptomsRuleBased(symptoms);
        result = { disease: ruleResult.disease, severity: ruleResult.severity, advice: ruleResult.advice,
          emoji: ruleResult.severityEmoji, confidence: ruleResult.confidence, source: "rule" };
      }
    }
  }

  if (offTopicMessage) {
    return res.json({
      offTopic: true,
      message: offTopicMessage
    });
  }

  const insert = db.prepare(
    `INSERT INTO symptom_checks (user_id, symptoms_text, predicted_disease, severity, confidence, source)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(req.user?.id || null, symptoms, result.disease, result.severity, result.confidence, result.source);

  res.json({
    checkId:     insert.lastInsertRowid,
    disease:     `${result.emoji || ""} ${result.disease}`.trim(),
    severity:    result.severity,
    advice:      result.advice,
    confidence:  result.confidence,
    source:      result.source,
    status:      "unverified",
    disclaimer:  "This is an AI-generated suggestion, NOT a confirmed medical diagnosis. It is pending review by a licensed doctor."
  });
});

// Patient can check status / history of their own submitted checks
app.get("/api/my-checks", requireAuth, (req, res) => {
  const rows = db.prepare(
    `SELECT id, symptoms_text, predicted_disease, severity, confidence, source, status,
            corrected_disease, doctor_notes, verified_at, created_at
     FROM symptom_checks WHERE user_id = ? ORDER BY created_at DESC`
  ).all(req.user.id);
  res.json({ checks: rows });
});

// ════════════════════════════════════════════════════════
// DOCTOR VERIFICATION WORKFLOW
// ════════════════════════════════════════════════════════

app.get("/api/doctor/queue", requireDoctor, (req, res) => {
  const rows = db.prepare(
    `SELECT id, symptoms_text, predicted_disease, severity, confidence, source, created_at
     FROM symptom_checks WHERE status = 'unverified' ORDER BY created_at ASC LIMIT 100`
  ).all();
  res.json({ queue: rows });
});

app.post("/api/doctor/verify/:id", requireDoctor, (req, res) => {
  const { id } = req.params;
  const { status, notes, correctedDisease } = req.body || {};

  if (!["verified", "rejected"].includes(status)) {
    return res.status(400).json({ error: "Status must be 'verified' or 'rejected'." });
  }

  const check = db.prepare("SELECT id FROM symptom_checks WHERE id = ?").get(id);
  if (!check) return res.status(404).json({ error: "Symptom check not found." });

  db.prepare(
    `UPDATE symptom_checks
     SET status = ?, doctor_notes = ?, corrected_disease = ?, verified_by = ?, verified_at = datetime('now')
     WHERE id = ?`
  ).run(status, notes || null, correctedDisease || null, req.user.id, id);

  res.json({ message: `Symptom check marked as ${status}.` });
});

app.get("/api/doctor/history", requireDoctor, (req, res) => {
  const rows = db.prepare(
    `SELECT id, symptoms_text, predicted_disease, corrected_disease, status, doctor_notes, verified_at
     FROM symptom_checks WHERE verified_by = ? ORDER BY verified_at DESC LIMIT 100`
  ).all(req.user.id);
  res.json({ history: rows });
});

// ════════════════════════════════════════════════════════
// ADMIN — doctor account approval workflow
// ════════════════════════════════════════════════════════
// New doctor registrations start out 'pending' and cannot access any
// /api/doctor/* routes until an admin approves them here. This protects the
// integrity of the verification workflow (and the data used to train the
// model) from anyone falsely registering as a doctor.

app.get("/api/admin/pending-doctors", requireAdmin, (req, res) => {
  const rows = db.prepare(
    `SELECT id, name, email, specialization, registration_number, practice_type,
            (certificate_path IS NOT NULL) AS has_certificate, created_at
     FROM users WHERE role = 'doctor' AND doctor_status = 'pending' ORDER BY created_at ASC`
  ).all();
  res.json({ pending: rows });
});

app.get("/api/admin/all-doctors", requireAdmin, (req, res) => {
  const rows = db.prepare(
    `SELECT id, name, email, specialization, registration_number, practice_type,
            (certificate_path IS NOT NULL) AS has_certificate, doctor_status, admin_notes, created_at
     FROM users WHERE role = 'doctor' ORDER BY created_at DESC`
  ).all();
  res.json({ doctors: rows });
});

// Serves a doctor's uploaded certificate so an admin can inspect it before
// approving. Restricted to admins only — this is sensitive identity
// document data, not something to expose publicly.
app.get("/api/admin/doctor-certificate/:id", requireAdmin, (req, res) => {
  const { id } = req.params;
  const row = db.prepare("SELECT certificate_path FROM users WHERE id = ? AND role = 'doctor'").get(id);
  if (!row || !row.certificate_path) {
    return res.status(404).json({ error: "No certificate on file for this doctor." });
  }
  const absolutePath = path.join(__dirname, row.certificate_path);
  if (!absolutePath.startsWith(CERT_DIR)) {
    return res.status(400).json({ error: "Invalid certificate path." }); // defense in depth
  }
  res.sendFile(absolutePath, (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: "Certificate file not found on disk." });
  });
});

// ════════════════════════════════════════════════════════
// PUBLIC DOCTOR DIRECTORY  (powers the Find a Doctor pages)
// ════════════════════════════════════════════════════════
//
// Only ever returns doctors with doctor_status = 'approved' — pending or
// rejected applications must never be visible to patients, regardless of
// what filters are passed in. No auth required: anyone visiting the
// Allopathy/Homeopathy doctor list pages should be able to see this.
app.get("/api/doctors", (req, res) => {
  const { type, specialization } = req.query;

  if (type && type !== "allopathy" && type !== "homeopathy") {
    return res.status(400).json({ error: "type must be 'allopathy' or 'homeopathy'." });
  }

  let sql = `
    SELECT id, name, specialization, registration_number, practice_type,
           years_experience, clinic_name, consultation_fee, bio,
           (profile_image_path IS NOT NULL) AS has_profile_photo, created_at
    FROM users
    WHERE role = 'doctor' AND doctor_status = 'approved'`;
  const params = [];

  if (type) { sql += ` AND practice_type = ?`; params.push(type); }
  if (specialization) { sql += ` AND specialization LIKE ?`; params.push(`%${specialization}%`); }
  sql += ` ORDER BY created_at DESC`;

  const rows = db.prepare(sql).all(...params);
  res.json({ doctors: rows });
});

// Public profile photo — safe to expose without auth (unlike the
// certificate, this is meant to be patient-facing).
app.get("/api/doctors/:id/photo", (req, res) => {
  const { id } = req.params;
  const row = db.prepare(
    "SELECT profile_image_path FROM users WHERE id = ? AND role = 'doctor' AND doctor_status = 'approved'"
  ).get(id);
  if (!row || !row.profile_image_path) {
    return res.status(404).json({ error: "No profile photo on file for this doctor." });
  }
  const absolutePath = path.join(__dirname, row.profile_image_path);
  if (!absolutePath.startsWith(PROFILE_DIR)) {
    return res.status(400).json({ error: "Invalid photo path." }); // defense in depth
  }
  res.sendFile(absolutePath, (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: "Photo file not found on disk." });
  });
});

app.post("/api/admin/approve-doctor/:id", requireAdmin, (req, res) => {
  const { id } = req.params;
  const { notes } = req.body || {};

  const doctor = db.prepare("SELECT id FROM users WHERE id = ? AND role = 'doctor'").get(id);
  if (!doctor) return res.status(404).json({ error: "Doctor account not found." });

  db.prepare("UPDATE users SET doctor_status = 'approved', admin_notes = ? WHERE id = ?").run(notes || null, id);
  res.json({ message: "Doctor account approved." });
});

app.post("/api/admin/reject-doctor/:id", requireAdmin, (req, res) => {
  const { id } = req.params;
  const { notes } = req.body || {};

  const doctor = db.prepare("SELECT id FROM users WHERE id = ? AND role = 'doctor'").get(id);
  if (!doctor) return res.status(404).json({ error: "Doctor account not found." });

  db.prepare("UPDATE users SET doctor_status = 'rejected', admin_notes = ? WHERE id = ?").run(notes || null, id);
  res.json({ message: "Doctor account rejected." });
});

// ════════════════════════════════════════════════════════
// MODEL TRAINING  (uses doctor-verified data as ground truth)
// ════════════════════════════════════════════════════════

app.get("/api/model/status", (req, res) => {
  const status = getModelStatus();
  const verifiedCount = db.prepare(`SELECT COUNT(*) AS n FROM symptom_checks WHERE status = 'verified'`).get().n;
  res.json({ ...status, verifiedRecordsAvailable: verifiedCount });
});

app.post("/api/model/train", requireDoctor, (req, res) => {
  try {
    const result = trainModel(db, req.user.id);
    res.json({ message: "Model trained successfully.", ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════
// MENTAL HEALTH CHAT
// ════════════════════════════════════════════════════════
app.post("/mental-health-chat", optionalAuth, async (req, res) => {
  const message = req.body.message?.trim();
  if (!message) return res.status(400).json({ reply: "Please type a message." });

  let reply, urgent = false;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey) {
    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 400,
          system: "You are MindCare, a compassionate mental health support chatbot for Medomitra.\n- Respond with warmth and empathy, never judgment\n- Ask open-ended follow-up questions\n- Suggest evidence-based coping techniques (breathing, grounding, journaling)\n- For crisis mentions (suicide, self-harm), always give Indian helplines: iCall 9152987821, Vandrevala Foundation 1860-2662-345\n- Keep responses to 3-5 sentences, conversational\n- You are not a replacement for professional care - gently encourage it when appropriate\n- Do NOT give physical/medical diagnoses - redirect to the Allopathy section for that",
          messages: [{ role: "user", content: message }]
        })
      });
      const data = await response.json();
      if (data.content?.[0]?.text) reply = data.content[0].text;
    } catch { /* fall through to rule-based */ }
  }

  if (!reply) {
    await new Promise(r => setTimeout(r, 400));
    const result = mentalHealthReply(message);
    reply = result.reply;
    urgent = result.urgent;
  }

  db.prepare("INSERT INTO mental_health_logs (user_id, message, reply, urgent) VALUES (?, ?, ?, ?)")
    .run(req.user?.id || null, message, reply, urgent ? 1 : 0);

  res.json({ reply, urgent });
});

// ════════════════════════════════════════════════════════
app.get("/health", (req, res) => res.json({ status: "ok", service: "Medomitra API", version: "3.0.0" }));

// 404 handler
app.use((req, res) => res.status(404).json({ error: "Route not found." }));

// Global error handler — catches anything thrown/rejected in a route
// (e.g. unexpected database errors) so the server stays up and the client
// gets a clean JSON response instead of a raw stack trace.
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err.message);
  res.status(500).json({ error: "Something went wrong on the server. Please try again." });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`MEDOMITRA API running at http://localhost:${PORT}`));
