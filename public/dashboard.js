/* Member dashboard entry. Uses authoritative backend account data. */
(() => {
  'use strict';
  const API_BASE = String(window.ONLINE_SPHERE_API_URL || 'https://online-sphere-backend.onrender.com').replace(/\/$/, '');
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

  const renderRecords = (dashboard) => {
    const transactions = $('#transactionList');
    if (transactions) {
      const rows = (dashboard.transactions || []).slice(0, 8);
      transactions.innerHTML = rows.length
        ? `<h3>Recent transactions</h3>${rows.map((item) => `<p><strong>${String(item.type || '').replaceAll('_', ' ')}</strong> · KSh ${Number(item.amount || 0).toLocaleString('en-KE')} · ${item.status || 'pending'}<br><small>${item.description || item.reference || ''}</small></p>`).join('')}`
        : '<p class="panel-description">No transactions recorded yet.</p>';
    }
    const notifications = $('#notificationList');
    if (notifications) {
      const rows = (dashboard.notifications || []).slice(0, 8);
      notifications.innerHTML = rows.length
        ? rows.map((item) => `<p><strong>${item.title}</strong><br>${item.message}<br><small>${new Date(item.created_at).toLocaleString()}</small></p>`).join('')
        : '<p class="panel-description">No account notifications.</p>';
    }
    const opportunityList = $('#opportunityList');
    if (opportunityList) {
      const opportunities = (dashboard.opportunities || []).slice(0, 6);
      opportunityList.innerHTML = opportunities.length ? opportunities.map((item) => `<article class="opportunity-card"><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.description)}</p><div class="opportunity-meta"><span>${escapeHtml(item.category)}</span><span>${escapeHtml(item.payment_currency || 'KES')} ${Number(item.payment_amount || 0).toLocaleString()}</span><span>Deadline: ${item.application_deadline ? new Date(item.application_deadline).toLocaleDateString() : 'Open'}</span></div><div class="opportunity-actions"><button type="button" data-opportunity-details="${item.id}">View details</button><button type="button" class="apply" data-opportunity-apply="${item.id}">Apply now</button></div></article>`).join('') : '<p class="panel-description">No published opportunities are currently available.</p>';
    }
  };
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const renderNotificationMenu = (notifications) => {
    const count = notifications.filter((item) => !item.read_at).length;
    const badge = $('#notificationCount');
    if (badge) { badge.hidden = count === 0; badge.textContent = count > 99 ? '99+' : String(count); }
    const panel = $('#notificationPanelList');
    if (panel) panel.innerHTML = notifications.length ? notifications.slice(0, 30).map((item) => `<article class="notification-item ${item.read_at ? '' : 'unread'}"><strong>${escapeHtml(item.title)}</strong><br>${escapeHtml(item.message)}<small>${new Date(item.created_at).toLocaleString()}</small></article>`).join('') : '<p class="panel-description">No notifications.</p>';
  };

  async function checkAdminAccess() {
    const tab = $('#adminDashboardTab');
    if (!tab) return;
    try {
      const response = await fetch(`${API_BASE}/api/admin/access`, { credentials: 'include', cache: 'no-store' });
      tab.hidden = !response.ok;
    } catch (_) {
      tab.hidden = true;
    }
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

    renderRecords(data);
    renderNotificationMenu(data.notifications || []);
    setStatus('Your account data is synchronized with the live service.', true);
  }

  async function loadDashboard() {
    try {
      const response = await fetch(`${API_BASE}/api/me/dashboard`, { credentials: 'include', cache: 'no-store' });
      const result = await response.json().catch(() => ({}));
      if (response.status === 401 || response.status === 403) {
        setStatus('Your session expired. Redirecting to sign in…');
        setTimeout(() => window.location.replace('auth.html'), 700);
        return;
      }
      if (!response.ok) throw new Error(result.message || 'The dashboard service is temporarily unavailable.');
      showDashboard(result.dashboard || result);
      checkAdminAccess();
    } catch (error) {
      setStatus(error.message, false);
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
  $('#signOutButton')?.addEventListener('click', async () => {
    await fetch(`${API_BASE}/api/auth/logout`, { method: 'POST', credentials: 'include' }).catch(() => {});
    window.location.replace('auth.html');
  });
  $('#notificationButton')?.addEventListener('click', async (event) => {
    event.stopPropagation();
    const menu = $('#notificationMenu');
    if (!menu) return;
    menu.hidden = !menu.hidden;
    if (!menu.hidden) {
      await fetch(`${API_BASE}/api/me/notifications/read-all`, { method: 'POST', credentials: 'include' }).catch(() => {});
      document.querySelectorAll('.notification-item').forEach((item) => item.classList.remove('unread'));
      const badge = $('#notificationCount');
      if (badge) badge.hidden = true;
    }
  });
  $('#markAllRead')?.addEventListener('click', async () => {
    await fetch(`${API_BASE}/api/me/notifications/read-all`, { method: 'POST', credentials: 'include' }).catch(() => {});
    document.querySelectorAll('.notification-item').forEach((item) => item.classList.remove('unread'));
    const badge = $('#notificationCount');
    if (badge) badge.hidden = true;
  });
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.top-actions')) {
      const menu = $('#notificationMenu');
      if (menu) menu.hidden = true;
    }
  });
  $('#opportunityList')?.addEventListener('click', async (event) => {
    const apply = event.target.closest('[data-opportunity-apply]');
    const details = event.target.closest('[data-opportunity-details]');
    const id = apply?.dataset.opportunityApply || details?.dataset.opportunityDetails;
    if (!id) return;
    if (details) {
      const card = details.closest('.opportunity-card');
      showToast(card?.querySelector('p')?.textContent || 'Opportunity details loaded.');
      return;
    }
    try {
      const response = await fetch(`${API_BASE}/api/opportunities/${id}/apply`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || 'Application could not be submitted.');
      showToast(data.message || 'Application submitted.');
      loadDashboard();
    } catch (error) { showToast(error.message); }
  });

  loadDashboard();
  setInterval(loadDashboard, 15000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) loadDashboard(); });
})();
