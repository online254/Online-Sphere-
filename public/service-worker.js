const CACHE_NAME = "online-sphere-v2";

const APP_FILES = [
  "./",
  "./index.html",
  "./manifest.json"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(APP_FILES)
    )
  );

  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );

  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  // Never intercept form submissions or other non-GET requests.
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Keep external services, including the M-Pesa backend, online.
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then(async (response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, copy);
          });
        }

        // Apply the shared design to every same-origin HTML page without
        // changing page scripts, forms, or the original response stored offline.
        const contentType = response.headers.get("content-type") || "";
        if (request.mode !== "navigate" || !contentType.includes("text/html")) {
          return response;
        }

        const html = await response.text();
        if (html.includes("./theme.css") || html.includes("/theme.css")) {
          return new Response(html, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers
          });
        }

        const themeHref = new URL("./theme.css", self.registration.scope).href;
        const stylesheet = '<link rel="stylesheet" href="' + themeHref + '">';
        const themedHtml = html.replace(/<\/head\s*>/i, stylesheet + "</head>");
        const headers = new Headers(response.headers);
        headers.delete("content-length");
        headers.delete("content-encoding");

        return new Response(themedHtml, {
          status: response.status,
          statusText: response.statusText,
          headers
        });
      })
      .catch(async () => {
        const cached = await caches.match(request);

        if (cached) return cached;

        if (request.mode === "navigate") {
          return (
            await caches.match("./index.html")
          ) || Response.error();
        }

        return Response.error();
      })
  );
});
