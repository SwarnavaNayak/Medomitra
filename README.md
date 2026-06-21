# Medomitra AI — Setup & New Features Guide

## Running the project

```bash
npm install
node create-admin.js
npm start
```

This starts the backend at `http://localhost:5000` and creates a SQLite database automatically at `data/medomitra.db` on first run (no separate database server needed).

Then open `index.html` in a browser (or serve the folder with any static file server).

---

## What's new in this version

### 1. SQL Database (SQLite, built into Node — zero extra setup)
All user accounts, symptom checks, and chat logs are now stored in a real SQL database (`data/medomitra.db`), using Node's built-in `node:sqlite` module. Tables:

- **users** — patients and doctors (name, email, hashed password, role, specialization)
- **symptom_checks** — every AI symptom analysis, with `status`: `unverified` / `verified` / `rejected`
- **mental_health_logs** — MindCare chatbot conversation history
- **model_meta** — a record of each time the model was retrained

### 2. Doctor Verification Workflow
Every AI diagnosis now starts as **unverified**. Doctors log in at `Doctor-Portal/dashboard.html` to:
- See a queue of pending AI diagnoses
- **Approve** (mark verified), **reject**, or **correct** the disease label
- Leave clinical notes

Patients can see the verification status of their own past checks via `GET /api/my-checks`.

### 3. Diagnosis AI — 4-tier priority chain
The `/symptom-check` endpoint now tries multiple diagnosis sources, in order, and uses whichever one is available and confident:

1. **Your locally-run trained neural network** (`localTrainedModel.js`) — this is YOUR model (`disease_model.h5` + `disease_encoder.pkl`, originally a Keras/TensorFlow network), ported into pure JavaScript so it runs natively inside this Node server with no Python, no TensorFlow, and no extra dependencies. Verified to produce bit-for-bit identical predictions to the original model. Covers 12 conditions (Allergy, Cardiovascular Disease, Common Cold, Dengue, Diabetes, Gastrointestinal Infection, Hypertension, Influenza, Kidney Disease, Malaria, Tuberculosis, Typhoid Fever) and runs in under a millisecond. The original Python source is kept in `model/python-source/` for reference if you ever want to retrain it.
2. **Cloud relay fallback** (`relayAI.js`) — used only when tier 1 found no recognizable symptoms, or wasn't confident (≤50%). Can diagnose virtually any disease (not limited to the 12 above) using Gemini or Claude, but its system prompt hard-locks it to symptom triage only — it will refuse to have a normal conversation no matter how the input is phrased, and instead returns a polite redirect asking for symptoms. Only runs if `GEMINI_API_KEY` or `ANTHROPIC_API_KEY` is set; otherwise this tier is skipped entirely.
3. **Doctor-verified statistical model** (`model.js`) — the original trainable Naive Bayes classifier described above, used when tiers 1 and 2 are unavailable.
4. **Static rule-based engine** — always available, zero dependencies, guarantees the feature works even with nothing else configured.

Every result — regardless of which tier produced it — is still logged to the database as `unverified` and goes through the same doctor verification workflow described above. The Doctor Portal queue and the Allopathy page result card both show which tier produced each diagnosis (🧬 Local Trained Model / ☁️ Relay AI / 🧠 Verified Model / 📋 Rule-based).

To enable the cloud relay tier, set one of these environment variables before running `npm start`:
```bash
GEMINI_API_KEY=your-key-here      # preferred, matches the original project
# or
ANTHROPIC_API_KEY=your-key-here   # alternative provider
```

### 4. Trainable Model (statistical fallback, tier 3 above)
A lightweight Naive Bayes text classifier (`model.js`) learns from **doctor-verified** symptom checks only — so it only gets training signal that's been clinically confirmed as correct. From the Doctor Portal's "Train Model" tab, a doctor can trigger training once at least 5 verified records exist.

### 5. Admin Approval for Doctor Accounts
Anyone could previously self-register as a "doctor" with no verification at all — which is a real problem, since doctor-verified diagnoses are shown to patients with a trust badge and used to train the model. Now, new doctor registrations start as `pending` and cannot access any `/api/doctor/*` route (queue, verify, train) until an admin approves them.

**Bootstrapping the first admin account** — there's no public "register as admin" form (there shouldn't be one). Instead, set these environment variables before running `npm start` the first time:
```bash
ADMIN_EMAIL=admin@yourcompany.com
ADMIN_PASSWORD=a-strong-password
```
The server creates the admin account automatically on startup if one doesn't already exist for that email. It's safe to leave these variables set on every subsequent run — it's a no-op once the account exists.

**Reviewing applications** — log in at `Admin-Portal/dashboard.html` to see pending doctor applications (name, email, specialization, medical registration number, and an uploaded certificate/license) and approve or reject each one, optionally leaving a note (e.g. "Verified medical license #12345") that the doctor will see.

Doctor registration now requires a **medical registration number** and an uploaded **certificate or license** (PNG, JPEG, WEBP, or PDF, max 5MB) — both are mandatory for the `doctor` role and the request is rejected without them. Certificates are stored on disk under `data/certificates/` (not committed to git — see `.gitignore`) with only the file path saved in the database, which is the standard way to handle file uploads alongside SQLite. Only admins can view a certificate, via `GET /api/admin/doctor-certificate/:id`, which requires an admin auth token — there is no public URL for these files.

Doctors who try to log in while pending or rejected still get a successful login (so the portal can show them a clear status screen), but every doctor-only API route independently re-checks their approval status server-side — so this can't be bypassed by tampering with the frontend.

Doctor accounts that already existed before this feature shipped are automatically grandfathered in as `approved` (the migration only fills in missing values, never overwrites), so upgrading won't suddenly lock out doctors who were already using the portal.

### 6. Dynamic "Find a Doctor" Directory
`Doctor_List/AlloDocList.html` and `Doctor_List/HomoDocList.html` used to show a hardcoded list of fake demo doctors. They now fetch real, **admin-approved** doctors live from the database via `GET /api/doctors?type=allopathy` or `?type=homeopathy` — pending and rejected applications are never returned by this endpoint, regardless of any filter passed in.

When registering, doctors choose whether they practice **Allopathy** or **Homeopathy** — this determines which of the two pages they appear on. They can also optionally add: years of experience, clinic/practice name, consultation fee, a short bio, and a profile photo. All of this is shown on their public listing card once approved. A doctor with no optional fields filled in still shows up correctly with sensible fallback text (e.g. "Experience not listed").

The search, specialization filter, sorting, and doctor comparison features on `AlloDocList.html` all still work, now operating on real data — the specialization filter dropdown is now populated dynamically from whatever specializations actually exist among approved doctors, rather than a fixed guessed list. Star ratings were removed from both pages since there's no review system to back them with real data.

### 7. Accounts
- Patients register/login at `Sign_Up/Register.html` or `Sign_Up/Login.html`
- Doctors register/login at `Doctor-Portal/dashboard.html` (requires a specialization)
- Passwords are hashed with bcrypt; sessions use JWT tokens stored in `localStorage`

---

## Key new API endpoints

| Method | Path | Description |
|---|---|---|
| POST | `/api/auth/register` | Create a patient or doctor account |
| POST | `/api/auth/login` | Log in, returns a JWT |
| GET  | `/api/me` | Get the logged-in user's profile |
| POST | `/symptom-check` | Submit symptoms, get AI diagnosis (now saved to DB) |
| GET  | `/api/my-checks` | Patient's own check history + verification status |
| GET  | `/api/doctor/queue` | Doctor's pending review queue |
| POST | `/api/doctor/verify/:id` | Approve/reject/correct a diagnosis |
| GET  | `/api/doctor/history` | Doctor's past verifications |
| GET  | `/api/model/status` | Is the model trained? How many verified records are available? |
| POST | `/api/model/train` | Trigger retraining (doctor only) |
| GET  | `/api/admin/pending-doctors` | List doctor accounts awaiting approval (admin only) |
| GET  | `/api/admin/all-doctors` | List every doctor account and its status (admin only) |
| GET  | `/api/admin/doctor-certificate/:id` | View a doctor's uploaded certificate file (admin only) |
| POST | `/api/admin/approve-doctor/:id` | Approve a doctor application (admin only) |
| POST | `/api/admin/reject-doctor/:id` | Reject a doctor application (admin only) |
| GET  | `/api/doctors` | Public directory of approved doctors. Supports `?type=allopathy\|homeopathy` and `?specialization=` filters |
| GET  | `/api/doctors/:id/photo` | Public profile photo for a doctor (no auth required) |
| POST | `/mental-health-chat` | MindCare chatbot |

## Notes
- Set `GEMINI_API_KEY` or `ANTHROPIC_API_KEY` to enable the cloud relay diagnosis tier (see above). Without either, the app still works using your local trained model + the statistical/rule fallbacks.
- Set `ANTHROPIC_API_KEY` to also power MindCare (the mental health chatbot) with Claude instead of its rule-based fallback.
- Set `JWT_SECRET` in production instead of using the default dev secret in `auth.js`.
