# Online Sphere upgrade plan

## Phase 1 — Preserve the approved dashboard
- Keep `public/dashboard.html`, `public/dashboard.css`, and `public/dashboard.js` untouched.
- Do not change colors, layout, or bottom navigation.
- Keep the dashboard as the first post-login page after the animated logo.

## Phase 2 — Harden the backend and database
- Add secure headers, rate limiting, and consistent server-side validation.
- Extend SQLite schema with roles, permissions, audit logs, login history, notifications, support tickets, referrals, commissions, tasks, and platform settings.
- Keep working member registration and dashboard API responses intact while adding secure ownership controls.

## Phase 3 — Owner-only administration
- Create the `super_admin` role and restrict admin APIs to the authorized owner account.
- Expose a dedicated `public/admin.html` owner dashboard and keep it inaccessible to ordinary members.
- Add audit logging for admin access and sensitive actions.

## Phase 4 — Financial and payment hardening
- Keep M-Pesa Daraja STK push flow and callback verification.
- Enforce idempotent payment handling and duplicate prevention.
- Only activate memberships after backend verification and avoid trusting client-side screenshots.

## Phase 5 — Opportunities, learning, and referrals
- Add platform data models for opportunities, submissions, courses, lessons, learning progress, and referral commission tracking.
- Keep referral commission model at 10% of verified membership activation fees, subject to terms and approval.

## Phase 6 — Deployment and environment safety
- Use environment variables for all secrets.
- Keep `.env` out of GitHub and document `.env.example` for production setup.
- Prepare for Render/Netlify deployment with secure callback URLs and production credentials.

## Phase 7 — Testing and release validation
- Verify registration and login flows.
- Test ownership access restrictions.
- Test M-Pesa callback logic and duplicate prevention.
- Confirm dashboard remains visually unchanged.

This upgrade is intentionally incremental to preserve the existing working project while adding the secure platform foundations required for the full Online Sphere scope.
