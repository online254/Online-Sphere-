const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");

const dbPath =
    process.env.DB_PATH ||
    path.join(__dirname, "online-sphere.sqlite");

fs.mkdirSync(path.dirname(dbPath), {
    recursive: true
});

const db = new Database(dbPath);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

const schemaPath = path.join(__dirname, "schema.sql");

if (!fs.existsSync(schemaPath)) {
    throw new Error(
        "Missing database/schema.sql"
    );
}

db.exec(
    fs.readFileSync(schemaPath, "utf8")
);

db.exec(`
CREATE TABLE IF NOT EXISTS payment_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id TEXT NOT NULL UNIQUE,
    phone TEXT NOT NULL,
    package_name TEXT NOT NULL,
    amount INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    merchant_request_id TEXT,
    checkout_request_id TEXT UNIQUE,
    mpesa_receipt TEXT UNIQUE,
    result_code INTEGER,
    result_description TEXT,
    transaction_date TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS
idx_payment_attempts_phone
ON payment_attempts(phone);

CREATE INDEX IF NOT EXISTS
idx_payment_attempts_status
ON payment_attempts(status);

CREATE TABLE IF NOT EXISTS auth_challenges (
    id TEXT PRIMARY KEY,
    user_id INTEGER,
    purpose TEXT NOT NULL,
    channel TEXT NOT NULL,
    destination TEXT NOT NULL,
    otp_hash TEXT NOT NULL,
    expires_at DATETIME NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 5,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    consumed_at DATETIME,
    request_ip TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_auth_challenges_destination
ON auth_challenges(destination, purpose, created_at);

CREATE TABLE IF NOT EXISTS pending_registrations (
    id TEXT PRIMARY KEY,
    full_name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    referral_code TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_registrations_email
ON pending_registrations(email);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_registrations_phone
ON pending_registrations(phone);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    consumed_at DATETIME,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
`);

module.exports = db;
