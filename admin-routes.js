'use strict';

require('dotenv').config();
const db = require('./database/database.db.js');

function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((item) => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function ensureTable(name, sql) {
  db.exec(`CREATE TABLE IF NOT EXISTS ${name} (${sql});`);
}

ensureColumn('users', 'role', "TEXT DEFAULT 'member'");
ensureColumn('users', 'is_admin', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('users', 'status', "TEXT DEFAULT 'active'");
ensureColumn('users', 'last_login_at', 'DATETIME');
ensureColumn('users', 'verification_status', "TEXT DEFAULT 'pending_verification'");
ensureColumn('users', 'deleted_at', 'DATETIME');
ensureColumn('users', 'deleted_by', 'INTEGER');
ensureColumn('users', 'delete_reason', 'TEXT');
ensureColumn('users', 'profile_info', 'TEXT');
ensureColumn('users', 'member_notes', 'TEXT');
ensureColumn('users', 'phone_verified', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('accounts', 'status', "TEXT DEFAULT 'active'");
ensureColumn('accounts', 'balance', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('accounts', 'currency', "TEXT DEFAULT 'KES'");
ensureColumn('accounts', 'last_wallet_adjustment_at', 'DATETIME');

ensureTable('admin_audit_logs', `
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_user_id INTEGER,
  actor_email TEXT,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id INTEGER,
  old_value TEXT,
  new_value TEXT,
  reason TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
`);

ensureTable('wallet_ledger', `
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  account_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  amount INTEGER NOT NULL,
  currency TEXT DEFAULT 'KES',
  reason TEXT NOT NULL,
  reference TEXT NOT NULL,
  admin_user_id INTEGER NOT NULL,
  admin_email TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
`);

ensureTable('member_status_history', `
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  previous_status TEXT,
  new_status TEXT NOT NULL,
  reason TEXT,
  admin_user_id INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
`);

ensureTable('member_login_history', `
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
`);

ensureTable('member_activity_log', `
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  details TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
`);

ensureTable('membership_history', `
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  previous_plan TEXT,
  new_plan TEXT NOT NULL,
  reason TEXT,
  admin_user_id INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
`);

ensureTable('member_admin_notes', `
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  author_email TEXT NOT NULL,
  note TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
`);

const expressPath = require.resolve('express');
const express = require(expressPath);
let routesRegistered = false;
const patchedExpress = (...args) => {
  const app = express(...args);
  const originalUse = app.use.bind(app);
  app.use = (...middleware) => {
    const handler = middleware.length === 1 ? middleware[0] : null;
    if (!routesRegistered && typeof handler === 'function' && handler.length === 2) {
      require('./admin-routes.js')(app, db);
      routesRegistered = true;
    }
    return originalUse(...middleware);
  };
  return app;
};
Object.assign(patchedExpress, express);
require.cache[expressPath].exports = patchedExpress;
require('./server.js');
