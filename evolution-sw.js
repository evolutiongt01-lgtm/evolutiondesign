const VERSION='evolution-app-2026-08-14-v5-mobile-ultra-fluid';
const PAGE_CACHE=VERSION+'-pages',ASSET_CACHE=VERSION+'-assets';
const PUBLIC=new Set(['/','/index.html','/arquitectura.html','/diseno-grafico.html','/diseno-web.html','/sobre-nosotros','/sobre-nosotros.html','/feedback','/feedback.html']);
const PREPAGES=['/','/index.html','/arquitectura.html','/diseno-grafico.html','/diseno-web.html','/sobre-nosotros','/feedback'];
const PREASSETS=['/css/theme.min.css','/img/logo.png','/manifest.webmanifest','/img/evolution-app-icon.png','/img/evolution-app-icon-desktop-v2-192.png','/img/evolution-app-icon-desktop-v2-512.png'];
const PRIVATE=['/proyectos','/admin','/perfil','/portal','/account','/checkout','/payment','/pago','/login','/recaptcha','/api/','/__/auth','/__/firebase'];
const isPrivate=p=>PRIVATE.some(x=>p.toLowerCase().includes(x));
const isAsset=p=>p.startsWith('/css/')||p.startsWith('/js/')||p.startsWith('/fonts/')||p.startsWith('/img/')||p.startsWith('/assets/')||p==='/manifest.webmanifest';

async function page(req){
  const c=await caches.open(PAGE_CACHE),hit=await c.match(req,{ignoreSearch:true});
  if(hit){fetch(req,{cache:'no-cache'}).then(r=>{if(r.ok&&r.type==='basic')c.put(req,r.clone())}).catch(()=>{});return hit}
  try{const r=await fetch(req,{cache:'no-cache'});if(r.ok&&r.type==='basic')await c.put(req,r.clone());return r}
  catch(_){return await c.match('/index.html')||await c.match('/')||new Response('<!doctype html><meta charset=utf-8><meta name=viewport content=\"width=device-width,initial-scale=1\"><body style=\"margin:0;background:#050505;color:#fff;font:16px system-ui;display:grid;place-items:center;min-height:100vh\"><div style=\"padding:28px;text-align:center\"><h1>Evolution</h1><p style=\"color:#999\">Sin conexión a internet.</p></div></body>',{headers:{'Content-Type':'text/html; charset=utf-8'}})}
}
async function asset(req){
  const c=await caches.open(ASSET_CACHE),hit=await c.match(req);
  if(hit){fetch(req).then(r=>{if(r.ok&&r.type==='basic')c.put(req,r.clone())}).catch(()=>{});return hit}
  try{const r=await fetch(req);if(r.ok&&r.type==='basic')await c.put(req,r.clone());return r}catch(_){return Response.error()}
}
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil((async()=>{
  const pc=await caches.open(PAGE_CACHE),ac=await caches.open(ASSET_CACHE);
  await Promise.allSettled(PREPAGES.map(async u=>{const r=await fetch(u,{cache:'reload'});if(r.ok&&r.type==='basic')await pc.put(u,r)}));
  await Promise.allSettled(PREASSETS.map(async u=>{const r=await fetch(u,{cache:'reload'});if(r.ok&&r.type==='basic')await ac.put(u,r)}));
})())});
self.addEventListener('activate',e=>e.waitUntil((async()=>{
  const keep=new Set([PAGE_CACHE,ASSET_CACHE]),keys=await caches.keys();
  await Promise.all(keys.filter(k=>(k.startsWith('evolution-speed-')||k.startsWith('evolution-app-'))&&!keep.has(k)).map(k=>caches.delete(k)));
  await self.clients.claim();
})()));
self.addEventListener('fetch',e=>{
  const r=e.request;if(r.method!=='GET')return;
  const u=new URL(r.url);if(u.origin!==self.location.origin||isPrivate(u.pathname))return;
  if(r.mode==='navigate'&&PUBLIC.has(u.pathname)){e.respondWith(page(r));return}
  if(isAsset(u.pathname))e.respondWith(asset(r));
});
self.addEventListener('message',e=>{if(e.data?.type==='SKIP_WAITING')self.skipWaiting()});
