/* Online Sphere entry gate. The logo animation is visible for 7 seconds, then members land on the dashboard. */
(() => {
  'use strict';
  const INTRO_DURATION_MS = 7000;
  const bootStarted = performance.now();
  const status = document.getElementById('bootStatus');

  function hasSavedSession() {
    try {
      // localStorage token is supported for existing accounts; new auth also supports session tokens.
      return Boolean(localStorage.getItem('onlineSphereToken') || sessionStorage.getItem('onlineSphereSession'));
    } catch (_) {
      return false;
    }
  }

  const authenticated = hasSavedSession();
  if (status) status.textContent = authenticated ? 'Opening your dashboard…' : 'Preparing secure account access…';

  window.setTimeout(() => {
    window.location.replace(authenticated ? './public/dashboard.html' : './public/auth.html');
  }, Math.max(0, INTRO_DURATION_MS - (performance.now() - bootStarted)));
})();
