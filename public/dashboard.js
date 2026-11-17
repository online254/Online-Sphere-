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
    renderNotifications(dashboard.notifications || []);
  };
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const notificationIcon = (type) => ({ opportunity: '◇', application: '✓', submission: '▣', payment: 'KSh', membership: '★', admin: '!' }[String(type || '').toLowerCase()] || '•');
  const renderNotificationItems = (notifications, limit) => {
    const rows = notifications.slice(0, limit);
    return rows.length ? rows.map((item) => `<article class="notification-item ${item.read_at ? '' : 'unread'}"><span class="notification-type-icon" aria-hidden="true">${notificationIcon(item.type)}</span><div><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.message)}</p><small>${new Date(item.created_at).toLocaleString()}</small>${item.read_at ? '' : `<button type="button" class="notification-read" data-notification-read="${item.id}">Mark as read</button>`}</div></article>`).join('') : '<p class="panel-description">No notifications.</p>';
  };
  const renderNotifications = (notifications) => {
    const count = notifications.filter((item) => !item.read_at).length;
    const badge = $('#notificationCount');
    if (badge) { badge.hidden = count === 0; badge.textContent = count > 99 ? '99+' : String(count); }
    const panel = $('#notificationPanelList');
    if (panel) panel.innerHTML = renderNotificationItems(notifications, 30);
    const dashboardList = $('#notificationList');
    if (dashboardList) dashboardList.innerHTML = renderNotificationItems(notifications, 8);
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
    renderNotifications(data.notifications || []);
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
  });
  async function markAllNotificationsRead() {
    const response = await fetch(`${API_BASE}/api/me/notifications/read-all`, { method: 'POST', credentials: 'include' });
    if (!response.ok) throw new Error('Notifications could not be updated.');
    loadDashboard();
  }
  $('#markAllRead')?.addEventListener('click', () => markAllNotificationsRead().catch((error) => showToast(error.message)));
  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-notification-read]');
    if (!button) return;
    fetch(`${API_BASE}/api/me/notifications/${encodeURIComponent(button.dataset.notificationRead)}/read`, { method: 'POST', credentials: 'include' })
      .then((response) => { if (!response.ok) throw new Error('Notification could not be updated.'); return response; })
      .then(() => loadDashboard())
      .catch((error) => showToast(error.message));
  });
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.top-actions')) {
      const menu = $('#notificationMenu');
      if (menu) menu.hidden = true;
    }
  });
  loadDashboard();
  setInterval(loadDashboard, 15000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) loadDashboard(); });
})();
