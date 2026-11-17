require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { promisify } = require('util');
const db = require('./database/database.db.js');
const app = express();
const PORT = process.env.PORT || 3000;
const scrypt = promisify(crypto.scrypt);

app.disable('x-powered-by');
const configuredOrigins = String(process.env.PUBLIC_SITE_ORIGINS || '').split(',').map((origin) => origin.trim()).filter(Boolean);
const allowedOrigins = new Set([
  'https://online254.github.io',
  'http://localhost:3000',
  'http://localhost:4173',
  'http://localhost:5500',
  'https://onlinespherecommercecompany.com',
  'https://www.onlinespherecommercecompany.com',
  ...configuredOrigins
]);
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) return callback(null, true);
    return callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token']
}));
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false }));
app.use((req, _res, next) => {
  req.cookies = Object.fromEntries(String(req.headers.cookie || '').split(';').map((part) => {
    const separator = part.indexOf('=');
    if (separator < 0) return [];
    try { return [decodeURIComponent(part.slice(0, separator).trim()), decodeURIComponent(part.slice(separator + 1).trim())]; } catch (_) { return []; }
  }).filter(([key, value]) => key && value));
  next();
});

// Additive SQLite migrations; existing member and payment records are preserved.
function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((item) => item.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
ensureColumn('users', 'referral_code', 'TEXT');
ensureColumn('users', 'referred_by_user_id', 'INTEGER REFERENCES users(id)');
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code) WHERE referral_code IS NOT NULL; CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);`);
db.exec(`
  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'account',
    read_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id, created_at);
  CREATE TABLE IF NOT EXISTS opportunity_applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    opportunity_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    application_note TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(opportunity_id, user_id),
    FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_opportunity_applications_opportunity ON opportunity_applications(opportunity_id);
  CREATE TABLE IF NOT EXISTS opportunity_submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    application_id INTEGER NOT NULL UNIQUE,
    user_id INTEGER NOT NULL,
    opportunity_id INTEGER NOT NULL,
    content TEXT,
    attachment_url TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    reviewed_at DATETIME,
    reviewed_by INTEGER,
    review_note TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (application_id) REFERENCES opportunity_applications(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE,
    FOREIGN KEY (reviewed_by) REFERENCES users(id)
  );
  CREATE INDEX IF NOT EXISTS idx_opportunity_submissions_status ON opportunity_submissions(status);
  CREATE TABLE IF NOT EXISTS opportunity_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    submission_id INTEGER NOT NULL UNIQUE,
    opportunity_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    amount INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'KES',
    status TEXT NOT NULL DEFAULT 'pending',
    transaction_id INTEGER,
    approved_by INTEGER,
    approved_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (submission_id) REFERENCES opportunity_submissions(id) ON DELETE CASCADE,
    FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (transaction_id) REFERENCES transactions(id),
    FOREIGN KEY (approved_by) REFERENCES users(id)
  );
  CREATE INDEX IF NOT EXISTS idx_opportunity_payments_status ON opportunity_payments(status);
  CREATE TABLE IF NOT EXISTS admin_audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_user_id INTEGER NOT NULL,
    affected_user_id INTEGER,
    action TEXT NOT NULL,
    previous_value TEXT,
    new_value TEXT,
    reason TEXT,
    reference TEXT UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (admin_user_id) REFERENCES users(id),
    FOREIGN KEY (affected_user_id) REFERENCES users(id)
  );
`);
[
  ['transactions', 'currency', "TEXT DEFAULT 'KES'"],
  ['opportunities', 'payment_amount', 'INTEGER DEFAULT 0'],
  ['opportunities', 'payment_currency', "TEXT DEFAULT 'KES'"],
  ['opportunities', 'payment_method', "TEXT DEFAULT 'Wallet credit'"],
  ['opportunities', 'payment_basis', "TEXT DEFAULT 'per approved submission'"],
  ['opportunities', 'positions', 'INTEGER DEFAULT 0'],
  ['opportunities', 'application_deadline', 'TEXT'],
  ['opportunities', 'start_date', 'TEXT'],
  ['opportunities', 'completion_date', 'TEXT'],
  ['opportunities', 'image_url', 'TEXT'],
  ['opportunities', 'attachment_url', 'TEXT'],
  ['opportunities', 'instructions', 'TEXT'],
  ['opportunities', 'eligibility', 'TEXT'],
  ['opportunities', 'created_by', 'INTEGER REFERENCES users(id)']
].forEach(([table, column, definition]) => ensureColumn(table, column, definition));

const PACKAGES = Object.freeze({ Bronze: 1000, Silver: 1750, Gold: 2500 });
const TOKEN_TTL_DAYS = Number(process.env.SESSION_TTL_DAYS) || 30;
const SESSION_COOKIE = 'online_sphere_session';
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const normalizeEmail = (value) => String(value || '').trim().toLowerCase();
const normalizePhone = (phone) => {
  let value = String(phone || '').trim().replace(/[\s()-]/g, '');
  if (value.startsWith('+')) value = value.slice(1);
  if (value.startsWith('0')) value = `254${value.slice(1)}`;
  else if (/^[17]/.test(value)) value = `254${value}`;
  return /^254[17]\d{8}$/.test(value) ? value : null;
};
async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt}$${key.toString('hex')}`;
}
async function verifyPassword(password, encoded) {
  const [scheme, salt, expectedHex] = String(encoded || '').split('$');
  if (scheme !== 'scrypt' || !salt || !expectedHex) return false;
  const expected = Buffer.from(expectedHex, 'hex');
  const actual = await scrypt(password, salt, expected.length);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}
function cookieOptions(maxAge) {
  return { httpOnly: true, secure: process.env.COOKIE_SECURE !== 'false', sameSite: process.env.SESSION_COOKIE_SAMESITE || 'none', path: '/', maxAge };
}
function writeCookie(res, name, value, options) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${options.path}`, `Max-Age=${Math.max(0, Math.floor(options.maxAge / 1000))}`, `SameSite=${options.sameSite}`];
  if (options.httpOnly) parts.push('HttpOnly');
  if (options.secure) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}
function setSessionCookie(res, token) {
  writeCookie(res, SESSION_COOKIE, token, cookieOptions(TOKEN_TTL_DAYS * 86400000));
}
function clearAuthCookies(res) {
  writeCookie(res, SESSION_COOKIE, '', cookieOptions(0));
}
function issueSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + TOKEN_TTL_DAYS * 86400000).toISOString();
  db.prepare('INSERT INTO sessions (user_id, token_hash, expires_at) VALUES (?, ?, ?)').run(userId, sha256(token), expiresAt);
  return token;
}
function findSession(req) {
  const header = String(req.get('authorization') || '');
  const bearer = /^Bearer\s+(.+)$/i.exec(header)?.[1];
  const token = req.cookies?.[SESSION_COOKIE] || bearer || req.get('x-online-sphere-session');
  if (!token || token.length > 512) return null;
  return db.prepare(`SELECT u.id, u.full_name, u.email, u.phone, u.created_at, u.referral_code,
      a.id AS account_id, a.package, a.status AS account_status, a.currency, a.account_number,
      a.balance, a.total_earned, a.total_withdrawn, a.pending_withdrawal
    FROM sessions s JOIN users u ON u.id=s.user_id
    LEFT JOIN accounts a ON a.user_id=u.id
    WHERE s.token_hash=? AND datetime(s.expires_at)>datetime('now') LIMIT 1`).get(sha256(token)) || null;
}
function requireSession(req, res, next) {
  try {
    const user = findSession(req);
    if (!user) return res.status(401).json({ success: false, message: 'Please sign in to continue.' });
    req.member = user;
    next();
  } catch (error) { next(error); }
}
function makeReferralCode() { return crypto.randomBytes(8).toString('hex'); }
function createUserAccount({ fullName, email, phone, passwordHash, referralCode }) {
  const insertUser = db.prepare(`INSERT INTO users (full_name,email,phone,password_hash,referral_code,referred_by_user_id) VALUES (?,?,?,?,?,?)`);
  const insertAccount = db.prepare(`INSERT INTO accounts (user_id,account_number,status,currency) VALUES (?,?,?,?)`);
  const referrer = referralCode ? db.prepare('SELECT id FROM users WHERE lower(referral_code)=lower(?)').get(referralCode) : null;
  if (referralCode && !referrer) throw Object.assign(new Error('That referral link is invalid or expired.'), { status: 400 });
  const create = db.transaction(() => {
    const userResult = insertUser.run(fullName, email, phone || null, passwordHash, makeReferralCode(), referrer?.id || null);
    const userId = Number(userResult.lastInsertRowid);
    const accountNumber = `OS${Date.now().toString().slice(-8)}${crypto.randomInt(1000, 10000)}`;
    insertAccount.run(userId, accountNumber, 'inactive', 'KES');
    return userId;
  });
  return create();
}

function audit(event, details = {}) {
  console.info(`[auth] ${event}`, JSON.stringify(details));
}
function recordAdminAction(adminUserId, affectedUserId, action, previousValue, newValue, reason) {
  const reference = `AUDIT-${crypto.randomUUID()}`;
  db.prepare(`
    INSERT INTO admin_audit_logs
      (admin_user_id,affected_user_id,action,previous_value,new_value,reason,reference)
    VALUES (?,?,?,?,?,?,?)
  `).run(
    adminUserId,
    affectedUserId || null,
    action,
    previousValue == null ? null : JSON.stringify(previousValue),
    newValue == null ? null : JSON.stringify(newValue),
    reason || null,
    reference
  );
  if (affectedUserId) {
    notifyUser(affectedUserId, 'Account updated', `${action.replaceAll('_', ' ')} was updated by an administrator.`, action.includes('status') ? 'membership' : 'admin');
  }
  return reference;
}
const OPPORTUNITY_STATUSES = new Set(['draft', 'published', 'paused', 'closed', 'active']);
const PAYMENT_CURRENCIES = new Set(['KES', 'USD', 'EUR', 'GBP']);
const PAYMENT_BASES = new Set(['per task', 'per approved submission', 'per completed project']);
function notifyUser(userId, title, message, type = 'opportunity') {
  const duplicate = db.prepare(`
    SELECT id FROM notifications
    WHERE user_id=? AND title=? AND message=? AND type=?
      AND datetime(created_at)>=datetime('now','-5 minutes')
    LIMIT 1
  `).get(userId, title, message, type);
  if (duplicate) return false;
  db.prepare('INSERT INTO notifications (user_id,title,message,type) VALUES (?,?,?,?)').run(userId, title, message, type);
  return true;
}
function notifyEligibleMembers(title, message, type = 'opportunity') {
  const members = db.prepare(`SELECT id FROM users WHERE lower(COALESCE(role,'member'))='member' OR COALESCE(is_admin,0)=0`).all();
  db.transaction(() => members.forEach(({ id }) => notifyUser(id, title, message, type)))();
}
function opportunityPayload(body, partial = false) {
  const value = (key) => String(body?.[key] ?? '').trim();
  const title = value('title');
  const category = value('category');
  const description = value('description');
  const paymentAmount = Number(body?.paymentAmount);
  const currency = value('paymentCurrency') || 'KES';
  const basis = value('paymentBasis') || 'per approved submission';
  const positions = Number(body?.positions || 0);
  const status = (value('status') || 'draft').toLowerCase();
  if (!partial && (!title || title.length > 160 || !category || !description)) throw Object.assign(new Error('Title, category and detailed description are required.'), { status: 400 });
  if (title && title.length > 160) throw Object.assign(new Error('Opportunity title is too long.'), { status: 400 });
  if (body?.paymentAmount !== undefined && (!Number.isSafeInteger(paymentAmount) || paymentAmount < 0)) throw Object.assign(new Error('Payment amount must be a non-negative whole number.'), { status: 400 });
  if (!PAYMENT_CURRENCIES.has(currency)) throw Object.assign(new Error('Select a supported payment currency.'), { status: 400 });
  if (!PAYMENT_BASES.has(basis)) throw Object.assign(new Error('Select a supported payment basis.'), { status: 400 });
  if (!Number.isSafeInteger(positions) || positions < 0) throw Object.assign(new Error('Available positions must be zero or a positive whole number.'), { status: 400 });
  if (!OPPORTUNITY_STATUSES.has(status)) throw Object.assign(new Error('Invalid opportunity status.'), { status: 400 });
  return {
    title, category, description, difficulty: value('difficulty') || 'Beginner',
    earningModel: value('earningModel'), requirements: value('requirements'),
    instructions: value('instructions'), eligibility: value('eligibility'),
    paymentAmount: body?.paymentAmount === undefined ? 0 : paymentAmount,
    paymentCurrency: currency, paymentMethod: value('paymentMethod') || 'Wallet credit',
    paymentBasis: basis, positions, applicationDeadline: value('applicationDeadline') || null,
    startDate: value('startDate') || null, completionDate: value('completionDate') || null,
    imageUrl: value('imageUrl') || null, attachmentUrl: value('attachmentUrl') || null,
    status
  };
}
function publicOpportunityWhere() {
  return `(lower(status) IN ('published','active') AND (application_deadline IS NULL OR datetime(application_deadline)>=datetime('now')))`;
}
function assertSameOrigin(req, res, next) {
  const origin = req.get('origin');
  if (origin && !allowedOrigins.has(origin)) return res.status(403).json({ success: false, message: 'Request origin is not allowed.' });
  next();
}
app.get('/', (_req, res) => res.json({ success: true, service: 'Online Sphere Backend', status: 'running' }));
app.get('/health', (_req, res) => res.json({ success: true, service: 'Online Sphere Backend', status: 'ready', database: 'connected' }));
app.get('/api/packages', (_req, res) => res.json({ success: true, currency: 'KES', packages: Object.entries(PACKAGES).map(([name, price]) => ({ name, price })) }));

// Registration and login use password authentication and expiring HTTP-only cookies.
app.post('/api/auth/register', assertSameOrigin, async (req, res, next) => {
  try {
    const fullName = String(req.body?.fullName || '').trim().replace(/\s+/g, ' ');
    const email = normalizeEmail(req.body?.email);
    const phone = normalizePhone(req.body?.phone);
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const passwordConfirmation = typeof req.body?.passwordConfirmation === 'string' ? req.body.passwordConfirmation : '';
    const referralCode = String(req.body?.ref || req.body?.referralCode || '').trim();
    if (fullName.length < 2 || fullName.length > 100) return res.status(400).json({ success: false, message: 'Enter your full name (2–100 characters).' });
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ success: false, message: 'Enter a valid email address.' });
    if (!phone) return res.status(400).json({ success: false, message: 'Enter a valid Kenyan mobile number.' });
    if (password.length < 8 || password.length > 128) return res.status(400).json({ success: false, message: 'Password must be at least 8 characters.' });
    if (password !== passwordConfirmation) return res.status(400).json({ success: false, message: 'Passwords do not match.' });
    const duplicate = db.prepare('SELECT email, phone FROM users WHERE lower(email)=? OR phone=? LIMIT 1').get(email, phone);
    if (duplicate) return res.status(409).json({ success: false, message: duplicate.email.toLowerCase() === email ? 'An account with this email already exists. Sign in instead.' : 'An account with this phone number already exists.' });
    const passwordHash = await hashPassword(password);
    const userId = createUserAccount({ fullName, email, phone, passwordHash, referralCode });
    setSessionCookie(res, issueSession(userId));
    audit('registration_completed', { userId });
    return res.status(201).json({ success: true, message: 'Account created. Welcome to Online Sphere.' });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ success: false, message: error.message });
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ success: false, message: 'An account with these details already exists.' });
    next(error);
  }
});
app.post('/api/auth/login', assertSameOrigin, async (req, res, next) => {
  try {
    const identifier = String(req.body?.identifier || '').trim();
    const email = normalizeEmail(identifier);
    const phone = normalizePhone(identifier);
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if ((!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) && !phone) return res.status(400).json({ success: false, message: 'Enter a valid email address or phone number.' });
    const user = db.prepare('SELECT id,full_name,email,phone,password_hash FROM users WHERE lower(email)=? OR phone=? LIMIT 1').get(email, phone);
    if (!user || !password || !(await verifyPassword(password, user.password_hash))) return res.status(401).json({ success: false, message: 'The login details are incorrect.' });
    setSessionCookie(res, issueSession(user.id));
    audit('login_completed', { userId: user.id, identifierType: phone ? 'phone' : 'email' });
    return res.json({ success: true, message: 'Signed in successfully.' });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ success: false, message: error.message });
    next(error);
  }
});
app.get('/api/auth/me', requireSession, (req, res) => res.json({ success: true, user: { id: req.member.id, fullName: req.member.full_name, email: req.member.email, phone: req.member.phone } }));
app.post('/api/auth/logout', assertSameOrigin, (req, res) => {
  const header = String(req.get('authorization') || '');
  const token = req.cookies?.[SESSION_COOKIE] || /^Bearer\s+(.+)$/i.exec(header)?.[1] || req.get('x-online-sphere-session');
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(sha256(token));
  clearAuthCookies(res);
  res.json({ success: true });
});
app.get('/api/me/dashboard', requireSession, (req, res) => {
  const member = req.member;
  const verified = db.prepare(`SELECT type, amount, status, created_at FROM transactions WHERE user_id=? AND lower(status) IN ('completed','verified','paid','approved')`).all(member.id);
  const sumTypes = (types) => verified.filter((tx) => types.includes(String(tx.type).toLowerCase())).reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
  const txCount = db.prepare('SELECT COUNT(*) AS count FROM transactions WHERE user_id=?').get(member.id).count;
  const pending = db.prepare(`SELECT COALESCE(SUM(amount),0) AS total FROM transactions WHERE user_id=? AND lower(status)='pending'`).get(member.id).total;
  const membershipActive = String(member.account_status || '').toLowerCase() === 'active';
  const referralCount = db.prepare('SELECT COUNT(*) AS count FROM users WHERE referred_by_user_id=?').get(member.id).count;
  const accountBalance = Number(member.balance || 0);
  const totalEarned = Number(member.total_earned || 0) || sumTypes(['earning', 'task_earning', 'commission']);
  const totalWithdrawn = Number(member.total_withdrawn || 0) || sumTypes(['withdrawal']);
  const pendingWithdrawal = Number(member.pending_withdrawal || 0);
  const transactions = db.prepare(`
    SELECT id,type,amount,status,reference,description,created_at
    FROM transactions WHERE user_id=? ORDER BY id DESC LIMIT 100
  `).all(member.id);
  const withdrawals = db.prepare(`
    SELECT id,amount,method,phone,status,reference,notes,created_at,processed_at
    FROM withdrawals WHERE user_id=? ORDER BY id DESC LIMIT 100
  `).all(member.id);
  const notifications = db.prepare(`
    SELECT id,title,message,type,read_at,created_at
    FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 50
  `).all(member.id);
  res.json({ success: true, dashboard: {
    user: { id: member.id, fullName: member.full_name, email: member.email, phone: member.phone, createdAt: member.created_at, status: member.account_status },
    membership: { name: member.package, package: member.package, status: member.account_status, active: membershipActive },
    wallet: { currency: member.currency || 'KES', walletBalance: accountBalance, availableBalance: Math.max(0, accountBalance - pendingWithdrawal), pendingBalance: Number(pending), totalDeposited: sumTypes(['deposit','membership_payment']), totalWithdrawn, totalEarnings: totalEarned },
    statistics: { transactionCount: Number(txCount), totalDeposited: sumTypes(['deposit','membership_payment']), totalWithdrawn, todayEarnings: totalEarned },
    referrals: { sponsorName: null, joinedCount: Number(referralCount), verifiedCount: Number(referralCount), url: member.referral_code ? `${process.env.PUBLIC_SITE_URL || 'https://onlinespherecommercecompany.com'}/register?ref=${encodeURIComponent(member.referral_code)}` : null, pendingCommissions: 0, paidCommissions: 0 },
    transactions,
    withdrawals,
    notifications
  } });
});

app.get('/api/opportunities', (_req, res) => {
  const opportunities = db.prepare(`
    SELECT id,title,category,description,difficulty,earning_model,requirements,instructions,eligibility,
      payment_amount,payment_currency,payment_method,payment_basis,positions,application_deadline,
      start_date,completion_date,image_url,attachment_url,platform_name,external_url,risk_level,
      featured,status,created_at,updated_at
    FROM opportunities WHERE ${publicOpportunityWhere()}
    ORDER BY featured DESC,created_at DESC,id ASC
  `).all();
  res.set('Cache-Control', 'no-store');
  res.json({ success: true, count: opportunities.length, opportunities });
});
app.get('/api/me/notifications', requireSession, (req, res) => {
  const notifications = db.prepare('SELECT id,title,message,type,read_at,created_at FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 100').all(req.member.id);
  res.json({ success: true, unreadCount: notifications.filter((item) => !item.read_at).length, notifications });
});
app.post('/api/me/notifications/read-all', requireSession, (req, res) => {
  db.prepare('UPDATE notifications SET read_at=CURRENT_TIMESTAMP WHERE user_id=? AND read_at IS NULL').run(req.member.id);
  res.json({ success: true });
});
app.post('/api/me/notifications/:id/read', requireSession, (req, res) => {
  const result = db.prepare('UPDATE notifications SET read_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?').run(Number(req.params.id), req.member.id);
  if (!result.changes) return res.status(404).json({ success: false, message: 'Notification not found.' });
  res.json({ success: true });
});
app.get('/api/opportunities/:id', requireSession, (req, res) => {
  const opportunity = db.prepare(`SELECT * FROM opportunities WHERE id=? AND ${publicOpportunityWhere()}`).get(Number(req.params.id));
  if (!opportunity) return res.status(404).json({ success: false, message: 'Opportunity not found or no longer active.' });
  const application = db.prepare('SELECT id,status,application_note,created_at FROM opportunity_applications WHERE opportunity_id=? AND user_id=?').get(opportunity.id, req.member.id);
  res.json({ success: true, opportunity, application: application || null });
});
app.post('/api/opportunities/:id/apply', requireSession, (req, res) => {
  const opportunity = db.prepare(`SELECT * FROM opportunities WHERE id=? AND ${publicOpportunityWhere()}`).get(Number(req.params.id));
  if (!opportunity) return res.status(404).json({ success: false, message: 'Opportunity not found or no longer accepting applications.' });
  const existing = db.prepare('SELECT id,status FROM opportunity_applications WHERE opportunity_id=? AND user_id=?').get(opportunity.id, req.member.id);
  if (existing) return res.status(409).json({ success: false, message: `You already applied for this opportunity (${existing.status}).` });
  const filled = db.prepare(`SELECT COUNT(*) AS count FROM opportunity_applications WHERE opportunity_id=? AND lower(status) IN ('pending','accepted')`).get(opportunity.id).count;
  if (Number(opportunity.positions) > 0 && Number(filled) >= Number(opportunity.positions)) return res.status(409).json({ success: false, message: 'All available positions have been filled.' });
  const note = String(req.body?.applicationNote || '').trim().slice(0, 2000);
  const result = db.prepare('INSERT INTO opportunity_applications (opportunity_id,user_id,application_note) VALUES (?,?,?)').run(opportunity.id, req.member.id, note || null);
  notifyUser(req.member.id, 'Application received', `Your application for "${opportunity.title}" is pending administrator review.`, 'application');
  res.status(201).json({ success: true, applicationId: Number(result.lastInsertRowid), message: 'Application submitted for review.' });
});
app.post('/api/opportunities/:id/submit', requireSession, (req, res) => {
  const application = db.prepare(`SELECT a.*,o.title FROM opportunity_applications a JOIN opportunities o ON o.id=a.opportunity_id WHERE a.opportunity_id=? AND a.user_id=? AND lower(a.status)='accepted'`).get(Number(req.params.id), req.member.id);
  if (!application) return res.status(404).json({ success: false, message: 'An accepted application is required before submitting work.' });
  const content = String(req.body?.content || '').trim();
  if (!content || content.length > 10000) return res.status(400).json({ success: false, message: 'Provide submission details up to 10,000 characters.' });
  const existing = db.prepare('SELECT id FROM opportunity_submissions WHERE application_id=?').get(application.id);
  if (existing) return res.status(409).json({ success: false, message: 'A submission already exists for this application.' });
  const result = db.prepare('INSERT INTO opportunity_submissions (application_id,user_id,opportunity_id,content,attachment_url) VALUES (?,?,?,?,?)').run(application.id, req.member.id, application.opportunity_id, content, String(req.body?.attachmentUrl || '').trim() || null);
  res.status(201).json({ success: true, submissionId: Number(result.lastInsertRowid), message: 'Submission sent for administrator review.' });
});

// M-Pesa Daraja STK Push remains available; membership is only activated by a validated callback.
function missingMpesaConfig() { return ['MPESA_CONSUMER_KEY','MPESA_CONSUMER_SECRET','MPESA_SHORTCODE','MPESA_PASSKEY','MPESA_CALLBACK_URL'].filter((key) => !process.env[key]); }
function mpesaBase() { return process.env.MPESA_ENV === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke'; }
function mpesaTimestamp() { const d = new Date(); return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}${String(d.getHours()).padStart(2,'0')}${String(d.getMinutes()).padStart(2,'0')}${String(d.getSeconds()).padStart(2,'0')}`; }
async function mpesaToken() {
  const auth = Buffer.from(`${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`).toString('base64');
  const response = await fetch(`${mpesaBase()}/oauth/v1/generate?grant_type=client_credentials`, { headers: { Authorization: `Basic ${auth}` }, signal: AbortSignal.timeout(20000) });
  const data = await response.json();
  if (!response.ok || !data.access_token) throw new Error('M-Pesa authentication failed');
  return data.access_token;
}
app.post('/api/mpesa/stkpush', async (req, res) => {
  const requestId = crypto.randomUUID();
  try {
    if (missingMpesaConfig().length) return res.status(503).json({ success: false, requestId, message: 'Payment service is not fully configured.' });
    const phone = normalizePhone(req.body?.phone);
    const packageName = String(req.body?.packageName || '').trim();
    if (!phone) return res.status(400).json({ success: false, requestId, message: 'Enter a valid Kenyan M-Pesa phone number.' });
    if (!Object.hasOwn(PACKAGES, packageName)) return res.status(400).json({ success: false, requestId, message: 'Select a valid membership package.' });
    const amount = PACKAGES[packageName];
    db.prepare(`INSERT INTO payment_attempts (request_id,phone,package_name,amount,status) VALUES (?,?,?,?,'pending')`).run(requestId, phone, packageName, amount);
    const timestamp = mpesaTimestamp();
    const response = await fetch(`${mpesaBase()}/mpesa/stkpush/v1/processrequest`, { method: 'POST', headers: { Authorization: `Bearer ${await mpesaToken()}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ BusinessShortCode: process.env.MPESA_SHORTCODE, Password: Buffer.from(`${process.env.MPESA_SHORTCODE}${process.env.MPESA_PASSKEY}${timestamp}`).toString('base64'), Timestamp: timestamp, TransactionType: 'CustomerPayBillOnline', Amount: amount, PartyA: phone, PartyB: process.env.MPESA_SHORTCODE, PhoneNumber: phone, CallBackURL: process.env.MPESA_CALLBACK_URL, AccountReference: `OS-${packageName}`, TransactionDesc: `Online Sphere ${packageName}` }), signal: AbortSignal.timeout(30000) });
    const data = await response.json();
    if (!response.ok || data.ResponseCode !== '0') {
      db.prepare(`UPDATE payment_attempts SET status='rejected',updated_at=CURRENT_TIMESTAMP WHERE request_id=?`).run(requestId);
      return res.status(502).json({ success: false, requestId, message: data.errorMessage || data.ResponseDescription || 'M-Pesa did not accept the payment request.' });
    }
    db.prepare(`UPDATE payment_attempts SET merchant_request_id=?,checkout_request_id=?,status='stk_sent',updated_at=CURRENT_TIMESTAMP WHERE request_id=?`).run(data.MerchantRequestID || null, data.CheckoutRequestID || null, requestId);
    res.json({ success: true, requestId, message: 'STK Push sent. Complete the prompt on your phone; payment is not confirmed until callback verification.', packageName, amount, currency: 'KES', checkoutRequestId: data.CheckoutRequestID });
  } catch (error) { console.error(`[${requestId}] STK error:`, error.message); res.status(502).json({ success: false, requestId, message: 'Payment request could not be completed.' }); }
});
app.post('/api/mpesa/callback', (req, res) => {
  const callback = req.body?.Body?.stkCallback;
  if (!callback?.CheckoutRequestID) return res.status(400).json({ ResultCode: 1, ResultDesc: 'Invalid callback payload' });
  try {
    const attempt = db.prepare('SELECT * FROM payment_attempts WHERE checkout_request_id=?').get(callback.CheckoutRequestID);
    if (!attempt || ['paid','paid_unlinked','review'].includes(attempt.status)) return res.json({ ResultCode: 0, ResultDesc: 'Callback recorded' });
    const resultCode = Number(callback.ResultCode);
    if (resultCode !== 0) {
      db.prepare(`UPDATE payment_attempts SET status='failed',result_code=?,result_description=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(resultCode, String(callback.ResultDesc || 'Payment failed'), attempt.id);
      const failedUser = db.prepare('SELECT id FROM users WHERE phone=?').get(attempt.phone);
      if (failedUser) notifyUser(failedUser.id, 'Payment rejected', `Your ${attempt.package_name} membership payment was rejected. ${String(callback.ResultDesc || 'Please try again.')}`, 'payment');
      return res.json({ ResultCode: 0, ResultDesc: 'Payment failure recorded' });
    }
    const metadata = Object.fromEntries((callback.CallbackMetadata?.Item || []).filter((item) => item.Name).map((item) => [item.Name, item.Value ?? null]));
    const receipt = String(metadata.MpesaReceiptNumber || '').trim();
    if (Number(metadata.Amount) !== attempt.amount || normalizePhone(metadata.PhoneNumber) !== attempt.phone || !/^[A-Z0-9]{6,20}$/.test(receipt)) {
      db.prepare(`UPDATE payment_attempts SET status='review',result_description='Callback details require review',updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(attempt.id);
      return res.json({ ResultCode: 0, ResultDesc: 'Payment received for review' });
    }
    const user = db.prepare('SELECT id FROM users WHERE phone=?').get(attempt.phone);
    const account = user ? db.prepare('SELECT id FROM accounts WHERE user_id=?').get(user.id) : null;
    db.transaction(() => {
      if (user && account) {
        db.prepare(`INSERT INTO transactions (user_id,account_id,type,amount,status,reference,description) VALUES (?,?,?,?,'completed',?,?)`).run(user.id, account.id, 'membership_payment', attempt.amount, receipt, `Online Sphere ${attempt.package_name} membership`);
        db.prepare(`UPDATE accounts SET package=?,activation_fee=?,status='active',updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?`).run(attempt.package_name, attempt.amount, account.id, user.id);
        notifyUser(user.id, 'Membership activated', `Your ${attempt.package_name} membership is active after payment confirmation.`, 'membership');
      }
      db.prepare(`UPDATE payment_attempts SET status=?,mpesa_receipt=?,result_code=?,result_description=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(user && account ? 'paid' : 'paid_unlinked', receipt, resultCode, String(callback.ResultDesc || 'Success'), attempt.id);
    })();
    res.json({ ResultCode: 0, ResultDesc: 'Callback processed' });
  } catch (error) { console.error('[M-Pesa callback]', error.message); res.json({ ResultCode: 0, ResultDesc: 'Callback received for investigation' }); }
});
app.post('/api/ai/chat', async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) return res.status(503).json({ success: false, message: 'Online Sphere AI is not configured.' });
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    if (!message || message.length > 2000) return res.status(400).json({ success: false, message: 'Enter a message up to 2000 characters.' });
    const OpenAI = require('openai');
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 30000, maxRetries: 1 });
    const response = await client.responses.create({ model: process.env.OPENAI_MODEL || 'gpt-4.1-mini', instructions: 'You are Online Sphere AI. Be honest; do not invent tasks, payments, member data, or guaranteed earnings. Never request passwords or M-Pesa PINs.', input: message, max_output_tokens: 500 });
    res.json({ success: true, reply: response.output_text });
  } catch (error) { console.error('[Online Sphere AI]', error.message); res.status(502).json({ success: false, message: 'Online Sphere AI is temporarily unavailable.' }); }
});

/* =========================================================
   ONLINE SPHERE ADMINISTRATOR API
   Admin email: muthinibenson7@gmail.com
   ========================================================= */


/* =========================================================
   ONLINE SPHERE ADMIN AUTHENTICATION
   ========================================================= */

const ADMIN_EMAIL = normalizeEmail(
  process.env.ADMIN_EMAIL ||
  String(process.env.ADMIN_EMAILS || '').split(',')[0] ||
  'muthinibenson7@gmail.com'
);

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

db.exec(`
CREATE TABLE IF NOT EXISTS admin_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  admin_user_id INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

function requireAdmin(req, res, next) {
  try {
    const header = String(req.get('authorization') || '');
    const token = /^Bearer\s+(.+)$/i.exec(header)?.[1];

    if (!token || token.length > 512) {
      return res.status(401).json({
        success: false,
        message: 'Administrator login required.'
      });
    }

    const session = db.prepare(`
      SELECT admin_user_id
      FROM admin_sessions
      WHERE token_hash=?
        AND datetime(expires_at)>datetime('now')
      LIMIT 1
    `).get(sha256(token));

    if (!session) {
      return res.status(401).json({
        success: false,
        message: 'Admin session expired. Sign in again.'
      });
    }

    const admin = db.prepare(`
      SELECT id,full_name,email
      FROM users
      WHERE id=? AND lower(email)=?
      LIMIT 1
    `).get(session.admin_user_id, ADMIN_EMAIL);

    if (!admin) {
      return res.status(403).json({
        success: false,
        message: 'Administrator access denied.'
      });
    }

    req.admin = admin;
    req.adminTokenHash = sha256(token);
    next();
  } catch (error) {
    next(error);
  }
}

async function ensureAdministratorAccount() {
  let admin = db.prepare(`
    SELECT id,full_name,email
    FROM users
    WHERE lower(email)=?
    LIMIT 1
  `).get(ADMIN_EMAIL);

  if (admin) {
    if (db.prepare('PRAGMA table_info(users)').all().some((column) => column.name === 'is_admin')) {
      db.prepare(`
        UPDATE users
        SET role='owner',is_admin=1,updated_at=CURRENT_TIMESTAMP
        WHERE id=?
      `).run(admin.id);
    }
    return admin;
  }

  const passwordHash = await hashPassword(ADMIN_PASSWORD);
  const userId = createUserAccount({
    fullName: 'Online Sphere Administrator',
    email: ADMIN_EMAIL,
    phone: null,
    passwordHash,
    referralCode: ''
  });
  if (db.prepare('PRAGMA table_info(users)').all().some((column) => column.name === 'is_admin')) {
    db.prepare(`
      UPDATE users
      SET role='owner',is_admin=1,updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).run(userId);
  }
  admin = db.prepare('SELECT id,full_name,email FROM users WHERE id=?').get(userId);
  return admin;
}

/* Administrator login */
app.post('/api/admin/login', async (req, res, next) => {
  try {
    if (!ADMIN_PASSWORD) {
      return res.status(503).json({
        success: false,
        message: 'Administrator password is not configured.'
      });
    }

    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || '');

    if (
      email !== ADMIN_EMAIL ||
      password.length === 0 ||
      password.length > 256
    ) {
      return res.status(401).json({
        success: false,
        message: 'Invalid administrator credentials.'
      });
    }

    const supplied = Buffer.from(password);
    const expected = Buffer.from(ADMIN_PASSWORD);

    if (
      supplied.length !== expected.length ||
      !crypto.timingSafeEqual(supplied, expected)
    ) {
      return res.status(401).json({
        success: false,
        message: 'Invalid administrator credentials.'
      });
    }

    const admin = await ensureAdministratorAccount();
    const token = crypto.randomBytes(32).toString('base64url');
    const tokenHash = sha256(token);
    const expiresAt = new Date(
      Date.now() + 8 * 60 * 60 * 1000
    ).toISOString();

    db.prepare(`
      INSERT INTO admin_sessions
      (token_hash,admin_user_id,expires_at)
      VALUES (?,?,?)
    `).run(tokenHash, admin.id, expiresAt);

    res.json({
      success: true,
      token,
      expiresAt,
      admin: {
        id: admin.id,
        name: admin.full_name,
        email: admin.email
      }
    });
  } catch (error) {
    next(error);
  }
});

/* Administrator session verification */
app.get('/api/admin/me', requireAdmin, (req, res) => {
  res.json({
    success: true,
    isAdmin: true,
    admin: req.admin
  });
});

/* Administrator logout */
app.post('/api/admin/logout', requireAdmin, (req, res) => {
  db.prepare(`
    DELETE FROM admin_sessions
    WHERE token_hash=?
  `).run(req.adminTokenHash);

  res.json({
    success: true,
    message: 'Administrator logged out.'
  });
});

/* Remove expired admin sessions */
db.prepare(`
  DELETE FROM admin_sessions
  WHERE datetime(expires_at)<=datetime('now')
`).run();

// Administrator dashboard statistics
app.get('/api/admin/stats', requireAdmin, (req, res) => {
  const members = db.prepare(
    'SELECT COUNT(*) AS total FROM users'
  ).get().total;

  const activeMembers = db.prepare(
    "SELECT COUNT(*) AS total FROM accounts WHERE lower(status)='active'"
  ).get().total;

  const suspendedMembers = db.prepare(
    "SELECT COUNT(*) AS total FROM accounts WHERE lower(status)='suspended'"
  ).get().total;

  const transactions = db.prepare(
    'SELECT COUNT(*) AS total FROM transactions'
  ).get().total;

  const revenue = db.prepare(`
    SELECT COALESCE(SUM(amount),0) AS total
    FROM transactions
    WHERE type='membership_payment'
      AND lower(status) IN ('completed','verified','paid','approved')
  `).get().total;

  const withdrawals = db.prepare(`
    SELECT COALESCE(SUM(amount),0) AS total
    FROM withdrawals
    WHERE lower(status)='pending'
  `).get().total;

  const memberships = db.prepare(`
    SELECT COUNT(*) AS total
    FROM packages
    WHERE lower(status)='active'
  `).get().total;

  res.json({
    success: true,
    stats: {
      totalMembers: Number(members),
      activeMembers: Number(activeMembers),
      suspendedMembers: Number(suspendedMembers),
      totalMemberships: Number(memberships),
      totalTransactions: Number(transactions),
      membershipRevenue: Number(revenue),
      pendingWithdrawals: Number(withdrawals)
    }
  });
});

app.get('/api/admin/opportunities', requireAdmin, (_req, res) => {
  const opportunities = db.prepare(`
    SELECT o.*, (SELECT COUNT(*) FROM opportunity_applications a WHERE a.opportunity_id=o.id) AS applicant_count,
      (SELECT COUNT(*) FROM opportunity_submissions s WHERE s.opportunity_id=o.id) AS submission_count,
      CASE WHEN o.positions>0 THEN o.positions*o.payment_amount ELSE 0 END AS allocated_amount,
      (SELECT COALESCE(SUM(amount),0) FROM opportunity_payments p WHERE p.opportunity_id=o.id AND p.status='approved') AS approved_amount
    FROM opportunities o ORDER BY o.id DESC
  `).all();
  res.json({ success: true, opportunities });
});
app.post('/api/admin/opportunities', requireAdmin, (req, res, next) => {
  try {
    const data = opportunityPayload(req.body);
    const result = db.prepare(`
      INSERT INTO opportunities
      (title,category,description,difficulty,earning_model,requirements,instructions,eligibility,
       payment_amount,payment_currency,payment_method,payment_basis,positions,application_deadline,
       start_date,completion_date,image_url,attachment_url,status,created_by,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, ?,CURRENT_TIMESTAMP)
    `).run(data.title,data.category,data.description,data.difficulty,data.earningModel,data.requirements,data.instructions,data.eligibility,
      data.paymentAmount,data.paymentCurrency,data.paymentMethod,data.paymentBasis,data.positions,data.applicationDeadline,
      data.startDate,data.completionDate,data.imageUrl,data.attachmentUrl,data.status,req.admin.id);
    const opportunity = db.prepare('SELECT * FROM opportunities WHERE id=?').get(result.lastInsertRowid);
    if (data.status === 'published') notifyEligibleMembers('New opportunity available', `A new opportunity "${data.title}" has been published. Open Opportunities to view the details and apply.`);
    res.status(201).json({ success: true, opportunity });
  } catch (error) { next(error); }
});
app.patch('/api/admin/opportunities/:id', requireAdmin, (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const current = db.prepare('SELECT * FROM opportunities WHERE id=?').get(id);
    if (!current) return res.status(404).json({ success: false, message: 'Opportunity not found.' });
    const merged = {
      title: req.body?.title ?? current.title, category: req.body?.category ?? current.category,
      description: req.body?.description ?? current.description, paymentAmount: req.body?.paymentAmount ?? current.payment_amount,
      paymentCurrency: req.body?.paymentCurrency ?? current.payment_currency, paymentBasis: req.body?.paymentBasis ?? current.payment_basis,
      positions: req.body?.positions ?? current.positions, status: req.body?.status ?? current.status,
      difficulty: req.body?.difficulty ?? current.difficulty, earningModel: req.body?.earningModel ?? current.earning_model,
      requirements: req.body?.requirements ?? current.requirements, instructions: req.body?.instructions ?? current.instructions,
      eligibility: req.body?.eligibility ?? current.eligibility, paymentMethod: req.body?.paymentMethod ?? current.payment_method,
      applicationDeadline: req.body?.applicationDeadline ?? current.application_deadline, startDate: req.body?.startDate ?? current.start_date,
      completionDate: req.body?.completionDate ?? current.completion_date, imageUrl: req.body?.imageUrl ?? current.image_url,
      attachmentUrl: req.body?.attachmentUrl ?? current.attachment_url
    };
    const data = opportunityPayload(merged, false);
    const changed = ['title', 'category', 'description', 'difficulty', 'earningModel', 'requirements', 'instructions', 'eligibility', 'paymentAmount', 'paymentCurrency', 'paymentMethod', 'paymentBasis', 'positions', 'applicationDeadline', 'startDate', 'completionDate', 'imageUrl', 'attachmentUrl', 'status']
      .some((key) => String(data[key] ?? '') !== String({
        title: current.title, category: current.category, description: current.description, difficulty: current.difficulty,
        earningModel: current.earning_model, requirements: current.requirements, instructions: current.instructions,
        eligibility: current.eligibility, paymentAmount: current.payment_amount, paymentCurrency: current.payment_currency,
        paymentMethod: current.payment_method, paymentBasis: current.payment_basis, positions: current.positions,
        applicationDeadline: current.application_deadline, startDate: current.start_date, completionDate: current.completion_date,
        imageUrl: current.image_url, attachmentUrl: current.attachment_url, status: current.status
      }[key] ?? ''));
    db.prepare(`
      UPDATE opportunities SET title=?,category=?,description=?,difficulty=?,earning_model=?,requirements=?,instructions=?,eligibility=?,
        payment_amount=?,payment_currency=?,payment_method=?,payment_basis=?,positions=?,application_deadline=?,start_date=?,
        completion_date=?,image_url=?,attachment_url=?,status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?
    `).run(data.title,data.category,data.description,data.difficulty,data.earningModel,data.requirements,data.instructions,data.eligibility,
      data.paymentAmount,data.paymentCurrency,data.paymentMethod,data.paymentBasis,data.positions,data.applicationDeadline,data.startDate,
      data.completionDate,data.imageUrl,data.attachmentUrl,data.status,id);
    if (current.status !== 'published' && data.status === 'published') notifyEligibleMembers('New opportunity available', `A new opportunity "${data.title}" has been published. Open Opportunities to view the details and apply.`);
    else if (current.status === 'published' && changed) notifyEligibleMembers('Opportunity updated', `"${data.title}" has been updated. Review the latest details in Opportunities.`);
    if (current.status === 'published' && ['paused', 'closed'].includes(data.status) && changed) notifyEligibleMembers('Opportunity unavailable', `"${data.title}" is no longer accepting applications.`, 'opportunity');
    res.json({ success: true, opportunity: db.prepare('SELECT * FROM opportunities WHERE id=?').get(id) });
  } catch (error) { next(error); }
});
app.delete('/api/admin/opportunities/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const opportunity = db.prepare('SELECT id,title FROM opportunities WHERE id=?').get(id);
  if (!opportunity) return res.status(404).json({ success: false, message: 'Opportunity not found.' });
  db.prepare('DELETE FROM opportunities WHERE id=?').run(id);
  notifyEligibleMembers('Opportunity removed', `"${opportunity.title}" has been removed from Opportunities.`, 'opportunity');
  res.json({ success: true, message: 'Opportunity deleted.' });
});
app.get('/api/admin/opportunities/:id/applications', requireAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT a.id,a.opportunity_id,a.user_id,a.status,a.application_note,a.created_at,a.updated_at,
      u.full_name,u.email,u.phone,s.id AS submission_id,s.status AS submission_status,s.content,s.review_note
    FROM opportunity_applications a JOIN users u ON u.id=a.user_id
    LEFT JOIN opportunity_submissions s ON s.application_id=a.id
    WHERE a.opportunity_id=? ORDER BY a.id DESC
  `).all(Number(req.params.id));
  res.json({ success: true, applications: rows });
});
app.patch('/api/admin/applications/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const status = String(req.body?.status || '').toLowerCase();
  if (!['accepted','rejected','pending'].includes(status)) return res.status(400).json({ success: false, message: 'Invalid application status.' });
  const application = db.prepare('SELECT a.*,o.title FROM opportunity_applications a JOIN opportunities o ON o.id=a.opportunity_id WHERE a.id=?').get(id);
  if (!application) return res.status(404).json({ success: false, message: 'Application not found.' });
  db.prepare('UPDATE opportunity_applications SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(status, id);
  notifyUser(application.user_id, `Application ${status}`, `Your application for "${application.title}" was ${status}.`, 'application');
  res.json({ success: true });
});
app.get('/api/admin/submissions', requireAdmin, (_req, res) => {
  const submissions = db.prepare(`
    SELECT s.*,o.title,u.full_name,u.email,a.status AS application_status
    FROM opportunity_submissions s JOIN opportunities o ON o.id=s.opportunity_id
    JOIN users u ON u.id=s.user_id JOIN opportunity_applications a ON a.id=s.application_id
    ORDER BY s.id DESC
  `).all();
  res.json({ success: true, submissions });
});
app.patch('/api/admin/submissions/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const status = String(req.body?.status || '').toLowerCase();
  if (!['approved','rejected','pending'].includes(status)) return res.status(400).json({ success: false, message: 'Invalid submission status.' });
  const submission = db.prepare('SELECT s.*,o.title,o.payment_amount,o.payment_currency,a.id AS account_id FROM opportunity_submissions s JOIN opportunities o ON o.id=s.opportunity_id JOIN accounts a ON a.user_id=s.user_id WHERE s.id=?').get(id);
  if (!submission) return res.status(404).json({ success: false, message: 'Submission not found.' });
  const note = String(req.body?.reviewNote || '').trim().slice(0, 1000) || null;
  db.transaction(() => {
    db.prepare('UPDATE opportunity_submissions SET status=?,reviewed_at=CURRENT_TIMESTAMP,reviewed_by=?,review_note=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(status, req.admin.id, note, id);
    if (status === 'approved') {
      const payment = db.prepare('SELECT * FROM opportunity_payments WHERE submission_id=?').get(id);
      if (!payment) {
        const reference = `OPP-${submission.opportunity_id}-${id}`;
        const transaction = db.prepare(`INSERT INTO transactions (user_id,account_id,type,amount,currency,status,reference,description) VALUES (?,?,?, ?,?,'completed',?,?)`).run(submission.user_id, submission.account_id, 'task_earning', submission.payment_amount, submission.payment_currency, reference, `Approved opportunity: ${submission.title}`);
        db.prepare('UPDATE accounts SET balance=balance+?,total_earned=total_earned+?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(submission.payment_amount, submission.payment_amount, submission.account_id);
        db.prepare('INSERT INTO opportunity_payments (submission_id,opportunity_id,user_id,amount,currency,status,transaction_id,approved_by,approved_at) VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)').run(id, submission.opportunity_id, submission.user_id, submission.payment_amount, submission.payment_currency, 'approved', transaction.lastInsertRowid, req.admin.id);
      }
    }
  })();
  notifyUser(submission.user_id, `Submission ${status}`, `Your submission for "${submission.title}" was ${status}.`, 'submission');
  if (status === 'approved') notifyUser(submission.user_id, 'Payment approved and credited', `${submission.payment_currency} ${submission.payment_amount} was credited to your verified wallet for "${submission.title}".`, 'payment');
  res.json({ success: true });
});
app.get('/api/admin/payments', requireAdmin, (_req, res) => {
  const payments = db.prepare(`SELECT p.*,o.title,u.full_name,u.email,t.reference FROM opportunity_payments p JOIN opportunities o ON o.id=p.opportunity_id JOIN users u ON u.id=p.user_id LEFT JOIN transactions t ON t.id=p.transaction_id ORDER BY p.id DESC`).all();
  res.json({ success: true, payments });
});

// List registered members
app.get('/api/admin/members', requireAdmin, (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  const offset = (page - 1) * limit;
  const search = String(req.query.search || '').trim();

  const members = db.prepare(`
    SELECT
      u.id,
      u.full_name,
      u.email,
      u.phone,
      u.created_at,
      a.account_number,
      a.package,
      a.status AS account_status,
      a.balance,
      a.total_earned,
      a.total_withdrawn,
      a.currency
    FROM users u
    LEFT JOIN accounts a ON a.user_id=u.id
    WHERE (
      ? = ''
      OR lower(u.full_name) LIKE lower(?)
      OR lower(u.email) LIKE lower(?)
      OR u.phone LIKE ?
    )
    ORDER BY u.id DESC
    LIMIT ? OFFSET ?
  `).all(search, `%${search}%`, `%${search}%`, `%${search}%`, limit, offset);

  const total = db.prepare(`
    SELECT COUNT(*) AS total
    FROM users
    WHERE (
      ? = ''
      OR lower(full_name) LIKE lower(?)
      OR lower(email) LIKE lower(?)
      OR phone LIKE ?
    )
  `).get(search, `%${search}%`, `%${search}%`, `%${search}%`).total;

  res.json({
    success: true,
    members,
    pagination: {
      page,
      limit,
      total: Number(total),
      pages: Math.ceil(Number(total) / limit)
    }
  });
});

// Get one member
app.get('/api/admin/members/:id', requireAdmin, (req, res) => {
  const member = db.prepare(`
    SELECT
      u.id,u.full_name,u.email,u.phone,u.created_at,
      a.account_number,a.package,a.status AS account_status,
      a.balance,a.total_earned,a.total_withdrawn,a.currency
    FROM users u
    LEFT JOIN accounts a ON a.user_id=u.id
    WHERE u.id=?
  `).get(Number(req.params.id));

  if (!member) {
    return res.status(404).json({
      success: false,
      message: 'Member not found.'
    });
  }

  const transactions = db.prepare(`
    SELECT id,type,amount,status,reference,description,created_at
    FROM transactions
    WHERE user_id=?
    ORDER BY id DESC
    LIMIT 100
  `).all(member.id);

  res.json({ success: true, member, transactions });
});

// Suspend or reactivate a member
app.patch('/api/admin/members/:id/status', requireAdmin, (req, res) => {
  const userId = Number(req.params.id);
  const status = String(req.body?.status || '').toLowerCase();

  if (!['active', 'suspended', 'inactive'].includes(status)) {
    return res.status(400).json({
      success: false,
      message: 'Status must be active, suspended, or inactive.'
    });
  }

  if (userId === req.admin.id && status === 'suspended') {
    return res.status(400).json({
      success: false,
      message: 'You cannot suspend your own administrator account.'
    });
  }

  const account = db.prepare(
    'SELECT id,status FROM accounts WHERE user_id=?'
  ).get(userId);

  if (!account) {
    return res.status(404).json({
      success: false,
      message: 'Member account not found.'
    });
  }

  db.prepare(`
    UPDATE accounts
    SET status=?,updated_at=CURRENT_TIMESTAMP
    WHERE user_id=?
  `).run(status, userId);
  recordAdminAction(req.admin.id, userId, 'account_status_changed', { status: account.status }, { status }, `Administrator changed account status to ${status}.`);

  res.json({
    success: true,
    message: `Member account status updated to ${status}.`
  });
});

// Auditable wallet adjustment
app.post('/api/admin/members/:id/balance', requireAdmin, (req, res) => {
  const userId = Number(req.params.id);
  const amount = Number(req.body?.amount);
  const description = String(req.body?.description || '').trim();

  if (!Number.isSafeInteger(amount) || amount === 0) {
    return res.status(400).json({
      success: false,
      message: 'Enter a valid non-zero adjustment amount.'
    });
  }

  if (Math.abs(amount) > 10000000) {
    return res.status(400).json({
      success: false,
      message: 'Adjustment exceeds the allowed limit.'
    });
  }

  if (!description || description.length < 3 || description.length > 200) {
    return res.status(400).json({
      success: false,
      message: 'Provide a reason for this adjustment.'
    });
  }

  const account = db.prepare(`
    SELECT id,balance FROM accounts WHERE user_id=?
  `).get(userId);

  if (!account) {
    return res.status(404).json({
      success: false,
      message: 'Member account not found.'
    });
  }

  const newBalance = Number(account.balance || 0) + amount;

  if (newBalance < 0) {
    return res.status(400).json({
      success: false,
      message: 'Adjustment cannot make the wallet negative.'
    });
  }

  const reference = `ADMIN-${crypto.randomUUID()}`;

  db.transaction(() => {
    db.prepare(`
      UPDATE accounts
      SET balance=?,updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).run(newBalance, account.id);

    db.prepare(`
      INSERT INTO transactions
      (user_id,account_id,type,amount,status,reference,description)
      VALUES (?,?,?,?,?,?,?)
    `).run(
      userId,
      account.id,
      amount > 0 ? 'admin_credit' : 'admin_debit',
      Math.abs(amount),
      'completed',
      reference,
      `Administrator adjustment: ${description}`
    );
  })();
  recordAdminAction(req.admin.id, userId, amount > 0 ? 'wallet_credit' : 'wallet_debit', { balance: account.balance }, { balance: newBalance, amount }, description);

  res.json({
    success: true,
    message: 'Wallet adjustment recorded.',
    balance: newBalance,
    reference
  });
});

// Delete member account permanently
app.delete('/api/admin/members/:id', requireAdmin, (req, res) => {
  const userId = Number(req.params.id);

  if (!Number.isSafeInteger(userId) || userId <= 0) {
    return res.status(400).json({
      success: false,
      message: 'Invalid member ID.'
    });
  }

  if (userId === req.admin.id) {
    return res.status(400).json({
      success: false,
      message: 'You cannot delete your own administrator account.'
    });
  }

  const member = db.prepare(
    'SELECT id,email FROM users WHERE id=?'
  ).get(userId);

  if (!member) {
    return res.status(404).json({
      success: false,
      message: 'Member not found.'
    });
  }

  // Preserve payment/financial history; do not delete accounts
  // with recorded transactions or withdrawals.
  const financialRecords = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM transactions WHERE user_id=?) +
      (SELECT COUNT(*) FROM withdrawals WHERE user_id=?) AS total
  `).get(userId, userId).total;

  if (Number(financialRecords) > 0) {
    return res.status(409).json({
      success: false,
      message: 'This member has financial records. Suspend the account instead to preserve audit history.'
    });
  }

  recordAdminAction(req.admin.id, userId, 'member_deleted', { email: member.email }, null, 'Administrator deleted member without financial records.');
  db.prepare('DELETE FROM users WHERE id=?').run(userId);

  res.json({
    success: true,
    message: 'Member account deleted.'
  });
});

// Read-only administrator summaries for sections backed by existing tables.
app.get('/api/admin/records', requireAdmin, (req, res) => {
  const section = String(req.query.section || '').toLowerCase();
  const queries = {
    opportunities: `
      SELECT id,title,category,difficulty,payment_amount,payment_currency,payment_basis,positions,status,created_at
      FROM opportunities ORDER BY id DESC LIMIT 100
    `,
    submissions: `
      SELECT s.id,o.title,u.full_name AS member,s.status,s.created_at,s.reviewed_at
      FROM opportunity_submissions s JOIN opportunities o ON o.id=s.opportunity_id
      JOIN users u ON u.id=s.user_id ORDER BY s.id DESC LIMIT 100
    `,
    opportunity_payments: `
      SELECT p.id,o.title,u.full_name AS member,p.amount,p.currency,p.status,p.approved_at,t.reference
      FROM opportunity_payments p JOIN opportunities o ON o.id=p.opportunity_id
      JOIN users u ON u.id=p.user_id LEFT JOIN transactions t ON t.id=p.transaction_id
      ORDER BY p.id DESC LIMIT 100
    `,
    packages: `
      SELECT id,name,activation_fee,status,created_at
      FROM packages ORDER BY activation_fee ASC
    `,
    payments: `
      SELECT t.id,u.full_name AS member,t.type,t.amount,t.status,t.reference,t.created_at
      FROM transactions t JOIN users u ON u.id=t.user_id
      ORDER BY t.id DESC LIMIT 100
    `,
    withdrawals: `
      SELECT w.id,u.full_name AS member,w.amount,w.method,w.phone,w.status,w.reference,w.created_at
      FROM withdrawals w JOIN users u ON u.id=w.user_id
      ORDER BY w.id DESC LIMIT 100
    `,
    finance: `
      SELECT
        (SELECT COUNT(*) FROM transactions) AS transactions,
        (SELECT COALESCE(SUM(amount),0) FROM transactions
          WHERE lower(status) IN ('completed','verified','paid','approved')) AS processed_transactions,
        (SELECT COUNT(*) FROM withdrawals) AS withdrawals,
        (SELECT COALESCE(SUM(amount),0) FROM withdrawals
          WHERE lower(status)='pending') AS pending_withdrawal_amount
    `,
    revenue: `
      SELECT type,status,COUNT(*) AS records,COALESCE(SUM(amount),0) AS amount
      FROM transactions
      WHERE lower(status) IN ('completed','verified','paid','approved')
      GROUP BY type,status ORDER BY amount DESC
    `
  };

  if (!queries[section]) {
    return res.status(400).json({ success: false, message: 'Unsupported administrator records section.' });
  }

  res.set('Cache-Control', 'no-store');
  res.json({ success: true, section, records: db.prepare(queries[section]).all() });
});

app.get('/api/admin/audit-logs', requireAdmin, (req, res, next) => {
  try {
    const logs = db.prepare(`
      SELECT l.id,l.action,l.previous_value,l.new_value,l.reason,l.reference,l.created_at,
        a.email AS administrator,m.email AS affected_member
      FROM admin_audit_logs l
      JOIN users a ON a.id=l.admin_user_id
      LEFT JOIN users m ON m.id=l.affected_user_id
      ORDER BY l.id DESC LIMIT 200
    `).all();
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, logs });
  } catch (error) {
    next(error);
  }
});

// All administrator API routes above this point.

app.use((req, res) => res.status(404).json({ success: false, message: 'API endpoint not found.' }));
app.use((err, _req, res, _next) => {
  console.error('[API error]', err.message);
  if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ success: false, message: 'An account with these details already exists.' });
  res.status(500).json({ success: false, message: 'An internal server error occurred.' });
});
app.listen(PORT, () => {
  console.log(`Online Sphere backend running on port ${PORT}`);
  if (process.env.DATABASE_URL) require('./database/postgres.js').checkConnection().then(({ database }) => console.log('[postgres] Connected', database)).catch((error) => console.error('[postgres] Connection failed:', error.message));
});
