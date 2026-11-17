/* Member dashboard entry. Uses the locally stored account only. */
(() => {
  'use strict';
  const SESSION_KEY = 'onlineSphereCurrentUser';
  const $ = (selector) => document.querySelector(selector);
  const statusBox = $('#loadState');
  const statusMessage = $('#loadMessage');

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

  function showDashboard(data, authenticatedUser = {}) {
    const user = { ...(data.user || {}), ...authenticatedUser };
    const membership = data.membership || {};
    const wallet = data.wallet || {};
    const statistics = data.statistics || {};
    const referrals = data.referrals || {};
    const fullName = user.fullName || user.full_name || '';

    const memberName = $('#memberName');
    const profileButton = $('#profileButton');
    const menuName = $('#menuName');
    if (fullName) {
      if (memberName) memberName.textContent = fullName.split(/\s+/)[0];
      if (profileButton) profileButton.textContent = fullName.trim().split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase();
      if (menuName) menuName.textContent = fullName;
    }

    const level = membership.name || membership.package || 'No active plan';
    const memberLevel = $('#memberLevel');
    const serviceLevel = $('#serviceLevel');
    const memberStatus = $('#memberStatus');
    const accountStatus = $('#accountStatus');
    const joinedDate = $('#joinedDate');
    const sponsorName = $('#sponsorName');

    if (memberLevel) memberLevel.textContent = String(level).toUpperCase();
    if (serviceLevel) serviceLevel.textContent = `${String(level).toUpperCase()} MEMBER`;
    if (memberStatus) memberStatus.textContent = membership.status || user.status || 'Status unavailable';
    if (accountStatus) accountStatus.textContent = user.status || membership.status || '—';

    const created = user.createdAt || user.created_at;
    if (joinedDate) joinedDate.textContent = created ? new Date(created).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
    if (sponsorName) sponsorName.textContent = referrals.sponsorName || referrals.sponsor_name || '—';

    const rank = { bronze: 1, silver: 2, gold: 3 }[String(level).toLowerCase()] || 0;
    document.querySelectorAll('.lock-indicator').forEach((icon) => {
      const min = icon.dataset.min.toLowerCase();
      const locked = !membership.active || rank < ({ bronze: 1, silver: 2, gold: 3 }[min] || 99);
      const tile = icon.closest('.service-tile');
      if (!tile) return;
      tile.classList.toggle('is-locked', locked);
      icon.textContent = locked ? '⌑' : '↗';
      if (locked) {
        const labelTarget = tile.querySelector('span:nth-child(2)');
        tile.setAttribute('aria-label', `${labelTarget ? labelTarget.textContent : 'Service'} requires an active ${icon.dataset.min} membership. Select to view membership options.`);
      } else {
        tile.removeAttribute('aria-label');
      }
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
    const referralInput = $('#referralUrl');
    const copyReferralButton = $('#copyReferral');
    if (referralUrl) {
      if (referralInput) referralInput.value = referralUrl;
      if (copyReferralButton) copyReferralButton.disabled = false;
    }

    setStatus('Your account is stored on this device.', true);
  }

  function loadDashboard() {
    let user = null;
    try { user = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch (_) {}
    if (!user) {
      setStatus('No local account is signed in. Redirecting to sign in…');
      setTimeout(() => window.location.replace('auth.html'), 700);
      return;
    }
    showDashboard({
      user: { ...user, createdAt: user.createdAt || new Date().toISOString(), status: 'Local account' },
      membership: { name: null, status: 'Not connected', active: false },
      wallet: { currency: 'KES', walletBalance: 0, availableBalance: 0, pendingBalance: 0, totalDeposited: 0, totalWithdrawn: 0, totalEarnings: 0 },
      statistics: { transactionCount: 0, todayEarnings: 0 },
      referrals: { joinedCount: 0, verifiedCount: 0 }
    });
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
    if (!input || !input.value || input.value.startsWith('Sign in')) return;
    try { await navigator.clipboard.writeText(input.value); showToast('Referral link copied.'); }
    catch (_) { input.select(); document.execCommand('copy'); showToast('Referral link copied.'); }
  });

  document.querySelectorAll('[data-not-ready]').forEach((button) => button.addEventListener('click', () => showToast(button.dataset.notReady)));
  $('#profileButton')?.addEventListener('click', (event) => {
    event.stopPropagation();
    const menu = $('#profileMenu');
    if (menu) menu.hidden = !menu.hidden;
  });
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.top-actions')) {
      const menu = $('#profileMenu');
      if (menu) menu.hidden = true;
    }
  });
  $('#signOutButton')?.addEventListener('click', () => {
    localStorage.removeItem(SESSION_KEY);
    window.location.replace('auth.html');
  });

  loadDashboard();
})();
