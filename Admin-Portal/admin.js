// admin.js — Medomitra Admin Portal

const API = "http://localhost:5000";
let TOKEN = localStorage.getItem("medomitra_admin_token") || null;
let CURRENT_USER = JSON.parse(localStorage.getItem("medomitra_admin_user") || "null");
let activeDoctorId = null;

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
    TOKEN = null;
    CURRENT_USER = null;
    localStorage.removeItem("medomitra_admin_token");
    localStorage.removeItem("medomitra_admin_user");
    document.getElementById("dashboardView")?.classList.add("hidden");
    document.getElementById("loginView")?.classList.remove("hidden");
    throw new Error(data.error || "Your session has expired. Please log in again.");
  }
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

// ─────────────────────────────────────────────
// LOGIN
// ─────────────────────────────────────────────
document.getElementById("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;
  const errEl = document.getElementById("loginError");
  errEl.textContent = "";

  try {
    const data = await api("POST", "/api/auth/login", { email, password });
    if (data.user.role !== "admin") {
      errEl.textContent = "This portal is for admin accounts only.";
      return;
    }
    setSession(data.token, data.user);
  } catch (err) {
    errEl.textContent = err.message;
  }
});

function setSession(token, user) {
  TOKEN = token;
  CURRENT_USER = user;
  localStorage.setItem("medomitra_admin_token", token);
  localStorage.setItem("medomitra_admin_user", JSON.stringify(user));
  showDashboard();
}

document.getElementById("logoutBtn").addEventListener("click", () => {
  TOKEN = null;
  CURRENT_USER = null;
  localStorage.removeItem("medomitra_admin_token");
  localStorage.removeItem("medomitra_admin_user");
  document.getElementById("dashboardView").classList.add("hidden");
  document.getElementById("loginView").classList.remove("hidden");
});

function showDashboard() {
  document.getElementById("loginView").classList.add("hidden");
  document.getElementById("dashboardView").classList.remove("hidden");
  document.getElementById("adminName").textContent = CURRENT_USER.name;
  loadPending();
}

// ─────────────────────────────────────────────
// TABS
// ─────────────────────────────────────────────
document.querySelectorAll(".ptab").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".ptab").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".portal-section").forEach(s => s.classList.add("hidden"));
    btn.classList.add("active");

    const view = btn.dataset.view;
    if (view === "pending") { document.getElementById("pendingSection").classList.remove("hidden"); loadPending(); }
    if (view === "all")     { document.getElementById("allSection").classList.remove("hidden");     loadAll(); }
  });
});

// ─────────────────────────────────────────────
// PENDING DOCTORS
// ─────────────────────────────────────────────
async function loadPending() {
  const list = document.getElementById("pendingList");
  list.innerHTML = `<p class="empty-state">Loading…</p>`;
  try {
    const data = await api("GET", "/api/admin/pending-doctors");
    if (!data.pending.length) {
      list.innerHTML = `<p class="empty-state">🎉 No pending applications — all caught up!</p>`;
      return;
    }
    list.innerHTML = data.pending.map(renderPendingCard).join("");
    list.querySelectorAll(".review-btn").forEach(btn => {
      btn.addEventListener("click", () => openReviewModal(JSON.parse(btn.dataset.doctor)));
    });
  } catch (err) {
    list.innerHTML = `<p class="empty-state">Error loading applications: ${err.message}</p>`;
  }
}

function renderPendingCard(d) {
  const practiceLabel = d.practice_type === "homeopathy" ? "🌿 Homeopathy" : d.practice_type === "allopathy" ? "💊 Allopathy" : "—";
  return `
    <div class="check-card">
      <div>
        <p class="card-name">${escapeHtml(d.name)}</p>
        <p class="card-info-line">${escapeHtml(d.email)}</p>
        <p class="card-info-line">${escapeHtml(d.specialization || "—")} · Reg #${escapeHtml(d.registration_number || "—")}</p>
        <p class="card-info-line">${practiceLabel}</p>
        <p class="card-info-line">${d.has_certificate ? '<i class="fa-solid fa-file-circle-check"></i> Certificate uploaded' : '<i class="fa-solid fa-triangle-exclamation"></i> No certificate on file'}</p>
      </div>
      <div class="meta">
        <span>Applied: ${new Date(d.created_at).toLocaleString()}</span>
      </div>
      <button class="review-btn" data-doctor='${JSON.stringify(d).replace(/'/g, "&apos;")}'>Review →</button>
    </div>`;
}

document.getElementById("refreshPending").addEventListener("click", loadPending);

// ─────────────────────────────────────────────
// REVIEW MODAL
// ─────────────────────────────────────────────
function openReviewModal(doctor) {
  activeDoctorId = doctor.id;
  document.getElementById("reviewName").textContent = doctor.name;
  document.getElementById("reviewEmail").textContent = doctor.email;
  document.getElementById("reviewSpecialization").textContent = doctor.specialization || "—";
  document.getElementById("reviewRegNum").textContent = doctor.registration_number || "—";
  document.getElementById("reviewPracticeType").textContent = doctor.practice_type === "homeopathy" ? "🌿 Homeopathy" : doctor.practice_type === "allopathy" ? "💊 Allopathy" : "—";
  document.getElementById("reviewDate").textContent = new Date(doctor.created_at).toLocaleString();

  const certEl = document.getElementById("reviewCertStatus");
  if (doctor.has_certificate) {
    certEl.innerHTML = "";
    const link = document.createElement("a");
    link.href = `${API}/api/admin/doctor-certificate/${doctor.id}`;
    link.target = "_blank";
    link.rel = "noopener";
    link.className = "cert-view-link";
    link.innerHTML = `<i class="fa-solid fa-eye"></i> View Certificate`;
    // The certificate endpoint requires an admin auth token, which a plain
    // link can't send — fetch it as a blob and open that instead.
    link.addEventListener("click", async (e) => {
      e.preventDefault();
      try {
        const res = await fetch(`${API}/api/admin/doctor-certificate/${doctor.id}`, {
          headers: { Authorization: `Bearer ${TOKEN}` }
        });
        if (!res.ok) throw new Error("Could not load certificate.");
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        window.open(url, "_blank");
      } catch (err) {
        alert("Error loading certificate: " + err.message);
      }
    });
    certEl.appendChild(link);
  } else {
    certEl.innerHTML = `<span style="color:#ff6b6b;">⚠️ No certificate uploaded</span>`;
  }

  document.getElementById("reviewNotes").value = "";
  document.getElementById("reviewModal").classList.remove("hidden");
}

document.getElementById("closeReviewModal").addEventListener("click", () => {
  document.getElementById("reviewModal").classList.add("hidden");
});

async function submitReview(approve) {
  const notes = document.getElementById("reviewNotes").value.trim();
  try {
    await api("POST", `/api/admin/${approve ? "approve" : "reject"}-doctor/${activeDoctorId}`, {
      notes: notes || undefined
    });
    document.getElementById("reviewModal").classList.add("hidden");
    loadPending();
  } catch (err) {
    alert("Error: " + err.message);
  }
}

document.getElementById("approveBtn").addEventListener("click", () => submitReview(true));
document.getElementById("rejectBtn").addEventListener("click", () => submitReview(false));

// ─────────────────────────────────────────────
// ALL DOCTORS
// ─────────────────────────────────────────────
async function loadAll() {
  const list = document.getElementById("allList");
  list.innerHTML = `<p class="empty-state">Loading…</p>`;
  try {
    const data = await api("GET", "/api/admin/all-doctors");
    if (!data.doctors.length) {
      list.innerHTML = `<p class="empty-state">No doctor accounts yet.</p>`;
      return;
    }
    list.innerHTML = data.doctors.map(d => {
      const practiceLabel = d.practice_type === "homeopathy" ? "🌿 Homeopathy" : d.practice_type === "allopathy" ? "💊 Allopathy" : "—";
      return `
      <div class="check-card">
        <div>
          <p class="card-name">${escapeHtml(d.name)}</p>
          <p class="card-info-line">${escapeHtml(d.email)} · ${escapeHtml(d.specialization || "—")} · Reg #${escapeHtml(d.registration_number || "—")}</p>
          <p class="card-info-line">${practiceLabel}</p>
          ${d.admin_notes ? `<p class="card-info-line">📝 ${escapeHtml(d.admin_notes)}</p>` : ""}
        </div>
        <div class="meta">
          <span class="badge ${d.doctor_status}">${d.doctor_status}</span>
          <span>${new Date(d.created_at).toLocaleString()}</span>
        </div>
      </div>`;
    }).join("");
  } catch (err) {
    list.innerHTML = `<p class="empty-state">Error loading doctors: ${err.message}</p>`;
  }
}

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
  showDashboard();
}
