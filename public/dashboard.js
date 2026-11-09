/* Dashboard data is always read from the authenticated backend; no demo balances or member records are generated here. */
(() => {
  'use strict';
  const API_BASE = String(window.ONLINE_SPHERE_API_URL || '').replace(/\/$/, '');
  const $ = (selector) => document.querySelector(selector);
  const statusBox = $('#loadState');
  const statusMessage = $('#loadMessage');
  const token = () => sessionStorage.getItem('onlineSphereSession') || '';
  const money = (amount, currency = 'KES') => {
    if (amount === null || amount === undefined || !Number.isFinite(Number(amount))) return '—';
    try { return new Intl.NumberFormat('en-KE', { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(amount)); }
    catch (_) { return `${currency} ${Number(amount).toFixed(2)}`; }
  };
  const showToast = (message) => {
    const toast = $('#toast');
    toast.textContent = message;
    toast.classList.add('show');
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => toast.classList.remove('show'), 2600);
  };
  const setStatus = (message, connected = false) => {
    statusMessage.textContent = message;
    statusBox.classList.toggle('connected', connected);
  };
  const setMoney = (key, value, currency = 'KES') => {
    document.querySelectorAll(`[data-money="${key}"]`).forEach((el) => { el.textContent = money(value, currency); });
  };
  const setStat = (key, value) => {
    document.querySelectorAll(`[data-stat="${key}"]`).forEach((el) => { el.textContent = value === null || value === undefined ? '—' : String(value); });
  };
  function displayDashboard(data) {
    const user = data.user || {};
    const membership = data.membership || {};
    const wallet = data.wallet || {};
    const stats = data.statistics || {};
    const referrals = data.referrals || {};
    const name = user.fullName || user.full_name || '';
    if (name) {
      $('#memberName').textContent = name.split(/\s+/)[0];
      $('#profileButton').textContent = name.trim().split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase();
      $('#menuName').textContent = name;
    }
    const level = membership.name || membership.package || 'No active plan';
    $('#memberLevel').textContent = String(level).toUpperCase();
    $('#serviceLevel').textContent = `${String(level).toUpperCase()} MEMBER`;
    $('#memberStatus').textContent = membership.status || user.status || 'Status unavailable';
    $('#accountStatus').textContent = user.status || membership.status || '—';
    $('#joinedDate').textContent = user.createdAt || user.created_at ? new Date(user.createdAt || user.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
    $('#sponsorName').textContent = referrals.sponsorName || referrals.sponsor_name || '—';
    const nameParts = String(level).toLowerCase();
    const rank = { bronze: 1, silver: 2, gold: 3 }[nameParts] || 0;
    document.querySelectorAll('.lock-indicator').forEach((icon) => {
      const min = icon.dataset.min.toLowerCase();
      const required = { bronze: 1, silver: 2, gold: 3 }[min] || 99;
      const locked = !membership.active || rank < required;
      const tile = icon.closest('.service-tile');
      tile.classList.toggle('is-locked', locked);
      icon.textContent = locked ? '⌑' : '↗';
      if (locked) tile.setAttribute('aria-label', `${tile.querySelector('span:nth-child(2)').textContent} requires an active ${icon.dataset.min} membership. Select to view opportunities and membership details.`);
      else tile.removeAttribute('aria-label');
    });
    if (wallet.currency) document.querySelectorAll('[data-money]').forEach((el) => { el.dataset.currency = wallet.currency; });
    ['walletBalance', 'availableBalance', 'pendingBalance', 'totalDeposited', 'totalWithdrawn', 'totalEarnings', 'todayEarnings', 'pendingCommissions', 'paidCommissions'].forEach((key) => {
      const value = wallet[key] !== undefined ? wallet[key] : (referrals[key] !== undefined ? referrals[key] : stats[key]);
      if (value !== undefined) setMoney(key, value, wallet.currency || 'KES');
    });
    if (stats.transactionCount !== undefined) setStat('transactionCount', stats.transactionCount);
    if (referrals.joinedCount !== undefined) setStat('joinedCount', referrals.joinedCount);
    if (referrals.verifiedCount !== undefined) setStat('verifiedReferrals', referrals.verifiedCount);
    const referralUrl = referrals.url || referrals.referralUrl || '';
    if (referralUrl) { $('#referralUrl').value = referralUrl; $('#copyReferral').disabled = false; }
    setStatus('Account data loaded from the secure service.', true);
  }
  async function loadDashboard() {
    if (!token()) {
      setStatus('Sign in to view your live membership, wallet, referral details and account activity. No sample values are shown.');
      return;
    }
    try {
      const response = await fetch(`${API_BASE}/api/me/dashboard`, { headers: { Authorization: `Bearer ${token()}`, Accept: 'application/json' }, credentials: 'include' });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || (response.status === 401 ? 'Your session has expired. Sign in again to continue.' : 'The member dashboard service is not available.'));
      displayDashboard(result.dashboard || result);
    } catch (error) {
      setStatus(`${error.message} Your account data has not been replaced with demo content.`);
    }
  }
  $('#greeting').textContent = `GOOD ${new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).format(new Date()).toUpperCase().includes('PM') ? 'EVENING' : 'DAY'}`;
  $('#loadMore').addEventListener('click', (event) => {
    const more = [...document.querySelectorAll('.extra-service')];
    const opening = more.some((item) => item.hidden);
    more.forEach((item) => { item.hidden = !opening; });
    event.currentTarget.innerHTML = opening ? 'Show less <span>⌃</span>' : 'Load more <span>⌄</span>';
  });
  $('#copyReferral').addEventListener('click', async () => {
    const input = $('#referralUrl');
    if (!input.value || input.value.startsWith('Sign in')) return;
    try { await navigator.clipboard.writeText(input.value); showToast('Referral link copied.'); }
    catch (_) { input.select(); document.execCommand('copy'); showToast('Referral link copied.'); }
  });
  document.querySelectorAll('[data-not-ready]').forEach((button) => button.addEventListener('click', () => showToast(button.dataset.notReady)));
  $('#profileButton').addEventListener('click', () => { const menu = $('#profileMenu'); menu.hidden = !menu.hidden; });
  document.addEventListener('click', (event) => { if (!event.target.closest('.top-actions')) $('#profileMenu').hidden = true; });
  $('#signOutButton').addEventListener('click', () => { sessionStorage.removeItem('onlineSphereSession'); window.location.href = 'login.html'; });
  loadDashboard();
})();
