(() => {
  'use strict';

  const API = String(window.ONLINE_SPHERE_API_URL || 'https://online-sphere-backend.onrender.com').replace(/\/$/, '') + '/api/admin';
  const TOKEN_KEY = 'onlineSphereAdminToken';
  let token = sessionStorage.getItem(TOKEN_KEY) || '';
  const $ = (selector) => document.querySelector(selector);
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const number = (value) => Number(value || 0).toLocaleString('en-KE');
  const money = (value) => `KSh ${Number(value || 0).toLocaleString('en-KE')}`;

  function showLogin(message = '') {
    $('#loginScreen').classList.remove('hidden');
    $('#adminPanel').classList.add('hidden');
    $('#loginMessage').textContent = message;
  }

  function showAdmin() {
    $('#loginScreen').classList.add('hidden');
    $('#adminPanel').classList.remove('hidden');
  }

  function notify(message) {
    const toast = $('#toast');
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => toast.classList.remove('show'), 3200);
  }

  async function request(path, options = {}) {
    const response = await fetch(API + path, {
      ...options,
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, ...(options.headers || {}) },
      cache: 'no-store'
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) {
      token = '';
      sessionStorage.removeItem(TOKEN_KEY);
      showLogin(data.message || 'Your administrator session has expired.');
    }
    if (!response.ok) throw new Error(data.message || 'The administrator request failed.');
    return data;
  }

  function setState(message, error = false) {
    const state = $('#globalState');
    state.textContent = message;
    state.classList.toggle('error', error);
  }

  async function loadStats() {
    const data = await request('/stats');
    const stats = data.stats || {};
    $('#totalMembers').textContent = number(stats.totalMembers);
    $('#activeMembers').textContent = number(stats.activeMembers);
    $('#suspendedMembers').textContent = number(stats.suspendedMembers);
    $('#totalMemberships').textContent = number(stats.totalMemberships);
    $('#totalPayments').textContent = number(stats.totalTransactions);
    $('#revenue').textContent = money(stats.membershipRevenue);
    $('#pendingWithdrawals').textContent = money(stats.pendingWithdrawals);
    $('#reportMembers').textContent = number(stats.totalMembers);
    $('#reportActive').textContent = number(stats.activeMembers);
    $('#reportRevenue').textContent = money(stats.membershipRevenue);
  }

  async function loadMembers() {
    const body = $('#membersBody');
    body.innerHTML = '<tr><td colspan="7" class="empty">Loading members…</td></tr>';
    try {
      const search = encodeURIComponent($('#memberSearch').value.trim());
      const data = await request(`/members?limit=100&search=${search}`);
      if (!data.members?.length) {
        body.innerHTML = '<tr><td colspan="7" class="empty">No members found.</td></tr>';
        return;
      }
      body.innerHTML = data.members.map((member) => {
        const status = String(member.account_status || 'inactive').toLowerCase();
        const suspended = status === 'suspended';
        return `<tr><td>${escapeHtml(member.id)}</td><td>${escapeHtml(member.full_name)}</td><td>${escapeHtml(member.email)}</td><td>${escapeHtml(member.package || '—')}</td><td><span class="status ${suspended ? 'suspended' : ''}">${escapeHtml(status)}</span></td><td>${money(member.balance)}</td><td><div class="actions"><button class="button button-secondary" data-action="status" data-id="${member.id}" data-status="${suspended ? 'active' : 'suspended'}">${suspended ? 'Reactivate' : 'Suspend'}</button><button class="button button-secondary" data-action="balance" data-id="${member.id}">Balance</button><button class="button button-secondary" data-action="details" data-id="${member.id}">Details</button><button class="button button-danger" data-action="delete" data-id="${member.id}">Delete</button></div></td></tr>`;
      }).join('');
    } catch (error) {
      body.innerHTML = `<tr><td colspan="7" class="empty">${escapeHtml(error.message)}</td></tr>`;
    }
  }

  async function loadRecords(section) {
    const panel = document.querySelector(`[data-records="${section}"]`);
    if (!panel) return;
    try {
      const data = await request(`/records?section=${encodeURIComponent(section)}`);
      if (!data.records?.length) {
        panel.innerHTML = '<div class="empty-state"><strong>No records found.</strong><p>The database returned an empty result for this section.</p></div>';
        return;
      }
      const columns = Object.keys(data.records[0]);
      panel.innerHTML = `<div class="table-wrap"><table class="record-table"><thead><tr>${columns.map((column) => `<th>${escapeHtml(column.replaceAll('_', ' '))}</th>`).join('')}</tr></thead><tbody>${data.records.map((record) => `<tr>${columns.map((column) => `<td>${escapeHtml(record[column] ?? '—')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    } catch (error) {
      panel.innerHTML = `<div class="empty-state"><strong>Unable to load records.</strong><p>${escapeHtml(error.message)}</p></div>`;
    }
  }

  async function refresh() {
    setState('Loading live administrator data…');
    try {
      await loadStats();
      const active = document.querySelector('.page-section.active')?.id;
      if (active === 'members') await loadMembers();
      if (['opportunities', 'memberships', 'payments', 'withdrawals', 'finance', 'revenue'].includes(active)) await loadRecords(active === 'memberships' ? 'packages' : active);
      setState('Live database data loaded.');
    } catch (error) {
      setState(error.message, true);
    }
  }

  function navigate(page) {
    document.querySelectorAll('.page-section').forEach((section) => section.classList.toggle('active', section.id === page));
    document.querySelectorAll('.nav-item[data-page]').forEach((item) => item.classList.toggle('active', item.dataset.page === page));
    const titles = { overview: 'Administrator Overview', 'audit-logs': 'Audit Logs' };
    $('#pageTitle').textContent = titles[page] || page.replaceAll('-', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
    $('#sidebar').classList.remove('open');
    $('#menuButton').setAttribute('aria-expanded', 'false');
    if (page === 'members') loadMembers();
    if (['opportunities', 'memberships', 'payments', 'withdrawals', 'finance', 'revenue'].includes(page)) loadRecords(page === 'memberships' ? 'packages' : page);
  }

  async function changeMember(action, id, status) {
    try {
      if (action === 'status') {
        if (!window.confirm(`Change member ${id} status to ${status}?`)) return;
        await request(`/members/${id}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
      } else if (action === 'balance') {
        const amount = Number(window.prompt('Enter a non-zero whole-number adjustment amount.'));
        const description = window.prompt('Reason for this wallet adjustment:');
        if (!Number.isSafeInteger(amount) || amount === 0 || !description) return;
        await request(`/members/${id}/balance`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amount, description }) });
      } else if (action === 'details') {
        const data = await request(`/members/${id}`);
        const member = data.member;
        window.alert(`MEMBER DETAILS\n\nName: ${member.full_name}\nEmail: ${member.email}\nPhone: ${member.phone || '—'}\nPackage: ${member.package || '—'}\nStatus: ${member.account_status || '—'}\nBalance: ${money(member.balance)}\nTransactions: ${data.transactions?.length || 0}`);
        return;
      } else if (action === 'delete') {
        if (!window.confirm('Permanently delete this member?')) return;
        await request(`/members/${id}`, { method: 'DELETE' });
      }
      notify('Member record updated.');
      await loadMembers();
      await loadStats();
    } catch (error) {
      window.alert(error.message);
    }
  }

  $('#loginForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = $('#loginButton');
    button.disabled = true;
    button.textContent = 'Authenticating…';
    $('#loginMessage').textContent = '';
    try {
      const response = await fetch(`${API}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ email: $('#email').value.trim(), password: $('#password').value }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) throw new Error(data.message || 'Login failed.');
      token = data.token;
      sessionStorage.setItem(TOKEN_KEY, token);
      const verified = await request('/me');
      $('#adminIdentity').textContent = verified.admin?.email || data.admin?.email || 'ADMINISTRATOR';
      $('#profileEmail').textContent = verified.admin?.email || data.admin?.email || 'Administrator';
      showAdmin();
      await refresh();
      notify('Administrator authenticated.');
    } catch (error) {
      token = '';
      sessionStorage.removeItem(TOKEN_KEY);
      $('#loginMessage').textContent = error.message;
    } finally {
      button.disabled = false;
      button.textContent = 'Sign in securely';
    }
  });

  document.querySelectorAll('.nav-item[data-page]').forEach((item) => item.addEventListener('click', () => navigate(item.dataset.page)));
  document.querySelectorAll('[data-refresh]').forEach((button) => button.addEventListener('click', refresh));
  document.querySelectorAll('[data-go]').forEach((button) => button.addEventListener('click', () => navigate(button.dataset.go)));
  $('#memberSearchButton').addEventListener('click', loadMembers);
  $('#memberSearch').addEventListener('keydown', (event) => { if (event.key === 'Enter') loadMembers(); });
  $('#membersBody').addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (button) changeMember(button.dataset.action, button.dataset.id, button.dataset.status);
  });
  $('#menuButton').addEventListener('click', () => {
    const open = $('#sidebar').classList.toggle('open');
    $('#menuButton').setAttribute('aria-expanded', String(open));
  });
  $('#logoutButton').addEventListener('click', async () => {
    try { await request('/logout', { method: 'POST' }); } catch (_) { /* local sign-out still clears the session */ }
    token = '';
    sessionStorage.removeItem(TOKEN_KEY);
    showLogin('You have been logged out.');
  });

  (async () => {
    if (!token) return showLogin();
    try {
      const data = await request('/me');
      if (!data.isAdmin) throw new Error('Administrator access denied.');
      $('#adminIdentity').textContent = data.admin?.email || 'ADMINISTRATOR';
      $('#profileEmail').textContent = data.admin?.email || 'Administrator';
      showAdmin();
      await refresh();
    } catch (error) {
      token = '';
      sessionStorage.removeItem(TOKEN_KEY);
      showLogin(error.message);
    }
  })();
})();
