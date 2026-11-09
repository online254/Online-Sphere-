# Secure backend deployment notes

The Render service now starts `secure-server.js` through `npm start`. It is an API-only service; keep the existing static frontend deployment separate and set `window.ONLINE_SPHERE_API_URL` in the frontend to this backend URL.

## Security controls included
- Helmet security headers and a request body limit.
- CORS allowlist via `CORS_ORIGINS`; do not use `*` with credentials.
- Global request limits and a stricter authentication rate limit.
- Scrypt password hashing and random bearer sessions stored as SHA-256 token hashes.
- Session expiry, logout revocation, parameterized SQL, and member-scoped queries.
- Owner provisioning only from server environment variables. Existing account is promoted only if the configured owner password verifies against its hash; password mismatch stops startup.
- Admin APIs check the `user_roles` database relation on every request. Frontend email checks only affect link visibility.
- Audit and login history tables.

## Required deployment settings
Configure `OWNER_EMAIL`, a unique strong `OWNER_PASSWORD`, `CORS_ORIGINS`, `PUBLIC_SITE_URL`, and `DB_PATH` (persistent disk path). Secrets must be entered in Render environment settings, not committed. Configure a persistent disk for SQLite or migrate to a managed PostgreSQL deployment before scaling horizontally.

## Scope and rollout warning
This secure API currently provides registration/login, identity, dashboard summaries, package listing, and owner overview/member/audit reads. It intentionally does not expose M-Pesa payment endpoints; migrate the existing Daraja integration only after server-to-server STK query verification, callback idempotency, persistent production storage, and sandbox testing are implemented. The previous `server.js` remains in the repository as a rollback/reference file. Do not describe payment processing or the full platform as production-ready on this backend yet.

Before deploying, run `npm install` and `npm run check`, then test registration, login, logout, a member request to `/api/admin/overview` (must return 403), and an authenticated owner request (must return 200). A database backup is required before switching the Render start command.
