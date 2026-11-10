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
  const normalizeStatus = (value) => String(value || '').trim().toLowerCase().replace(/\s+/g, '_');

  function currentUser(req) {
    const authorization = String(req.get('authorization') || '');
    const token = /^Bearer\s+(.+)$/i.exec(authorization)?.[1] || req.get('x-online-sphere-session');
    if (!token || token.length > 512) return null;
    return db.prepare(`
      SELECT u.id, u.email, u.role, u.is_admin, u.full_name, u.status, u.verification_status
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND datetime(s.expires_at) > datetime('now')
      LIMIT 1
    `).get(tokenHash(token)) || null;
  }

  function isAdmin(user) {
    if (!user) return false;
    const role = String(user.role || '').trim().toLowerCase();
    return ['admin', 'owner', 'super_admin', 'finance_admin', 'support_admin', 'operations_admin'].includes(role) || Number(user.is_admin) === 1 || allowedEmails.has(String(user.email || '').trim().toLowerCase());
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

  function auditLog(actor, action, entityType, entityId, oldValue, newValue, reason) {
    if (!actor) return;
    db.prepare(`
      INSERT INTO admin_audit_logs (actor_user_id, actor_email, action, entity_type, entity_id, old_value, new_value, reason)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      Number(actor.id),
      String(actor.email || ''),
      String(action || 'admin_action'),
      entityType || null,
      entityId || null,
      oldValue ? JSON.stringify(oldValue) : null,
      newValue ? JSON.stringify(newValue) : null,
      reason || null
    );
  }

  function recordActivity(userId, action, details) {
    if (!userId) return;
    db.prepare(`INSERT INTO member_activity_log (user_id, action, details) VALUES (?, ?, ?)`).run(userId, action, JSON.stringify(details || {}));
  }

  function getMemberSummary(memberId) {
    return db.prepare(`
      SELECT u.*,
             a.id AS account_id,
             a.account_number,
             a.package,
             a.activation_fee,
             a.status AS account_status,
             a.balance,
             a.currency,
             a.total_earned,
             a.total_withdrawn,
             a.pending_withdrawal,
             a.created_at AS account_created_at,
             a.updated_at AS account_updated_at
      FROM users u
      LEFT JOIN accounts a ON a.user_id = u.id
      WHERE u.id = ?
      LIMIT 1
    `).get(memberId) || null;
  }

  function getMemberListSql(req) {
    const search = String(req.query.search || '').trim();
    const status = String(req.query.status || '').trim();
    const plan = String(req.query.plan || '').trim();
    const from = String(req.query.from || '').trim();
    const to = String(req.query.to || '').trim();
    const minBalance = req.query.minBalance !== undefined && req.query.minBalance !== '' ? Number(req.query.minBalance) : null;
    const maxBalance = req.query.maxBalance !== undefined && req.query.maxBalance !== '' ? Number(req.query.maxBalance) : null;

    const clauses = [];
    const params = [];

    if (search) {
      clauses.push(`(
        LOWER(COALESCE(u.full_name, '')) LIKE ? OR
        LOWER(COALESCE(u.email, '')) LIKE ? OR
        LOWER(COALESCE(u.phone, '')) LIKE ? OR
        CAST(u.id AS TEXT) LIKE ?
      )`);
      const token = `%${search.toLowerCase()}%`;
      params.push(token, token, token, `%${search}%`);
    }

    if (status) {
      clauses.push(`COALESCE(a.status, u.status, 'active') = ?`);
      params.push(status);
    }

    if (plan) {
      clauses.push(`LOWER(COALESCE(a.package, '')) = LOWER(?)`);
      params.push(plan);
    }

    if (from) {
      clauses.push(`DATE(u.created_at) >= DATE(?)`);
      params.push(from);
    }

    if (to) {
      clauses.push(`DATE(u.created_at) <= DATE(?)`);
      params.push(to);
    }

    if (minBalance !== null) {
      clauses.push(`COALESCE(a.balance, 0) >= ?`);
      params.push(minBalance);
    }

    if (maxBalance !== null) {
      clauses.push(`COALESCE(a.balance, 0) <= ?`);
      params.push(maxBalance);
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    return {
      sql: `
        SELECT
          u.id,
          u.full_name AS fullName,
          u.email,
          u.phone,
          u.role,
          u.status,
          u.verification_status,
          u.created_at AS createdAt,
          u.deleted_at,
          COALESCE(a.package, 'Bronze') AS plan,
          COALESCE(a.status, u.status, 'active') AS accountStatus,
          COALESCE(a.balance, 0) AS walletBalance,
          COALESCE(a.currency, 'KES') AS currency,
          (SELECT COUNT(*) FROM member_login_history mlh WHERE mlh.user_id = u.id) AS loginCount,
          (SELECT COUNT(*) FROM member_activity_log mal WHERE mal.user_id = u.id) AS activityCount
        FROM users u
        LEFT JOIN accounts a ON a.user_id = u.id
        ${where}
        ORDER BY u.created_at DESC
        LIMIT 200
      `,
      params,
    };
  }

  app.get('/api/admin/access', requireAdmin, (req, res) => {
    res.set('Cache-Control', 'no-store');
    const role = String(req.adminUser.role || (allowedEmails.has(String(req.adminUser.email || '').toLowerCase()) ? 'owner' : 'admin'));
    res.json({ success: true, isAdmin: true, role });
  });

  app.get('/api/admin/overview', requireAdmin, (_req, res, next) => {
    try {
      const members = db.prepare('SELECT COUNT(*) AS count FROM users WHERE deleted_at IS NULL').get().count;
      const activeMembers = db.prepare("SELECT COUNT(*) AS count FROM accounts WHERE lower(COALESCE(status,''))='active'").get().count;
      const pendingVerification = db.prepare("SELECT COUNT(*) AS count FROM users WHERE lower(COALESCE(verification_status,''))='pending_verification'").get().count;
      const totalWalletBalances = db.prepare('SELECT COALESCE(SUM(balance), 0) AS total FROM accounts').get().total;
      const revenue = db.prepare("SELECT COALESCE(SUM(amount),0) AS total FROM transactions WHERE lower(status) IN ('completed','verified','paid','approved') AND lower(type) IN ('deposit','membership_payment','task_earning','commission')").get().total;
      const pendingWithdrawals = db.prepare("SELECT COUNT(*) AS count, COALESCE(SUM(amount),0) AS total FROM withdrawals WHERE lower(status)='pending'").get();
      const pendingTransactions = db.prepare("SELECT COUNT(*) AS count FROM transactions WHERE lower(status) IN ('pending','review')").get().count;
      const recentMembers = db.prepare('SELECT id, full_name AS fullName, email, created_at AS createdAt FROM users WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 5').all();
      const recentTransactions = db.prepare(`
        SELECT t.id, u.full_name AS memberName, t.type, t.amount, t.status, t.created_at AS createdAt
        FROM transactions t
        JOIN users u ON u.id = t.user_id
        ORDER BY t.created_at DESC LIMIT 6
      `).all();
      const recentAudit = db.prepare(`
        SELECT action, actor_email, created_at AS createdAt
        FROM admin_audit_logs
        ORDER BY created_at DESC
        LIMIT 6
      `).all();

      res.set('Cache-Control', 'no-store');
      res.json({
        success: true,
        overview: {
          members: Number(members || 0),
          activeMembers: Number(activeMembers || 0),
          pendingVerification: Number(pendingVerification || 0),
          totalWalletBalances: Number(totalWalletBalances || 0),
          revenue: Number(revenue || 0),
          pendingWithdrawals: Number(pendingWithdrawals.count || 0),
          pendingWithdrawalValue: Number(pendingWithdrawals.total || 0),
          pendingTransactions: Number(pendingTransactions || 0),
          recentMembers,
          recentTransactions,
          recentAudit,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/admin/members', requireAdmin, (req, res) => {
    const { sql, params } = getMemberListSql(req);
    const members = params.length ? db.prepare(sql).all(...params) : db.prepare(sql).all();
    res.json({ success: true, members });
  });

  app.get('/api/admin/members/:id', requireAdmin, (req, res) => {
    const memberId = Number(req.params.id);
    const member = getMemberSummary(memberId);
    if (!member) return res.status(404).json({ success: false, message: 'Member not found.' });

    const walletLedger = db.prepare(`
      SELECT wl.*, u.full_name AS adminName
      FROM wallet_ledger wl
      LEFT JOIN users u ON u.id = wl.admin_user_id
      WHERE wl.user_id = ?
      ORDER BY wl.created_at DESC
      LIMIT 50
    `).all(memberId);

    const statusHistory = db.prepare(`
      SELECT msh.*, u.full_name AS adminName
      FROM member_status_history msh
      LEFT JOIN users u ON u.id = msh.admin_user_id
      WHERE msh.user_id = ?
      ORDER BY msh.created_at DESC
      LIMIT 50
    `).all(memberId);

    const loginHistory = db.prepare(`
      SELECT * FROM member_login_history WHERE user_id = ? ORDER BY created_at DESC LIMIT 50
    `).all(memberId);

    const activity = db.prepare(`
      SELECT * FROM member_activity_log WHERE user_id = ? ORDER BY created_at DESC LIMIT 50
    `).all(memberId);

    const notes = db.prepare(`
      SELECT * FROM member_admin_notes WHERE user_id = ? ORDER BY created_at DESC LIMIT 50
    `).all(memberId);

    const membershipHistory = db.prepare(`
      SELECT * FROM membership_history WHERE user_id = ? ORDER BY created_at DESC LIMIT 50
    `).all(memberId);

    res.json({
      success: true,
      member,
      walletLedger,
      statusHistory,
      loginHistory,
      activity,
      notes,
      membershipHistory,
    });
  });

  app.post('/api/admin/members/:id/status', requireAdmin, (req, res) => {
    const memberId = Number(req.params.id);
    const status = String(req.body?.status || '').trim();
    const reason = String(req.body?.reason || 'Admin status update').trim();

    if (!memberId || !status) {
      return res.status(400).json({ success: false, message: 'A valid member ID and status are required.' });
    }

    const member = getMemberSummary(memberId);
    if (!member) return res.status(404).json({ success: false, message: 'Member not found.' });

    const previousStatus = String(member.status || member.account_status || 'active');
    const newStatus = normalizeStatus(status);

    db.transaction(() => {
      db.prepare('UPDATE users SET status = ?, verification_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(newStatus, newStatus === 'active' ? 'verified' : 'pending_verification', memberId);
      db.prepare('UPDATE accounts SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?').run(newStatus, memberId);
      db.prepare(`INSERT INTO member_status_history (user_id, previous_status, new_status, reason, admin_user_id) VALUES (?, ?, ?, ?, ?)`).run(memberId, previousStatus, newStatus, reason, req.adminUser.id);
      db.prepare(`INSERT INTO member_activity_log (user_id, action, details) VALUES (?, ?, ?)`).run(memberId, 'status_updated', JSON.stringify({ previousStatus, newStatus, reason }));
    })();

    auditLog(req.adminUser, 'member_status_updated', 'member', memberId, previousStatus, newStatus, reason);
    res.json({ success: true, message: 'Member status updated successfully.' });
  });

  app.post('/api/admin/members/:id/reset-password', requireAdmin, async (req, res) => {
    const memberId = Number(req.params.id);
    const password = String(req.body?.password || '').trim();

    if (!memberId || !password || password.length < 8) {
      return res.status(400).json({ success: false, message: 'Provide a new password of at least 8 characters.' });
    }

    const member = db.prepare('SELECT id, email FROM users WHERE id = ?').get(memberId);
    if (!member) return res.status(404).json({ success: false, message: 'Member not found.' });

    const salt = crypto.randomBytes(16).toString('hex');
    const key = await new Promise((resolve, reject) => {
      crypto.scrypt(password, salt, 64, (error, derivedKey) => error ? reject(error) : resolve(derivedKey));
    });

    db.transaction(() => {
      db.prepare('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(`scrypt$${salt}$${key.toString('hex')}`, memberId);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(memberId);
      db.prepare('INSERT INTO member_activity_log (user_id, action, details) VALUES (?, ?, ?)').run(memberId, 'password_reset', JSON.stringify({ actor: req.adminUser.email }));
    })();

    auditLog(req.adminUser, 'member_password_reset', 'member', memberId, null, { email: member.email }, 'Password reset');
    res.json({ success: true, message: 'Password reset successfully and active sessions were revoked.' });
  });

  app.post('/api/admin/members/:id/logout-sessions', requireAdmin, (req, res) => {
    const memberId = Number(req.params.id);
    if (!memberId) return res.status(400).json({ success: false, message: 'Valid member ID is required.' });

    const member = db.prepare('SELECT id, email FROM users WHERE id = ?').get(memberId);
    if (!member) return res.status(404).json({ success: false, message: 'Member not found.' });

    db.transaction(() => {
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(memberId);
      db.prepare('INSERT INTO member_activity_log (user_id, action, details) VALUES (?, ?, ?)').run(memberId, 'logout_all_sessions', JSON.stringify({ terminatedBy: req.adminUser.email }));
    })();

    auditLog(req.adminUser, 'force_logout_sessions', 'member', memberId, null, { email: member.email }, 'Forced logout from all sessions');
    res.json({ success: true, message: 'Member sessions were invalidated.' });
  });

  app.post('/api/admin/members/:id/delete', requireAdmin, (req, res) => {
    const memberId = Number(req.params.id);
    const reason = String(req.body?.reason || '').trim();
    const confirm = String(req.body?.confirm || '').trim();

    if (!memberId || !reason || confirm !== 'CONFIRM_DELETE') {
      return res.status(400).json({ success: false, message: 'Deletion requires reason and explicit CONFIRM_DELETE.' });
    }

    const member = getMemberSummary(memberId);
    if (!member) return res.status(404).json({ success: false, message: 'Member not found.' });

    db.transaction(() => {
      db.prepare('UPDATE users SET status = ?, deleted_at = CURRENT_TIMESTAMP, deleted_by = ?, delete_reason = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run('deleted', req.adminUser.id, reason, memberId);
      db.prepare('UPDATE accounts SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?').run('deleted', memberId);
      db.prepare('INSERT INTO member_activity_log (user_id, action, details) VALUES (?, ?, ?)').run(memberId, 'account_deleted', JSON.stringify({ reason, deletedBy: req.adminUser.email }));
    })();

    auditLog(req.adminUser, 'member_soft_deleted', 'member', memberId, member.status || 'active', 'deleted', reason);
    res.json({ success: true, message: 'Member account was soft-deleted and financial history was retained.' });
  });

  app.post('/api/admin/members/:id/restore', requireAdmin, (req, res) => {
    const memberId = Number(req.params.id);
    const member = getMemberSummary(memberId);
    if (!member) return res.status(404).json({ success: false, message: 'Member not found.' });

    db.transaction(() => {
      db.prepare('UPDATE users SET status = ?, deleted_at = NULL, deleted_by = NULL, delete_reason = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run('active', memberId);
      db.prepare('UPDATE accounts SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?').run('active', memberId);
      db.prepare('INSERT INTO member_activity_log (user_id, action, details) VALUES (?, ?, ?)').run(memberId, 'account_restored', JSON.stringify({ restoredBy: req.adminUser.email }));
    })();

    auditLog(req.adminUser, 'member_restored', 'member', memberId, 'deleted', 'active', 'Restored by administrator');
    res.json({ success: true, message: 'Member account was restored.' });
  });

  app.post('/api/admin/members/:id/notes', requireAdmin, (req, res) => {
    const memberId = Number(req.params.id);
    const note = String(req.body?.note || '').trim();
    if (!memberId || !note) return res.status(400).json({ success: false, message: 'A note is required.' });

    db.prepare(`INSERT INTO member_admin_notes (user_id, author_email, note) VALUES (?, ?, ?)`).run(memberId, String(req.adminUser.email || ''), note);
    recordActivity(memberId, 'admin_note_added', { author: req.adminUser.email, note });
    auditLog(req.adminUser, 'admin_note_added', 'member', memberId, null, { note }, 'Internal admin note');
    res.json({ success: true, message: 'Admin note recorded.' });
  });

  app.post('/api/admin/members/:id/wallet-adjust', requireAdmin, (req, res) => {
    const memberId = Number(req.params.id);
    const amount = Number(req.body?.amount);
    const direction = String(req.body?.direction || '').trim().toLowerCase();
    const reason = String(req.body?.reason || '').trim();
    const reference = String(req.body?.reference || '').trim();
    const confirm = String(req.body?.confirm || '').trim();

    if (!memberId || !Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ success: false, message: 'A valid amount is required.' });
    }
    if (!['credit', 'debit'].includes(direction)) {
      return res.status(400).json({ success: false, message: 'Direction must be credit or debit.' });
    }
    if (!reason || !reference || confirm !== 'CONFIRM') {
      return res.status(400).json({ success: false, message: 'Reason, reference, and confirmation are required.' });
    }

    const account = db.prepare('SELECT * FROM accounts WHERE user_id = ?').get(memberId);
    if (!account) return res.status(404).json({ success: false, message: 'Member wallet not found.' });

    const previousBalance = Number(account.balance || 0);
    const delta = direction === 'credit' ? amount : -amount;

    db.transaction(() => {
      db.prepare(`INSERT INTO wallet_ledger (user_id, account_id, type, amount, currency, reason, reference, admin_user_id, admin_email)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(memberId, account.id, direction, Math.round(amount), account.currency || 'KES', reason, reference, req.adminUser.id, req.adminUser.email);
      db.prepare('UPDATE accounts SET balance = balance + ?, last_wallet_adjustment_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(delta, account.id);
      db.prepare('INSERT INTO member_activity_log (user_id, action, details) VALUES (?, ?, ?)').run(memberId, 'wallet_adjusted', JSON.stringify({ direction, amount, reason, reference }));
    })();

    auditLog(req.adminUser, 'wallet_adjustment', 'wallet', memberId, { balance: previousBalance }, { balance: previousBalance + delta }, reason);
    res.json({ success: true, message: 'Wallet adjustment recorded to the ledger.' });
  });

  app.post('/api/admin/members/:id/membership', requireAdmin, (req, res) => {
    const memberId = Number(req.params.id);
    const plan = String(req.body?.plan || '').trim();
    const reason = String(req.body?.reason || 'Membership update').trim();

    if (!memberId || !plan) {
      return res.status(400).json({ success: false, message: 'Member ID and plan are required.' });
    }

    const account = db.prepare('SELECT * FROM accounts WHERE user_id = ?').get(memberId);
    if (!account) return res.status(404).json({ success: false, message: 'Member account not found.' });

    const previousPlan = String(account.package || 'Bronze');

    db.transaction(() => {
      db.prepare('UPDATE accounts SET package = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?').run(plan, 'active', memberId);
      db.prepare('INSERT INTO membership_history (user_id, previous_plan, new_plan, reason, admin_user_id) VALUES (?, ?, ?, ?, ?)').run(memberId, previousPlan, plan, reason, req.adminUser.id);
      db.prepare('INSERT INTO member_activity_log (user_id, action, details) VALUES (?, ?, ?)').run(memberId, 'membership_updated', JSON.stringify({ previousPlan, newPlan: plan, reason }));
    })();

    auditLog(req.adminUser, 'membership_updated', 'member', memberId, previousPlan, plan, reason);
    res.json({ success: true, message: 'Membership updated successfully.' });
  });

  app.get('/api/admin/wallet-ledger', requireAdmin, (_req, res) => {
    const rows = db.prepare(`
      SELECT wl.*, u.full_name AS memberName, a.account_number AS accountNumber
      FROM wallet_ledger wl
      JOIN users u ON u.id = wl.user_id
      JOIN accounts a ON a.id = wl.account_id
      ORDER BY wl.created_at DESC
      LIMIT 200
    `).all();
    res.json({ success: true, transactions: rows });
  });

  app.get('/api/admin/payments', requireAdmin, (_req, res) => {
    const paymentAttempts = db.prepare('SELECT * FROM payment_attempts ORDER BY created_at DESC LIMIT 200').all();
    const transactions = db.prepare(`
      SELECT t.id, u.full_name AS memberName, t.type, t.amount, t.status, t.reference, t.description, t.created_at AS createdAt
      FROM transactions t
      JOIN users u ON u.id = t.user_id
      ORDER BY t.created_at DESC
      LIMIT 200
    `).all();
    res.json({ success: true, paymentAttempts, transactions });
  });

  app.get('/api/admin/withdrawals', requireAdmin, (_req, res) => {
    const rows = db.prepare(`
      SELECT w.*, u.full_name AS memberName
      FROM withdrawals w
      JOIN users u ON u.id = w.user_id
      ORDER BY w.created_at DESC
      LIMIT 200
    `).all();
    res.json({ success: true, withdrawals: rows });
  });

  app.post('/api/admin/withdrawals/:id/decision', requireAdmin, (req, res) => {
    const withdrawalId = Number(req.params.id);
    const decision = String(req.body?.decision || 'approved').trim().toLowerCase();
    const note = String(req.body?.note || 'Processed by administrator').trim();

    if (!['approved', 'rejected', 'processed'].includes(decision)) {
      return res.status(400).json({ success: false, message: 'Decision must be approved, rejected, or processed.' });
    }

    const withdrawal = db.prepare('SELECT * FROM withdrawals WHERE id = ?').get(withdrawalId);
    if (!withdrawal) return res.status(404).json({ success: false, message: 'Withdrawal record not found.' });

    db.transaction(() => {
      db.prepare('UPDATE withdrawals SET status = ?, notes = ?, processed_at = CURRENT_TIMESTAMP WHERE id = ?').run(decision, note, withdrawalId);
      db.prepare('INSERT INTO member_activity_log (user_id, action, details) VALUES (?, ?, ?)').run(withdrawal.user_id, 'withdrawal_decision', JSON.stringify({ decision, note }));
    })();

    auditLog(req.adminUser, 'withdrawal_reviewed', 'withdrawal', withdrawalId, withdrawal.status || 'pending', decision, note);
    res.json({ success: true, message: `Withdrawal ${decision} successfully.` });
  });

  app.get('/api/admin/security', requireAdmin, (_req, res) => {
    const auditLogs = db.prepare(`
      SELECT a.*, u.full_name AS actorName
      FROM admin_audit_logs a
      LEFT JOIN users u ON u.id = a.actor_user_id
      ORDER BY a.created_at DESC
      LIMIT 200
    `).all();

    const sessions = db.prepare(`
      SELECT s.id, u.full_name AS userName, u.email, s.expires_at AS expiresAt
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      ORDER BY s.created_at DESC
      LIMIT 200
    `).all();

    res.json({ success: true, auditLogs, sessions });
  });

  app.get('/api/admin/reports', requireAdmin, (req, res) => {
    const from = String(req.query.from || '').trim();
    const to = String(req.query.to || '').trim();

    const where = [];
    const params = [];

    if (from) {
      where.push('DATE(created_at) >= DATE(?)');
      params.push(from);
    }

    if (to) {
      where.push('DATE(created_at) <= DATE(?)');
      params.push(to);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const reports = {
      registrationCount: db.prepare(`SELECT COUNT(*) AS count FROM users ${whereSql}`).get(...params).count,
      revenue: db.prepare(`SELECT COALESCE(SUM(amount), 0) AS total FROM transactions WHERE lower(status) IN ('completed','verified','paid','approved') ${where.length ? `AND ${where.join(' AND ')}` : ''}`).get(...params).total,
      withdrawalCount: db.prepare(`SELECT COUNT(*) AS count FROM withdrawals ${whereSql}`).get(...params).count,
      walletTransactions: db.prepare(`SELECT COUNT(*) AS count FROM wallet_ledger ${whereSql}`).get(...params).count,
    };

    res.json({ success: true, reports });
  });
};
