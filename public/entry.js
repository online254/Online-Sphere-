/* Online Sphere boot screen: finish the logo intro after exactly seven seconds, then route into the member app. */
(() => {
  'use strict';

  const INTRO_DURATION_MS = 7000;
  const startedAt = performance.now();
  const status = document.getElementById('bootStatus');

  function hasExistingSession() {
    try {
      // Keep compatibility with the current authentication page and dashboard.
      return Boolean(
        localStorage.getItem('onlineSphereToken') ||
        sessionStorage.getItem('onlineSphereSession')
      );
    } catch (_) {
      return false;
    }
  }

  const authenticated = hasExistingSession();
  if (status) {
    status.textContent = authenticated
      ? 'Opening your dashboard…'
      : 'Preparing secure account access…';
  }

  const remaining = Math.max(0, INTRO_DURATION_MS - (performance.now() - startedAt));
  window.setTimeout(() => {
    window.location.replace(
      authenticated ? './public/dashboard.html' : './public/auth.html'
    );
  }, remaining);
})();
