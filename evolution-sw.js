/* Evolution Design · App Shell Service Worker · v16 */
const VERSION='evolution-app-shell-v16';
const SHELL=`${VERSION}-shell`;
const RUNTIME=`${VERSION}-runtime`;

const SHELL_FILES=[
  '/',
  '/index.html','/arquitectura.html','/diseno-grafico.html','/diseno-web.html',
  '/views/home.html','/views/arquitectura.html','/views/diseno-grafico.html','/views/diseno-web.html',
  '/evolution-nav.js','/evolution-app.js','/evolution-sw.js',
  '/img/logo.png','/manifest.webmanifest'
];

const PRIVATE=['/proyectos','/perfil','/admin','/portal','/account','/checkout','/payment','/pago','/login','/api/','/recaptcha','/__/auth','/__/firebase'];
const isPrivate=p=>PRIVATE.some(x=>p.toLowerCase().includes(x));
const isShellPath=p=>['/','/index.html','/arquitectura','/arquitectura.html','/diseno-grafico','/diseno-grafico.html','/diseno-web','/diseno-web.html'].includes(p);
const shellAlias=p=>p==='/arquitectura'?'/arquitectura.html':p==='/diseno-grafico'?'/diseno-grafico.html':p==='/diseno-web'?'/diseno-web.html':p;
const isView=p=>p.startsWith('/views/')&&p.endsWith('.html');
const isStatic=p=>p==='/evolution-nav.js'||p==='/evolution-app.js'||p==='/manifest.webmanifest'||p.startsWith('/img/')||p.startsWith('/css/')||p.startsWith('/js/')||p.startsWith('/fonts/')||p.startsWith('/assets/');

async function fetchSameOrigin(request){
  const res=await fetch(request,{cache:'no-cache',redirect:'follow'});
  if(!res||!res.ok)return null;
  if(!res.redirected)return res;
  try{
    const final=new URL(res.url);
    if(final.origin!==self.location.origin)return null;
    const body=await res.clone().arrayBuffer();
    return new Response(body,{status:res.status,statusText:res.statusText,headers:new Headers(res.headers)});
  }catch(_){return null}
}

async function cacheFirstUpdate(request,cacheName){
  const cache=await caches.open(cacheName);
  const cached=await cache.match(request,{ignoreSearch:true});
  const refresh=fetchSameOrigin(request).then(async fresh=>{if(fresh){await cache.put(request,fresh.clone());return fresh}return null}).catch(()=>null);
  if(cached){refresh.catch(()=>{});return cached}
  return await refresh||Response.error();
}

async function shellNavigation(request){
  const cache=await caches.open(SHELL);
  const url=new URL(request.url);
  const cached=await cache.match(shellAlias(url.pathname),{ignoreSearch:true})||await cache.match(url.pathname,{ignoreSearch:true})||await cache.match(request,{ignoreSearch:true});
  const refresh=fetchSameOrigin(request).then(async fresh=>{if(fresh)await cache.put(url.pathname,fresh.clone());return fresh}).catch(()=>null);
  if(cached){refresh.catch(()=>{});return cached}
  const fresh=await refresh;
  if(fresh)return fresh;
  return await cache.match('/index.html')||Response.error();
}

self.addEventListener('install',event=>{
  self.skipWaiting();
  event.waitUntil((async()=>{
    const cache=await caches.open(SHELL);
    await Promise.allSettled(SHELL_FILES.map(async url=>{
      const req=new Request(url,{cache:'reload'});
      const res=await fetchSameOrigin(req);
      if(res)await cache.put(url,res.clone());
    }));
  })());
});

self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(k=>k.startsWith('evolution')&&!k.startsWith(VERSION)).map(k=>caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET')return;
  const url=new URL(req.url);
  if(url.origin!==self.location.origin)return;
  if(isPrivate(url.pathname)){event.respondWith(fetch(req));return}

  if(req.mode==='navigate'){
    if(isShellPath(url.pathname)){event.respondWith(shellNavigation(req));return}
    if(isView(url.pathname)){event.respondWith(cacheFirstUpdate(req,SHELL));return}
    return;
  }

  if(isView(url.pathname)){event.respondWith(cacheFirstUpdate(req,SHELL));return}
  if(isStatic(url.pathname)){event.respondWith(cacheFirstUpdate(req,RUNTIME));return}
});
