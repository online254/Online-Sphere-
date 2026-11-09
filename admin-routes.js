/* Secure, additive administrator routes. Loaded by admin-bootstrap.js before the backend's 404 handler. */
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
    return db.prepare(`SELECT u.id, u.email, u.role, u.is_admin
      FROM sessions s JOIN users u ON u.id=s.user_id
      WHERE s.token_hash=? AND datetime(s.expires_at)>datetime('now') LIMIT 1`).get(tokenHash(token)) || null;
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

  app.get('/api/admin/access', requireAdmin, (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, isAdmin: true, role: String(req.adminUser.role || (allowedEmails.has(String(req.adminUser.email || '').toLowerCase()) ? 'owner' : 'admin')) });
  });

  app.get('/api/admin/overview', requireAdmin, (_req, res, next) => {
    try {
      const members = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
      const activeMembers = db.prepare("SELECT COUNT(*) AS count FROM accounts WHERE lower(COALESCE(status,''))='active'").get().count;
      const verifiedRevenue = db.prepare("SELECT COALESCE(SUM(amount),0) AS total FROM transactions WHERE lower(status) IN ('completed','verified','paid','approved') AND lower(type) IN ('deposit','membership_payment')").get().total;
      const pendingTransactions = db.prepare("SELECT COUNT(*) AS count FROM transactions WHERE lower(status)='pending'").get().count;
      const pendingWithdrawals = db.prepare("SELECT COUNT(*) AS count FROM withdrawals WHERE lower(status)='pending'").get().count;
      const recentMembers = db.prepare('SELECT id, full_name AS fullName, email, created_at AS createdAt FROM users ORDER BY created_at DESC LIMIT 5').all();
      const recentTransactions = db.prepare(`SELECT t.id, u.full_name AS memberName, t.type, t.amount, t.status, t.created_at AS createdAt
        FROM transactions t JOIN users u ON u.id=t.user_id ORDER BY t.created_at DESC LIMIT 6`).all();
      res.set('Cache-Control', 'no-store');
      res.json({ success: true, overview: {
        members: Number(members), activeMembers: Number(activeMembers), verifiedRevenue: Number(verifiedRevenue || 0),
        pendingTransactions: Number(pendingTransactions), pendingWithdrawals: Number(pendingWithdrawals), recentMembers, recentTransactions
      } });
    } catch (error) {
      next(error);
    }
  });
};
