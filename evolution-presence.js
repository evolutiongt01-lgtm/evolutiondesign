/* Evolution Design Presence v1 · anonymous live visitors + approximate Cloudflare geo
   Raw IP is never stored. The Worker stores only a salted SHA-256 hash.
*/
(()=>{
  if(window.__EVOLUTION_PRESENCE_V1__)return;
  window.__EVOLUTION_PRESENCE_V1__=true;

  const WORKER='https://evolution-design-backend.evolutiongt01.workers.dev';
  const PING_INTERVAL=5000;
  const MIN_GAP=2500;
  const SESSION_TTL=30*60*1000;
  const VISITOR_KEY='evolution_presence_visitor_v1';
  const SESSION_KEY='evolution_presence_session_v1';
  const LAST_KEY='evolution_presence_last_ping_v1';
  const EXCLUDED=/\/(?:admin|system|content|demo-visor-3d|404)(?:\.html)?$/i;
  const VIEW_PATH=/^\/views\//i;

  function shouldTrack(){
    const p=location.pathname||'/';
    return !EXCLUDED.test(p)&&!VIEW_PATH.test(p);
  }
  function getStore(key){try{return localStorage.getItem(key)||''}catch(_){return ''}}
  function setStore(key,val){try{localStorage.setItem(key,val)}catch(_){}}
  function randomId(prefix){
    const core=(crypto.randomUUID?.()||`${Date.now()}-${Math.random()}`).replace(/[^A-Za-z0-9_-]/g,'');
    return `${prefix}${core}`.slice(0,92);
  }
  function visitorId(){
    let id=getStore(VISITOR_KEY);
    if(!/^[A-Za-z0-9_-]{16,100}$/.test(id))id=randomId('v_');
    setStore(VISITOR_KEY,id);
    return id;
  }
  function sessionId(){
    const now=Date.now();let data={};
    try{data=JSON.parse(getStore(SESSION_KEY)||'{}')}catch(_){data={}}
    if(!/^[A-Za-z0-9_-]{16,100}$/.test(String(data.id||''))||now-Number(data.last||0)>SESSION_TTL){
      data={id:randomId('s_'),startedAt:now,last:now};
    }else data.last=now;
    setStore(SESSION_KEY,JSON.stringify(data));
    return data.id;
  }
  function touchSession(){
    try{const d=JSON.parse(getStore(SESSION_KEY)||'{}');if(d?.id){d.last=Date.now();setStore(SESSION_KEY,JSON.stringify(d))}}catch(_){}
  }
  function clientInfo(){
    const ua=navigator.userAgent||'';
    const iPad=/iPad/i.test(ua)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
    const iPhone=/iPhone|iPod/i.test(ua),android=/Android/i.test(ua);
    const tablet=android&&/Tablet|SM-T|Lenovo Tab|Nexus 7|Nexus 9|Pixel C/i.test(ua);
    let device='Web',os='Otro';
    if(iPhone){device='iPhone';os='iOS'}
    else if(iPad){device='iPad';os='iPadOS'}
    else if(tablet){device='Android Tablet';os='Android'}
    else if(android){device='Android';os='Android'}
    else if(/Macintosh|Mac OS X/i.test(ua)){device='Mac';os='macOS'}
    else if(/Windows/i.test(ua)){device='Windows PC';os='Windows'}
    else if(/Linux/i.test(ua)){device='Linux PC';os='Linux'}
    let browser='Otro';
    if(/EdgiOS|EdgA|Edg\//i.test(ua))browser='Edge';
    else if(/OPiOS|OPR\//i.test(ua))browser='Opera';
    else if(/SamsungBrowser\//i.test(ua))browser='Samsung Internet';
    else if(/Firefox|FxiOS/i.test(ua))browser='Firefox';
    else if(/CriOS|Chrome\//i.test(ua))browser='Chrome';
    else if(/Version\//i.test(ua)&&/Safari/i.test(ua))browser='Safari';
    return {device,browser,os};
  }
  function currentPath(){return `${location.pathname}${location.search}`.slice(0,500)}

  async function firebaseToken(){
    try{
      const [{getApps,initializeApp},{getAuth}]=await Promise.all([
        import('https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js'),
        import('https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js')
      ]);
      const cfg={apiKey:'AIzaSyA5b-2R5WUQNOt3N2cAKBZK3x5--YhwzHM',authDomain:'evolution-design-9b63b.firebaseapp.com',projectId:'evolution-design-9b63b',storageBucket:'evolution-design-9b63b.firebasestorage.app',messagingSenderId:'433474708581',appId:'1:433474708581:web:cff7830077fb7d0e8a128c'};
      const app=getApps()[0]||initializeApp(cfg);
      const auth=getAuth(app);
      if(auth.authStateReady)await Promise.race([auth.authStateReady(),new Promise(r=>setTimeout(r,1300))]);
      const user=auth.currentUser;
      return user?await user.getIdToken(false):'';
    }catch(_){return ''}
  }

  let busy=false,lastPath='';
  async function ping(reason='heartbeat',force=false,anonymousFast=false){
    if(!shouldTrack()||navigator.onLine===false)return;
    const now=Date.now(),path=currentPath();
    if(!force){
      const last=Number(getStore(LAST_KEY)||0);
      if(now-last<MIN_GAP&&path===lastPath)return;
    }
    if(busy&&!anonymousFast)return;
    if(!anonymousFast)busy=true;
    touchSession();
    try{
      const headers={'content-type':'application/json'};
      if(!anonymousFast){const token=await firebaseToken();if(token)headers.authorization=`Bearer ${token}`}
      const info=clientInfo();
      const payload={
        visitorId:visitorId(),sessionId:sessionId(),path,
        title:(document.title||'Evolution Design').slice(0,180),
        referrer:(document.referrer||'').slice(0,500),
        device:info.device,browser:info.browser,os:info.os,
        standalone:matchMedia('(display-mode: standalone)').matches||navigator.standalone===true,
        language:(navigator.language||'').slice(0,30),
        reason:String(reason||'heartbeat').slice(0,40),
        visible:document.visibilityState==='visible',clientAt:new Date().toISOString()
      };
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),6500);
      await fetch(`${WORKER}/presence/heartbeat`,{method:'POST',headers,body:JSON.stringify(payload),signal:controller.signal,cache:'no-store',keepalive:true});
      clearTimeout(timer);setStore(LAST_KEY,String(Date.now()));lastPath=path;
    }catch(_){
      // Presence analytics must never block the website.
    }finally{if(!anonymousFast)busy=false}
  }
  function closePing(reason){ping(reason,true,true)}
  let routeTimer=0;
  function routePing(reason='route'){
    clearTimeout(routeTimer);routeTimer=setTimeout(()=>ping(reason,true),110);
  }
  function patchHistory(){
    for(const name of ['pushState','replaceState']){
      const original=history[name];if(original.__evoPresenceWrapped)continue;
      const wrapped=function(...args){const result=original.apply(this,args);routePing(name);return result};
      wrapped.__evoPresenceWrapped=true;history[name]=wrapped;
    }
  }
  function start(){
    if(!shouldTrack())return;
    patchHistory();
    ping('open',true);
    setInterval(()=>{if(document.visibilityState==='visible')ping('heartbeat')},PING_INTERVAL);
    addEventListener('online',()=>ping('online',true));
    addEventListener('pageshow',()=>ping('pageshow',true));
    addEventListener('popstate',()=>routePing('popstate'));
    addEventListener('hashchange',()=>routePing('hashchange'));
    document.addEventListener('visibilitychange',()=>document.visibilityState==='visible'?ping('visible',true):closePing('hidden'));
    addEventListener('pagehide',()=>closePing('pagehide'));
    addEventListener('beforeunload',()=>closePing('unload'));
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
