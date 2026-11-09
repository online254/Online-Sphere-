/* Inject the admin API into the existing Express app before its catch-all 404. */
'use strict';

require('dotenv').config();
const db = require('./database/database.db.js');

function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((item) => item.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

// Additive role fields preserve existing member and account records. Admin access
// is granted only by an explicit database role or a server-side allowlist.
ensureColumn('users', 'role', "TEXT DEFAULT 'member'");
ensureColumn('users', 'is_admin', 'INTEGER NOT NULL DEFAULT 0');

const expressPath = require.resolve('express');
const express = require(expressPath);
let routesRegistered = false;
const patchedExpress = (...args) => {
  const app = express(...args);
  const originalUse = app.use.bind(app);
  app.use = (...middleware) => {
    const handler = middleware.length === 1 ? middleware[0] : null;
    // The existing backend's final 404 handler is the only two-argument
    // middleware. Register protected routes immediately before it.
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
