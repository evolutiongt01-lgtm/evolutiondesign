/* Evolution Design · Advanced App Shell Service Worker · v50.74 · optical liquid glass */
const VERSION='evolution-smart-app-v50.74-optical-liquid-glass';
const APP_BUILD=82;
const SHELL=`${VERSION}-shell`;
const VIEWS=`${VERSION}-views`;
const ASSETS=`${VERSION}-assets`;
const IMAGES=`${VERSION}-images`;

const SHELL_FILES=[
  '/',
  '/index.html','/arquitectura.html','/diseno-grafico.html','/diseno-web.html','/portafolio.html','/dispositivos.html','/academia.html','/curso-autocad-intermedio.html',
  '/evolution-nav.js','/evolution-app.js','/evolution-payments.js','/evolution-project-files.js','/evolution-presence.js','/evolution-academy-chat.js','/evolution-sw.js',
  '/img/logo.png','/manifest.webmanifest',
  '/img/evolution-android-any-v3-192.png','/img/evolution-android-any-v3-512.png',
  '/img/evolution-android-maskable-v3-192.png','/img/evolution-android-maskable-v3-512.png',
  '/img/evolution-launch-mark-v3.png'
];

const VIEW_FILES=[
  '/views/home.html',
  '/views/arquitectura.html',
  '/views/diseno-grafico.html',
  '/views/diseno-web.html',
  '/views/portafolio.html',
  '/views/dispositivos.html'
];

const PRIVATE=[
  '/proyectos','/perfil','/admin','/portal','/account',
  '/checkout','/payment','/pago','/login','/diploma','/academy',
  '/api/','/recaptcha','/__/auth','/__/firebase'
];

const isPrivate=p=>PRIVATE.some(x=>p.toLowerCase().includes(x));
const isShellPath=p=>['/','/index.html','/arquitectura','/arquitectura.html','/diseno-grafico','/diseno-grafico.html','/diseno-web','/diseno-web.html','/portafolio','/portafolio.html','/dispositivos','/dispositivos.html','/academia','/academia.html','/curso-autocad-intermedio','/curso-autocad-intermedio.html'].includes(p);
const shellAlias=p=>p==='/arquitectura'?'/arquitectura.html':p==='/diseno-grafico'?'/diseno-grafico.html':p==='/diseno-web'?'/diseno-web.html':p==='/portafolio'?'/portafolio.html':p==='/dispositivos'?'/dispositivos.html':p==='/academia'?'/academia.html':p==='/curso-autocad-intermedio'?'/curso-autocad-intermedio.html':p;
const isView=p=>p.startsWith('/views/')&&p.endsWith('.html');
const isImage=p=>/\.(png|jpe?g|webp|avif|gif|svg)$/i.test(p)||p.startsWith('/img/');
const isStatic=p=>
  p==='/evolution-nav.js'||
  p==='/evolution-app.js'||
  p==='/evolution-payments.js'||
  p==='/evolution-project-files.js'||
  p==='/evolution-presence.js'|| 
  p==='/evolution-academy-chat.js'||
  p==='/manifest.webmanifest'||
  p.startsWith('/css/')||
  p.startsWith('/js/')||
  p.startsWith('/fonts/')||
  p.startsWith('/assets/');

async function normalizeResponse(res){
  if(!res||!res.ok)return null;
  if(!res.redirected)return res;
  try{
    const final=new URL(res.url);
    if(final.origin!==self.location.origin)return null;
    const body=await res.clone().arrayBuffer();
    return new Response(body,{
      status:res.status,
      statusText:res.statusText,
      headers:new Headers(res.headers)
    });
  }catch(_){
    return null;
  }
}

async function network(request,{reload=false}={}){
  const res=await fetch(request,{
    cache:reload?'reload':'no-cache',
    redirect:'follow'
  });
  return normalizeResponse(res);
}

async function putSafe(cacheName,key,response){
  if(!response||!response.ok)return;
  const cache=await caches.open(cacheName);
  try{await cache.put(key,response.clone())}catch(_){}
}

async function trimCache(cacheName,maxItems){
  try{
    const cache=await caches.open(cacheName);
    const keys=await cache.keys();
    if(keys.length<=maxItems)return;
    const remove=keys.slice(0,keys.length-maxItems);
    await Promise.all(remove.map(key=>cache.delete(key)));
  }catch(_){}
}

async function staleWhileRevalidate(request,cacheName,{maxItems=0}={}){
  const cache=await caches.open(cacheName);
  const cached=await cache.match(request,{ignoreSearch:true});

  const refresh=network(request).then(async fresh=>{
    if(fresh){
      await cache.put(request,fresh.clone());
      if(maxItems)trimCache(cacheName,maxItems);
      return fresh;
    }
    return null;
  }).catch(()=>null);

  if(cached){
    refresh.catch(()=>{});
    return cached;
  }

  return await refresh||Response.error();
}

async function cacheFirst(request,cacheName,{maxItems=0}={}){
  const cache=await caches.open(cacheName);
  const cached=await cache.match(request,{ignoreSearch:true});
  if(cached)return cached;

  const fresh=await network(request).catch(()=>null);
  if(fresh){
    await cache.put(request,fresh.clone());
    if(maxItems)trimCache(cacheName,maxItems);
    return fresh;
  }

  return Response.error();
}

async function shellNavigation(request){
  const cache=await caches.open(SHELL);
  const url=new URL(request.url);

  const cached=
    await cache.match(shellAlias(url.pathname),{ignoreSearch:true})||
    await cache.match(url.pathname,{ignoreSearch:true})||
    await cache.match(request,{ignoreSearch:true})||
    await cache.match('/index.html');

  const refresh=network(request).then(async fresh=>{
    if(fresh){
      await cache.put(shellAlias(url.pathname),fresh.clone());
      return fresh;
    }
    return null;
  }).catch(()=>null);

  if(cached){
    refresh.catch(()=>{});
    return cached;
  }

  return await refresh||Response.error();
}

function cacheNameFor(pathname){
  if(isView(pathname))return VIEWS;
  if(isImage(pathname))return IMAGES;
  if(isStatic(pathname))return ASSETS;
  if(isShellPath(pathname))return SHELL;
  return ASSETS;
}

async function cacheURL(value){
  try{
    const url=new URL(value,self.location.origin);
    if(url.origin!==self.location.origin||isPrivate(url.pathname))return false;

    const req=new Request(url.href,{credentials:'same-origin',cache:'reload'});
    const fresh=await network(req,{reload:true});
    if(!fresh)return false;

    const name=cacheNameFor(url.pathname);
    await putSafe(name,req,fresh);
    if(name===IMAGES)trimCache(IMAGES,90);
    if(name===ASSETS)trimCache(ASSETS,80);
    return true;
  }catch(_){
    return false;
  }
}

async function broadcast(message){
  const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  clients.forEach(client=>client.postMessage(message));
}

self.addEventListener('install',event=>{
  self.skipWaiting();

  event.waitUntil((async()=>{
    const shell=await caches.open(SHELL);
    const views=await caches.open(VIEWS);

    await Promise.allSettled(SHELL_FILES.map(async url=>{
      const req=new Request(url,{cache:'reload'});
      const res=await network(req,{reload:true});
      if(res)await shell.put(url,res.clone());
    }));

    /* Las 5 vistas públicas quedan descargadas localmente desde la instalación. */
    await Promise.allSettled(VIEW_FILES.map(async url=>{
      const req=new Request(url,{cache:'reload'});
      const res=await network(req,{reload:true});
      if(res)await views.put(url,res.clone());
    }));
  })());
});

self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(
      keys
        .filter(k=>k.startsWith('evolution')&&!k.startsWith(VERSION))
        .map(k=>caches.delete(k))
    );

    await self.clients.claim();
    await broadcast({
      type:'EVOLUTION_SW_ACTIVATED',
      version:VERSION,
      build:APP_BUILD
    });
    await broadcast({
      type:'EVOLUTION_UPDATE_READY',
      version:VERSION,
      build:APP_BUILD
    });
  })());
});

self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET')return;

  const url=new URL(req.url);
  if(url.origin!==self.location.origin)return;

  /* Release metadata: siempre desde red real. */
  if(url.pathname==='/evolution-version.json'){
    event.respondWith(fetch(req,{cache:'no-store'}));
    return;
  }

  /* Speed probe: siempre mide red real, nunca caché. */
  if(url.searchParams.has('evo-probe')){
    event.respondWith(fetch(req,{cache:'no-store'}));
    return;
  }

  if(isPrivate(url.pathname)){
    event.respondWith(fetch(req));
    return;
  }

  if(req.mode==='navigate'){
    if(isShellPath(url.pathname)){
      event.respondWith(shellNavigation(req));
      return;
    }
    if(isView(url.pathname)){
      event.respondWith(staleWhileRevalidate(req,VIEWS));
      return;
    }
    return;
  }

  if(isView(url.pathname)){
    event.respondWith(staleWhileRevalidate(req,VIEWS));
    return;
  }

  if(isImage(url.pathname)){
    event.respondWith(cacheFirst(req,IMAGES,{maxItems:90}));
    return;
  }

  if(isStatic(url.pathname)){
    event.respondWith(staleWhileRevalidate(req,ASSETS,{maxItems:80}));
  }
});

self.addEventListener('message',event=>{
  const data=event.data||{};

  if(data.type==='SKIP_WAITING'){
    self.skipWaiting();
    return;
  }

  if(data.type==='GET_VERSION'){
    event.source?.postMessage({type:'EVOLUTION_SW_ACTIVATED',version:VERSION,build:APP_BUILD});
    return;
  }

  if(data.type==='CACHE_URLS'&&Array.isArray(data.urls)){
    event.waitUntil((async()=>{
      for(const value of data.urls.slice(0,12)){
        const ok=await cacheURL(value);
        if(ok)event.source?.postMessage({type:'EVOLUTION_CACHE_READY',url:value,version:VERSION});
      }
    })());
    return;
  }

  if(data.type==='CLEAR_EVOLUTION_CACHES'){
    event.waitUntil((async()=>{
      const keys=await caches.keys();
      await Promise.all(keys.filter(k=>k.startsWith('evolution')).map(k=>caches.delete(k)));
      event.source?.postMessage({type:'EVOLUTION_CACHES_CLEARED',version:VERSION});
    })());
  }
});
