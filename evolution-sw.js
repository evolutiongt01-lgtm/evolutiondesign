/* Evolution Design · Service Worker · v14 · Redirect Fix */

const VERSION = 'evolution-v14-nav-redirect-fix';
const PAGES = `${VERSION}-pages`;
const ASSETS = `${VERSION}-assets`;

const PUBLIC = [
  '/',
  '/index.html',
  '/arquitectura',
  '/arquitectura.html',
  '/diseno-grafico',
  '/diseno-grafico.html',
  '/diseno-web',
  '/diseno-web.html',
  '/sobre-nosotros',
  '/sobre-nosotros.html',
  '/feedback',
  '/feedback.html'
];

const PRELOAD = [
  '/index.html',
  '/arquitectura.html',
  '/diseno-grafico.html',
  '/diseno-web.html',
  '/evolution-nav.js',
  '/img/logo.png',
  '/manifest.webmanifest'
];

const PRIVATE = [
  '/proyectos',
  '/perfil',
  '/admin',
  '/portal',
  '/account',
  '/checkout',
  '/payment',
  '/pago',
  '/login',
  '/api/',
  '/recaptcha',
  '/__/auth',
  '/__/firebase'
];

const privatePath = pathname =>
  PRIVATE.some(part =>
    pathname.toLowerCase().includes(part)
  );

const assetPath = pathname =>
  pathname === '/evolution-nav.js' ||
  pathname === '/manifest.webmanifest' ||
  pathname.startsWith('/img/') ||
  pathname.startsWith('/css/') ||
  pathname.startsWith('/js/') ||
  pathname.startsWith('/fonts/') ||
  pathname.startsWith('/assets/');


async function normalizeResponse(response) {

  if (!response) {
    return null;
  }

  if (!response.redirected) {
    return response;
  }

  try {

    const finalURL = new URL(response.url);

    if (finalURL.origin !== self.location.origin) {
      return null;
    }

    const body = await response.clone().arrayBuffer();
    const headers = new Headers(response.headers);

    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers
    });

  } catch (error) {

    console.warn(
      'Evolution SW · redirect normalize failed',
      error
    );

    return null;
  }
}


async function fetchNormalized(request, options = {}) {

  const response = await fetch(request, {
    ...options,
    redirect: 'follow'
  });

  return normalizeResponse(response);
}


async function networkFirst(request) {

  const cache = await caches.open(PAGES);

  try {

    const fresh = await fetchNormalized(
      request,
      {
        cache: 'no-store'
      }
    );

    if (fresh && fresh.ok) {

      await cache.put(
        request,
        fresh.clone()
      );

      return fresh;
    }

    throw new Error('NETWORK_RESPONSE_INVALID');

  } catch (error) {

    const cached = await cache.match(
      request,
      {
        ignoreSearch: true
      }
    );

    if (cached) {
      return cached;
    }

    const url = new URL(request.url);
    const pathname = url.pathname;

    let alias = '';

    if (pathname.endsWith('.html')) {
      alias = pathname.slice(0, -5);
    } else if (
      pathname !== '/' &&
      !pathname.includes('.')
    ) {
      alias = `${pathname}.html`;
    }

    if (alias) {

      const aliasCached = await cache.match(
        alias,
        {
          ignoreSearch: true
        }
      );

      if (aliasCached) {
        return aliasCached;
      }
    }

    return new Response(
      `<!doctype html>
      <html lang="es">
      <head>
        <meta charset="utf-8">
        <meta
          name="viewport"
          content="width=device-width,initial-scale=1"
        >
        <title>Evolution Design</title>
      </head>
      <body style="
        margin:0;
        min-height:100vh;
        display:grid;
        place-items:center;
        background:#050505;
        color:#fff;
        font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
      ">
        <div style="text-align:center;padding:32px">
          <strong style="font-size:20px">
            Sin conexión
          </strong>
          <p style="
            margin:10px 0 0;
            color:#85858d;
            font-size:14px;
          ">
            Conéctate a internet e inténtalo nuevamente.
          </p>
        </div>
      </body>
      </html>`,
      {
        status: 503,
        headers: {
          'content-type':
            'text/html;charset=utf-8',
          'cache-control':
            'no-store'
        }
      }
    );
  }
}


async function staleAsset(request) {

  const cache = await caches.open(ASSETS);

  const cached = await cache.match(
    request,
    {
      ignoreSearch: true
    }
  );

  const update = fetchNormalized(
    request,
    {
      cache: 'no-store'
    }
  )
  .then(async fresh => {

    if (fresh && fresh.ok) {

      await cache.put(
        request,
        fresh.clone()
      );

      return fresh;
    }

    return null;
  })
  .catch(() => null);

  if (cached) {

    update.catch(() => {});

    return cached;
  }

  const fresh = await update;

  return fresh || Response.error();
}


self.addEventListener(
  'install',
  event => {

    self.skipWaiting();

    event.waitUntil(
      (async () => {

        const pageCache =
          await caches.open(PAGES);

        const assetCache =
          await caches.open(ASSETS);

        await Promise.allSettled(

          PRELOAD.map(
            async url => {

              const request =
                new Request(
                  url,
                  {
                    cache: 'reload'
                  }
                );

              const response =
                await fetchNormalized(
                  request,
                  {
                    cache: 'no-store'
                  }
                );

              if (
                !response ||
                !response.ok
              ) {
                return;
              }

              const pathname =
                new URL(
                  url,
                  self.location.origin
                ).pathname;

              if (assetPath(pathname)) {

                await assetCache.put(
                  url,
                  response.clone()
                );

              } else {

                await pageCache.put(
                  url,
                  response.clone()
                );

                if (pathname.endsWith('.html')) {

                  const pretty =
                    pathname.slice(0, -5);

                  if (pretty) {

                    await pageCache.put(
                      pretty,
                      response.clone()
                    );
                  }
                }
              }
            }
          )
        );
      })()
    );
  }
);


self.addEventListener(
  'activate',
  event => {

    event.waitUntil(
      (async () => {

        const keys =
          await caches.keys();

        await Promise.all(

          keys
            .filter(
              key =>
                key.startsWith('evolution') &&
                !key.startsWith(VERSION)
            )
            .map(
              key =>
                caches.delete(key)
            )
        );

        await self.clients.claim();
      })()
    );
  }
);


self.addEventListener(
  'fetch',
  event => {

    const request =
      event.request;

    if (request.method !== 'GET') {
      return;
    }

    const url =
      new URL(request.url);

    if (
      url.origin !==
      self.location.origin
    ) {
      return;
    }


    if (
      privatePath(url.pathname)
    ) {

      event.respondWith(
        fetch(request)
      );

      return;
    }


    if (
      request.mode === 'navigate'
    ) {

      event.respondWith(
        networkFirst(request)
      );

      return;
    }


    if (
      assetPath(url.pathname)
    ) {

      event.respondWith(
        staleAsset(request)
      );
    }
  }
);
