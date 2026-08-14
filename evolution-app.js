/* Evolution Design · Smart App Shell · v18 */
(() => {
  'use strict';

  const VERSION='18';

  const ROUTES = {
    home:{key:'home',path:'/index.html',view:'/views/home.html',title:'Evolution Design',order:0,transition:{x:0,y:5,scale:.999,blur:0}},
    arquitectura:{key:'arquitectura',path:'/arquitectura.html',view:'/views/arquitectura.html',title:'Arquitectura · Evolution Design',order:1,transition:{x:0,y:8,scale:.997,blur:1}},
    grafico:{key:'grafico',path:'/diseno-grafico.html',view:'/views/diseno-grafico.html',title:'Diseño Gráfico · Evolution Design',order:2,transition:{x:10,y:0,scale:.999,blur:0}},
    web:{key:'web',path:'/diseno-web.html',view:'/views/diseno-web.html',title:'Diseño Web · Evolution Design',order:3,transition:{x:0,y:7,scale:.998,blur:2}}
  };

  const ROUTE_LIST=Object.values(ROUTES);
  const PRIVATE_HINTS=['/proyectos','/perfil','/admin','/portal','/account','/checkout','/payment','/pago','/login','/api/'];
  const prefetchedViews=new Set();
  const prefetchedAssets=new Set();
  const scrollMemory=new Map();

  let activeFrame=null;
  let activeKey=null;
  let navigationToken=0;
  let networkMode=navigator.onLine?'normal':'offline';
  let deferredInstall=null;
  let lastSWUpdateCheck=0;

  /* ---------- SMART APP CSS ---------- */
  const smartStyle=document.createElement('style');
  smartStyle.id='evolution-smart-app-style';
  smartStyle.textContent=`
    .evo-view-frame{
      --evo-enter-x:0px;
      --evo-enter-y:7px;
      --evo-enter-scale:.999;
      --evo-enter-blur:0px;
      --evo-leave-x:0px;
      --evo-leave-y:-3px;
      --evo-duration:.30s;
      transition:
        opacity .20s ease,
        transform var(--evo-duration) cubic-bezier(.16,1,.3,1),
        filter .22s ease!important;
    }
    .evo-view-frame.evo-view-incoming{
      opacity:0!important;
      transform:translate3d(var(--evo-enter-x),var(--evo-enter-y),0) scale(var(--evo-enter-scale))!important;
      filter:blur(var(--evo-enter-blur))!important;
    }
    .evo-view-frame.evo-view-active{
      opacity:1!important;
      transform:none!important;
      filter:none!important;
    }
    .evo-view-frame.evo-view-leaving{
      opacity:0!important;
      transform:translate3d(var(--evo-leave-x),var(--evo-leave-y),0) scale(.999)!important;
      filter:blur(1px)!important;
      pointer-events:none!important;
    }

    html[data-evo-network="slow"] .evo-view-frame{
      --evo-duration:.20s;
    }
    html[data-evo-network="slow"] .evo-view-frame.evo-view-incoming,
    html[data-evo-network="slow"] .evo-view-frame.evo-view-leaving{
      filter:none!important;
    }

    #evolution-smart-toast{
      position:fixed;
      left:50%;
      bottom:max(18px,env(safe-area-inset-bottom,0px));
      z-index:2147483647;
      width:min(430px,calc(100vw - 28px));
      padding:11px 12px 11px 14px;
      border:1px solid rgba(255,255,255,.12);
      border-radius:16px;
      background:rgba(14,14,16,.94);
      color:#fff;
      box-shadow:0 18px 55px rgba(0,0,0,.48);
      backdrop-filter:blur(20px) saturate(150%);
      -webkit-backdrop-filter:blur(20px) saturate(150%);
      display:flex;
      align-items:center;
      gap:10px;
      transform:translate3d(-50%,18px,0) scale(.98);
      opacity:0;
      visibility:hidden;
      pointer-events:none;
      transition:opacity .20s ease,transform .28s cubic-bezier(.16,1,.3,1),visibility .20s;
      font:600 .78rem/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
    }
    #evolution-smart-toast.show{
      transform:translate3d(-50%,0,0) scale(1);
      opacity:1;
      visibility:visible;
      pointer-events:auto;
    }
    #evolution-smart-toast .evo-toast-text{flex:1;min-width:0}
    #evolution-smart-toast .evo-toast-sub{display:block;margin-top:2px;color:#898990;font-weight:500;font-size:.70rem}
    #evolution-smart-toast button{
      flex:0 0 auto;
      border:0;
      border-radius:999px;
      min-height:32px;
      padding:0 12px;
      background:#f3f3f1;
      color:#080808;
      font:800 .69rem/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
      cursor:pointer;
    }
    #evolution-smart-toast[data-kind="offline"]{
      border-color:rgba(212,184,149,.30);
    }
    #evolution-smart-toast[data-kind="slow"]{
      border-color:rgba(212,184,149,.22);
    }

    @media(max-width:991.98px){
      #evolution-smart-toast{bottom:max(14px,env(safe-area-inset-bottom,0px))}
    }
    @media(prefers-reduced-motion:reduce){
      .evo-view-frame,#evolution-smart-toast{transition:none!important}
    }
  `;
  document.head.appendChild(smartStyle);

  /* ---------- BASIC ROUTER HELPERS ---------- */
  const routeFromURL=value=>{
    let p='';
    try{p=new URL(value||location.href,location.href).pathname.toLowerCase()}catch(_){}
    if(p.includes('arquitectura'))return ROUTES.arquitectura;
    if(p.includes('diseno-grafico'))return ROUTES.grafico;
    if(p.includes('diseno-web'))return ROUTES.web;
    return ROUTES.home;
  };

  const routeFromHref=value=>{
    try{
      const u=new URL(value,location.href);
      if(u.origin!==location.origin)return null;
      const p=u.pathname.toLowerCase();
      if(PRIVATE_HINTS.some(x=>p.includes(x)))return null;
      return routeFromURL(u.href);
    }catch(_){return null}
  };

  const stage=()=>document.getElementById('evolution-view-stage');
  const progress=()=>document.getElementById('evolution-route-progress');

  const setLoading=on=>{
    document.body.classList.toggle('evo-app-loading',on);
    progress()?.classList.toggle('show',on);
  };

  /* ---------- TOAST ---------- */
  const toast=document.createElement('div');
  toast.id='evolution-smart-toast';
  toast.setAttribute('role','status');
  toast.setAttribute('aria-live','polite');
  toast.innerHTML='<div class="evo-toast-text"></div>';
  document.body.appendChild(toast);

  let toastTimer=0;
  const showToast=(message,{sub='',kind='info',button='',onButton=null,duration=3200,persistent=false}={})=>{
    clearTimeout(toastTimer);
    toast.dataset.kind=kind;
    toast.innerHTML=`<div class="evo-toast-text">${message}${sub?`<span class="evo-toast-sub">${sub}</span>`:''}</div>${button?`<button type="button">${button}</button>`:''}`;
    const btn=toast.querySelector('button');
    if(btn&&onButton)btn.addEventListener('click',onButton,{once:true});
    toast.classList.add('show');
    if(!persistent&&duration>0)toastTimer=setTimeout(()=>toast.classList.remove('show'),duration);
  };
  const hideToast=()=>{clearTimeout(toastTimer);toast.classList.remove('show')};

  /* ---------- NETWORK INTELLIGENCE ---------- */
  const connection=()=>navigator.connection||navigator.mozConnection||navigator.webkitConnection||null;

  const classifyConnection=()=>{
    if(!navigator.onLine)return 'offline';
    const c=connection();
    if(!c)return 'unknown';
    if(c.saveData)return 'slow';
    const type=String(c.effectiveType||'').toLowerCase();
    if(type==='slow-2g'||type==='2g')return 'slow';
    if(type==='3g')return 'normal';
    if(type==='4g'){
      if(Number.isFinite(c.downlink)&&c.downlink<1.4)return 'normal';
      if(Number.isFinite(c.rtt)&&c.rtt>500)return 'normal';
      return 'fast';
    }
    if(Number.isFinite(c.downlink)){
      if(c.downlink<.8)return 'slow';
      if(c.downlink<2)return 'normal';
      return 'fast';
    }
    return 'unknown';
  };

  const applyNetwork=mode=>{
    networkMode=mode==='unknown'?'normal':mode;
    document.documentElement.dataset.evoNetwork=networkMode;
    window.EvolutionNav?.setNetwork(networkMode);
    window.dispatchEvent(new CustomEvent('evolution:network-changed',{detail:{mode:networkMode}}));
  };

  const probeNetwork=async()=>{
    if(!navigator.onLine){applyNetwork('offline');return 'offline'}

    const native=classifyConnection();
    if(native!=='unknown'){
      applyNetwork(native);
      return native;
    }

    const start=performance.now();
    try{
      const response=await fetch(`/img/logo.png?evo-probe=18&t=${Date.now()}`,{
        cache:'no-store',
        credentials:'same-origin'
      });
      if(!response.ok)throw new Error('probe');
      await response.arrayBuffer();
      const elapsed=performance.now()-start;
      const mode=elapsed>1300?'slow':elapsed>520?'normal':'fast';
      applyNetwork(mode);
      return mode;
    }catch(_){
      applyNetwork('normal');
      return 'normal';
    }
  };

  connection()?.addEventListener?.('change',()=>{
    const mode=classifyConnection();
    if(mode!=='unknown')applyNetwork(mode);
  });

  addEventListener('offline',()=>{
    applyNetwork('offline');
    showToast('Sin conexión',{sub:'Evolution seguirá usando el contenido guardado en este dispositivo.',kind:'offline',persistent:true});
  });

  addEventListener('online',async()=>{
    hideToast();
    await probeNetwork();
    showToast('Conexión restaurada',{sub:'Evolution volvió a sincronizar contenido en segundo plano.',duration:2600});
    checkForSWUpdate(true);
  });

  /* ---------- PREDICTIVE PRELOAD ---------- */
  const safePublicURL=value=>{
    try{
      const u=new URL(value,location.href);
      if(u.origin!==location.origin)return null;
      if(PRIVATE_HINTS.some(x=>u.pathname.toLowerCase().includes(x)))return null;
      return u;
    }catch(_){return null}
  };

  const tellSWToCache=urls=>{
    if(!navigator.serviceWorker?.controller||!urls?.length)return;
    navigator.serviceWorker.controller.postMessage({type:'CACHE_URLS',urls});
  };

  const extractAssets=(html,baseURL,limit)=>{
    if(!html||networkMode==='slow'||networkMode==='offline')return [];
    const doc=new DOMParser().parseFromString(html,'text/html');
    const found=[];

    const add=value=>{
      if(found.length>=limit||!value)return;
      const raw=String(value).trim().split(/\s+/)[0];
      const u=safePublicURL(new URL(raw,baseURL).href);
      if(!u||prefetchedAssets.has(u.href))return;
      if(!/\.(png|jpe?g|webp|avif|svg)(\?|$)/i.test(u.pathname+u.search))return;
      prefetchedAssets.add(u.href);
      found.push(u.href);
    };

    doc.querySelectorAll('img[src]').forEach(el=>add(el.getAttribute('src')));
    if(found.length<limit){
      doc.querySelectorAll('source[srcset]').forEach(el=>{
        const first=(el.getAttribute('srcset')||'').split(',')[0]?.trim()?.split(/\s+/)[0];
        add(first);
      });
    }
    return found.slice(0,limit);
  };

  const prefetchRoute=async(route,{assets=false,reason='intent'}={})=>{
    if(!route||networkMode==='offline')return;
    const key=route.key;
    const already=prefetchedViews.has(key);

    if(!already)prefetchedViews.add(key);

    try{
      const response=await fetch(`${route.view}?prefetch=${VERSION}&reason=${encodeURIComponent(reason)}`,{
        credentials:'same-origin',
        cache:'force-cache'
      });

      tellSWToCache([route.view]);

      if(!response.ok||!assets||networkMode==='slow')return;

      const html=await response.clone().text();
      const maxAssets=networkMode==='fast'?6:2;
      const urls=extractAssets(html,response.url,maxAssets);
      if(urls.length){
        tellSWToCache(urls);
        if(networkMode==='fast'){
          urls.forEach(url=>fetch(url,{credentials:'same-origin',cache:'force-cache'}).catch(()=>{}));
        }
      }
    }catch(_){}
  };

  const schedulePrefetch=(route,options={})=>{
    if(!route||route.key===activeKey||networkMode==='offline')return;
    const run=()=>prefetchRoute(route,options);
    if('requestIdleCallback'in window)requestIdleCallback(run,{timeout:550});
    else setTimeout(run,70);
  };

  const prewarmAccordingToNetwork=()=>{
    if(networkMode==='offline'||networkMode==='slow')return;

    const current=ROUTES[activeKey]||routeFromURL(location.href);
    const others=ROUTE_LIST.filter(r=>r.key!==current.key);

    if(networkMode==='fast'){
      let delay=180;
      others.forEach(route=>{
        setTimeout(()=>schedulePrefetch(route,{assets:true,reason:'idle-fast'}),delay);
        delay+=260;
      });
      return;
    }

    const next=ROUTE_LIST.find(r=>r.order===current.order+1)||ROUTES.home;
    setTimeout(()=>schedulePrefetch(next,{assets:false,reason:'idle-normal'}),900);
  };

  const routeFromNavTarget=target=>{
    const a=target instanceof Element?target.closest('evolution-nav a[data-evo-route]'):null;
    return a?ROUTES[a.dataset.evoRoute]||null:null;
  };

  document.addEventListener('pointerover',e=>{
    if(e.pointerType&&e.pointerType!=='mouse'&&e.pointerType!=='pen')return;
    const route=routeFromNavTarget(e.target);
    if(route)schedulePrefetch(route,{assets:networkMode==='fast',reason:'hover'});
  },{passive:true});

  document.addEventListener('focusin',e=>{
    const route=routeFromNavTarget(e.target);
    if(route)schedulePrefetch(route,{assets:false,reason:'focus'});
  });

  document.addEventListener('pointerdown',e=>{
    const route=routeFromNavTarget(e.target);
    if(route)prefetchRoute(route,{assets:networkMode==='fast',reason:'pointer-intent'});
  },{passive:true});

  /* ---------- FRAME / SCROLL ---------- */
  const saveScroll=()=>{
    if(!activeFrame||!activeKey)return;
    try{scrollMemory.set(activeKey,activeFrame.contentWindow.scrollY||0)}catch(_){}
  };

  const restoreScroll=(frame,key,restore)=>{
    try{
      const y=restore?(scrollMemory.get(key)||0):0;
      frame.contentWindow.scrollTo(0,y);
      window.EvolutionNav?.setScroll(y);
    }catch(_){}
  };

  const handleFrameLoad=frame=>{
    try{
      const childURL=new URL(frame.contentWindow.location.href);
      const isView=childURL.origin===location.origin&&childURL.pathname.startsWith('/views/');
      if(!isView){
        location.href=childURL.href;
        return false;
      }
    }catch(_){}
    return true;
  };

  const attachFrameTelemetry=frame=>{
    try{
      const win=frame.contentWindow;
      let ticking=false;
      const update=()=>{
        ticking=false;
        if(frame!==activeFrame)return;
        window.EvolutionNav?.setScroll(win.scrollY||0);
      };
      win.addEventListener('scroll',()=>{
        if(ticking)return;
        ticking=true;
        requestAnimationFrame(update);
      },{passive:true});
      update();
    }catch(_){}
  };

  const attachPersistentGuard=frame=>{
    frame.addEventListener('load',()=>{
      if(frame===activeFrame)handleFrameLoad(frame);
    });
  };

  const syncRoute=route=>{
    activeKey=route.key;
    document.title=route.title;
    window.EvolutionNav?.setActive(route.key);
    window.dispatchEvent(new CustomEvent('evolution:route-changed',{detail:{key:route.key,path:route.path}}));
  };

  /* ---------- INTELLIGENT TRANSITIONS ---------- */
  const applyTransition=(frame,from,to)=>{
    const t=to.transition||ROUTES.home.transition;
    const forward=!from||to.order>=from.order;
    const direction=forward?1:-1;

    let x=t.x*direction;
    let y=t.y;
    let blur=t.blur;
    let scale=t.scale;

    if(networkMode==='slow'){
      x*=.5;y*=.5;blur=0;scale=.9995;
    }

    frame.style.setProperty('--evo-enter-x',`${x}px`);
    frame.style.setProperty('--evo-enter-y',`${y}px`);
    frame.style.setProperty('--evo-enter-scale',String(scale));
    frame.style.setProperty('--evo-enter-blur',`${blur}px`);
    frame.style.setProperty('--evo-leave-x',`${-x*.35}px`);
    frame.style.setProperty('--evo-leave-y',`${-Math.max(2,y*.35)}px`);
  };

  const loadRoute=(route,{push=true,restore=false,replace=false}={})=>{
    if(!route)return;

    if(activeKey===route.key&&activeFrame){
      if(!restore){
        try{activeFrame.contentWindow.scrollTo({top:0,behavior:'smooth'})}catch(_){}
      }
      return;
    }

    saveScroll();
    const token=++navigationToken;
    const from=activeKey?ROUTES[activeKey]:null;
    setLoading(true);

    const frame=document.createElement('iframe');
    frame.className='evo-view-frame evo-view-incoming';
    frame.src=`${route.view}?shell=${VERSION}`;
    frame.title=route.title;
    frame.setAttribute('aria-label',route.title);
    frame.setAttribute('allow','clipboard-read; clipboard-write; payment');
    applyTransition(frame,from,route);

    const old=activeFrame;
    stage().appendChild(frame);

    const fail=setTimeout(()=>{
      if(token===navigationToken){
        setLoading(false);
        showToast('Esta sección está tardando más de lo normal.',{
          sub:networkMode==='slow'?'Detectamos una conexión lenta; seguimos intentando.':'Seguimos cargando el contenido.',
          kind:networkMode==='slow'?'slow':'info',
          duration:3000
        });
      }
    },6500);

    frame.addEventListener('load',()=>{
      if(token!==navigationToken){frame.remove();return}
      if(!handleFrameLoad(frame))return;

      clearTimeout(fail);

      if(push){
        if(replace)history.replaceState({evolutionRoute:route.key},'',route.path);
        else history.pushState({evolutionRoute:route.key},'',route.path);
      }

      syncRoute(route);
      restoreScroll(frame,route.key,restore);

      requestAnimationFrame(()=>requestAnimationFrame(()=>{
        frame.classList.remove('evo-view-incoming');
        frame.classList.add('evo-view-active');
        old?.classList.add('evo-view-leaving');
        setLoading(false);
      }));

      setTimeout(()=>{
        if(old&&old!==frame)old.remove();
        activeFrame=frame;
        attachPersistentGuard(frame);
        attachFrameTelemetry(frame);
        prewarmAccordingToNetwork();
      },340);
    },{once:true});
  };

  /* ---------- ROUTER EVENTS ---------- */
  document.addEventListener('click',e=>{
    if(e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;
    const a=e.target instanceof Element?e.target.closest('evolution-nav a[data-evo-route]'):null;
    if(!a)return;
    const route=ROUTES[a.dataset.evoRoute]||routeFromHref(a.href);
    if(!route)return;
    e.preventDefault();e.stopImmediatePropagation();
    loadRoute(route,{push:true,restore:false});
  },true);

  document.addEventListener('evolution:auth-request',()=>{
    activeFrame?.contentWindow?.postMessage({type:'evolution:auth-open'},location.origin);
  });

  document.addEventListener('evolution:logout-request',()=>{
    activeFrame?.contentWindow?.postMessage({type:'evolution:logout'},location.origin);
  });

  addEventListener('message',e=>{
    if(e.origin!==location.origin||!e.data)return;
    const data=e.data;

    if(data.type==='evolution:navigate'&&data.href){
      const route=routeFromHref(data.href);
      if(route){loadRoute(route,{push:true,restore:false});return}
      location.href=data.href;return;
    }

    if(data.type==='evolution:external-nav'&&data.href){location.href=data.href;return}

    if(data.type==='evolution:auth-state'){
      window.EvolutionNav?.setAuth({user:data.user||null,isAdmin:Boolean(data.isAdmin)});
      return;
    }

    if(data.type==='evolution:view-title'&&data.title){document.title=data.title}
  });

  addEventListener('popstate',()=>loadRoute(routeFromURL(location.href),{push:false,restore:true}));

  /* ---------- PWA INSTALL ---------- */
  const standalone=()=>matchMedia('(display-mode:standalone)').matches||navigator.standalone===true;
  const isIOS=()=>/iphone|ipad|ipod/i.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);

  addEventListener('beforeinstallprompt',e=>{
    e.preventDefault();
    deferredInstall=e;
    window.EvolutionNav?.setInstallAvailable(true);

    setTimeout(()=>{
      if(deferredInstall&&!standalone()){
        showToast('Instala Evolution como app',{
          sub:'Abrirá más rápido y conservará el contenido público para usarlo sin conexión.',
          button:'Instalar',
          duration:7000,
          onButton:()=>document.dispatchEvent(new CustomEvent('evolution:install-request'))
        });
      }
    },9000);
  });

  document.addEventListener('evolution:install-request',async()=>{
    if(standalone()){
      showToast('Evolution ya está instalada.',{duration:2200});
      return;
    }

    if(deferredInstall){
      try{
        deferredInstall.prompt();
        await deferredInstall.userChoice;
      }catch(_){}
      deferredInstall=null;
      window.EvolutionNav?.setInstallAvailable(false);
      return;
    }

    if(isIOS()){
      showToast('Instalar Evolution',{
        sub:'En Safari toca Compartir → Añadir a pantalla de inicio.',
        kind:'info',
        duration:6500
      });
      return;
    }

    showToast('Instalación no disponible todavía',{
      sub:'El navegador mostrará la opción cuando cumpla los requisitos de instalación.',
      duration:3500
    });
  });

  addEventListener('appinstalled',()=>{
    deferredInstall=null;
    window.EvolutionNav?.setInstallAvailable(false);
    try{localStorage.setItem('evolution_app_installed','1')}catch(_){}
    showToast('Evolution instalada',{sub:'Ya puedes abrirla como una app.',duration:3000});
  });

  if(isIOS()&&!standalone())window.EvolutionNav?.setInstallAvailable(true);

  /* ---------- SILENT SERVICE WORKER UPDATES ---------- */
  const noteSWVersion=version=>{
    if(!version)return;
    let previous='';
    try{
      previous=localStorage.getItem('evolution_sw_version')||'';
      localStorage.setItem('evolution_sw_version',version);
    }catch(_){}

    if(previous&&previous!==version){
      showToast('Evolution se actualizó en segundo plano.',{
        sub:'La nueva versión quedará lista sin interrumpir lo que estás viendo.',
        duration:3200
      });
    }
  };

  navigator.serviceWorker?.addEventListener('message',e=>{
    const data=e.data||{};
    if(data.type==='EVOLUTION_SW_ACTIVATED')noteSWVersion(data.version);
    if(data.type==='EVOLUTION_CACHE_READY'&&data.url){
      window.dispatchEvent(new CustomEvent('evolution:cache-ready',{detail:data}));
    }
  });

  async function checkForSWUpdate(force=false){
    if(!('serviceWorker'in navigator))return;
    const now=Date.now();
    if(!force&&now-lastSWUpdateCheck<10*60*1000)return;
    lastSWUpdateCheck=now;

    try{
      const reg=await navigator.serviceWorker.getRegistration('/');
      if(!reg)return;
      await reg.update();
      reg.active?.postMessage({type:'GET_VERSION'});
    }catch(_){}
  }

  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='visible')checkForSWUpdate(false);
  });

  setInterval(()=>checkForSWUpdate(false),30*60*1000);

  /* ---------- BOOT ---------- */
  const boot=async()=>{
    const initial=routeFromURL(location.href);
    syncRoute(initial);

    const native=classifyConnection();
    if(native!=='unknown')applyNetwork(native);
    else applyNetwork(navigator.onLine?'normal':'offline');

    loadRoute(initial,{push:false,restore:false});

    setTimeout(async()=>{
      await probeNetwork();
      prewarmAccordingToNetwork();
    },650);

    setTimeout(()=>checkForSWUpdate(true),2200);

    if(isIOS()&&!standalone()){
      window.EvolutionNav?.setInstallAvailable(true);
    }
  };

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});
  else boot();

  window.EvolutionApp={
    version:VERSION,
    routes:ROUTES,
    navigate:key=>ROUTES[key]&&loadRoute(ROUTES[key],{push:true}),
    prefetch:key=>ROUTES[key]&&prefetchRoute(ROUTES[key],{assets:networkMode==='fast',reason:'api'}),
    get network(){return networkMode}
  };
})();
