// auth.js — authentication helpers & middleware

const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const db = require("./database");

// In production, set JWT_SECRET as an environment variable.
const JWT_SECRET = process.env.JWT_SECRET || "medomitra-dev-secret-change-in-production";
const TOKEN_EXPIRY = "7d";

function hashPassword(password) {
  return bcrypt.hashSync(password, 10);
}

function comparePassword(password, hash) {
  return bcrypt.compareSync(password, hash);
}

function signToken(user) {
  return jwt.sign(
    { id: user.id, name: user.name, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: TOKEN_EXPIRY }
  );
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

// A token can be cryptographically valid but still point to a user that no
// longer exists (e.g. the database was reset, or the account was deleted).
// Using a stale id as a foreign key would crash inserts/updates, so we
// always re-check against the current database and pull fresh user data
// (this also means a role change takes effect immediately, not after 7 days).
function getLiveUser(payload) {
  if (!payload?.id) return null;
  const row = db.prepare("SELECT id, name, email, role, doctor_status FROM users WHERE id = ?").get(payload.id);
  return row || null;
}

// Express middleware — attaches req.user if a valid token AND a matching
// user record are present. Does NOT block the request if missing (so
// anonymous symptom checks still work).
function optionalAuth(req, res, next) {
  const header = req.headers.authorization;
  if (header && header.startsWith("Bearer ")) {
    const payload = verifyToken(header.slice(7));
    const liveUser = getLiveUser(payload);
    if (liveUser) req.user = liveUser; // ignore silently if the user no longer exists
  }
  next();
}

// Express middleware — REQUIRES a valid token AND a matching user record.
function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Authentication required." });
  }
  const payload = verifyToken(header.slice(7));
  if (!payload) return res.status(401).json({ error: "Invalid or expired token." });

  const liveUser = getLiveUser(payload);
  if (!liveUser) {
    return res.status(401).json({ error: "Your session is no longer valid. Please log out and log in again." });
  }
  req.user = liveUser;
  next();
}

// Express middleware — REQUIRES the authenticated user to be a doctor who
// has been approved by an admin. Admin accounts are always let through
// (they can act as a doctor too). A doctor account that is still pending or
// has been rejected gets a clear, specific error instead of a generic 403.
function requireDoctor(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role === "admin") return next();

    if (req.user.role !== "doctor") {
      return res.status(403).json({ error: "Doctor access required." });
    }
    if (req.user.doctor_status === "pending") {
      return res.status(403).json({ error: "Your doctor account is still pending admin approval." });
    }
    if (req.user.doctor_status === "rejected") {
      return res.status(403).json({ error: "Your doctor account application was not approved." });
    }
    next();
  });
}

// Express middleware — REQUIRES the authenticated user to be an admin.
function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "Admin access required." });
    }
    next();
  });
}

module.exports = {
  hashPassword,
  comparePassword,
  signToken,
  verifyToken,
  optionalAuth,
  requireAuth,
  requireDoctor,
  requireAdmin
};
