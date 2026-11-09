'use strict';

require('dotenv').config();
const db = require('./database/database.db.js');

function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((item) => item.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function ensureTable(name, sql) {
  db.exec(`CREATE TABLE IF NOT EXISTS ${name} (${sql});`);
}

ensureColumn('users', 'role', "TEXT DEFAULT 'member'");
ensureColumn('users', 'is_admin', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('users', 'status', "TEXT DEFAULT 'active'");
ensureColumn('users', 'last_login_at', 'DATETIME');

ensureTable('admin_audit_logs', `
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  actor_email TEXT,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id INTEGER,
  details TEXT,
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
