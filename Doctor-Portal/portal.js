// portal.js — Medomitra Doctor Portal

const API = "http://localhost:5000";
let TOKEN = localStorage.getItem("medomitra_doctor_token") || null;
let CURRENT_USER = JSON.parse(localStorage.getItem("medomitra_doctor_user") || "null");
let activeCheckId = null;

// ─────────────────────────────────────────────
// API HELPER
// ─────────────────────────────────────────────
async function api(method, path, body) {
  const headers = { "Content-Type": "application/json" };
  if (TOKEN) headers["Authorization"] = `Bearer ${TOKEN}`;
  const res = await fetch(API + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    // Token expired / user no longer exists — force re-login
    TOKEN = null;
    CURRENT_USER = null;
    localStorage.removeItem("medomitra_doctor_token");
    localStorage.removeItem("medomitra_doctor_user");
    document.getElementById("dashboardView")?.classList.add("hidden");
    document.getElementById("loginView")?.classList.remove("hidden");
    throw new Error(data.error || "Your session has expired. Please log in again.");
  }
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

// ─────────────────────────────────────────────
// AUTH TABS
// ─────────────────────────────────────────────
document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".auth-form").forEach(f => f.classList.remove("active-form"));
    btn.classList.add("active");
    document.getElementById(btn.dataset.tab === "login" ? "loginForm" : "registerForm").classList.add("active-form");
  });
});

// ─────────────────────────────────────────────
// LOGIN / REGISTER
// ─────────────────────────────────────────────
document.getElementById("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;
  const errEl = document.getElementById("loginError");
  errEl.textContent = "";

  try {
    const data = await api("POST", "/api/auth/login", { email, password });
    if (data.user.role !== "doctor" && data.user.role !== "admin") {
      errEl.textContent = "This portal is for doctors only. Please use the main site to log in as a patient.";
      return;
    }
    setSession(data.token, data.user);
  } catch (err) {
    errEl.textContent = err.message;
  }
});

document.getElementById("registerForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = document.getElementById("regName").value.trim();
  const email = document.getElementById("regEmail").value.trim();
  const specialization = document.getElementById("regSpecialization").value.trim();
  const password = document.getElementById("regPassword").value;
  const errEl = document.getElementById("registerError");
  errEl.textContent = "";

  try {
    const data = await api("POST", "/api/auth/register", {
      name, email, password, role: "doctor", specialization
    });
    setSession(data.token, data.user);
  } catch (err) {
    errEl.textContent = err.message;
  }
});

function setSession(token, user) {
  TOKEN = token;
  CURRENT_USER = user;
  localStorage.setItem("medomitra_doctor_token", token);
  localStorage.setItem("medomitra_doctor_user", JSON.stringify(user));
  routeToCorrectView();
}

document.getElementById("logoutBtn").addEventListener("click", logout);
document.getElementById("statusLogoutBtn").addEventListener("click", logout);

function logout() {
  TOKEN = null;
  CURRENT_USER = null;
  localStorage.removeItem("medomitra_doctor_token");
  localStorage.removeItem("medomitra_doctor_user");
  document.getElementById("dashboardView").classList.add("hidden");
  document.getElementById("statusView").classList.add("hidden");
  document.getElementById("loginView").classList.remove("hidden");
}

// Admins always go straight to the dashboard. Doctors only get in once
// approved — pending/rejected doctors see a status screen instead, since
// the backend will reject every /api/doctor/* call until they're approved
// anyway, and silently failing requests would be a confusing dead end.
function routeToCorrectView() {
  if (CURRENT_USER.role === "admin") {
    showDashboard();
    return;
  }
  if (CURRENT_USER.doctorStatus === "approved") {
    showDashboard();
  } else {
    showStatusScreen(CURRENT_USER.doctorStatus);
  }
}

function showStatusScreen(status) {
  document.getElementById("loginView").classList.add("hidden");
  document.getElementById("dashboardView").classList.add("hidden");
  document.getElementById("statusView").classList.remove("hidden");

  const icon = document.getElementById("statusIcon");
  const title = document.getElementById("statusTitle");
  const message = document.getElementById("statusMessage");
  const notesEl = document.getElementById("statusNotes");
  const card = document.querySelector("#statusView .status-card");

  if (status === "rejected") {
    card.classList.add("status-rejected");
    icon.className = "fa-solid fa-circle-xmark";
    title.textContent = "Application Not Approved";
    message.textContent = "Your doctor account application was not approved by an admin. If you believe this is a mistake, please contact support.";
  } else {
    card.classList.remove("status-rejected");
    icon.className = "fa-solid fa-user-clock";
    title.textContent = "Pending Approval";
    message.textContent = "Your doctor account is awaiting review by an admin. You'll be able to access the portal once approved — feel free to check back later.";
  }

  if (CURRENT_USER.adminNotes) {
    notesEl.innerHTML = `<strong>Note from admin:</strong> ${escapeHtml(CURRENT_USER.adminNotes)}`;
    notesEl.classList.remove("hidden");
  } else {
    notesEl.classList.add("hidden");
  }
}

function showDashboard() {
  document.getElementById("loginView").classList.add("hidden");
  document.getElementById("statusView").classList.add("hidden");
  document.getElementById("dashboardView").classList.remove("hidden");
  document.getElementById("docName").textContent = CURRENT_USER.role === "admin" ? CURRENT_USER.name : `Dr. ${CURRENT_USER.name}`;
  loadQueue();
}

// ─────────────────────────────────────────────
// PORTAL TABS (Queue / History / Train)
// ─────────────────────────────────────────────
document.querySelectorAll(".ptab").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".ptab").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".portal-section").forEach(s => s.classList.add("hidden"));
    btn.classList.add("active");

    const view = btn.dataset.view;
    if (view === "queue")   { document.getElementById("queueSection").classList.remove("hidden");   loadQueue(); }
    if (view === "history") { document.getElementById("historySection").classList.remove("hidden"); loadHistory(); }
    if (view === "train")   { document.getElementById("trainSection").classList.remove("hidden");   loadModelStatus(); }
  });
});

// ─────────────────────────────────────────────
// QUEUE
// ─────────────────────────────────────────────
async function loadQueue() {
  const list = document.getElementById("queueList");
  list.innerHTML = `<p class="empty-state">Loading…</p>`;
  try {
    const data = await api("GET", "/api/doctor/queue");
    if (!data.queue.length) {
      list.innerHTML = `<p class="empty-state">🎉 No pending checks — the queue is clear!</p>`;
      return;
    }
    list.innerHTML = data.queue.map(renderQueueCard).join("");
    list.querySelectorAll(".review-btn").forEach(btn => {
      btn.addEventListener("click", () => openVerifyModal(JSON.parse(btn.dataset.check)));
    });
  } catch (err) {
    list.innerHTML = `<p class="empty-state">Error loading queue: ${err.message}</p>`;
  }
}

const SOURCE_BADGES = {
  "local-trained-model": `<span class="badge local-ai-source">🧬 Local Trained Model</span>`,
  "relay-ai":             `<span class="badge relay-ai-source">☁️ Relay AI</span>`,
  "model":                `<span class="badge model-source">🧠 Verified Model</span>`,
  "rule":                 `<span class="badge rule-source">📋 Rule-based</span>`
};

function renderQueueCard(c) {
  const sourceBadge = SOURCE_BADGES[c.source] || "";
  return `
    <div class="check-card">
      <div>
        <p class="symptoms">"${escapeHtml(c.symptoms_text)}"</p>
        <div style="margin-top:8px; display:flex; gap:8px; flex-wrap:wrap;">
          <span class="badge disease">${escapeHtml(c.predicted_disease)}</span>
          ${sourceBadge}
        </div>
      </div>
      <div class="meta">
        <span>Confidence: ${c.confidence}%</span>
        <span>${new Date(c.created_at).toLocaleString()}</span>
      </div>
      <button class="review-btn" data-check='${JSON.stringify(c).replace(/'/g, "&apos;")}'>Review →</button>
    </div>`;
}

document.getElementById("refreshQueue").addEventListener("click", loadQueue);

// ─────────────────────────────────────────────
// VERIFY MODAL
// ─────────────────────────────────────────────
function openVerifyModal(check) {
  activeCheckId = check.id;
  document.getElementById("verifySymptoms").textContent = check.symptoms_text;
  document.getElementById("verifyPrediction").textContent = check.predicted_disease;
  document.getElementById("verifyConfidence").textContent = `${check.confidence}%`;
  const sourceLabels = {
    "local-trained-model": "Local Trained Neural Network",
    "relay-ai": "Cloud Relay AI",
    "model": "Doctor-Verified Statistical Model",
    "rule": "Rule-based Engine"
  };
  document.getElementById("verifySource").textContent = sourceLabels[check.source] || check.source;
  document.getElementById("verifyNotes").value = "";
  document.getElementById("correctedDisease").value = "";
  document.getElementById("verifyModal").classList.remove("hidden");
}

document.getElementById("closeVerifyModal").addEventListener("click", () => {
  document.getElementById("verifyModal").classList.add("hidden");
});

async function submitVerification(status) {
  const notes = document.getElementById("verifyNotes").value.trim();
  const correctedDisease = document.getElementById("correctedDisease").value.trim();
  try {
    await api("POST", `/api/doctor/verify/${activeCheckId}`, {
      status, notes: notes || undefined, correctedDisease: correctedDisease || undefined
    });
    document.getElementById("verifyModal").classList.add("hidden");
    loadQueue();
  } catch (err) {
    alert("Error: " + err.message);
  }
}

document.getElementById("approveBtn").addEventListener("click", () => submitVerification("verified"));
document.getElementById("rejectBtn").addEventListener("click", () => submitVerification("rejected"));

// ─────────────────────────────────────────────
// HISTORY
// ─────────────────────────────────────────────
async function loadHistory() {
  const list = document.getElementById("historyList");
  list.innerHTML = `<p class="empty-state">Loading…</p>`;
  try {
    const data = await api("GET", "/api/doctor/history");
    if (!data.history.length) {
      list.innerHTML = `<p class="empty-state">You haven't verified any checks yet.</p>`;
      return;
    }
    list.innerHTML = data.history.map(h => `
      <div class="check-card">
        <div>
          <p class="symptoms">"${escapeHtml(h.symptoms_text)}"</p>
          <div style="margin-top:8px; display:flex; gap:8px; flex-wrap:wrap;">
            <span class="badge disease">${escapeHtml(h.corrected_disease || h.predicted_disease)}</span>
            <span class="badge ${h.status}">${h.status}</span>
          </div>
          ${h.doctor_notes ? `<p style="margin-top:8px; font-size:.85rem; color:#9aa3af;">📝 ${escapeHtml(h.doctor_notes)}</p>` : ""}
        </div>
        <div class="meta">
          <span>${new Date(h.verified_at).toLocaleString()}</span>
        </div>
      </div>`).join("");
  } catch (err) {
    list.innerHTML = `<p class="empty-state">Error loading history: ${err.message}</p>`;
  }
}

// ─────────────────────────────────────────────
// TRAIN MODEL
// ─────────────────────────────────────────────
async function loadModelStatus() {
  const el = document.getElementById("modelStatus");
  try {
    const status = await api("GET", "/api/model/status");
    if (status.trained) {
      el.innerHTML = `
        ✅ <strong>Model is trained</strong><br>
        Last trained: ${new Date(status.trainedAt).toLocaleString()}<br>
        Training samples: ${status.trainingSamples}<br>
        Diseases learned: ${status.classes.join(", ")}<br><br>
        🔬 New verified records available since last training: <strong>${status.verifiedRecordsAvailable}</strong>`;
    } else {
      el.innerHTML = `
        ⚪ <strong>No trained model yet</strong><br>
        Verified records available: <strong>${status.verifiedRecordsAvailable}</strong> (minimum 5 needed)<br><br>
        Verify more symptom checks in the Review Queue, then come back here to train.`;
    }
  } catch (err) {
    el.textContent = "Error loading model status: " + err.message;
  }
}

document.getElementById("trainBtn").addEventListener("click", async () => {
  const btn = document.getElementById("trainBtn");
  const resultEl = document.getElementById("trainResult");
  btn.disabled = true;
  btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Training…`;
  resultEl.textContent = "";
  resultEl.className = "train-result";

  try {
    const result = await api("POST", "/api/model/train", {});
    resultEl.textContent = `✅ Trained on ${result.trainingSamples} verified samples across ${result.classes.length} conditions.`;
    resultEl.className = "train-result success";
    loadModelStatus();
  } catch (err) {
    resultEl.textContent = "❌ " + err.message;
    resultEl.className = "train-result error";
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<i class="fa-solid fa-brain"></i> Train Model Now`;
  }
});

// ─────────────────────────────────────────────
// UTIL
// ─────────────────────────────────────────────
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ─────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────
if (TOKEN && CURRENT_USER) {
  routeToCorrectView();
}
