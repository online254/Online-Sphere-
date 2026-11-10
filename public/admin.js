<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#07111f">
  <meta name="robots" content="noindex, nofollow">
  <title>Member Management | Online Sphere Admin</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=Space+Grotesk:wght@500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="admin.css">
  <script src="admin.js" defer></script>
</head>
<body>
  <main class="admin-shell">
    <header class="admin-header">
      <a class="brand" href="dashboard.html"><span class="brand-icon" aria-hidden="true">◎</span><span>ONLINE <b>SPHERE</b><small>ADMINISTATOR DASHBOARD</small></span></a>
      <div class="header-actions">
        <a href="dashboard.html">Member dashboard</a>
        <button id="signOut" type="button">Sign out</button>
      </div>
    </header>

    <section class="intro">
      <span class="eyebrow">PRIVATE ADMINISTRATOR ACCESS</span>
      <h1>Member Management Control Center</h1>
      <p>Manage accounts, memberships, wallet activity, and operations securely.</p>
    </section>

    <p class="status" id="status" role="status" aria-live="polite">Verifying administrator access…</p>

    <section class="overview" id="overview" hidden aria-label="Platform overview">
      <article class="metric"><span>Total members</span><strong id="members">—</strong></article>
      <article class="metric"><span>Active members</span><strong id="activeMembers">—</strong></article>
      <article class="metric"><span>Pending verification</span><strong id="pendingVerification">—</strong></article>
      <article class="metric"><span>Total wallet</span><strong id="walletTotal">—</strong></article>
      <article class="metric"><span>Revenue</span><strong id="revenue">—</strong></article>
      <article class="metric"><span>Pending withdrawals</span><strong id="pendingWithdrawals">—</strong></article>
    </section>

    <section class="toolbar panel">
      <div class="field-group search-box">
        <label for="memberSearch">Search member</label>
        <input id="memberSearch" type="search" placeholder="Name, email, phone, ID" />
      </div>

      <div class="field-group">
        <label for="memberStatusFilter">Status</label>
        <select id="memberStatusFilter">
          <option value="">All</option>
          <option value="active">Active</option>
          <option value="pending_verification">Pending Verification</option>
          <option value="suspended">Suspended</option>
          <option value="restricted">Restricted</option>
          <option value="banned">Banned</option>
          <option value="deactivated">Deactivated</option>
          <option value="deleted">Deleted</option>
        </select>
      </div>

      <div class="field-group">
        <label for="planFilter">Plan</label>
        <select id="planFilter">
          <option value="">All</option>
          <option value="Bronze">Bronze</option>
          <option value="Silver">Silver</option>
          <option value="Gold">Gold</option>
        </select>
      </div>

      <div class="field-group width-compact">
        <label for="fromDate">From</label>
        <input id="fromDate" type="date" />
      </div>

      <div class="field-group width-compact">
        <label for="toDate">To</label>
        <input id="toDate" type="date" />
      </div>

      <button id="applyFilters" class="primary" type="button">Apply filters</button>
    </section>

    <section class="content-grid">
      <article class="panel">
        <div class="panel-head">
          <h2>Members</h2>
          <button id="refreshMembers" type="button" class="secondary">Refresh</button>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Plan</th>
                <th>Status</th>
                <th>Wallet</th>
                <th>Joined</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="memberTableBody"></tbody>
          </table>
        </div>
      </article>

      <aside class="panel details-panel">
        <div class="panel-head">
          <h2>Member details</h2>
        </div>
        <div id="memberDetails" class="member-details empty-state">
          Select a member from the table to inspect account information, wallet, and activity.
        </div>
      </aside>
    </section>

    <section class="bottom-grid">
      <article class="panel">
        <div class="panel-head"><h2>Wallet ledger</h2></div>
        <div id="walletLedger" class="list-block"></div>
      </article>

      <article class="panel">
        <div class="panel-head"><h2>Recent admin audit</h2></div>
        <div id="auditFeed" class="list-block"></div>
      </article>
    </section>

    <a class="back-link" href="dashboard.html">← Return to member dashboard</a>
  </main>
</body>
</html>
