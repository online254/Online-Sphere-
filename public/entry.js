/* Online Sphere entry: show the intro, then open the local account page. */
(() => {
  'use strict';
  const INTRO_MS = 7000;
  const started = performance.now();
  const status = document.getElementById('bootStatus');
  if (status) status.textContent = 'Opening account access…';
  setTimeout(() => window.location.replace('./public/auth.html'), Math.max(0, INTRO_MS - (performance.now() - started)));
})();
