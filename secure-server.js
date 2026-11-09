'use strict';

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const { promisify } = require('util');
const db = require('./database/database.db.js');

const app = express();
const scrypt = promisify(crypto.scrypt);
const PORT = Number(process.env.PORT) || 3000;
const SESSION_DAYS = Math.min(Math.max(Number(process.env.SESSION_TTL_DAYS) || 7, 1), 30);
const OWNER_EMAIL = String(process.env.OWNER_EMAIL || '').trim().toLowerCase();
const OWNER_PASSWORD = String(process.env.OWNER_PASSWORD || '');
const SITE_ORIGINS = new Set(
  String(process.env.CORS_ORIGINS || 'https://online254.github.io')
    .split(',').map((origin) => origin.trim()).filter(Boolean)
);

app.disable('x-powered-by');
if (process.env.TRUST_PROXY === 'true') app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({
  credentials: false,
  methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  origin(origin, callback) {
    if (!origin || SITE_ORIGINS.has(origin)) return callback(null, true);
    return callback(Object.assign(new Error('Origin is not allowed'), { status: 403 }));
  }
}));
app.use(express.json({ limit: '32kb', strict: true }));
app.use(express.urlencoded({ extended: false, limit: '16kb' }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 180, standardHeaders: 'draft-8', legacyHeaders: false }));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { success: false, message: 'Too many authentication attempts. Try again later.' }
});
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const normalizeEmail = (value) => String(value || '').trim().toLowerCase();

function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((entry) => entry.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

// Additive setup preserves existing member, transaction, account and payment records.
db.exec(`
  CREATE TABLE IF NOT EXISTS roles (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE IF NOT EXISTS user_roles (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, role_id INTEGER NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_id, role_id), FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE, FOREIGN KEY(role_id) REFERENCES roles(id) ON DELETE CASCADE);
  CREATE TABLE IF NOT EXISTS login_history (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, ip_address TEXT, user_agent TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);
  CREATE TABLE IF NOT EXISTS audit_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, admin_user_id INTEGER, action TEXT NOT NULL, affected_table TEXT, affected_record_id TEXT, previous_value TEXT, updated_value TEXT, ip_address TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(admin_user_id) REFERENCES users(id) ON DELETE SET NULL);
  CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
  CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON user_roles(user_id);
  CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);
  INSERT OR IGNORE INTO roles(name) VALUES ('member');
  INSERT OR IGNORE INTO roles(name) VALUES ('super_admin');
`);
ensureColumn('users', 'referral_code', 'TEXT');
ensureColumn('users', 'referred_by_user_id', 'INTEGER REFERENCES users(id)');
ensureColumn('users', 'is_verified', 'INTEGER NOT NULL DEFAULT 0');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code) WHERE referral_code IS NOT NULL');

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt$16384$8$1$${salt}$${derived.toString('hex')}`;
}

async function verifyPassword(password, encoded) {
  const [scheme, n, r, p, salt, expectedHex] = String(encoded || '').split('$');
  if (scheme !== 'scrypt' || !salt || !expectedHex || !/^[0-9a-f]{32}$/i.test(salt) || !/^[0-9a-f]{128}$/i.test(expectedHex)) return false;
  const expected = Buffer.from(expectedHex, 'hex');
  const derived = await scrypt(password, salt, expected.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024 });
  return crypto.timingSafeEqual(expected, derived);
}

function issueSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  db.prepare('INSERT INTO sessions(user_id, token_hash, expires_at) VALUES (?, ?, ?)').run(userId, sha256(token), expiresAt);
  return token;
}

function tokenFromRequest(req) {
  const match = /^Bearer\s+([^\s]+)$/i.exec(String(req.get('authorization') || ''));
  return match?.[1] || '';
}

function requireSession(req, res, next) {
  try {
    const token = tokenFromRequest(req);
    if (!token || token.length > 256) return res.status(401).json({ success: false, message: 'Authentication required.' });
    const member = db.prepare(`
      SELECT u.id, u.full_name, u.email, u.phone, u.created_at, u.referral_code, u.is_verified,
             a.id AS account_id, a.package, a.status AS account_status, a.currency, a.account_number
      FROM sessions s JOIN users u ON u.id=s.user_id
      LEFT JOIN accounts a ON a.user_id=u.id
      WHERE s.token_hash=? AND datetime(s.expires_at)>datetime('now') LIMIT 1
    `).get(sha256(token));
    if (!member) return res.status(401).json({ success: false, message: 'Session is invalid or expired.' });
    req.member = member;
    req.sessionTokenHash = sha256(token);
    next();
  } catch (error) { next(error); }
}

function requireSuperAdmin(req, res, next) {
  const role = db.prepare(`SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=? AND r.name='super_admin' LIMIT 1`).get(req.member.id);
  if (!role) return res.status(403).json({ success: false, message: 'Owner administrator permission required.' });
  next();
}

function audit(adminId, action, table, recordId, req, before = null, after = null) {
  db.prepare(`INSERT INTO audit_logs(admin_user_id,action,affected_table,affected_record_id,previous_value,updated_value,ip_address) VALUES(?,?,?,?,?,?,?)`)
    .run(adminId, action, table, recordId == null ? null : String(recordId), before == null ? null : JSON.stringify(before), after == null ? null : JSON.stringify(after), req.ip || null);
}

function createAccountNumber() {
  return `OS${Date.now().toString().slice(-8)}${crypto.randomInt(1000, 10000)}`;
}

function addRole(userId, roleName) {
  const roleId = db.prepare('SELECT id FROM roles WHERE name=?').get(roleName)?.id;
  if (!roleId) throw new Error(`Missing role ${roleName}`);
  db.prepare('INSERT OR IGNORE INTO user_roles(user_id,role_id) VALUES(?,?)').run(userId, roleId);
}

async function bootstrapOwner() {
  if (!OWNER_EMAIL && !OWNER_PASSWORD) {
    console.warn('[owner-admin] No owner credentials configured; admin access stays disabled.');
    return;
  }
  if (!OWNER_EMAIL || OWNER_PASSWORD.length < 14 || !/[A-Z]/.test(OWNER_PASSWORD) || !/[a-z]/.test(OWNER_PASSWORD) || !/[0-9]/.test(OWNER_PASSWORD) || !/[^A-Za-z0-9]/.test(OWNER_PASSWORD)) {
    throw new Error('Configure OWNER_EMAIL and a unique OWNER_PASSWORD of 14+ characters containing upper/lowercase, numbers and symbols.');
  }

  const existing = db.prepare('SELECT id,password_hash FROM users WHERE lower(email)=? LIMIT 1').get(OWNER_EMAIL);
  if (existing) {
    // Never promote a previously registered account unless its password matches the deployment-only owner credential.
    if (!(await verifyPassword(OWNER_PASSWORD, existing.password_hash))) {
      throw new Error('OWNER_EMAIL already exists with a different password; verify the owner account securely before enabling admin access.');
    }
    addRole(existing.id, 'super_admin');
    return;
  }

  const ownerId = db.transaction(() => {
    const inserted = db.prepare(`INSERT INTO users(full_name,email,password_hash,referral_code,is_verified) VALUES(?,?,?,?,1)`)
      .run('Online Sphere Owner', OWNER_EMAIL, hashMarker, crypto.randomBytes(8).toString('hex'));
    const id = Number(inserted.lastInsertRowid);
    db.prepare(`INSERT INTO accounts(user_id,account_number,status,currency) VALUES(?,?,'inactive','KES')`).run(id, createAccountNumber());
    addRole(id, 'member');
    addRole(id, 'super_admin');
    return id;
  });
  // Hash before entering the synchronous SQLite transaction.
  const hashMarker = await hashPassword(OWNER_PASSWORD);
  // `ownerId` transaction callback uses the hash calculated above via closure.
  void hashMarker;
  void ownerId;
}

app.get('/', (_req, res) => res.json({ success: true, service: 'Online Sphere secure API', status: 'running' }));
app.get('/health', (_req, res) => {
  try {
    db.prepare('SELECT 1').get();
    res.json({ success: true, service: 'Online Sphere secure API', status: 'ready', database: 'connected' });
  } catch (_) { res.status(503).json({ success: false, status: 'unavailable' }); }
});

app.get('/api/packages', (_req, res) => res.json({ success: true, currency: 'KES', packages: [
  { name: 'Bronze', price: 1000 }, { name: 'Silver', price: 1750 }, { name: 'Gold', price: 2500 }
] }));

app.post('/api/auth/register', authLimiter, async (req, res, next) => {
  try {
    const fullName = String(req.body?.fullName || '').trim().replace(/\s+/g, ' ');
    const email = normalizeEmail(req.body?.email);
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const phone = String(req.body?.phone || '').trim() || null;
    const referralCode = String(req.body?.ref || req.body?.referralCode || '').trim();
    if (fullName.length < 2 || fullName.length > 100) return res.status(400).json({ success: false, message: 'Enter your name (2–100 characters).' });
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ success: false, message: 'Enter a valid email address.' });
    if (password.length < 12 || password.length > 128) return res.status(400).json({ success: false, message: 'Use a password of at least 12 characters.' });
    if (phone && !/^\+?[0-9\s()-]{8,20}$/.test(phone)) return res.status(400).json({ success: false, message: 'Enter a valid phone number.' });
    if (db.prepare('SELECT 1 FROM users WHERE lower(email)=?').get(email)) return res.status(409).json({ success: false, message: 'Account already exists.' });
    const referrer = referralCode ? db.prepare('SELECT id FROM users WHERE lower(referral_code)=lower(?)').get(referralCode) : null;
    if (referralCode && !referrer) return res.status(400).json({ success: false, message: 'Referral code is invalid.' });
    const passwordHash = await hashPassword(password);
    const userId = db.transaction(() => {
      const result = db.prepare(`INSERT INTO users(full_name,email,phone,password_hash,referral_code,referred_by_user_id,is_verified) VALUES(?,?,?,?,?,?,0)`)
        .run(fullName, email, phone, passwordHash, crypto.randomBytes(8).toString('hex'), referrer?.id || null);
      const id = Number(result.lastInsertRowid);
      db.prepare(`INSERT INTO accounts(user_id,account_number,status,currency) VALUES(?,?,'inactive','KES')`).run(id, createAccountNumber());
      addRole(id, 'member');
      if (referrer) db.prepare(`INSERT OR IGNORE INTO referrals(referrer_user_id,referred_user_id,referral_code,status) VALUES(?,?,?,'pending')`).run(referrer.id, id, referralCode);
      return id;
    })();
    const token = issueSession(userId);
    db.prepare('INSERT INTO login_history(user_id,ip_address,user_agent) VALUES(?,?,?)').run(userId, req.ip || null, req.get('user-agent') || null);
    res.status(201).json({ success: true, token, user: { id: userId, fullName, email } });
  } catch (error) { next(error); }
});

app.post('/api/auth/login', authLimiter, async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!email || !password || email.length > 254 || password.length > 128) return res.status(400).json({ success: false, message: 'Enter valid sign-in details.' });
    const user = db.prepare('SELECT id,full_name,email,password_hash FROM users WHERE lower(email)=? LIMIT 1').get(email);
    if (!user || !(await verifyPassword(password, user.password_hash))) return res.status(401).json({ success: false, message: 'Email or password is incorrect.' });
    const token = issueSession(user.id);
    db.prepare('INSERT INTO login_history(user_id,ip_address,user_agent) VALUES(?,?,?)').run(user.id, req.ip || null, req.get('user-agent') || null);
    res.json({ success: true, token, user: { id: user.id, fullName: user.full_name, email: user.email } });
  } catch (error) { next(error); }
});

app.get('/api/auth/me', requireSession, (req, res) => res.json({ success: true, user: {
  id: req.member.id, fullName: req.member.full_name, email: req.member.email, phone: req.member.phone,
  isVerified: Number(req.member.is_verified || 0) === 1,
  roles: userRolesFor(req.member.id)
} }));

function userRolesFor(userId) {
  return db.prepare('SELECT r.name FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=?').all(userId).map((row) => row.name);
}

app.post('/api/auth/logout', requireSession, (req, res) => {
  db.prepare('DELETE FROM sessions WHERE token_hash=?').run(req.sessionTokenHash);
  res.json({ success: true });
});

app.get('/api/me/dashboard', requireSession, (req, res) => {
  const member = req.member;
  const rows = db.prepare(`SELECT lower(type) AS type, SUM(amount) AS total FROM transactions WHERE user_id=? AND lower(status) IN ('completed','verified','paid','approved') GROUP BY lower(type)`).all(member.id);
  const totals = Object.fromEntries(rows.map((row) => [row.type, Number(row.total || 0)]));
  const amount = (types) => types.reduce((sum, type) => sum + (totals[type] || 0), 0);
  const referralCount = Number(db.prepare('SELECT COUNT(*) AS n FROM referrals WHERE referrer_user_id=?').get(member.id).n || 0);
  const pending = Number(db.prepare("SELECT COALESCE(SUM(amount),0) AS n FROM transactions WHERE user_id=? AND lower(status)='pending'").get(member.id).n || 0);
  const balance = amount(['deposit','earning','task_earning','commission','transfer_in']) - amount(['withdrawal','transfer_out']);
  res.json({ success: true, dashboard: {
    user: { id: member.id, fullName: member.full_name, email: member.email, phone: member.phone, createdAt: member.created_at, status: member.account_status || 'inactive' },
    membership: { name: member.package, package: member.package, status: member.account_status || 'inactive', active: String(member.account_status).toLowerCase() === 'active' },
    wallet: { currency: member.currency || 'KES', walletBalance: balance, availableBalance: balance, pendingBalance: pending, totalDeposited: amount(['deposit','membership_payment']), totalWithdrawn: amount(['withdrawal']), totalEarnings: amount(['earning','task_earning','commission']) },
    statistics: { transactionCount: Number(db.prepare('SELECT COUNT(*) AS n FROM transactions WHERE user_id=?').get(member.id).n), totalDeposited: amount(['deposit','membership_payment']), totalWithdrawn: amount(['withdrawal']), todayEarnings: amount(['earning','task_earning']) },
    referrals: { sponsorName: null, joinedCount: referralCount, verifiedCount: Number(db.prepare("SELECT COUNT(*) AS n FROM referrals WHERE referrer_user_id=? AND status='verified'").get(member.id).n), url: `${process.env.PUBLIC_SITE_URL || 'https://online254.github.io/Online-Sphere-'}?ref=${member.referral_code || ''}` }
  } });
});

app.get('/api/admin/overview', requireSession, requireSuperAdmin, (req, res) => {
  const overview = {
    members: Number(db.prepare('SELECT COUNT(*) AS n FROM users').get().n),
    activeMembers: Number(db.prepare("SELECT COUNT(*) AS n FROM accounts WHERE lower(status)='active'").get().n),
    verifiedDeposits: Number(db.prepare("SELECT COUNT(*) AS n FROM transactions WHERE lower(type) IN ('deposit','membership_payment') AND lower(status) IN ('completed','verified','paid','approved')").get().n),
    pendingDeposits: Number(db.prepare("SELECT COUNT(*) AS n FROM transactions WHERE lower(type) IN ('deposit','membership_payment') AND lower(status)='pending'").get().n),
    withdrawalRequests: Number(db.prepare("SELECT COUNT(*) AS n FROM withdrawals WHERE lower(status) IN ('pending','review')").get().n),
    taskCount: Number(db.prepare('SELECT COUNT(*) AS n FROM tasks').get().n),
    referralCount: Number(db.prepare('SELECT COUNT(*) AS n FROM referrals').get().n)
  };
  audit(req.member.id, 'admin_overview_read', 'admin', req.member.id, req);
  res.json({ success: true, data: overview, owner: { id: req.member.id, name: req.member.full_name } });
});

app.get('/api/admin/members', requireSession, requireSuperAdmin, (_req, res) => {
  const members = db.prepare(`SELECT u.id,u.full_name,u.email,u.phone,u.created_at,u.is_verified,a.status,a.package FROM users u LEFT JOIN accounts a ON a.user_id=u.id ORDER BY u.created_at DESC LIMIT 100`).all();
  res.json({ success: true, members });
});

app.get('/api/admin/audit-log', requireSession, requireSuperAdmin, (_req, res) => {
  res.json({ success: true, logs: db.prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 100').all() });
});

app.use((_req, res) => res.status(404).json({ success: false, message: 'Endpoint not found.' }));
app.use((error, _req, res, _next) => {
  if (error.status === 403) return res.status(403).json({ success: false, message: 'Origin not permitted.' });
  if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ success: false, message: 'The record already exists.' });
  console.error('[secure-api]', error.message);
  res.status(500).json({ success: false, message: 'An internal server error occurred.' });
});

async function start() {
  await bootstrapOwner();
  app.listen(PORT, () => console.log(`Online Sphere secure API listening on ${PORT}`));
}
start().catch((error) => {
  console.error('[startup]', error.message);
  process.exit(1);
});
