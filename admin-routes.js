'use strict';

const crypto = require('crypto');

module.exports = function registerAdminRoutes(app, db) {
  const allowedEmails = new Set(
    String(process.env.ADMIN_EMAILS || process.env.ADMIN_EMAIL || '')
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
  );
  const tokenHash = (token) => crypto.createHash('sha256').update(token).digest('hex');

  function currentUser(req) {
    const authorization = String(req.get('authorization') || '');
    const token = /^Bearer\s+(.+)$/i.exec(authorization)?.[1] || req.get('x-online-sphere-session');
    if (!token || token.length > 512) return null;
    return db.prepare(`
      SELECT u.id, u.email, u.role, u.is_admin, u.full_name
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND datetime(s.expires_at) > datetime('now')
      LIMIT 1
    `).get(tokenHash(token)) || null;
  }

  function isAdmin(user) {
    if (!user) return false;
    const role = String(user.role || '').trim().toLowerCase();
    return ['admin', 'owner'].includes(role) || Number(user.is_admin) === 1 || allowedEmails.has(String(user.email || '').trim().toLowerCase());
  }

  function requireAdmin(req, res, next) {
    try {
      const user = currentUser(req);
      if (!user) return res.status(401).json({ success: false, message: 'Please sign in to continue.' });
      if (!isAdmin(user)) return res.status(403).json({ success: false, message: 'Administrator access is restricted to authorized staff only.' });
      req.adminUser = user;
      return next();
    } catch (error) {
      return next(error);
    }
  }

  function auditLog(user, action, entityType, entityId, details) {
    if (!user) return;
    db.prepare(`INSERT INTO admin_audit_logs (user_id, actor_email, action, entity_type, entity_id, details)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(Number(user.id), String(user.email || ''), action, entityType || null, entityId || null, JSON.stringify(details || {}));
  }

  function normalizeNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  function memberSummarySql(search) {
    const q = String(search || '').trim();
    const where = q ? `WHERE lower(u.full_name) LIKE ? OR lower(u.email) LIKE ? OR lower(COALESCE(u.phone,'')) LIKE ? OR CAST(u.id AS TEXT) LIKE ?` : '';
    const params = q ? [
      `%${q.toLowerCase()}%`, `%${q.toLowerCase()}%`, `%${q.toLowerCase()}%`, `%${q}%`
    ] : [];
    return { sql: `SELECT u.id, u.full_name AS fullName, u.email, u.phone, u.created_at AS createdAt, u.role, a.status, a.package, a.balance, a.account_number AS accountNumber, a.currency,
      (SELECT COUNT(*) FROM users r WHERE r.referred_by_user_id = u.id) AS referralCount,
      (SELECT COALESCE(SUM(amount), 0) FROM transactions t WHERE t.user_id = u.id AND lower(t.status) IN ('completed','approved','verified','paid')) AS totalIncome
      FROM users u
      LEFT JOIN accounts a ON a.user_id = u.id
      ${where}
      ORDER BY u.created_at DESC LIMIT 200`, params };
  }

  app.get('/api/admin/access', requireAdmin, (req, res) => {
    res.set('Cache-Control', 'no-store');
    const role = String(req.adminUser.role || (allowedEmails.has(String(req.adminUser.email || '').toLowerCase()) ? 'owner' : 'admin'));
    res.json({ success: true, isAdmin: true, role });
  });

  app.get('/api/admin/overview', requireAdmin, (_req, res, next) => {
    try {
      const members = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
      const activeMembers = db.prepare("SELECT COUNT(*) AS count FROM accounts WHERE lower(COALESCE(status,''))='active'").get().count;
      const inactiveMembers = db.prepare("SELECT COUNT(*) AS count FROM accounts WHERE lower(COALESCE(status,''))='inactive'").get().count;
      const suspendedAccounts = db.prepare("SELECT COUNT(*) AS count FROM accounts WHERE lower(COALESCE(status,'')) IN ('suspended','locked','restricted')").get().count;
      const totalWalletBalances = db.prepare('SELECT COALESCE(SUM(balance),0) AS total FROM accounts').get().total;
      const revenue = db.prepare("SELECT COALESCE(SUM(amount),0) AS total FROM transactions WHERE lower(status) IN ('completed','verified','paid','approved') AND lower(type) IN ('deposit','membership_payment','task_earning','commission')").get().total;
      const pendingWithdrawals = db.prepare("SELECT COUNT(*) AS count, COALESCE(SUM(amount),0) AS total FROM withdrawals WHERE lower(status)='pending'").get();
      const pendingTaskSubmissions = db.prepare("SELECT COUNT(*) AS count FROM transactions WHERE lower(status)='pending' AND lower(type) IN ('task_earning','task_payment','commission')").get().count;
      const pendingPaymentVerifications = db.prepare("SELECT COUNT(*) AS count FROM transactions WHERE lower(status) IN ('pending','review')").get().count;
      const newRegistrations = db.prepare("SELECT COUNT(*) AS count FROM users WHERE created_at >= datetime('now','-7 days')").get().count;
      const recentMembers = db.prepare('SELECT id, full_name AS fullName, email, created_at AS createdAt FROM users ORDER BY created_at DESC LIMIT 5').all();
      const recentTransactions = db.prepare(`SELECT t.id, u.full_name AS memberName, t.type, t.amount, t.status, t.created_at AS createdAt
        FROM transactions t JOIN users u ON u.id=t.user_id ORDER BY t.created_at DESC LIMIT 6`).all();
      res.set('Cache-Control', 'no-store');
      res.json({
        success: true,
        overview: {
          members: Number(members),
          activeMembers: Number(activeMembers),
          inactiveMembers: Number(inactiveMembers),
          suspendedAccounts: Number(suspendedAccounts),
          totalWalletBalances: Number(totalWalletBalances || 0),
          revenue: Number(revenue || 0),
          pendingWithdrawals: Number(pendingWithdrawals.count || 0),
          pendingWithdrawalValue: Number(pendingWithdrawals.total || 0),
          pendingTaskSubmissions: Number(pendingTaskSubmissions || 0),
          pendingPaymentVerifications: Number(pendingPaymentVerifications || 0),
          newRegistrations: Number(newRegistrations || 0),
          recentMembers,
          recentTransactions,
        }
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/admin/members', requireAdmin, (req, res) => {
    const search = String(req.query.search || '').trim();
    const { sql, params } = memberSummarySql(search);
    const members = params.length ? db.prepare(sql).all(...params) : db.prepare(sql).all();
    res.json({ success: true, members });
  });

  app.post('/api/admin/members/:id/status', requireAdmin, (req, res) => {
    const memberId = Number(req.params.id);
    const status = String(req.body?.status || '').trim();
    if (!memberId || !status) return res.status(400).json({ success: false, message: 'A valid member and account status are required.' });
    const member = db.prepare('SELECT id FROM users WHERE id = ?').get(memberId);
    if (!member) return res.status(404).json({ success: false, message: 'Member not found.' });

    db.transaction(() => {
      db.prepare('UPDATE accounts SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?').run(status, memberId);
      db.prepare('UPDATE users SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(status, memberId);
    })();
    auditLog(req.adminUser, 'member_status_updated', 'member', memberId, { status, actor: req.adminUser.email });
    res.json({ success: true, message: 'Member status updated.' });
  });

  app.post('/api/admin/members/:id/reset-password', requireAdmin, async (req, res) => {
    const memberId = Number(req.params.id);
    const password = String(req.body?.password || '').trim();
    if (!memberId || !password || password.length < 8) return res.status(400).json({ success: false, message: 'Provide a new password of at least 8 characters.' });
    const member = db.prepare('SELECT id, email FROM users WHERE id = ?').get(memberId);
    if (!member) return res.status(404).json({ success: false, message: 'Member not found.' });

    const salt = crypto.randomBytes(16).toString('hex');
    const key = await new Promise((resolve, reject) => {
      const scrypt = crypto.scrypt(password, salt, 64, (error, derivedKey) => error ? reject(error) : resolve(derivedKey));
      scrypt;
    });
    db.prepare('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(`scrypt$${salt}$${key.toString('hex')}`, memberId);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(memberId);
    auditLog(req.adminUser, 'member_password_reset', 'member', memberId, { email: member.email });
    res.json({ success: true, message: 'Password reset successfully and existing sessions were revoked.' });
  });

  app.delete('/api/admin/members/:id', requireAdmin, (req, res) => {
    const memberId = Number(req.params.id);
    const confirm = String(req.body?.confirm || '').trim();
    if (!memberId || confirm !== 'DELETE') return res.status(400).json({ success: false, message: 'Deletion requires explicit confirmation: DELETE.' });
    const member = db.prepare('SELECT id, email FROM users WHERE id = ?').get(memberId);
    if (!member) return res.status(404).json({ success: false, message: 'Member not found.' });
    db.prepare('DELETE FROM users WHERE id = ?').run(memberId);
    auditLog(req.adminUser, 'member_deleted', 'member', memberId, { email: member.email, retention: 'financial records preserved' });
    res.json({ success: true, message: 'Member record permanently deleted with retention of required transaction history.' });
  });

  app.get('/api/admin/wallets', requireAdmin, (req, res) => {
    const rows = db.prepare(`
      SELECT t.id, u.full_name AS memberName, a.account_number AS accountNumber, t.type, t.amount, t.status, t.reference, t.description, t.created_at AS createdAt
      FROM transactions t
      JOIN users u ON u.id = t.user_id
      JOIN accounts a ON a.id = t.account_id
      ORDER BY t.created_at DESC LIMIT 200
    `).all();
    res.json({ success: true, transactions: rows });
  });

  app.post('/api/admin/wallets/adjust', requireAdmin, (req, res) => {
    const memberId = Number(req.body?.memberId || req.body?.userId);
    const amount = normalizeNumber(req.body?.amount);
    const currency = String(req.body?.currency || 'KES').trim().toUpperCase();
    const type = String(req.body?.type || 'adjustment').trim();
    const reason = String(req.body?.reason || 'Manual wallet adjustment').trim();
    const adminConfirm = String(req.body?.confirm || '').trim();
    if (!memberId || !amount || !type || adminConfirm !== 'CONFIRM') return res.status(400).json({ success: false, message: 'Member, amount, reason, and confirmation are required.' });

    const account = db.prepare('SELECT id, balance FROM accounts WHERE user_id = ?').get(memberId);
    if (!account) return res.status(404).json({ success: false, message: 'Member wallet not found.' });

    const reference = `ADMIN-${Date.now()}-${crypto.randomInt(1000, 9999)}`;
    db.transaction(() => {
      db.prepare(`INSERT INTO transactions (user_id, account_id, type, amount, status, reference, description)
        VALUES (?, ?, ?, ?, 'completed', ?, ?)
      `).run(memberId, account.id, String(type).toLowerCase(), Math.round(amount), reference, reason);
      db.prepare('UPDATE accounts SET balance = balance + ?, currency = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(Math.round(amount), currency, account.id);
    })();

    auditLog(req.adminUser, 'wallet_adjustment', 'wallet', memberId, { amount: Math.round(amount), currency, type, reason, reference });
    res.json({ success: true, message: 'Wallet adjustment recorded to the member ledger.' });
  });

  app.get('/api/admin/memberships', requireAdmin, (_req, res) => {
    const packages = db.prepare('SELECT * FROM packages ORDER BY id ASC').all();
    const members = db.prepare(`SELECT a.user_id AS memberId, u.full_name AS fullName, a.package, a.status, a.activation_fee, a.currency
      FROM accounts a JOIN users u ON u.id = a.user_id ORDER BY a.updated_at DESC LIMIT 200`).all();
    res.json({ success: true, packages, members });
  });

  app.post('/api/admin/memberships', requireAdmin, (req, res) => {
    const name = String(req.body?.name || '').trim();
    const activationFee = Number(req.body?.activationFee || 0);
    const description = String(req.body?.description || '').trim();
    if (!name || !activationFee) return res.status(400).json({ success: false, message: 'Package name and activation fee are required.' });
    db.prepare(`INSERT INTO packages (name, activation_fee, description, status) VALUES (?, ?, ?, 'active')
    `).run(name, activationFee, description);
    auditLog(req.adminUser, 'membership_package_created', 'membership_package', null, { name, activationFee, description });
    res.json({ success: true, message: 'Membership package created.' });
  });

  app.post('/api/admin/memberships/:id', requireAdmin, (req, res) => {
    const packageId = Number(req.params.id);
    const status = String(req.body?.status || '').trim();
    const activationFee = Number(req.body?.activationFee || 0);
    const description = String(req.body?.description || '').trim();
    if (!packageId) return res.status(400).json({ success: false, message: 'Package ID is required.' });
    db.prepare(`UPDATE packages SET status = COALESCE(?, status), activation_fee = COALESCE(?, activation_fee), description = COALESCE(?, description) WHERE id = ?`)
      .run(status || null, Number.isFinite(activationFee) && activationFee >= 0 ? activationFee : null, description || null, packageId);
    auditLog(req.adminUser, 'membership_package_updated', 'membership_package', packageId, { status, activationFee, description });
    res.json({ success: true, message: 'Membership package updated.' });
  });

  app.get('/api/admin/tasks', requireAdmin, (_req, res) => {
    const opportunities = db.prepare('SELECT * FROM opportunities ORDER BY featured DESC, created_at DESC LIMIT 100').all();
    const tasks = db.prepare(`SELECT t.id, u.full_name AS memberName, t.type, t.amount, t.status, t.description, t.created_at AS createdAt
      FROM transactions t JOIN users u ON u.id = t.user_id
      WHERE lower(t.type) IN ('task_earning','task_payment','commission','earning')
      ORDER BY t.created_at DESC LIMIT 200`).all();
    res.json({ success: true, opportunities, tasks });
  });

  app.post('/api/admin/tasks', requireAdmin, (req, res) => {
    const title = String(req.body?.title || '').trim();
    const category = String(req.body?.category || '').trim();
    const description = String(req.body?.description || '').trim();
    const status = String(req.body?.status || 'active').trim();
    if (!title || !category || !description) return res.status(400).json({ success: false, message: 'Task title, category and description are required.' });
    db.prepare(`INSERT INTO opportunities (title, category, description, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run(title, category, description, status);
    auditLog(req.adminUser, 'task_created', 'opportunity', null, { title, category, status });
    res.json({ success: true, message: 'Opportunity created and published.' });
  });

  app.get('/api/admin/payments', requireAdmin, (_req, res) => {
    const paymentAttempts = db.prepare('SELECT * FROM payment_attempts ORDER BY created_at DESC LIMIT 200').all();
    const transactions = db.prepare(`SELECT t.id, u.full_name AS memberName, t.type, t.amount, t.status, t.reference, t.description, t.created_at AS createdAt
      FROM transactions t JOIN users u ON u.id = t.user_id ORDER BY t.created_at DESC LIMIT 200`).all();
    res.json({ success: true, paymentAttempts, transactions });
  });

  app.post('/api/admin/payments/:id/verify', requireAdmin, (req, res) => {
    const transactionId = Number(req.params.id);
    const status = String(req.body?.status || 'verified').trim();
    const tx = db.prepare('SELECT id FROM transactions WHERE id = ?').get(transactionId);
    if (!tx) return res.status(404).json({ success: false, message: 'Transaction not found.' });
    db.prepare('UPDATE transactions SET status = ?, description = COALESCE(?, description) WHERE id = ?').run(status, String(req.body?.reason || 'Verified by administrator'), transactionId);
    auditLog(req.adminUser, 'payment_verified', 'transaction', transactionId, { status, reason: req.body?.reason || 'Verified by administrator' });
    res.json({ success: true, message: 'Payment status has been updated.' });
  });

  app.get('/api/admin/withdrawals', requireAdmin, (_req, res) => {
    const withdrawals = db.prepare(`SELECT w.id, u.full_name AS memberName, w.amount, w.method, w.phone, w.reference, w.status, w.notes, w.created_at AS createdAt
      FROM withdrawals w JOIN users u ON u.id = w.user_id ORDER BY w.created_at DESC LIMIT 200`).all();
    res.json({ success: true, withdrawals });
  });

  app.post('/api/admin/withdrawals/:id/decision', requireAdmin, (req, res) => {
    const withdrawalId = Number(req.params.id);
    const decision = String(req.body?.decision || 'approved').trim();
    const note = String(req.body?.note || '').trim() || 'Processed by administrator';
    const row = db.prepare('SELECT id FROM withdrawals WHERE id = ?').get(withdrawalId);
    if (!row) return res.status(404).json({ success: false, message: 'Withdrawal record not found.' });
    db.prepare('UPDATE withdrawals SET status = ?, notes = ?, processed_at = CURRENT_TIMESTAMP WHERE id = ?').run(decision, note, withdrawalId);
    auditLog(req.adminUser, 'withdrawal_decision', 'withdrawal', withdrawalId, { decision, note });
    res.json({ success: true, message: `Withdrawal ${decision}.` });
  });

  app.get('/api/admin/referrals', requireAdmin, (_req, res) => {
    const referrals = db.prepare(`SELECT u.id, u.full_name AS referredName, u.email, u.created_at AS joinedAt,
      ref.full_name AS referrerName,
      (SELECT COUNT(*) FROM users child WHERE child.referred_by_user_id = u.id) AS referrals
      FROM users u
      LEFT JOIN users ref ON ref.id = u.referred_by_user_id
      WHERE u.referred_by_user_id IS NOT NULL
      ORDER BY u.created_at DESC LIMIT 200`).all();
    res.json({ success: true, referrals });
  });

  app.post('/api/admin/referrals/:id/commission', requireAdmin, (req, res) => {
    const userId = Number(req.params.id);
    const action = String(req.body?.action || 'approve').trim();
    const amount = Number(req.body?.amount || 0);
    if (!userId) return res.status(400).json({ success: false, message: 'Referral member ID is required.' });
    const member = db.prepare('SELECT id, full_name FROM users WHERE id = ?').get(userId);
    if (!member) return res.status(404).json({ success: false, message: 'Referral member not found.' });
    db.prepare(`INSERT INTO transactions (user_id, account_id, type, amount, status, reference, description)
      SELECT ?, a.id, 'commission', ?, 'completed', ?, ? FROM accounts a WHERE a.user_id = ?
    `).run(userId, Math.max(0, amount), `REF-${Date.now()}`, `${action === 'reverse' ? 'Commission reversed' : 'Commission approved'} by admin`, userId);
    auditLog(req.adminUser, 'referral_commission_update', 'referral', userId, { action, amount, member: member.full_name });
    res.json({ success: true, message: `Referral commission ${action === 'reverse' ? 'reversed' : 'approved'} successfully.` });
  });

  app.get('/api/admin/security', requireAdmin, (_req, res) => {
    const auditLogs = db.prepare(`SELECT a.*, u.full_name AS actorName FROM admin_audit_logs a
      LEFT JOIN users u ON u.id = a.user_id
      ORDER BY a.created_at DESC LIMIT 200`).all();
    const sessions = db.prepare(`SELECT s.id, u.full_name AS userName, u.email, s.expires_at AS expiresAt
      FROM sessions s JOIN users u ON u.id = s.user_id ORDER BY s.created_at DESC LIMIT 200`).all();
    res.json({ success: true, auditLogs, sessions });
  });

  app.post('/api/admin/notifications', requireAdmin, (req, res) => {
    const channel = String(req.body?.channel || 'all').trim();
    const subject = String(req.body?.subject || 'System update').trim();
    const message = String(req.body?.message || '').trim();
    if (!message) return res.status(400).json({ success: false, message: 'Notification message is required.' });
    auditLog(req.adminUser, 'notification_sent', 'notification', null, { channel, subject, message });
    res.json({ success: true, message: `Notification queued for ${channel}.` });
  });

  app.get('/api/admin/reports', requireAdmin, (req, res) => {
    const from = String(req.query.from || '').trim();
    const to = String(req.query.to || '').trim();
    const where = from || to ? `WHERE created_at >= COALESCE('${from || '1970-01-01'}', created_at) AND created_at <= COALESCE('${to || '2999-12-31'}', created_at)` : '';
    const data = {
      registrationCount: db.prepare(`SELECT COUNT(*) AS count FROM users ${where}`).get().count,
      revenue: db.prepare(`SELECT COALESCE(SUM(amount),0) AS total FROM transactions WHERE lower(status) IN ('completed','verified','paid','approved') ${from || to ? `AND created_at >= COALESCE('${from || '1970-01-01'}', created_at) AND created_at <= COALESCE('${to || '2999-12-31'}', created_at)` : ''}`).get().total,
      withdrawalCount: db.prepare(`SELECT COUNT(*) AS count FROM withdrawals ${where}`).get().count,
      walletTransactions: db.prepare(`SELECT COUNT(*) AS count FROM transactions ${where}`).get().count,
    };
    res.json({ success: true, reports: data });
  });
};
