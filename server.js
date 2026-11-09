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
app.use(cors({ origin: true, credentials: true, methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization'] }));
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false }));

// Additive SQLite migrations; existing member and payment records are preserved.
function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((item) => item.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
ensureColumn('users', 'referral_code', 'TEXT');
ensureColumn('users', 'referred_by_user_id', 'INTEGER REFERENCES users(id)');
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code) WHERE referral_code IS NOT NULL; CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);`);

const PACKAGES = Object.freeze({ Bronze: 1000, Silver: 1750, Gold: 2500 });
const TOKEN_TTL_DAYS = Number(process.env.SESSION_TTL_DAYS) || 30;
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
function issueSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + TOKEN_TTL_DAYS * 86400000).toISOString();
  db.prepare('INSERT INTO sessions (user_id, token_hash, expires_at) VALUES (?, ?, ?)').run(userId, sha256(token), expiresAt);
  return token;
}
function findSession(req) {
  const header = String(req.get('authorization') || '');
  const bearer = /^Bearer\s+(.+)$/i.exec(header)?.[1];
  const token = bearer || req.get('x-online-sphere-session');
  if (!token || token.length > 512) return null;
  return db.prepare(`SELECT u.id, u.full_name, u.email, u.phone, u.created_at, u.referral_code,
      a.id AS account_id, a.package, a.status AS account_status, a.currency, a.account_number
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

app.get('/', (_req, res) => res.json({ success: true, service: 'Online Sphere Backend', status: 'running' }));
app.get('/health', (_req, res) => res.json({ success: true, service: 'Online Sphere Backend', status: 'ready', database: 'connected' }));
app.get('/api/packages', (_req, res) => res.json({ success: true, currency: 'KES', packages: Object.entries(PACKAGES).map(([name, price]) => ({ name, price })) }));

// Registration and login are backed by SQLite accounts and hashed, expiring sessions.
app.post('/api/auth/register', async (req, res, next) => {
  try {
    const fullName = String(req.body?.fullName || '').trim().replace(/\s+/g, ' ');
    const email = normalizeEmail(req.body?.email);
    const rawPhone = String(req.body?.phone || '').trim();
    const phone = rawPhone ? normalizePhone(rawPhone) : null;
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const referralCode = String(req.body?.ref || req.body?.referralCode || '').trim();
    if (fullName.length < 2 || fullName.length > 100) return res.status(400).json({ success: false, message: 'Enter your full name (2–100 characters).' });
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ success: false, message: 'Enter a valid email address.' });
    if (rawPhone && !phone) return res.status(400).json({ success: false, message: 'Enter a valid Kenyan mobile number, or leave phone blank.' });
    if (password.length < 8 || password.length > 128) return res.status(400).json({ success: false, message: 'Password must be at least 8 characters.' });
    const duplicate = db.prepare('SELECT email, phone FROM users WHERE lower(email)=? OR (? IS NOT NULL AND phone=?) LIMIT 1').get(email, phone, phone);
    if (duplicate) return res.status(409).json({ success: false, message: duplicate.email.toLowerCase() === email ? 'An account with this email already exists. Sign in instead.' : 'An account with this phone number already exists.' });
    const passwordHash = await hashPassword(password);
    const userId = createUserAccount({ fullName, email, phone, passwordHash, referralCode });
    const token = issueSession(userId);
    return res.status(201).json({ success: true, message: 'Account created. Welcome to Online Sphere.', token, user: { id: userId, fullName, email } });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ success: false, message: error.message });
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ success: false, message: 'An account with these details already exists.' });
    next(error);
  }
});
app.post('/api/auth/login', async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!email || !password) return res.status(400).json({ success: false, message: 'Enter your email and password.' });
    const user = db.prepare('SELECT id,full_name,email,password_hash FROM users WHERE lower(email)=? LIMIT 1').get(email);
    if (!user || !(await verifyPassword(password, user.password_hash))) return res.status(401).json({ success: false, message: 'Email or password is incorrect.' });
    const token = issueSession(user.id);
    return res.json({ success: true, message: 'Signed in successfully.', token, user: { id: user.id, fullName: user.full_name, email: user.email } });
  } catch (error) { next(error); }
});
app.get('/api/auth/me', requireSession, (req, res) => res.json({ success: true, user: { id: req.member.id, fullName: req.member.full_name, email: req.member.email } }));
app.post('/api/auth/logout', (req, res) => {
  const header = String(req.get('authorization') || '');
  const token = /^Bearer\s+(.+)$/i.exec(header)?.[1] || req.get('x-online-sphere-session');
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(sha256(token));
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
  res.json({ success: true, dashboard: {
    user: { id: member.id, fullName: member.full_name, email: member.email, phone: member.phone, createdAt: member.created_at, status: member.account_status },
    membership: { name: member.package, package: member.package, status: member.account_status, active: membershipActive },
    wallet: { currency: member.currency || 'KES', walletBalance: sumTypes(['deposit','earning','task_earning','commission','transfer_in']) - sumTypes(['withdrawal','transfer_out']), availableBalance: sumTypes(['deposit','earning','task_earning','commission','transfer_in']) - sumTypes(['withdrawal','transfer_out']), pendingBalance: Number(pending), totalDeposited: sumTypes(['deposit','membership_payment']), totalWithdrawn: sumTypes(['withdrawal']), totalEarnings: sumTypes(['earning','task_earning','commission']) },
    statistics: { transactionCount: Number(txCount), totalDeposited: sumTypes(['deposit','membership_payment']), totalWithdrawn: sumTypes(['withdrawal']), todayEarnings: sumTypes(['earning','task_earning','commission']) },
    referrals: { sponsorName: null, joinedCount: Number(referralCount), verifiedCount: Number(referralCount), url: member.referral_code ? `${process.env.PUBLIC_SITE_URL || 'https://onlinespherecommercecompany.com'}/register?ref=${encodeURIComponent(member.referral_code)}` : null, pendingCommissions: 0, paidCommissions: 0 }
  } });
});

// Opportunities are optional until a Neon DATABASE_URL is configured.
app.get('/api/opportunities', async (_req, res) => {
  if (!process.env.DATABASE_URL) return res.status(503).json({ success: false, message: 'Opportunities service is not configured.' });
  try {
    const postgres = require('./database/postgres.js');
    const result = await postgres.query(`SELECT id,title,category,description,difficulty,earning_model,requirements,platform_name,external_url,risk_level,featured,status,created_at,updated_at FROM opportunities WHERE status=$1 ORDER BY featured DESC,created_at DESC,id ASC`, ['active']);
    res.json({ success: true, count: result.rows.length, opportunities: result.rows });
  } catch (error) { console.error('[opportunities]', error.message); res.status(503).json({ success: false, message: 'Opportunities are temporarily unavailable.' }); }
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
