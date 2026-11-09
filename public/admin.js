(() => {
  'use strict';
  const API_BASE = String(window.ONLINE_SPHERE_API_URL || 'https://online-sphere-backend.onrender.com').replace(/\/$/, '');
  const token = (() => {
    try { return sessionStorage.getItem('onlineSphereSession') || localStorage.getItem('onlineSphereToken') || ''; }
    catch (_) { return ''; }
  })();
  const status = document.getElementById('status');
  const number = (value) => new Intl.NumberFormat('en-KE').format(Number(value || 0));
  const money = (value) => new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', maximumFractionDigits: 0 }).format(Number(value || 0));

  function deny(message) {
    status.textContent = message;
    status.classList.add('error');
    setTimeout(() => window.location.replace('dashboard.html'), 1600);
  }

  function addText(container, value) {
    const row = document.createElement('p');
    row.textContent = value;
    container.appendChild(row);
  }

  async function load() {
    if (!token) return deny('Please sign in with an authorized administrator account. Returning to the dashboard…');
    try {
      const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
      const accessResponse = await fetch(`${API_BASE}/api/admin/access`, { headers, credentials: 'include', cache: 'no-store' });
      if (!accessResponse.ok) return deny(accessResponse.status === 401 ? 'Your session expired. Please sign in again.' : 'Administrator access is restricted. Returning to your dashboard…');
      const overviewResponse = await fetch(`${API_BASE}/api/admin/overview`, { headers, credentials: 'include', cache: 'no-store' });
      const result = await overviewResponse.json().catch(() => ({}));
      if (!overviewResponse.ok) throw new Error(result.message || 'Unable to load platform records.');
      const data = result.overview || {};
      document.getElementById('members').textContent = number(data.members);
      document.getElementById('activeMembers').textContent = number(data.activeMembers);
      document.getElementById('revenue').textContent = money(data.verifiedRevenue);
      document.getElementById('pendingTransactions').textContent = number(data.pendingTransactions);
      document.getElementById('pendingWithdrawals').textContent = number(data.pendingWithdrawals);
      const members = document.getElementById('recentMembers');
      const transactions = document.getElementById('recentTransactions');
      (data.recentMembers || []).forEach((member) => addText(members, `${member.fullName || 'Member'} · ${member.email || ''}`));
      (data.recentTransactions || []).forEach((item) => addText(transactions, `${item.memberName || 'Member'} · ${item.type || 'Transaction'} · ${money(item.amount)} · ${item.status || ''}`));
      document.getElementById('overview').hidden = false;
      document.getElementById('records').hidden = false;
      status.textContent = 'Administrator access verified. Records are loaded from the live database.';
    } catch (error) {
      status.textContent = `${error.message} Please try again later.`;
      status.classList.add('error');
    }
  }

  document.getElementById('signOut').addEventListener('click', async () => {
    try { await fetch(`${API_BASE}/api/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, credentials: 'include' }); } catch (_) {}
    try { sessionStorage.removeItem('onlineSphereSession'); localStorage.removeItem('onlineSphereToken'); } catch (_) {}
    window.location.replace('auth.html');
  });
  load();
})();
