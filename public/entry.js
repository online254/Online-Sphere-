/* Online Sphere entry: show the intro, then validate a saved session before selecting dashboard or sign-in. */
(() => {
  'use strict';
  const API_BASE = String(window.ONLINE_SPHERE_API_URL || 'https://online-sphere-backend.onrender.com').replace(/\/$/, '');
  const INTRO_MS = 7000;
  const started = performance.now();
  const status = document.getElementById('bootStatus');
  const authCheck = fetch(`${API_BASE}/api/auth/me`, { credentials: 'include', cache: 'no-store' }).then((response) => response.ok).catch(() => false);
  if (status) status.textContent = 'Checking your secure session…';
  Promise.race([authCheck, new Promise((resolve) => setTimeout(() => resolve(false), INTRO_MS))]).then((valid) => {
    const wait = Math.max(0, INTRO_MS - (performance.now() - started));
    if (status && !valid) status.textContent = 'Opening secure account access…';
    setTimeout(() => {
      window.location.replace(valid ? './public/dashboard.html' : './public/auth.html');
    }, wait);
  });
})();
