/* Member dashboard entry. Uses backend-provided member data; owner link visibility is not an authorization check. */
(() => {
  'use strict';
  const API_BASE = String(window.ONLINE_SPHERE_API_URL || 'https://online-sphere-backend.onrender.com').replace(/\/$/, '');
  const OWNER_EMAIL = 'muthinibenson7@gmail.com';
  const $ = (selector) => document.querySelector(selector);
  const statusBox = $('#loadState');
  const statusMessage = $('#loadMessage');

  function readToken() {
    try { return sessionStorage.getItem('onlineSphereSession') || localStorage.getItem('onlineSphereToken') || ''; }
    catch (_) { return ''; }
  }
  const token = readToken();
  const money = (value, currency = 'KES') => {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
    try { return new Intl.NumberFormat('en-KE', { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(value)); }
    catch (_) { return `${currency} ${Number(value).toFixed(2)}`; }
  };
  const setStatus = (message, connected = false) => {
    if (!statusMessage || !statusBox) return;
    statusMessage.textContent = message;
    statusBox.classList.toggle('connected', connected);
  };
  function showToast(message) {
    const toast = $('#toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove('show'), 2600);
  }
  function setMoney(key, value, currency = 'KES') {
    document.querySelectorAll(`[data-money="${key}"]`).forEach((el) => { el.textContent = money(value, currency); });
  }
  function setStat(key, value) {
    document.querySelectorAll(`[data-stat="${key}"]`).forEach((el) => { el.textContent = value === null || value === undefined ? '—' : String(value); });
  }

  function showOwnerLink(user) {
    // This only controls whether the link is shown. Admin API authorization must be enforced server-side.
    if (String(user.email || '').trim().toLowerCase() !== OWNER_EMAIL) return;
    const menu = $('#profileMenu');
    if (!menu || menu.querySelector('[data-owner-admin-link]')) return;
    const link = document.createElement('a');
    link.href = 'admin.html';
    link.textContent = 'Owner Control Centre';
    link.dataset.ownerAdminLink = 'true';
    menu.insertBefore(link, menu.querySelector('button') || null);
  }

  function showDashboard(data) {
    const user = data.user || {};
    const membership = data.membership || {};
    const wallet = data.wallet || {};
    const statistics = data.statistics || {};
    const referrals = data.referrals || {};
    const fullName = user.fullName || user.full_name || '';

    if (fullName) {
      $('#memberName').textContent = fullName.split(/\s+/)[0];
      $('#profileButton').textContent = fullName.trim().split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase();
      $('#menuName').textContent = fullName;
    }
    showOwnerLink(user);

    const level = membership.name || membership.package || 'No active plan';
    $('#memberLevel').textContent = String(level).toUpperCase();
    $('#serviceLevel').textContent = `${String(level).toUpperCase()} MEMBER`;
    $('#memberStatus').textContent = membership.status || user.status || 'Status unavailable';
    $('#accountStatus').textContent = user.status || membership.status || '—';
    const created = user.createdAt || user.created_at;
    $('#joinedDate').textContent = created ? new Date(created).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
    $('#sponsorName').textContent = referrals.sponsorName || referrals.sponsor_name || '—';

    const rank = { bronze: 1, silver: 2, gold: 3 }[String(level).toLowerCase()] || 0;
    document.querySelectorAll('.lock-indicator').forEach((icon) => {
      const min = icon.dataset.min.toLowerCase();
      const locked = !membership.active || rank < ({ bronze: 1, silver: 2, gold: 3 }[min] || 99);
      const tile = icon.closest('.service-tile');
      tile.classList.toggle('is-locked', locked);
      icon.textContent = locked ? '⌑' : '↗';
      if (locked) tile.setAttribute('aria-label', `${tile.querySelector('span:nth-child(2)').textContent} requires an active ${icon.dataset.min} membership. Select to view membership options.`);
      else tile.removeAttribute('aria-label');
    });

    const currency = wallet.currency || 'KES';
    ['walletBalance', 'availableBalance', 'pendingBalance', 'totalDeposited', 'totalWithdrawn', 'totalEarnings', 'todayEarnings'].forEach((key) => {
      const value = wallet[key] !== undefined ? wallet[key] : statistics[key];
      if (value !== undefined) setMoney(key, value, currency);
    });
    ['pendingCommissions', 'paidCommissions'].forEach((key) => { if (referrals[key] !== undefined) setMoney(key, referrals[key], currency); });
    if (statistics.transactionCount !== undefined) setStat('transactionCount', statistics.transactionCount);
    if (referrals.joinedCount !== undefined) setStat('joinedCount', referrals.joinedCount);
    if (referrals.verifiedCount !== undefined) setStat('verifiedReferrals', referrals.verifiedCount);
    const referralUrl = referrals.url || referrals.referralUrl || '';
    if (referralUrl) { $('#referralUrl').value = referralUrl; $('#copyReferral').disabled = false; }
    setStatus('Your account data has loaded from the secure service.', true);
  }

  async function loadDashboard() {
    if (!token) {
      setStatus('Sign in to continue. Redirecting to secure account access…');
      setTimeout(() => window.location.replace('auth.html'), 700);
      return;
    }
    try {
      const response = await fetch(`${API_BASE}/api/me/dashboard`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        credentials: 'include',
        cache: 'no-store'
      });
      const result = await response.json().catch(() => ({}));
      if (response.status === 401 || response.status === 403) {
        try { sessionStorage.removeItem('onlineSphereSession'); localStorage.removeItem('onlineSphereToken'); } catch (_) {}
        setStatus('Your session expired. Redirecting to sign in…');
        setTimeout(() => window.location.replace('auth.html'), 700);
        return;
      }
      if (!response.ok) throw new Error(result.message || 'The dashboard service is temporarily unavailable.');
      showDashboard(result.dashboard || result);
    } catch (error) {
      setStatus(`${error.message} No sample financial data is being shown.`);
    }
  }

  const greeting = $('#greeting');
  if (greeting) greeting.textContent = `GOOD ${new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).format(new Date()).toUpperCase().includes('PM') ? 'EVENING' : 'DAY'}`;
  $('#loadMore')?.addEventListener('click', (event) => {
    const more = [...document.querySelectorAll('.extra-service')];
    const opening = more.some((item) => item.hidden);
    more.forEach((item) => { item.hidden = !opening; });
    event.currentTarget.innerHTML = opening ? 'Show less <span>⌃</span>' : 'Load more <span>⌄</span>';
  });
  $('#copyReferral')?.addEventListener('click', async () => {
    const input = $('#referralUrl');
    if (!input.value || input.value.startsWith('Sign in')) return;
    try { await navigator.clipboard.writeText(input.value); showToast('Referral link copied.'); }
    catch (_) { input.select(); document.execCommand('copy'); showToast('Referral link copied.'); }
  });
  document.querySelectorAll('[data-not-ready]').forEach((button) => button.addEventListener('click', () => showToast(button.dataset.notReady)));
  $('#profileButton')?.addEventListener('click', () => { const menu = $('#profileMenu'); menu.hidden = !menu.hidden; });
  document.addEventListener('click', (event) => { if (!event.target.closest('.top-actions') && $('#profileMenu')) $('#profileMenu').hidden = true; });
  $('#signOutButton')?.addEventListener('click', async () => {
    try {
      await fetch(`${API_BASE}/api/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, credentials: 'include' });
    } catch (_) {}
    try { sessionStorage.removeItem('onlineSphereSession'); localStorage.removeItem('onlineSphereToken'); } catch (_) {}
    window.location.replace('auth.html');
  });
  loadDashboard();
})();
