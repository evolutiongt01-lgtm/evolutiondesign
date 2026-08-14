/* Evolution Design · App Shell Router · v16 */
(() => {
  'use strict';

  const ROUTES = {
    home:{key:'home',path:'/index.html',view:'/views/home.html',title:'Evolution Design'},
    arquitectura:{key:'arquitectura',path:'/arquitectura.html',view:'/views/arquitectura.html',title:'Arquitectura · Evolution Design'},
    grafico:{key:'grafico',path:'/diseno-grafico.html',view:'/views/diseno-grafico.html',title:'Diseño Gráfico · Evolution Design'},
    web:{key:'web',path:'/diseno-web.html',view:'/views/diseno-web.html',title:'Diseño Web · Evolution Design'}
  };

  const PRIVATE_HINTS=['/proyectos','/perfil','/admin','/portal','/account','/checkout','/payment','/pago'];
  const scrollMemory=new Map();
  let activeFrame=null;
  let activeKey=null;
  let navigationToken=0;

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
      return routeFromURL(u.href);
    }catch(_){return null}
  };

  const stage=()=>document.getElementById('evolution-view-stage');
  const progress=()=>document.getElementById('evolution-route-progress');

  const setLoading=on=>{
    document.body.classList.toggle('evo-app-loading',on);
    progress()?.classList.toggle('show',on);
  };

  const saveScroll=()=>{
    if(!activeFrame||!activeKey)return;
    try{scrollMemory.set(activeKey,activeFrame.contentWindow.scrollY||0)}catch(_){}
  };

  const restoreScroll=(frame,key,restore)=>{
    try{frame.contentWindow.scrollTo(0,restore?(scrollMemory.get(key)||0):0)}catch(_){}
  };

  const handleFrameLoad=frame=>{
    try{
      const childURL=new URL(frame.contentWindow.location.href);
      const isView=childURL.origin===location.origin&&childURL.pathname.startsWith('/views/');
      if(!isView){
        location.href=childURL.href;
        return false;
      }
    }catch(_){
      // Cross-origin navigation inside the view: promote it to top-level when possible.
    }
    return true;
  };

  const attachPersistentGuard=frame=>{
    frame.addEventListener('load',()=>{
      if(frame===activeFrame)handleFrameLoad(frame);
    });
  };

  const syncRoute=route=>{
    activeKey=route.key;
    window.EvolutionNav?.setActive(route.key);
    window.dispatchEvent(new CustomEvent('evolution:route-changed',{detail:{key:route.key,path:route.path}}));
  };

  const loadRoute=(route,{push=true,restore=false,replace=false}={})=>{
    if(!route)return;
    if(activeKey===route.key&&activeFrame){
      if(!restore){try{activeFrame.contentWindow.scrollTo({top:0,behavior:'smooth'})}catch(_){}}
      return;
    }

    saveScroll();
    const token=++navigationToken;
    setLoading(true);

    const frame=document.createElement('iframe');
    frame.className='evo-view-frame evo-view-incoming';
    frame.src=`${route.view}?shell=16`;
    frame.title=route.title;
    frame.setAttribute('aria-label',route.title);
    frame.setAttribute('allow','clipboard-read; clipboard-write; payment');

    const old=activeFrame;
    stage().appendChild(frame);

    const fail=setTimeout(()=>{if(token===navigationToken)setLoading(false)},8000);

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
      },320);
    },{once:true});
  };

  const prewarm=()=>{
    const run=()=>Object.values(ROUTES).forEach(route=>{
      fetch(`${route.view}?prewarm=16`,{credentials:'same-origin',cache:'force-cache'}).catch(()=>{});
    });
    if('requestIdleCallback'in window)requestIdleCallback(run,{timeout:2200});else setTimeout(run,900);
  };

  document.addEventListener('click',e=>{
    if(e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;
    const a=e.target instanceof Element?e.target.closest('evolution-nav a[data-evo-route]'):null;
    if(!a)return;
    const route=ROUTES[a.dataset.evoRoute]||routeFromHref(a.href);
    if(!route)return;
    e.preventDefault();e.stopImmediatePropagation();loadRoute(route,{push:true,restore:false});
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

  const boot=()=>{
    const initial=routeFromURL(location.href);
    syncRoute(initial);
    loadRoute(initial,{push:false,restore:false});
    prewarm();
  };

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
