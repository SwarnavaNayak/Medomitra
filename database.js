// database.js — SQLite data layer for Medomitra
// Uses Node's built-in `node:sqlite` module (true SQL, zero native deps).

const { DatabaseSync } = require("node:sqlite");
const path = require("path");
const fs = require("fs");

const DATA_DIR = path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, "medomitra.db");
const db = new DatabaseSync(DB_PATH);

// Pragmas for reliability
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

// ════════════════════════════════════════════════════════
// SCHEMA
// ════════════════════════════════════════════════════════
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  name                TEXT NOT NULL,
  email               TEXT NOT NULL UNIQUE,
  password_hash       TEXT NOT NULL,
  role                TEXT NOT NULL CHECK(role IN ('patient','doctor','admin')) DEFAULT 'patient',
  specialization      TEXT,                 -- only used when role = 'doctor'
  registration_number TEXT,                 -- medical council registration number, doctor only
  certificate_path    TEXT,                 -- stored path to uploaded certificate image, doctor only
  doctor_status       TEXT CHECK(doctor_status IN ('pending','approved','rejected')), -- only used when role = 'doctor'
  admin_notes         TEXT,                 -- optional note left by the admin who approved/rejected
  practice_type       TEXT CHECK(practice_type IN ('allopathy','homeopathy')), -- which Find a Doctor list this doctor appears in
  years_experience    INTEGER,              -- optional, doctor only
  clinic_name         TEXT,                 -- optional, doctor only
  consultation_fee    TEXT,                 -- optional, doctor only (free text, e.g. "₹500")
  bio                 TEXT,                 -- optional, doctor only
  profile_image_path  TEXT,                 -- optional uploaded profile photo, doctor only
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// ── Migration: add doctor_status/admin_notes/registration_number/certificate_path
// to a users table created by an earlier version of this app. ──
(function migrateUsersTable() {
  const columns = db.prepare(`PRAGMA table_info(users)`).all().map(c => c.name);

  if (!columns.includes("doctor_status")) {
    db.exec(`ALTER TABLE users ADD COLUMN doctor_status TEXT CHECK(doctor_status IN ('pending','approved','rejected'));`);
    console.log("Migrated users table: added doctor_status column.");
  }
  if (!columns.includes("admin_notes")) {
    db.exec(`ALTER TABLE users ADD COLUMN admin_notes TEXT;`);
    console.log("Migrated users table: added admin_notes column.");
  }
  if (!columns.includes("registration_number")) {
    db.exec(`ALTER TABLE users ADD COLUMN registration_number TEXT;`);
    console.log("Migrated users table: added registration_number column.");
  }
  if (!columns.includes("certificate_path")) {
    db.exec(`ALTER TABLE users ADD COLUMN certificate_path TEXT;`);
    console.log("Migrated users table: added certificate_path column.");
  }
  if (!columns.includes("practice_type")) {
    db.exec(`ALTER TABLE users ADD COLUMN practice_type TEXT CHECK(practice_type IN ('allopathy','homeopathy'));`);
    console.log("Migrated users table: added practice_type column.");
  }
  if (!columns.includes("years_experience")) {
    db.exec(`ALTER TABLE users ADD COLUMN years_experience INTEGER;`);
    console.log("Migrated users table: added years_experience column.");
  }
  if (!columns.includes("clinic_name")) {
    db.exec(`ALTER TABLE users ADD COLUMN clinic_name TEXT;`);
    console.log("Migrated users table: added clinic_name column.");
  }
  if (!columns.includes("consultation_fee")) {
    db.exec(`ALTER TABLE users ADD COLUMN consultation_fee TEXT;`);
    console.log("Migrated users table: added consultation_fee column.");
  }
  if (!columns.includes("bio")) {
    db.exec(`ALTER TABLE users ADD COLUMN bio TEXT;`);
    console.log("Migrated users table: added bio column.");
  }
  if (!columns.includes("profile_image_path")) {
    db.exec(`ALTER TABLE users ADD COLUMN profile_image_path TEXT;`);
    console.log("Migrated users table: added profile_image_path column.");
  }

  // Grandfather in any doctor accounts that already existed before this
  // feature shipped — they were already trusted/in-use, so don't suddenly
  // lock them out. Only fills in NULLs; never overwrites an existing status.
  db.prepare(`UPDATE users SET doctor_status = 'approved' WHERE role = 'doctor' AND doctor_status IS NULL`).run();

  // Existing doctors from before practice_type existed default to allopathy
  // (the original/only doctor list before this feature) so they don't
  // silently disappear from both Find a Doctor pages after upgrading.
  db.prepare(`UPDATE users SET practice_type = 'allopathy' WHERE role = 'doctor' AND practice_type IS NULL`).run();
})();

db.exec(`
CREATE TABLE IF NOT EXISTS symptom_checks (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id            INTEGER,                       -- nullable: anonymous checks allowed
  symptoms_text      TEXT NOT NULL,
  predicted_disease  TEXT NOT NULL,
  severity           TEXT,
  confidence         INTEGER,
  source             TEXT NOT NULL CHECK(source IN ('rule','model','local-trained-model','relay-ai')) DEFAULT 'rule',
  status             TEXT NOT NULL CHECK(status IN ('unverified','verified','rejected')) DEFAULT 'unverified',
  corrected_disease  TEXT,                           -- set if doctor disagrees & corrects
  doctor_notes       TEXT,
  verified_by        INTEGER,                        -- FK -> users.id (a doctor)
  verified_at        TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id)     REFERENCES users(id),
  FOREIGN KEY (verified_by) REFERENCES users(id)
);
`);

// ── Migration: widen the `source` CHECK constraint on databases created by
// an earlier version of this app (which only allowed 'rule'/'model'). SQLite
// can't ALTER a CHECK constraint directly, so we detect the old constraint
// and rebuild the table, preserving all existing rows. ──
(function migrateSourceConstraint() {
  const tableSql = db.prepare(
    `SELECT sql FROM sqlite_master WHERE type='table' AND name='symptom_checks'`
  ).get()?.sql || "";

  const isOldSchema = tableSql.includes("CHECK(source IN ('rule','model'))");
  if (!isOldSchema) return; // already up to date (or table didn't exist yet)

  db.exec("PRAGMA foreign_keys = OFF;");
  db.exec(`
    CREATE TABLE symptom_checks_new (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id            INTEGER,
      symptoms_text      TEXT NOT NULL,
      predicted_disease  TEXT NOT NULL,
      severity           TEXT,
      confidence         INTEGER,
      source             TEXT NOT NULL CHECK(source IN ('rule','model','local-trained-model','relay-ai')) DEFAULT 'rule',
      status             TEXT NOT NULL CHECK(status IN ('unverified','verified','rejected')) DEFAULT 'unverified',
      corrected_disease  TEXT,
      doctor_notes       TEXT,
      verified_by        INTEGER,
      verified_at        TEXT,
      created_at         TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id)     REFERENCES users(id),
      FOREIGN KEY (verified_by) REFERENCES users(id)
    );
  `);
  db.exec(`
    INSERT INTO symptom_checks_new
      (id, user_id, symptoms_text, predicted_disease, severity, confidence, source,
       status, corrected_disease, doctor_notes, verified_by, verified_at, created_at)
    SELECT id, user_id, symptoms_text, predicted_disease, severity, confidence, source,
       status, corrected_disease, doctor_notes, verified_by, verified_at, created_at
    FROM symptom_checks;
  `);
  db.exec("DROP TABLE symptom_checks;");
  db.exec("ALTER TABLE symptom_checks_new RENAME TO symptom_checks;");
  db.exec("PRAGMA foreign_keys = ON;");
  console.log("Migrated symptom_checks table to support new AI source types.");
})();


db.exec(`
CREATE TABLE IF NOT EXISTS mental_health_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER,
  message     TEXT NOT NULL,
  reply       TEXT NOT NULL,
  urgent      INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
`);

db.exec(`
CREATE TABLE IF NOT EXISTS model_meta (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  trained_at        TEXT NOT NULL DEFAULT (datetime('now')),
  training_samples  INTEGER NOT NULL,
  class_count       INTEGER NOT NULL,
  trained_by        INTEGER,                          -- FK -> users.id
  FOREIGN KEY (trained_by) REFERENCES users(id)
);
`);

// Helpful indexes
db.exec(`CREATE INDEX IF NOT EXISTS idx_checks_status ON symptom_checks(status);`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_checks_user    ON symptom_checks(user_id);`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_users_email     ON users(email);`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_users_doctor_lookup ON users(role, doctor_status, practice_type);`);

module.exports = db;
