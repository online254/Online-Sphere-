# Online Sphere

Online Sphere is a secure digital opportunities platform focused on member access, earnings, wallet activity, opportunities, learning, referrals, and private owner management.

## Current status
- The approved dashboard remains preserved and is not redesigned.
- The platform now includes a secure backend foundation with authentication, admin controls, M-Pesa callback handling, and tiered access checks.
- The owner-only admin page is available at `public/admin.html` and requires the authorized super admin session.

## Important deployment notes
- Never publish real secrets in the repo.
- Use `.env` for production credentials and keep `.env.example` as the safe template.
- Use the `OWNER_EMAIL` and `OWNER_PASSWORD` environment variables to initialize the specific owner account.
- The dashboard remains the first member page after successful login.

## Key modules
- Member auth and secure session management
- M-Pesa Daraja STK push and callback verification
- Membership packages and dashboard accounting
- Opportunities and submission workflow
- Learning centre and announcements
- Referral and commission infrastructure
- Owner-only super admin access
- Audit logging and security controls

## Run locally
1. Copy `.env.example` to `.env` and set real values.
2. Install dependencies:
   npm install
3. Start the app:
   npm start

## Production notes
- Use Render or a secure Node host for the backend.
- Keep callback URL configured to the live backend domain.
- Never trust client-side payment screenshots or messages as the source of wallet credit.

This project is intentionally incremental: the approved dashboard stays visually unchanged while the underlying platform security and functionality are upgraded.
