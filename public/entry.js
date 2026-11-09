/* Online Sphere entry: show the intro, then validate a saved session before selecting dashboard or sign-in. */
(() => {
  'use strict';
  const API_BASE = String(window.ONLINE_SPHERE_API_URL || 'https://online-sphere-backend.onrender.com').replace(/\/$/, '');
  const INTRO_MS = 7000;
  const started = performance.now();
  const status = document.getElementById('bootStatus');
  let token = '';
  try { token = sessionStorage.getItem('onlineSphereSession') || localStorage.getItem('onlineSphereToken') || ''; } catch (_) {}
  const authCheck = token ? fetch(`${API_BASE}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` }, credentials: 'include', cache: 'no-store' }).then((response) => response.ok).catch(() => false) : Promise.resolve(false);
  if (status) status.textContent = token ? 'Checking your secure session…' : 'Preparing secure account access…';
  Promise.race([authCheck, new Promise((resolve) => setTimeout(() => resolve(false), INTRO_MS))]).then((valid) => {
    const wait = Math.max(0, INTRO_MS - (performance.now() - started));
    if (status && token && !valid) status.textContent = 'Opening secure account access…';
    setTimeout(() => {
      if (token && !valid) { try { sessionStorage.removeItem('onlineSphereSession'); localStorage.removeItem('onlineSphereToken'); } catch (_) {} }
      window.location.replace(valid ? './public/dashboard.html' : './public/auth.html');
    }, wait);
  });
})();
