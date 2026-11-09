<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#07111f">
  <title>Owner Control Centre | Online Sphere</title>
  <style>
    :root { color-scheme: dark; --bg: #07111f; --panel: #101d2d; --line: rgba(255,255,255,0.08); --text: #f6f9ff; --muted: #a4b7cc; --gold: #ffbd59; --teal: #55d9c8; --blue: #2563eb; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; background: var(--bg); color: var(--text); font-family: Arial, sans-serif; display: grid; place-items: center; }
    .shell { width: min(1100px, calc(100vw - 24px)); background: var(--panel); border: 1px solid var(--line); border-radius: 18px; padding: 24px; }
    .topbar { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 20px; }
    .brand { color: var(--text); text-decoration: none; font-weight: 700; letter-spacing: 0.08em; }
    .status { color: var(--teal); font-size: 12px; text-transform: uppercase; }
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 14px; margin: 18px 0; }
    .card { background: rgba(255,255,255,0.02); border: 1px solid var(--line); border-radius: 12px; padding: 16px; }
    .card h3 { margin: 0 0 8px; font-size: 12px; letter-spacing: 0.08em; color: var(--muted); text-transform: uppercase; }
    .card strong { font-size: 28px; display: block; }
    .notice { margin-top: 16px; color: var(--muted); }
    .danger { color: #ff8b8b; }
    @media (max-width: 640px) { .topbar { flex-direction: column; align-items: flex-start; } }
  </style>
</head>
<body>
  <div class="shell">
    <div class="topbar">
      <div class="brand">ONLINE SPHERE // OWNER CONTROL CENTRE</div>
      <div class="status" id="status">Loading secure admin access…</div>
    </div>

    <div class="stats" id="stats"></div>
    <div class="notice" id="notice">Access is restricted to the authorized owner account only.</div>
  </div>

  <script>
    (() => {
      'use strict';
      const API_BASE = String(window.ONLINE_SPHERE_API_URL || 'https://online-sphere-backend.onrender.com').replace(/\/$/, '');
      const token = sessionStorage.getItem('onlineSphereSession') || localStorage.getItem('onlineSphereToken') || '';
      const statusEl = document.getElementById('status');
      const noticeEl = document.getElementById('notice');
      const statsEl = document.getElementById('stats');

      async function loadAdmin() {
        if (!token) {
          statusEl.textContent = 'Session required';
          noticeEl.textContent = 'Please sign in with the authorized owner account to continue.';
          noticeEl.classList.add('danger');
          return;
        }

        try {
          const response = await fetch(`${API_BASE}/api/admin/overview`, {
            headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
            credentials: 'include',
            cache: 'no-store'
          });
          const result = await response.json().catch(() => ({}));

          if (!response.ok) {
            throw new Error(result.message || 'Access denied');
          }

          const overview = result.data || {};
          statusEl.textContent = 'Owner access verified';
          noticeEl.textContent = `Authorized account: ${result.owner?.name || 'Super Admin'}`;

          const entries = [
            ['Total members', overview.members || 0],
            ['Active members', overview.activeMembers || 0],
            ['Pending deposits', overview.pendingDeposits || 0],
            ['Verified deposits', overview.verifiedDeposits || 0],
            ['Withdrawal requests', overview.withdrawalRequests || 0],
            ['Approved withdrawals', overview.approvedWithdrawals || 0],
            ['Platform revenue', `KSh ${Number(overview.platformRevenue || 0).toLocaleString()}`],
            ['Task count', overview.taskCount || 0],
            ['Referral count', overview.referralCount || 0]
          ];

          statsEl.innerHTML = entries.map(([label, value]) => `
            <div class="card">
              <h3>${label}</h3>
              <strong>${value}</strong>
            </div>
          `).join('');
        } catch (error) {
          statusEl.textContent = 'Access denied';
          noticeEl.textContent = error.message || 'This area is restricted to the authenticated owner only.';
          noticeEl.classList.add('danger');
        }
      }

      loadAdmin();
    })();
  </script>
</body>
</html>
