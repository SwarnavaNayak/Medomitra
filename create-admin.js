// create-admin.js — Run this ONCE to guarantee an admin account exists
// with a specific email/password, no environment variables needed.
//
// Usage:
//   node create-admin.js
//
// Safe to run multiple times — if the account already exists, it will
// just reset the password and make sure the role is 'admin'.

const db = require("./database");
const { hashPassword } = require("./auth");

const ADMIN_EMAIL = "swarnava@medomitra.com";
const ADMIN_PASSWORD = "Sammy@2002";

const email = ADMIN_EMAIL.toLowerCase();
const hash = hashPassword(ADMIN_PASSWORD);

const existing = db.prepare("SELECT id, role FROM users WHERE email = ?").get(email);

if (existing) {
    db.prepare("UPDATE users SET password_hash = ?, role = 'admin' WHERE id = ?").run(hash, existing.id);
    console.log(`Updated existing account (${email}) to admin with the new password.`);
} else {
    db.prepare("INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'admin')")
        .run("Swarnava", email, hash);
    console.log(`Created new admin account: ${email}`);
}

console.log("\nYou can now log in at Admin-Portal/dashboard.html with:");
console.log(`  Email:    ${ADMIN_EMAIL}`);
console.log(`  Password: ${ADMIN_PASSWORD}`);