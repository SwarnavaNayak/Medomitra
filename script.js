// =========================================================
// MEDOMITRA AI - Main Script
// =========================================================

const API_BASE = "http://localhost:5000";

// ---------------------------------------------------------
// AUTH HELPERS (shared across the homepage)
// ---------------------------------------------------------
function getToken() { return localStorage.getItem("medomitra_token"); }
function getUser() {
  try { return JSON.parse(localStorage.getItem("medomitra_user") || "null"); }
  catch { return null; }
}
function setSession(token, user) {
  localStorage.setItem("medomitra_token", token);
  localStorage.setItem("medomitra_user", JSON.stringify(user));
}
function clearSession() {
  localStorage.removeItem("medomitra_token");
  localStorage.removeItem("medomitra_user");
}

document.addEventListener("DOMContentLoaded", function () {
  renderNavAuthState();
  verifySessionIsStillValid();
});

// If the database was reset (or the account no longer exists) but an old
// token is still sitting in localStorage, silently clear it and refresh
// the navbar instead of letting stale-session errors surface later.
async function verifySessionIsStillValid() {
  const token = getToken();
  if (!token) return;
  try {
    const res = await fetch(`${API_BASE}/api/me`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.status === 401) {
      clearSession();
      renderNavAuthState();
    }
  } catch {
    // Server not reachable — leave the session as-is rather than logging
    // the user out just because the backend happens to be offline.
  }
}

function renderNavAuthState() {
  const user = getUser();
  const userConnect = document.getElementById("userConnect");
  if (!userConnect) return;

  const loginBtn  = document.getElementById("loginNavBtn");
  const signupBtn = document.getElementById("signupNavBtn");

  if (user) {
    // Logged in: hide Login/Sign Up, show "My Dashboard" + "Log Out"
    if (loginBtn)  loginBtn.style.display  = "none";
    if (signupBtn) signupBtn.style.display = "none";

    if (!document.getElementById("dashboardNavBtn")) {
      const dashBtn = document.createElement("button");
      dashBtn.id = "dashboardNavBtn";
      dashBtn.className = "btn1 btn-log";
      dashBtn.textContent = user.role === "doctor" ? `Dr. ${user.name.split(" ")[0]}` : user.name.split(" ")[0];
      dashBtn.onclick = () => {
        window.location.href = user.role === "doctor" ? "Doctor-Portal/dashboard.html" : "dashbord/dashboard.html";
      };
      userConnect.appendChild(dashBtn);
    }

    if (!document.getElementById("logoutNavBtn")) {
      const logoutBtn = document.createElement("button");
      logoutBtn.id = "logoutNavBtn";
      logoutBtn.className = "btn1 btn-red-sn";
      logoutBtn.textContent = "Log Out";
      logoutBtn.onclick = () => {
        clearSession();
        window.location.reload();
      };
      userConnect.appendChild(logoutBtn);
    }
  } else {
    // Logged out: show Login/Sign Up, remove any leftover Dashboard/Logout buttons
    if (loginBtn)  loginBtn.style.display  = "";
    if (signupBtn) signupBtn.style.display = "";
    document.getElementById("dashboardNavBtn")?.remove();
    document.getElementById("logoutNavBtn")?.remove();
  }
}

// ---------------------------------------------------------
// NAVBAR FLOATING WINDOWS
// ---------------------------------------------------------
function openSymptomWindow() {
  document.getElementById("symptomWindow").style.display = "block";
  document.getElementById("allopathyDr").style.display   = "none";
  document.getElementById("homeopathyDr").style.display  = "none";
}
function closeSymptomWindow()          { document.getElementById("symptomWindow").style.display  = "none"; }
function openAllopathyDoctorWindow()   {
  document.getElementById("allopathyDr").style.display  = "block";
  document.getElementById("homeopathyDr").style.display = "none";
  const s = document.getElementById("symptomWindow"); if (s) s.style.display = "none";
}
function closeAllopathyDoctorWindow()  { document.getElementById("allopathyDr").style.display  = "none"; }
function openHomeopathyDoctorWindow()  {
  document.getElementById("homeopathyDr").style.display = "block";
  document.getElementById("allopathyDr").style.display  = "none";
  const s = document.getElementById("symptomWindow"); if (s) s.style.display = "none";
}
function closeHomeopathyDoctorWindow() { document.getElementById("homeopathyDr").style.display = "none"; }

// ---------------------------------------------------------
// MENTAL HEALTH CHATBOT
// ---------------------------------------------------------
function toggleChat() {
  const chat = document.getElementById("chatWindow");
  if (!chat) return;
  const isOpen = chat.style.display === "flex";
  chat.style.display = isOpen ? "none" : "flex";
  if (!isOpen) {
    const msgs = document.getElementById("chatMessages");
    if (msgs && msgs.children.length === 0) {
      appendBotMessage("Hi, I'm **MindCare** - your mental health companion.\n\nI'm here to listen without judgment. How are you feeling today?");
    }
    const input = document.getElementById("userInput");
    if (input) input.focus();
  }
}

function appendBotMessage(text) {
  const messages = document.getElementById("chatMessages");
  if (!messages) return;
  const div = document.createElement("div");
  div.className = "message bot-message";
  div.innerHTML = text.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>").replace(/\n/g, "<br>");
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
  return div;
}

async function sendMessage() {
  const input = document.getElementById("userInput");
  if (!input) return;
  const msg = input.value.trim();
  if (!msg) return;

  const messages = document.getElementById("chatMessages");
  if (!messages) return;

  const userDiv = document.createElement("div");
  userDiv.className = "message user-message";
  userDiv.textContent = msg;
  messages.appendChild(userDiv);
  input.value = "";
  messages.scrollTop = messages.scrollHeight;

  const thinking = document.createElement("div");
  thinking.className = "message bot-message thinking";
  thinking.innerHTML = `<span class="dot"></span><span class="dot"></span><span class="dot"></span>`;
  messages.appendChild(thinking);
  messages.scrollTop = messages.scrollHeight;

  try {
    const token = getToken();
    const headers = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const response = await fetch(`${API_BASE}/mental-health-chat`, {
      method: "POST",
      headers,
      body: JSON.stringify({ message: msg })
    });
    const data = await response.json();
    thinking.remove();

    const botDiv = document.createElement("div");
    botDiv.className = "message bot-message" + (data.urgent ? " urgent-message" : "");
    botDiv.innerHTML = (data.reply || "I'm here to help. Please tell me more.")
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      .replace(/\n/g, "<br>");
    messages.appendChild(botDiv);
  } catch {
    thinking.remove();
    appendBotMessage("I'm having trouble connecting right now. If you're in crisis, please call iCall: **9152987821** immediately.");
  }

  messages.scrollTop = messages.scrollHeight;
}

document.addEventListener("DOMContentLoaded", function () {
  const userInput = document.getElementById("userInput");
  if (userInput) {
    userInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); sendMessage(); }
    });
  }
});

// ---------------------------------------------------------
// HERO - ANIMATED COUNTERS
// ---------------------------------------------------------
function animateCounter(element, target, duration = 2000) {
  let start = 0;
  const inc = target / (duration / 16);
  function tick() {
    start += inc;
    if (start < target) { element.textContent = Math.floor(start); requestAnimationFrame(tick); }
    else { element.textContent = target; }
  }
  tick();
}

document.addEventListener("DOMContentLoaded", function () {
  const trustObs = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.querySelectorAll(".trust-number").forEach(c =>
          animateCounter(c, parseInt(c.getAttribute("data-target")))
        );
        trustObs.unobserve(entry.target);
      }
    });
  }, { threshold: 0.5 });

  const ti = document.querySelector(".trust-indicators");
  if (ti) trustObs.observe(ti);
});

// ---------------------------------------------------------
// TREATMENT OPTION RIPPLE EFFECTS
// ---------------------------------------------------------
document.addEventListener("DOMContentLoaded", function () {
  const style = document.createElement("style");
  style.textContent = `
    @keyframes ripple { to { transform:scale(4); opacity:0; } }
    @keyframes dotBounce { 0%,80%,100%{transform:scale(0)} 40%{transform:scale(1)} }
    .thinking .dot { display:inline-block; width:8px; height:8px; background:#667eea;
      border-radius:50%; margin:0 2px; animation:dotBounce 1.4s ease-in-out infinite; }
    .thinking .dot:nth-child(2) { animation-delay:.16s; }
    .thinking .dot:nth-child(3) { animation-delay:.32s; }
    .urgent-message { background:#fff3cd !important; border-left:4px solid #e74c3c !important; color:#333 !important; }
  `;
  document.head.appendChild(style);

  document.querySelectorAll(".option").forEach(opt => {
    opt.addEventListener("click", function (e) {
      const r = document.createElement("div");
      Object.assign(r.style, { position:"absolute", borderRadius:"50%",
        background:"rgba(0,255,136,0.3)", transform:"scale(0)",
        animation:"ripple 0.6s linear", pointerEvents:"none",
        left:e.clientX-this.offsetLeft+"px", top:e.clientY-this.offsetTop+"px",
        width:"20px", height:"20px" });
      this.appendChild(r);
      setTimeout(() => r.remove(), 600);
    });
    opt.addEventListener("keydown", function (e) {
      if (e.key==="Enter"||e.key===" ") { e.preventDefault(); this.click(); }
    });
    opt.addEventListener("focus",  function () { this.style.transform = "translateX(-5px) scale(1.01)"; });
    opt.addEventListener("blur",   function () { this.style.transform = ""; });
  });
});

// ---------------------------------------------------------
// HOW IT WORKS - STEP PROGRESS
// ---------------------------------------------------------
document.addEventListener("DOMContentLoaded", function () {
  const stepIndicators = document.querySelectorAll(".step-indicator");
  const progressFill   = document.getElementById("progressFill");
  let heroStep = 1;

  function updateProgress(step) {
    if (progressFill) progressFill.style.width = (step / 3) * 100 + "%";
    stepIndicators.forEach((ind, i) => ind.classList.toggle("active", i + 1 <= step));
  }

  stepIndicators.forEach((ind, i) => {
    ind.addEventListener("click", () => { heroStep = i + 1; updateProgress(heroStep); });
  });
  document.querySelectorAll(".interactive-card").forEach(card => {
    card.addEventListener("mouseenter", () => updateProgress(parseInt(card.dataset.step)));
    card.addEventListener("click",      () => showDemo(parseInt(card.dataset.step)));
  });

  updateProgress(1);
});

// ---------------------------------------------------------
// DEMO MODAL
// ---------------------------------------------------------
let currentDemoStep = 1;

const demoContent = {
  1: { title:"Step 1: Symptom Search Demo", content:`
    <div class="demo-step">
      <h4>AI-Powered Symptom Analysis</h4>
      <p>Our advanced AI analyses your symptoms in real-time:</p>
      <ul>
        <li>Enter symptoms like "headache, fever, fatigue"</li>
        <li>Get instant AI-powered analysis with severity levels</li>
        <li>Every AI result is reviewed by a real doctor before being marked verified</li>
      </ul>
      <div class="demo-preview">
        <div class="result-preview">
          <div class="result-item"><span class="condition">Common Cold</span><span class="confidence">85% match</span></div>
          <div class="result-item"><span class="condition">Migraine</span><span class="confidence">72% match</span></div>
        </div>
      </div>
    </div>` },
  2: { title:"Step 2: Doctor Matching Demo", content:`
    <div class="demo-step">
      <h4>Expert Doctor Matching</h4>
      <p>Our system matches you with the right healthcare professional:</p>
      <ul>
        <li>AI analyses your symptoms and matches specialists</li>
        <li>View doctor availability, ratings and specialisations</li>
      </ul>
      <div class="demo-preview">
        <div class="doctor-card">
          <div class="doctor-info"><h5>Dr. Priya Sharma</h5><p>Neurologist - 12 years experience</p><div class="rating">4.9/5</div></div>
          <button class="book-btn">Book Appointment</button>
        </div>
      </div>
    </div>` },
  3: { title:"Step 3: Ongoing Support Demo", content:`
    <div class="demo-step">
      <h4>24/7 Support & Mental Health Care</h4>
      <ul>
        <li>MindCare AI chatbot - mental health support anytime</li>
        <li>Video consultations with doctors</li>
        <li>Prescription & follow-up management</li>
      </ul>
      <div class="demo-preview">
        <div class="support-options">
          <div class="support-item"><span>MindCare AI Chat</span></div>
          <div class="support-item"><span>Video Consultation</span></div>
          <div class="support-item"><span>Prescription Management</span></div>
        </div>
      </div>
    </div>` }
};

function showDemo(step) {
  currentDemoStep = step;
  const demo  = demoContent[step];
  const modal = document.getElementById("demoModal");
  if (!demo || !modal) return;
  document.getElementById("demoTitle").textContent = demo.title;
  document.getElementById("demoBody").innerHTML    = demo.content;
  modal.style.display = "block";
  const content = modal.querySelector(".demo-content");
  if (content) {
    content.style.cssText = "transform:translate(-50%,-50%) scale(0.8);opacity:0;transition:all 0.25s ease;";
    setTimeout(() => { content.style.transform = "translate(-50%,-50%) scale(1)"; content.style.opacity = "1"; }, 10);
  }
}
function closeDemo() { const m = document.getElementById("demoModal"); if (m) m.style.display = "none"; }
function prevDemo()  { if (currentDemoStep > 1) showDemo(currentDemoStep - 1); }
function nextDemo()  { if (currentDemoStep < 3) showDemo(currentDemoStep + 1); }

document.addEventListener("DOMContentLoaded", function () {
  const m = document.getElementById("demoModal");
  if (m) m.addEventListener("click", e => { if (e.target === m) closeDemo(); });
});

// ---------------------------------------------------------
// HEALTH ASSESSMENT (self-assessment quiz)
// ---------------------------------------------------------
let currentStep    = 1;
const totalSteps   = 10;
let   totalScore   = 0;
let   categoryScores = {};

function openAssessment() {
  const modal = document.getElementById("healthAssessmentModal");
  if (!modal) return;
  modal.style.display = "flex";
  restartAssessment();
}

function closeAssessment() {
  const modal = document.getElementById("healthAssessmentModal");
  if (modal) modal.style.display = "none";
}

function restartAssessment() {
  currentStep    = 1;
  totalScore     = 0;
  categoryScores = {};

  const result = document.getElementById("assessmentResult");
  const form   = document.getElementById("assessmentForm");
  if (result) result.style.display = "none";
  if (form)   form.style.display   = "block";

  // Reset ALL form steps: clear any inline styles left over from a previous
  // run (this was the bug that made every question disappear after the
  // first completed assessment) and remove the "active" class.
  document.querySelectorAll(".form-step").forEach(step => {
    step.classList.remove("active");
    step.style.display = "";
    step.style.opacity = "";
    step.querySelectorAll(".option-btn").forEach(btn => {
      btn.disabled = false;
      btn.style.cssText = "";
    });
  });

  const first = document.querySelector(`.form-step[data-step="1"]`);
  if (first) first.classList.add("active");

  updateAssessmentProgress();
}

function updateAssessmentProgress() {
  const bar = document.getElementById("assessmentProgressFill");
  const num = document.getElementById("currentQuestionNumber");
  if (bar) bar.style.width = ((currentStep / totalSteps) * 100) + "%";
  if (num) num.textContent = currentStep;
}

function nextAssessmentStep() {
  const cur = document.querySelector(`.form-step[data-step="${currentStep}"]`);
  if (cur) cur.classList.remove("active");

  currentStep++;

  if (currentStep <= totalSteps) {
    const next = document.querySelector(`.form-step[data-step="${currentStep}"]`);
    if (next) {
      next.style.display = "";
      next.classList.add("active");
    }
    updateAssessmentProgress();
  } else {
    showResults();
  }
}

function showResults() {
  const form   = document.getElementById("assessmentForm");
  const result = document.getElementById("assessmentResult");
  if (!form || !result) return;

  form.style.display   = "none";
  result.style.display = "block";

  const maxScore  = totalSteps * 5;
  const healthPct = Math.round((totalScore / maxScore) * 100);
  const scoreEl   = document.getElementById("healthScore");
  const contentEl = document.getElementById("resultContent");
  if (scoreEl) {
    scoreEl.textContent = healthPct;
    scoreEl.style.color = healthPct >= 70 ? "#00C896" : healthPct >= 40 ? "#f39c12" : "#e74c3c";
  }

  const recommendations = buildRecommendations();
  let html = `<div style="margin-bottom:16px;"><h5 style="margin-bottom:8px;">Category Scores</h5><ul style="list-style:none;padding:0;">`;
  for (const [cat, score] of Object.entries(categoryScores)) {
    const pct   = Math.round((score / 5) * 100);
    const color = score >= 4 ? "#00C896" : score === 3 ? "#f39c12" : "#e74c3c";
    html += `<li style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f0f0f0;">
      <span>${cat.charAt(0).toUpperCase()+cat.slice(1)}</span>
      <span style="font-weight:600;color:${color}">${score}/5 (${pct}%)</span></li>`;
  }
  html += `</ul></div>`;

  if (recommendations.length) {
    html += `<div><h5 style="margin-bottom:8px;">Personalised Recommendations</h5>`;
    recommendations.forEach(r => {
      html += `<div class="result-item" style="padding:10px;background:#f8f9ff;border-radius:8px;margin-bottom:8px;">
        <strong>${r.title}</strong><p style="margin:4px 0 0;font-size:.9em;color:#555;">${r.desc}</p></div>`;
    });
    html += `</div>`;
  }
  if (contentEl) contentEl.innerHTML = html;

  renderCharts(categoryScores);
}

function buildRecommendations() {
  const recs = [];
  if (categoryScores.energy    < 3) recs.push({ title:"Boost Your Energy",     desc:"Consider improving sleep quality and nutrition. A short daily walk can also raise energy levels significantly." });
  if (categoryScores.sleep     < 3) recs.push({ title:"Improve Sleep Habits",  desc:"Aim for 7-8 hours. Keep a consistent schedule, reduce screen time before bed, and avoid caffeine after 2 pm." });
  if (categoryScores.stress    < 3) recs.push({ title:"Manage Stress",         desc:"Try 10 minutes of mindfulness or box breathing daily. Writing in a journal can also help process stress." });
  if (categoryScores.exercise  < 3) recs.push({ title:"Move More",             desc:"Even 20-30 minutes of walking 4 times a week can improve mood, energy, and physical health." });
  if (categoryScores.nutrition < 3) recs.push({ title:"Improve Nutrition",     desc:"Focus on balanced meals with vegetables, protein, and whole grains. Reduce processed foods and sugar." });
  if (categoryScores.hydration < 3) recs.push({ title:"Stay Hydrated",         desc:"Aim for 8 glasses of water daily. Dehydration affects concentration, mood, and physical performance." });
  if (categoryScores.mental    < 3) recs.push({ title:"Sharpen Mental Clarity", desc:"Try brain exercises, reading, or mindfulness. Adequate sleep and regular exercise both improve focus." });
  if (categoryScores.social    < 3) recs.push({ title:"Nurture Social Bonds",  desc:"Make time for friends and family. Even brief social interactions have a positive impact on mental health." });
  recs.push({ title:"Regular Health Checkups", desc:"Schedule an annual checkup with your doctor to catch any health issues early." });
  return recs;
}

function renderCharts(scores) {
  const radarCanvas = document.getElementById("radarChart");
  const barCanvas   = document.getElementById("lineChart");
  if (!radarCanvas || !barCanvas || typeof Chart === "undefined") return;

  if (radarCanvas._chartInst) radarCanvas._chartInst.destroy();
  if (barCanvas._chartInst)   barCanvas._chartInst.destroy();

  const labels = Object.keys(scores).map(k => k.charAt(0).toUpperCase() + k.slice(1));
  const values = Object.values(scores);

  radarCanvas._chartInst = new Chart(radarCanvas.getContext("2d"), {
    type: "radar",
    data: { labels, datasets: [{ label:"Your Health", data:values,
        backgroundColor:"rgba(0,200,150,0.2)", borderColor:"#00C896",
        borderWidth:2, pointBackgroundColor:"#00C896", pointRadius:4 }] },
    options: { scales:{ r:{ suggestedMin:0, suggestedMax:5, ticks:{ stepSize:1 } } },
               plugins:{ legend:{ display:false } } }
  });

  barCanvas._chartInst = new Chart(barCanvas.getContext("2d"), {
    type: "bar",
    data: { labels, datasets: [{ label:"Score (out of 5)", data:values,
        backgroundColor: values.map(v => v>=4?"rgba(0,200,150,.75)": v===3?"rgba(243,156,18,.75)":"rgba(231,76,60,.75)"),
        borderRadius: 6 }] },
    options: { scales:{ y:{ suggestedMin:0, suggestedMax:5, ticks:{ stepSize:1 } } },
               plugins:{ legend:{ display:false } } }
  });
}

// Single delegated click listener for assessment options
document.addEventListener("DOMContentLoaded", function () {
  const assessmentForm = document.getElementById("assessmentForm");
  if (assessmentForm) {
    assessmentForm.addEventListener("click", function (e) {
      const btn = e.target.closest(".option-btn");
      if (!btn || btn.disabled) return;

      const stepEl = btn.closest(".form-step");
      if (!stepEl) return;

      stepEl.querySelectorAll(".option-btn").forEach(b => {
        b.disabled = true;
        b.style.opacity = "0.5";
        b.style.background = "";
        b.style.color = "";
      });
      btn.style.opacity    = "1";
      btn.style.background = "#00C896";
      btn.style.color      = "#fff";

      const val = parseInt(btn.dataset.value);
      const cat = btn.dataset.category;
      if (cat) { categoryScores[cat] = val; totalScore += val; }

      setTimeout(nextAssessmentStep, 450);
    });
  }

  const assessModal = document.getElementById("healthAssessmentModal");
  if (assessModal) assessModal.addEventListener("click", e => { if (e.target===assessModal) closeAssessment(); });

  const loginModal = document.getElementById("loginModal");
  if (loginModal)  loginModal.addEventListener("click",  e => { if (e.target===loginModal) closeLogin(); });
});

// ---------------------------------------------------------
// LOGIN MODAL (homepage quick-login - now hits the real API)
// ---------------------------------------------------------
function closeLogin() {
  const m = document.getElementById("loginModal");
  if (m) m.style.display = "none";
}

async function handleLogin() {
  const emailEl = document.getElementById("email");
  const passEl  = document.getElementById("password");
  const email = (emailEl?.value || "").trim();
  const pass  = passEl?.value || "";

  if (!email || !pass) { alert("Please enter both email and password."); return; }

  try {
    const res = await fetch(`${API_BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: pass })
    });
    const data = await res.json();

    if (!res.ok) { alert(data.error || "Login failed."); return; }

    setSession(data.token, data.user);
    closeLogin();
    renderNavAuthState();

    if (data.user.role === "doctor") {
      window.location.href = "Doctor-Portal/dashboard.html";
    } else {
      openAssessment();
    }
  } catch {
    alert("Could not reach the server. Please make sure the backend (server.js) is running.");
  }
}

function showSignup()          { window.location.href = "Sign_Up/Register.html"; }
function showForgotPassword()  { alert("Password reset - please contact support."); }

// ---------------------------------------------------------
// ACTION BUTTONS
// ---------------------------------------------------------
function openChatBot() {
  const chat = document.getElementById("chatWindow");
  if (chat) { chat.style.display = "flex"; }
  closeAssessment();
}
function bookDoctor() { window.location.href = "Doctor_List/AlloDocList.html"; }
