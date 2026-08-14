/* Evolution Design · Safari-safe Offline Service Worker
   v6
   - Never serves redirected responses directly.
   - Sanitizes same-origin followed redirects before caching/returning.
   - Deletes all older Evolution caches.
   - Keeps private/auth/payment routes network-only.
*/
const VERSION = 'evolution-app-2026-08-14-v11-shared-navigation';
const PAGE_CACHE = `${VERSION}-pages`;
const ASSET_CACHE = `${VERSION}-assets`;

const PUBLIC = new Set([
  '/',
  '/index.html',
  '/arquitectura.html',
  '/arquitectura',
  '/diseno-grafico.html',
  '/diseno-grafico',
  '/diseno-web.html',
  '/diseno-web',
  '/sobre-nosotros',
  '/sobre-nosotros.html',
  '/feedback',
  '/feedback.html'
]);

const PREPAGES = [
  '/',
  '/index.html',
  '/arquitectura.html',
  '/arquitectura',
  '/diseno-grafico.html',
  '/diseno-grafico',
  '/diseno-web.html'
];

const PREASSETS = [
  '/css/theme.min.css',
  '/img/logo.png',
  '/manifest.webmanifest',
  '/img/evolution-app-icon.png',
  '/img/evolution-app-icon-desktop-v2-192.png',
  '/img/evolution-app-icon-desktop-v2-512.png',
  '/evolution-nav.js'];

const PRIVATE = [
  '/proyectos',
  '/admin',
  '/perfil',
  '/portal',
  '/account',
  '/checkout',
  '/payment',
  '/pago',
  '/login',
  '/recaptcha',
  '/api/',
  '/__/auth',
  '/__/firebase'
];

const isPrivate = pathname =>
  PRIVATE.some(part => pathname.toLowerCase().includes(part));

const isAsset = pathname =>
  pathname.startsWith('/css/') ||
  pathname.startsWith('/js/') ||
  pathname.startsWith('/fonts/') ||
  pathname.startsWith('/img/') ||
  pathname.startsWith('/assets/') ||
  pathname === '/manifest.webmanifest';

/*
 * Safari/WebKit can reject a navigation when a Service Worker returns
 * a Response object whose redirected flag is true.
 *
 * For a followed SAME-ORIGIN redirect, rebuild the final response as a
 * fresh synthetic Response. That preserves the final body/status/headers
 * while `redirected` becomes false.
 */
async function safariSafeResponse(response) {
  if (!response) return null;

  if (!response.redirected) {
    return response;
  }

  let finalURL;
  try {
    finalURL = new URL(response.url);
  } catch (_) {
    return null;
  }

  // Never flatten a cross-origin redirect.
  if (finalURL.origin !== self.location.origin) {
    return null;
  }

  const body = await response.clone().arrayBuffer();

  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: new Headers(response.headers)
  });
}

async function fetchSafe(request, options = {}) {
  const network = await fetch(request, options);
  return safariSafeResponse(network);
}

async function page(request) {
  const cache = await caches.open(PAGE_CACHE);
  const cached = await cache.match(request, { ignoreSearch:true });

  if (cached) {
    // Never trust a poisoned redirect response from an old cache.
    if (cached.redirected) {
      await cache.delete(request, { ignoreSearch:true });
    } else {
      // Refresh quietly in background.
      fetchSafe(request, { cache:'no-cache' })
        .then(async fresh => {
          if (fresh?.ok && fresh.type === 'basic' && !fresh.redirected) {
            await cache.put(request, fresh.clone());
          }
        })
        .catch(() => {});

      return cached;
    }
  }

  try {
    const fresh = await fetchSafe(request, { cache:'no-cache' });

    if (fresh?.ok && fresh.type === 'basic' && !fresh.redirected) {
      await cache.put(request, fresh.clone());
    }

    if (fresh) return fresh;
    throw new Error('Unsafe redirected response');
  } catch (_) {
    // Offline fallback: only return clean cached responses.
    const candidates = [
      await cache.match(request, { ignoreSearch:true }),
      await cache.match('/index.html'),
      await cache.match('/')
    ];

    const clean = candidates.find(r => r && !r.redirected);
    if (clean) return clean;

    return new Response(
      '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;background:#050505;color:#fff;font:16px system-ui;display:grid;place-items:center;min-height:100vh"><div style="max-width:420px;padding:28px;text-align:center"><h1 style="margin:0 0 10px">Evolution</h1><p style="margin:0;color:#8a8a91;line-height:1.6">Sin conexión a internet. Abre una sección que ya hayas visitado.</p></div></body>',
      {
        status:200,
        headers:{'Content-Type':'text/html; charset=utf-8'}
      }
    );
  }
}

async function asset(request) {
  const cache = await caches.open(ASSET_CACHE);
  const cached = await cache.match(request);

  if (cached && !cached.redirected) {
    fetchSafe(request)
      .then(async fresh => {
        if (fresh?.ok && fresh.type === 'basic' && !fresh.redirected) {
          await cache.put(request, fresh.clone());
        }
      })
      .catch(() => {});
    return cached;
  }

  if (cached?.redirected) {
    await cache.delete(request);
  }

  try {
    const fresh = await fetchSafe(request);
    if (fresh?.ok && fresh.type === 'basic' && !fresh.redirected) {
      await cache.put(request, fresh.clone());
    }
    return fresh || Response.error();
  } catch (_) {
    return Response.error();
  }
}

self.addEventListener('install', event => {
  self.skipWaiting();

  event.waitUntil((async () => {
    const pageCache = await caches.open(PAGE_CACHE);
    const assetCache = await caches.open(ASSET_CACHE);

    await Promise.allSettled(
      PREPAGES.map(async url => {
        const request = new Request(url, { cache:'reload' });
        const response = await fetchSafe(request);

        if (response?.ok && response.type === 'basic' && !response.redirected) {
          await pageCache.put(url, response);
        }
      })
    );

    await Promise.allSettled(
      PREASSETS.map(async url => {
        const request = new Request(url, { cache:'reload' });
        const response = await fetchSafe(request);

        if (response?.ok && response.type === 'basic' && !response.redirected) {
          await assetCache.put(url, response);
        }
      })
    );
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // Remove every older Evolution cache, including any poisoned redirect.
    const keep = new Set([PAGE_CACHE, ASSET_CACHE]);
    const keys = await caches.keys();

    await Promise.all(
      keys
        .filter(key =>
          (key.startsWith('evolution-speed-') ||
           key.startsWith('evolution-app-')) &&
          !keep.has(key)
        )
        .map(key => caches.delete(key))
    );

    if ('navigationPreload' in self.registration) {
      try {
        await self.registration.navigationPreload.enable();
      } catch (_) {}
    }

    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Third parties stay fully outside the SW.
  if (url.origin !== self.location.origin) return;

  // Firebase Auth, private pages, projects, payments, APIs stay network-only.
  if (isPrivate(url.pathname)) return;

  if (request.mode === 'navigate' && PUBLIC.has(url.pathname)) {
    event.respondWith((async () => {
      // Navigation preload is already a direct network response.
      // If it was redirected, sanitize it before returning.
      try {
        const preload = await event.preloadResponse;
        if (preload) {
          const safe = await safariSafeResponse(preload);
          if (safe?.ok && !safe.redirected) {
            const cache = await caches.open(PAGE_CACHE);
            await cache.put(request, safe.clone());
            return safe;
          }
        }
      } catch (_) {}

      return page(request);
    })());
    return;
  }

  if (isAsset(url.pathname)) {
    event.respondWith(asset(request));
  }
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  if (event.data?.type === 'CLEAR_EVOLUTION_CACHES') {
    event.waitUntil((async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter(key =>
            key.startsWith('evolution-speed-') ||
            key.startsWith('evolution-app-')
          )
          .map(key => caches.delete(key))
      );
    })());
  }
});
