/* Evolution Design · Service Worker · v13 */

const VERSION='evolution-v13-nav';

const PAGES=`${VERSION}-pages`;
const ASSETS=`${VERSION}-assets`;

const PUBLIC=[
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

const PRELOAD=[
  '/index.html',
  '/arquitectura.html',
  '/diseno-grafico.html',
  '/diseno-web.html',

  '/evolution-nav.js',

  '/img/logo.png',
  '/manifest.webmanifest'
];

const PRIVATE=[
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

const privatePath=p=>
  PRIVATE.some(x=>
    p.toLowerCase().includes(x)
  );

const assetPath=p=>
  p==='/evolution-nav.js' ||
  p==='/manifest.webmanifest' ||
  p.startsWith('/img/') ||
  p.startsWith('/css/') ||
  p.startsWith('/js/') ||
  p.startsWith('/fonts/') ||
  p.startsWith('/assets/');


async function safeFetch(req,options){

  const res=await fetch(req,options);

  if(!res.redirected){
    return res;
  }

  try{

    const url=new URL(res.url);

    if(url.origin!==self.location.origin){
      return null;
    }

    const body=
      await res.clone().arrayBuffer();

    return new Response(body,{
      status:res.status,
      statusText:res.statusText,
      headers:new Headers(res.headers)
    });

  }catch(_){

    return null;

  }
}


async function networkFirst(req){

  const cache=
    await caches.open(PAGES);

  try{

    const fresh=
      await safeFetch(req,{
        cache:'no-cache'
      });

    if(
      fresh?.ok &&
      fresh.type==='basic'
    ){

      await cache.put(
        req,
        fresh.clone()
      );

      return fresh;
    }

    throw new Error('network');

  }catch(_){

    return (
      await cache.match(
        req,
        {ignoreSearch:true}
      )
    )
    ||
    (
      await cache.match(
        '/index.html'
      )
    )
    ||
    new Response(
      `<!doctype html>
      <meta charset="utf-8">

      <meta
        name="viewport"
        content="width=device-width,initial-scale=1"
      >

      <body
        style="
          margin:0;
          background:#050505;
          color:#fff;
          font:16px system-ui;
          display:grid;
          place-items:center;
          min-height:100vh
        "
      >
        Sin conexión
      </body>`,
      {
        headers:{
          'content-type':
          'text/html;charset=utf-8'
        }
      }
    );

  }
}


async function staleAsset(req){

  const cache=
    await caches.open(ASSETS);

  const cached=
    await cache.match(
      req,
      {ignoreSearch:true}
    );

  const update=
    safeFetch(req,{
      cache:'no-cache'
    })
    .then(async fresh=>{

      if(
        fresh?.ok &&
        fresh.type==='basic'
      ){

        await cache.put(
          req,
          fresh.clone()
        );

        return fresh;
      }

      return null;

    })
    .catch(()=>null);

  return (
    cached ||
    await update ||
    Response.error()
  );
}


self.addEventListener(
  'install',
  event=>{

    self.skipWaiting();

    event.waitUntil(
      (async()=>{

        const pageCache=
          await caches.open(PAGES);

        const assetCache=
          await caches.open(ASSETS);

        await Promise.allSettled(

          PRELOAD.map(
            async url=>{

              const req=
                new Request(
                  url,
                  {cache:'reload'}
                );

              const res=
                await safeFetch(req);

              if(
                !res?.ok ||
                res.type!=='basic'
              ){
                return;
              }

              if(
                assetPath(
                  new URL(
                    url,
                    self.location.origin
                  ).pathname
                )
              ){

                await assetCache.put(
                  url,
                  res
                );

              }else{

                await pageCache.put(
                  url,
                  res
                );

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
  event=>{

    event.waitUntil(
      (async()=>{

        const keys=
          await caches.keys();

        await Promise.all(

          keys
          .filter(
            k=>
              k.startsWith('evolution') &&
              !k.startsWith(VERSION)
          )
          .map(
            k=>caches.delete(k)
          )
        );

        await self.clients.claim();

      })()
    );

  }
);


self.addEventListener(
  'fetch',
  event=>{

    const req=
      event.request;

    if(req.method!=='GET'){
      return;
    }

    const url=
      new URL(req.url);

    if(
      url.origin !==
      self.location.origin
    ){
      return;
    }


    if(
      privatePath(
        url.pathname
      )
    ){

      event.respondWith(
        fetch(req)
      );

      return;
    }


    if(
      req.mode==='navigate'
    ){

      if(
        PUBLIC.includes(
          url.pathname
        )
        ||
        url.pathname.endsWith(
          '.html'
        )
      ){

        event.respondWith(
          networkFirst(req)
        );

      }

      return;
    }


    if(
      assetPath(
        url.pathname
      )
    ){

      event.respondWith(
        staleAsset(req)
      );

    }

  }
);
