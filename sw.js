// Batimon Service Worker — Network-First strategy
// Every change to the website is immediately reflected in the app.
// Offline fallback: cached version is shown when there is no connection.

const CACHE_NAME = 'batimon-v5';

// Files that should NEVER be cached — always fetched fresh from server
const NO_CACHE = ['/app.js', '/index.html', '/auth.js', '/project.js'];

const SHELL_FILES = [
  '/',
  '/styles.css',
  '/config.js',
  '/ncr.js',
  '/profile.js',
  'https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Barlow:wght@400;500;600;700&display=swap'
];

// ── Install: pre-cache the app shell (excluding app.js & index.html) ─
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return Promise.allSettled(
        SHELL_FILES.map(url =>
          cache.add(url).catch(() => { /* ignore individual failures */ })
        )
      );
    }).then(() => self.skipWaiting())
  );
});

// ── Activate: delete ALL old caches ───────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(k => caches.delete(k)))  // wipe everything
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: Network-First ──────────────────────────────────────────────
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  if (!url.protocol.startsWith('http')) return;

  // Skip Supabase and external API requests
  if (url.hostname.includes('supabase') ||
      (url.hostname.includes('googleapis') && !url.pathname.includes('fonts/css'))) {
    return;
  }

  // app.js and index.html: always bypass cache, go straight to network
  const pathname = url.pathname.replace(/\?.*$/, '');
  if (NO_CACHE.includes(pathname)) {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' }).catch(() =>
        new Response('Offline', { status: 503 })
      )
    );
    return;
  }

  // Everything else: Network-First with cache fallback
  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response && response.status === 200 && response.type !== 'opaque') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() =>
        caches.match(event.request).then(cached => {
          if (cached) return cached;
          if (event.request.mode === 'navigate') return caches.match('/index.html');
          return new Response('Offline', { status: 503 });
        })
      )
  );
});
