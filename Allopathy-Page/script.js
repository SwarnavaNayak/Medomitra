const placeholders = [
    "Fever, headache, fatigue...",
    "Cough, sore throat, congestion...",
    "Joint pain, muscle stiffness...",
    "Skin rash, itching, redness...",
    "Nausea, vomiting, stomach pain..."
  ];
  
  let index = 0;
  let repeatCount = 0;
  const maxRepeats = 5;
  const inputField = document.getElementById("search");
  
  function typeEffect(text, callback) {
    let i = 0;
    inputField.placeholder = "";
    const interval = setInterval(() => {
      if (i < text.length) {
        inputField.placeholder += text[i];
        i++;
      } else {
        clearInterval(interval);
        setTimeout(() => deleteEffect(callback), 2000);
      }
    }, 100);
  }
  
  const symptomSuggestions = [
    "Fever", "Cough", "Headache", "Cold", "Fatigue",
    "Chest Pain", "Back Pain", "Nausea", "Vomiting",
    "Shortness of Breath", "Diarrhea", "Sore Throat",
    "Muscle Ache", "Dizziness", "Skin Rash"
  ];
  const input = document.getElementById("search");
  const suggestionBox = document.getElementById("suggestionBox");
  
  input.addEventListener("input", function () {
    const value = this.value.toLowerCase();
    suggestionBox.innerHTML = ""; // clear previous suggestions
  
    if (value === "") return;
  
    const filtered = symptomSuggestions.filter(symptom =>
      symptom.toLowerCase().includes(value)
    );
  
    filtered.forEach(symptom => {
      const div = document.createElement("div");
      div.textContent = symptom;
      div.onclick = () => {
        input.value = symptom;
        suggestionBox.innerHTML = "";
      };
      suggestionBox.appendChild(div);
    });
  });
  
  document.addEventListener("click", function (e) {
    if (!suggestionBox.contains(e.target) && e.target !== input) {
      suggestionBox.innerHTML = "";
    }
  });

  // Optional: Close suggestions when clicking outside

function deleteEffect(callback) {
  let text = inputField.placeholder;
  let i = text.length;
  const interval = setInterval(() => {
    if (i > 0) {
      inputField.placeholder = text.substring(0, i - 1);
      i--;
    } else {
      clearInterval(interval);
      callback();
    }
  }, 100);
}

function updatePlaceholder() {
  if (repeatCount >= maxRepeats) return;
  typeEffect(placeholders[index], () => {
    index = (index + 1) % placeholders.length;
    if (index === 0) repeatCount++;
    setTimeout(updatePlaceholder, 500);
  });
}

updatePlaceholder();

// =========================================================
// INSTANT DIAGNOSIS — swift, prompt symptom analysis
// =========================================================
const API_BASE = "http://localhost:5000";
const diagnoseBtn   = document.getElementById("diagnoseBtn");
const resultPanel   = document.getElementById("diagnosisResult");

const severityClassMap = {
  "Critical": "severity-critical",
  "High": "severity-high",
  "Moderate to High": "severity-high",
  "Moderate": "severity-moderate",
  "Mild to Moderate": "severity-moderate",
  "Mild": "severity-mild",
  "Unknown": "severity-unknown"
};

function getAuthToken() {
  return localStorage.getItem("medomitra_token");
}

function showDiagnosisLoading() {
  resultPanel.className = "diagnosis-result";
  resultPanel.innerHTML = `
    <div class="dr-loading">
      <div class="dr-spinner"></div>
      <span>Analyzing your symptoms…</span>
    </div>`;
}

function showOffTopicMessage(message) {
  resultPanel.className = "diagnosis-result severity-unknown";
  resultPanel.innerHTML = `
    <div class="dr-inner">
      <div class="dr-header">
        <div class="dr-disease">🩺 Symptoms Needed</div>
        <button class="dr-close" id="drCloseBtn" aria-label="Close">✕</button>
      </div>
      <div class="dr-advice">${escapeHtml(message || "I can only help assess physical symptoms. Please describe what you're experiencing (e.g. fever, cough, pain).")}</div>
    </div>`;
  document.getElementById("drCloseBtn")?.addEventListener("click", () => {
    resultPanel.classList.add("hidden");
  });
}

function showDiagnosisError(message) {
  resultPanel.className = "diagnosis-result";
  resultPanel.innerHTML = `
    <div class="dr-error">
      ⚠️ ${escapeHtml(message)}
      <div class="dr-actions" style="margin-top:10px;">
        <button class="dr-retry-btn" id="drRetryBtn">Try Again</button>
      </div>
    </div>`;
  document.getElementById("drRetryBtn")?.addEventListener("click", runDiagnosis);
}

const SOURCE_BADGES = {
  "local-trained-model": `<span class="dr-badge source-local-ai">🧬 Local Trained Model</span>`,
  "relay-ai":             `<span class="dr-badge source-relay-ai">☁️ Relay AI</span>`,
  "model":                `<span class="dr-badge source-model">🧠 Verified Model</span>`,
  "rule":                 `<span class="dr-badge source-rule">📋 Rule-based</span>`
};

function renderDiagnosisResult(data) {
  const severityClass = severityClassMap[data.severity] || "severity-unknown";
  resultPanel.className = `diagnosis-result ${severityClass}`;

  const sourceBadge = SOURCE_BADGES[data.source] || "";

  resultPanel.innerHTML = `
    <div class="dr-inner">
      <div class="dr-header">
        <div class="dr-disease">${escapeHtml(data.disease)}</div>
        <button class="dr-close" id="drCloseBtn" aria-label="Close">✕</button>
      </div>
      <div class="dr-meta">
        <span class="dr-badge confidence">Confidence: ${data.confidence}%</span>
        ${sourceBadge}
        <span class="dr-badge pending">⏳ Pending Doctor Review</span>
      </div>
      <div class="dr-advice">${escapeHtml(data.advice || "")}</div>
      <div class="dr-disclaimer">${escapeHtml(data.disclaimer || "")}</div>
      <div class="dr-actions">
        <a class="dr-book-btn" href="../Doctor_List/AlloDocList.html">Book a Doctor →</a>
        <button class="dr-retry-btn" id="drNewCheckBtn">New Check</button>
      </div>
    </div>`;

  document.getElementById("drCloseBtn")?.addEventListener("click", () => {
    resultPanel.classList.add("hidden");
  });
  document.getElementById("drNewCheckBtn")?.addEventListener("click", () => {
    resultPanel.classList.add("hidden");
    input.value = "";
    input.focus();
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

async function runDiagnosis() {
  const symptoms = input.value.trim();
  if (symptoms.length < 3) {
    resultPanel.className = "diagnosis-result";
    resultPanel.innerHTML = `<div class="dr-error">Please describe your symptoms in a bit more detail (e.g. "fever, headache, fatigue").</div>`;
    resultPanel.classList.remove("hidden");
    input.focus();
    return;
  }

  suggestionBox.innerHTML = "";
  resultPanel.classList.remove("hidden");
  showDiagnosisLoading();

  diagnoseBtn.disabled = true;
  const originalLabel = diagnoseBtn.innerHTML;
  diagnoseBtn.innerHTML = `<span class="btn-icon">⏳</span> Analyzing…`;

  try {
    const headers = { "Content-Type": "application/json" };
    const token = getAuthToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const res = await fetch(`${API_BASE}/symptom-check`, {
      method: "POST",
      headers,
      body: JSON.stringify({ symptoms })
    });
    const data = await res.json();

    if (!res.ok) {
      showDiagnosisError(data.disclaimer || data.error || "Could not analyze symptoms. Please try again.");
      return;
    }
    if (data.offTopic) {
      showOffTopicMessage(data.message);
      return;
    }
    renderDiagnosisResult(data);
  } catch (err) {
    showDiagnosisError("Could not reach the diagnosis server. Please make sure the backend is running and try again.");
  } finally {
    diagnoseBtn.disabled = false;
    diagnoseBtn.innerHTML = originalLabel;
  }
}

diagnoseBtn.addEventListener("click", runDiagnosis);
input.addEventListener("keydown", function (e) {
  if (e.key === "Enter") {
    e.preventDefault();
    runDiagnosis();
  }
});
