/* Evolution Design · Smart App Shell · v39 · Premium Tier Stability Fix */
(() => {
  'use strict';

  const VERSION='39';
  const APP_BUILD=39;
  const RELEASE_ENDPOINT='/evolution-version.json';
  const RELEASE_ACK_KEY='evolution_release_ack_build';

  const ROUTES = {
    home:{key:'home',path:'/index.html',view:'/views/home.html',title:'Evolution Design',order:0,transition:{x:0,y:5,scale:.999,blur:0}},
    arquitectura:{key:'arquitectura',path:'/arquitectura.html',view:'/views/arquitectura.html',title:'Arquitectura · Evolution Design',order:1,transition:{x:0,y:8,scale:.997,blur:1}},
    grafico:{key:'grafico',path:'/diseno-grafico.html',view:'/views/diseno-grafico.html',title:'Diseño Gráfico · Evolution Design',order:2,transition:{x:10,y:0,scale:.999,blur:0}},
    web:{key:'web',path:'/diseno-web.html',view:'/views/diseno-web.html',title:'Diseño Web · Evolution Design',order:3,transition:{x:0,y:7,scale:.998,blur:2}}
  };

  const ROUTE_LIST=Object.values(ROUTES);
  const PAYMENT_ROUTES=new Set(['arquitectura','grafico','web']);
  const PAYMENT_BRIDGE='/evolution-payments.js?v=21';

  /* Orden de navegación táctil móvil. Mis Proyectos queda fuera porque
     es una zona privada y no pertenece al App Shell público. */
  const MOBILE_SWIPE_ORDER=['home','arquitectura','grafico','web'];
  const MOBILE_SWIPE_COMMIT_PROGRESS=.35;
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

  /* Live mobile pager: keeps only the immediate previous/next public view
     beside the active iframe, so the next page literally follows the finger. */
  let swipeNeighbors={prev:null,next:null};
  let swipeSettling=false;
  let swipePreviewGeneration=0;
  let swipeDepthEl=null;
  let swipeVeilEl=null;
  let swipeGlassEl=null;
  let swipeEdgeGuards=null;
  let swipeSettleToken=0;

  /* V35 · Adaptive Liquid Glass */
  let swipeVisualTier='standard';
  let swipeNativeTier='standard';
  let swipeTierReason='default';
  let swipeFrameLast=0;
  let swipeFrameBad=0;
  let swipeFrameGood=0;
  let swipeLitePaintLast=0;
  const SWIPE_TIER_STATE_BUILD=39;

  /* ---------- PERSISTENT AUTH UI STATE ----------
     La sesión real sigue perteneciendo a Firebase dentro de las vistas.
     El Shell solo conserva el estado VISUAL para evitar parpadeos al
     cambiar de sección.
  */
  let stableAuth={user:null,isAdmin:false};
  let logoutPending=false;
  let authNullTimer=0;

  const AUTH_MEMORY_KEY='evolution_shell_auth_v20';

  const readAuthMemory=()=>{
    try{
      const raw=sessionStorage.getItem(AUTH_MEMORY_KEY);
      if(!raw)return;
      const parsed=JSON.parse(raw);
      if(parsed?.user?.uid){
        stableAuth={
          user:{
            uid:String(parsed.user.uid||''),
            email:String(parsed.user.email||''),
            displayName:String(parsed.user.displayName||''),
            photoURL:String(parsed.user.photoURL||'')
          },
          isAdmin:Boolean(parsed.isAdmin)
        };
      }
    }catch(_){}
  };

  const writeAuthMemory=()=>{
    try{
      if(stableAuth.user?.uid){
        sessionStorage.setItem(AUTH_MEMORY_KEY,JSON.stringify(stableAuth));
      }else{
        sessionStorage.removeItem(AUTH_MEMORY_KEY);
      }
    }catch(_){}
  };

  const applyStableAuth=()=>{
    if(!window.EvolutionNav)return;
    window.EvolutionNav.setAuth({
      user:stableAuth.user,
      isAdmin:Boolean(stableAuth.isAdmin)
    });
  };

  const mergeAuthUser=(incoming,previous)=>{
    if(!incoming?.uid)return null;

    const same=previous?.uid&&String(previous.uid)===String(incoming.uid);

    return {
      uid:String(incoming.uid||previous?.uid||''),
      email:String(incoming.email||(same?previous?.email:'')||''),
      displayName:String(incoming.displayName||(same?previous?.displayName:'')||''),
      photoURL:String(incoming.photoURL||(same?previous?.photoURL:'')||'')
    };
  };

  const acceptAuthState=data=>{
    const incoming=data?.user||null;
    const authoritative=data?.source==='shell';

    if(incoming?.uid){
      clearTimeout(authNullTimer);
      authNullTimer=0;
      logoutPending=false;

      const previous=stableAuth.user;
      const same=previous?.uid&&String(previous.uid)===String(incoming.uid);

      stableAuth={
        user:mergeAuthUser(incoming,previous),
        /* Si una vista tarda en reconstruir el badge Admin, no lo apagues. */
        isAdmin:Boolean(data.isAdmin)||(same&&Boolean(stableAuth.isAdmin))
      };

      writeAuthMemory();
      applyStableAuth();
      return;
    }

    /* El Auth del Shell es la fuente real. Si Firebase central confirma
       user:null, limpiamos el estado aunque no haya sido un logout manual. */
    if(authoritative){
      clearTimeout(authNullTimer);
      authNullTimer=0;
      stableAuth={user:null,isAdmin:false};
      logoutPending=false;
      writeAuthMemory();
      applyStableAuth();
      return;
    }

    /* Logout explícito: aquí sí se limpia de inmediato cuando Firebase
       reporta null desde una vista. */
    if(logoutPending){
      clearTimeout(authNullTimer);
      authNullTimer=0;
      stableAuth={user:null,isAdmin:false};
      logoutPending=false;
      writeAuthMemory();
      applyStableAuth();
      return;
    }

    /* Si ya conocemos una sesión, un null recién cargando otra vista es
       transitorio. Mantenemos foto/Admin y esperamos confirmación estable. */
    if(stableAuth.user?.uid){
      clearTimeout(authNullTimer);

      if(networkMode==='offline'){
        applyStableAuth();
        return;
      }

      authNullTimer=setTimeout(()=>{
        /*
         * No borramos la UI por un null aislado de una vista nueva.
         * Una sesión que realmente terminó se limpia mediante el flujo
         * explícito de logout. Esto evita el flash Login → Perfil.
         */
        applyStableAuth();
      },7000);

      return;
    }

    stableAuth={user:null,isAdmin:false};
    writeAuthMemory();
    applyStableAuth();
  };

  readAuthMemory();

  /* ---------- CENTRAL FIREBASE AUTH · LOCAL ONLY ----------
     Este Auth vive en el App Shell y sobrevive al cierre de la PWA.
     No guarda contraseñas ni tokens manualmente: Firebase administra
     su propia sesión persistente en IndexedDB/localStorage.
  */
  const FIREBASE_CONFIG={
    apiKey:"AIzaSyA5b-2R5WUQNOt3N2cAKBZK3x5--YhwzHM",
    authDomain:"evolution-design-9b63b.firebaseapp.com",
    projectId:"evolution-design-9b63b",
    storageBucket:"evolution-design-9b63b.firebasestorage.app",
    messagingSenderId:"433474708581",
    appId:"1:433474708581:web:cff7830077fb7d0e8a128c"
  };

  const ADMIN_EMAILS=new Set([
    'evolutiongt01@gmail.com',
    'tepaz2025@gmail.com'
  ]);

  let shellAuth=null;
  let shellAuthModule=null;
  let shellAuthReady=null;

  const publicUser=user=>user?{
    uid:user.uid||'',
    email:user.email||'',
    displayName:user.displayName||'',
    photoURL:user.photoURL||''
  }:null;

  const initShellAuth=()=>{
    if(shellAuthReady)return shellAuthReady;

    shellAuthReady=(async()=>{
      try{
        const [appModule,authModule]=await Promise.all([
          import('https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js'),
          import('https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js')
        ]);

        shellAuthModule=authModule;

        const firebaseApp=appModule.getApps().length
          ? appModule.getApp()
          : appModule.initializeApp(FIREBASE_CONFIG);

        try{
          shellAuth=authModule.initializeAuth(firebaseApp,{
            persistence:[
              authModule.indexedDBLocalPersistence,
              authModule.browserLocalPersistence
            ]
          });
        }catch(error){
          /* Si otra integración del Shell ya inicializó Auth, reutilízala
             y fuerza una persistencia LOCAL. Nunca SESSION. */
          shellAuth=authModule.getAuth(firebaseApp);

          try{
            await authModule.setPersistence(shellAuth,authModule.indexedDBLocalPersistence);
          }catch(indexedDBError){
            await authModule.setPersistence(shellAuth,authModule.browserLocalPersistence);
          }
        }

        authModule.onAuthStateChanged(shellAuth,user=>{
          const email=String(user?.email||'').toLowerCase();

          acceptAuthState({
            source:'shell',
            user:publicUser(user),
            isAdmin:Boolean(user&&ADMIN_EMAILS.has(email))
          });
        });

        window.EvolutionShellAuth={
          get currentUser(){return shellAuth?.currentUser||null},
          async signOut(){
            if(!shellAuth||!shellAuthModule)return;
            await shellAuthModule.signOut(shellAuth);
          },
          async getIdToken(forceRefresh=false){
            const user=shellAuth?.currentUser;
            return user?await user.getIdToken(Boolean(forceRefresh)):'';
          }
        };

        return shellAuth;
      }catch(error){
        console.warn('Evolution Shell Auth:',error?.code||error);
        return null;
      }
    })();

    return shellAuthReady;
  };

  /* ---------- SMART APP CSS ---------- */
  const smartStyle=document.createElement('style');
  smartStyle.id='evolution-smart-app-style';
  smartStyle.textContent=`
    html,body{
      overscroll-behavior-x:none!important;
    }
    #evolution-view-stage{
      background:
        radial-gradient(circle at 50% 42%,rgba(212,184,149,.035),transparent 42%),
        #030303!important;
    }

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

    /* V32 · Full Surface Liquid Cards
       La tarjeta saliente reduce su escala de forma claramente visible,
       recibe una superficie Liquid Glass, y la entrante crece desde atrás.
       No existe traslación horizontal continua de glifos. */
    .evo-view-frame.evo-swipe-neighbor{
      opacity:1!important;
      filter:none!important;
      pointer-events:none!important;
      z-index:4!important;
      visibility:hidden;
      transform:translateZ(0) scale(.885)!important;
      transform-origin:center center!important;
      border-radius:36px!important;
      will-change:auto;
      backface-visibility:hidden;
      -webkit-backface-visibility:hidden;
      contain:paint;
    }
    .evo-view-frame.evo-swipe-neighbor.evo-swipe-visible{
      visibility:visible!important;
    }

    body.evo-live-swipe-dragging .evo-view-frame.evo-view-active{
      transition:none!important;
      transform:translateZ(0) scale(var(--evo-active-card-scale,1))!important;
      border-radius:var(--evo-active-card-radius,0px)!important;
      will-change:transform,border-radius;
      backface-visibility:hidden;
      -webkit-backface-visibility:hidden;
    }
    body.evo-live-swipe-dragging .evo-view-frame.evo-swipe-neighbor{
      transition:none!important;
      transform:translateZ(0) scale(var(--evo-next-card-scale,.885))!important;
      border-radius:var(--evo-next-card-radius,36px)!important;
      will-change:transform,clip-path,border-radius;
    }

    body.evo-live-swipe-settling .evo-view-frame.evo-view-active{
      transition:
        transform .245s cubic-bezier(.18,.88,.22,1),
        border-radius .245s cubic-bezier(.18,.88,.22,1)!important;
      transform:translateZ(0) scale(var(--evo-active-card-scale,1))!important;
      border-radius:var(--evo-active-card-radius,0px)!important;
      will-change:transform,border-radius;
    }
    body.evo-live-swipe-settling .evo-view-frame.evo-swipe-neighbor{
      transition:
        clip-path .245s cubic-bezier(.18,.88,.22,1),
        transform .245s cubic-bezier(.18,.88,.22,1),
        border-radius .245s cubic-bezier(.18,.88,.22,1)!important;
      transform:translateZ(0) scale(var(--evo-next-card-scale,.885))!important;
      border-radius:var(--evo-next-card-radius,36px)!important;
      will-change:transform,clip-path,border-radius;
    }

    /* Vidrio sobre la tarjeta que queda atrás. Es una sola superficie;
       no aplicamos filter:blur() al iframe ni movemos sus glifos. */
    #evolution-view-stage .evo-swipe-glass{
      position:absolute;
      inset:0;
      z-index:3;
      pointer-events:none;
      opacity:0;
      overflow:hidden;
      border:1px solid rgba(255,255,255,0);
      border-radius:0;
      background:
        radial-gradient(circle at 18% 10%,
          rgba(255,255,255,.18),
          rgba(255,255,255,0) 31%),
        linear-gradient(145deg,
          rgba(255,255,255,.115),
          rgba(255,255,255,.028) 38%,
          rgba(212,184,149,.065) 100%);
      -webkit-backdrop-filter:blur(0px) saturate(1);
      backdrop-filter:blur(0px) saturate(1);
      box-shadow:none;
      contain:paint;
      will-change:
        opacity,
        backdrop-filter,
        inset,
        border-radius,
        box-shadow;
    }
    #evolution-view-stage .evo-swipe-glass::before{
      content:"";
      position:absolute;
      inset:0;
      pointer-events:none;
      opacity:.78;
      background:
        linear-gradient(
          115deg,
          rgba(255,255,255,.12) 0%,
          rgba(255,255,255,.025) 22%,
          rgba(255,255,255,0) 43%
        );
    }
    #evolution-view-stage .evo-swipe-glass::after{
      content:"";
      position:absolute;
      left:9%;
      right:9%;
      top:0;
      height:1px;
      pointer-events:none;
      background:linear-gradient(
        90deg,
        transparent,
        rgba(255,255,255,.28),
        transparent
      );
      opacity:.72;
    }

    /* Velo de profundidad debajo de la tarjeta entrante. */
    #evolution-view-stage .evo-swipe-veil{
      position:absolute;
      inset:0;
      z-index:2;
      pointer-events:none;
      background:#000;
      opacity:0;
      contain:paint;
    }

    /* V33: unión LIQUID GLASS. Ya no existe línea vertical.
       Es una franja ancha que mezcla ambas páginas con degradado,
       un blur local muy pequeño y bordes totalmente desvanecidos. */
    #evolution-view-stage .evo-swipe-depth{
      position:absolute;
      top:0;
      bottom:0;
      left:0;
      width:144px;
      z-index:6;
      pointer-events:none;
      opacity:0;
      transform:translate3d(-260px,0,0);
      border:0!important;
      background:rgba(6,6,8,.035);
      -webkit-backdrop-filter:blur(2.2px) saturate(1.04);
      backdrop-filter:blur(2.2px) saturate(1.04);
      -webkit-mask-image:linear-gradient(
        90deg,
        transparent 0%,
        #000 18%,
        #000 82%,
        transparent 100%
      );
      mask-image:linear-gradient(
        90deg,
        transparent 0%,
        #000 18%,
        #000 82%,
        transparent 100%
      );
      contain:paint;
      will-change:transform,opacity;
    }
    #evolution-view-stage .evo-swipe-depth::before{
      content:"";
      position:absolute;
      inset:0;
      border:0!important;
    }
    #evolution-view-stage .evo-swipe-depth::after{
      display:none!important;
      content:none!important;
    }
    #evolution-view-stage .evo-swipe-depth.from-next::before{
      background:linear-gradient(
        90deg,
        rgba(0,0,0,0) 0%,
        rgba(0,0,0,.028) 20%,
        rgba(0,0,0,.14) 48%,
        rgba(212,184,149,.035) 64%,
        rgba(0,0,0,0) 100%
      );
    }
    #evolution-view-stage .evo-swipe-depth.from-prev::before{
      background:linear-gradient(
        90deg,
        rgba(0,0,0,0) 0%,
        rgba(212,184,149,.035) 36%,
        rgba(0,0,0,.14) 52%,
        rgba(0,0,0,.028) 80%,
        rgba(0,0,0,0) 100%
      );
    }
    #evolution-view-stage .evo-swipe-depth.is-visible{
      opacity:var(--evo-swipe-depth-opacity,.58);
    }

    /* =========================================================
       V35 · ADAPTIVE LIQUID GLASS
       Premium = más cristal.
       Lite = misma estética, sin filtros GPU caros durante el dedo.
       ========================================================= */

    html[data-evo-swipe-tier="premium"]
    #evolution-view-stage .evo-swipe-glass{
      background:
        radial-gradient(circle at 13% 7%,rgba(255,255,255,.34),rgba(255,255,255,0) 27%),
        radial-gradient(circle at 82% 82%,rgba(212,184,149,.15),rgba(212,184,149,0) 38%),
        linear-gradient(
          145deg,
          rgba(255,255,255,.185),
          rgba(255,255,255,.045) 38%,
          rgba(212,184,149,.105) 100%
        );
    }

    html[data-evo-swipe-tier="premium"]
    #evolution-view-stage .evo-swipe-glass::before{
      opacity:1;
      background:
        linear-gradient(
          116deg,
          rgba(255,255,255,.245) 0%,
          rgba(255,255,255,.065) 18%,
          rgba(255,255,255,.014) 34%,
          rgba(255,255,255,0) 48%
        );
    }

    html[data-evo-swipe-tier="premium"]
    #evolution-view-stage .evo-swipe-glass::after{
      left:6%;
      right:6%;
      top:0;
      height:1px;
      display:block;
      opacity:.95;
      background:linear-gradient(
        90deg,
        transparent,
        rgba(255,255,255,.44) 22%,
        rgba(212,184,149,.32) 52%,
        rgba(255,255,255,.24) 76%,
        transparent
      );
    }

    html[data-evo-swipe-tier="premium"]
    #evolution-view-stage .evo-swipe-depth{
      width:184px;
      -webkit-backdrop-filter:blur(4.4px) saturate(1.10);
      backdrop-filter:blur(4.4px) saturate(1.10);
    }

    /* En Premium la tarjeta anterior realmente se separa del fondo.
       No afecta Standard/Lite. */
    html[data-evo-swipe-tier="premium"]
    body.evo-live-swipe-dragging .evo-view-frame.evo-view-active{
      transform:
        translateZ(0)
        scale(var(--evo-active-card-scale,1))!important;
      border-radius:var(--evo-active-card-radius,0px)!important;
      box-shadow:
        0 30px 95px rgba(0,0,0,.34),
        0 0 0 1px rgba(255,255,255,.025)!important;
    }

    html[data-evo-swipe-tier="premium"]
    body.evo-live-swipe-settling .evo-view-frame.evo-view-active{
      box-shadow:
        0 30px 95px rgba(0,0,0,.34),
        0 0 0 1px rgba(255,255,255,.025)!important;
    }

    /* LITE: pensado para iPhone 8 Plus y hardware equivalente. */
    html[data-evo-swipe-tier="lite"]
    body.evo-live-swipe-dragging .evo-view-frame.evo-view-active{
      transform:none!important;
      border-radius:0!important;
      will-change:auto!important;
    }

    html[data-evo-swipe-tier="lite"]
    body.evo-live-swipe-dragging .evo-view-frame.evo-swipe-neighbor{
      transform:none!important;
      border-radius:0!important;
      will-change:clip-path!important;
    }

    html[data-evo-swipe-tier="lite"]
    #evolution-view-stage .evo-swipe-glass{
      inset:0!important;
      border-radius:0!important;
      border-color:transparent!important;
      -webkit-backdrop-filter:none!important;
      backdrop-filter:none!important;
      box-shadow:none!important;
      will-change:opacity!important;
      background:linear-gradient(115deg,rgba(255,255,255,.072),rgba(255,255,255,.018) 36%,rgba(212,184,149,.038))!important;
    }

    html[data-evo-swipe-tier="lite"]
    #evolution-view-stage .evo-swipe-glass::before{
      opacity:.58;
      background:linear-gradient(110deg,rgba(255,255,255,.09),rgba(255,255,255,.018) 30%,transparent 56%);
    }

    html[data-evo-swipe-tier="lite"]
    #evolution-view-stage .evo-swipe-glass::after{
      display:none!important;
    }

    html[data-evo-swipe-tier="lite"]
    #evolution-view-stage .evo-swipe-depth{
      width:76px!important;
      background:transparent!important;
      -webkit-backdrop-filter:none!important;
      backdrop-filter:none!important;
      -webkit-mask-image:linear-gradient(90deg,transparent,#000 32%,#000 68%,transparent)!important;
      mask-image:linear-gradient(90deg,transparent,#000 32%,#000 68%,transparent)!important;
      will-change:transform,opacity!important;
    }

    html[data-evo-swipe-tier="lite"]
    #evolution-view-stage .evo-swipe-depth.from-next::before{
      background:linear-gradient(90deg,transparent,rgba(0,0,0,.055) 48%,rgba(212,184,149,.025) 68%,transparent)!important;
    }

    html[data-evo-swipe-tier="lite"]
    #evolution-view-stage .evo-swipe-depth.from-prev::before{
      background:linear-gradient(90deg,transparent,rgba(212,184,149,.025) 32%,rgba(0,0,0,.055) 52%,transparent)!important;
    }

    html[data-evo-swipe-tier="lite"]
    body.evo-live-swipe-settling .evo-view-frame.evo-view-active{
      transition:opacity .20s ease!important;
      transform:none!important;
      border-radius:0!important;
    }

    html[data-evo-swipe-tier="lite"]
    body.evo-live-swipe-settling .evo-view-frame.evo-swipe-neighbor{
      transition:clip-path .205s cubic-bezier(.18,.88,.22,1)!important;
      transform:none!important;
      border-radius:0!important;
    }

    /* V32: guard del borde FÍSICO de toda la pantalla, incluyendo navbar
       y cualquier franja fuera del iframe. Solo ocupa 30px. */
    .evo-swipe-edge-guard{
      position:fixed;
      top:0;
      bottom:0;
      width:30px;
      z-index:2147483200;
      background:transparent;
      pointer-events:auto;
      touch-action:none;
      -webkit-user-select:none;
      user-select:none;
    }
    .evo-swipe-edge-guard.left{left:0}
    .evo-swipe-edge-guard.right{right:0}

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

      const p=u.pathname
        .replace(/\/{2,}/g,'/')
        .replace(/\/$/,'')
        .toLowerCase() || '/';

      if(PRIVATE_HINTS.some(x=>p.includes(x)))return null;

      /* IMPORTANTE:
         Solo estas cuatro rutas pertenecen al router público.
         Un enlace interno, feedback, sobre-nosotros, archivo, etc.
         jamás debe convertirse accidentalmente en Home. */
      if(p==='/'||p==='/index.html')return ROUTES.home;
      if(p==='/arquitectura'||p==='/arquitectura.html')return ROUTES.arquitectura;
      if(p==='/diseno-grafico'||p==='/diseno-grafico.html')return ROUTES.grafico;
      if(p==='/diseno-web'||p==='/diseno-web.html')return ROUTES.web;

      return null;
    }catch(_){return null}
  };

  const scrollActiveViewToHash=href=>{
    if(!activeFrame)return false;

    try{
      const raw=String(href||'').trim();
      const frameURL=new URL(activeFrame.contentWindow.location.href);
      const targetURL=new URL(raw,frameURL);

      if(targetURL.origin!==location.origin||!targetURL.hash)return false;

      const id=decodeURIComponent(targetURL.hash.slice(1));
      if(!id){
        activeFrame.contentWindow.scrollTo({top:0,behavior:'smooth'});
        return true;
      }

      const doc=activeFrame.contentDocument;
      const target=
        doc?.getElementById(id) ||
        doc?.querySelector?.(`[name="${CSS.escape(id)}"]`);

      if(!target)return false;

      target.scrollIntoView({
        behavior:'smooth',
        block:'start'
      });

      /* Conserva el hash en la URL visible sin recargar ni destruir la vista. */
      const route=ROUTES[activeKey]||routeFromURL(location.href);
      history.replaceState(
        {evolutionRoute:route.key},
        '',
        `${route.path}${targetURL.hash}`
      );

      return true;
    }catch(error){
      console.warn('[Evolution App] Internal anchor:',error);
      return false;
    }
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

  const injectPaymentsBridge=(frame,route)=>{
    if(!frame||!route||!PAYMENT_ROUTES.has(route.key))return;

    try{
      const doc=frame.contentDocument;
      if(!doc?.head)return;

      if(
        frame.contentWindow?.EvolutionPayments?.version ||
        doc.querySelector('script[data-evolution-payments-bridge]')
      ){
        return;
      }

      const script=doc.createElement('script');
      script.src=PAYMENT_BRIDGE;
      script.async=true;
      script.dataset.evolutionPaymentsBridge='21';
      script.dataset.evolutionPaymentsRoute=route.key;

      script.onerror=()=>{
        console.error(
          '[Evolution App] No se pudo cargar evolution-payments.js en',
          route.key
        );
      };

      doc.head.appendChild(script);
    }catch(error){
      console.warn('[Evolution App] Payments bridge:',error);
    }
  };

  const repairViewLocalControls=(frame,route)=>{
    if(!frame)return;

    try{
      const doc=frame.contentDocument;
      if(!doc)return;

      /*
       * Las views antiguas tienen controles con:
       *   <a href="#" onclick="abrirPedido...();return false">
       *
       * El bridge del App Shell escucha clicks en CAPTURE y, para "#",
       * puede interpretarlos como navegación principal antes de que el
       * onclick del control alcance a ejecutarse.
       *
       * Convertimos SOLO los anchors de control (href="#" + id/onclick)
       * a un hash local inofensivo. El bridge los reconoce como internos
       * y deja que su JS original haga el trabajo.
       */
      const patchAnchor=a=>{
        if(!(a instanceof frame.contentWindow.HTMLAnchorElement))return;
        if(a.getAttribute('href')!=='#')return;

        /*
         * Solo quitamos href en controles que YA poseen una acción JS.
         * Ejemplos reales:
         *   dgCustomCta -> abrirPedidoDiseno()
         *   dgLogoCta   -> abrirPedidoLogo()
         *   dgVideoCta  -> abrirPedidoVideo()
         *
         * Al no tener atributo href, el bridge antiguo de la view
         * (closest('a[href]')) no puede confundirlos con navegación.
         */
        const inlineAction=Boolean(a.getAttribute('onclick'));
        const knownGraphicCTA=[
          'dgCustomCta',
          'dgLogoCta',
          'dgVideoCta'
        ].includes(a.id);

        if(!inlineAction&&!knownGraphicCTA)return;

        a.removeAttribute('href');
        a.setAttribute('role','button');
        if(!a.hasAttribute('tabindex'))a.setAttribute('tabindex','0');
        a.dataset.evolutionLocalControl='1';

        /* Accesibilidad: Enter/Espacio ejecutan el click normal del CTA. */
        if(!a.dataset.evolutionKeyboardBound){
          a.dataset.evolutionKeyboardBound='1';
          a.addEventListener('keydown',event=>{
            if(event.key==='Enter'||event.key===' '){
              event.preventDefault();
              a.click();
            }
          });
        }
      };

      doc.querySelectorAll('a[href="#"]').forEach(patchAnchor);

      /* También cubre controles que Firebase/JS agregue dinámicamente. */
      if(!frame.__evolutionLocalControlsObserver){
        const Observer=frame.contentWindow.MutationObserver;
        if(Observer){
          const observer=new Observer(records=>{
            for(const record of records){
              if(
                record.type==='attributes' &&
                record.target instanceof frame.contentWindow.HTMLAnchorElement &&
                record.target.getAttribute('href')==='#'
              ){
                patchAnchor(record.target);
              }

              for(const node of record.addedNodes||[]){
                if(!(node instanceof frame.contentWindow.Element))continue;
                if(node.matches?.('a[href="#"]'))patchAnchor(node);
                node.querySelectorAll?.('a[href="#"]').forEach(patchAnchor);
              }
            }
          });

          observer.observe(doc.documentElement,{
            childList:true,
            subtree:true,
            attributes:true,
            attributeFilter:['href']
          });

          frame.__evolutionLocalControlsObserver=observer;
        }
      }
    }catch(error){
      console.warn('[Evolution App] Local controls repair:',error);
    }
  };

  const setSwipeVisualTier=(tier,reason='runtime')=>{
    const next=['premium','standard','lite'].includes(tier)?tier:'standard';

    swipeVisualTier=next;
    swipeTierReason=reason;

    document.documentElement.dataset.evoSwipeTier=next;
    document.documentElement.dataset.evoSwipeTierReason=reason;

    /* V39: cualquier estado adaptativo queda ligado a ESTA build.
       Una actualización nunca hereda un downgrade viejo. */
    try{
      sessionStorage.setItem('evolution_swipe_tier_runtime',next);
      sessionStorage.setItem('evolution_swipe_tier_reason',reason);
      sessionStorage.setItem(
        'evolution_swipe_tier_build',
        String(SWIPE_TIER_STATE_BUILD)
      );
    }catch(_){}
  };

  const baseSwipeHardwareTier=()=>{
    const ua=navigator.userAgent||'';
    const ios=/iphone|ipad|ipod/i.test(ua) ||
      (navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);

    const longSide=Math.max(
      Number(screen.width||0),
      Number(screen.height||0),
      Number(innerWidth||0),
      Number(innerHeight||0)
    );

    const shortSide=Math.min(
      ...[
        Number(screen.width||0),
        Number(screen.height||0),
        Number(innerWidth||0),
        Number(innerHeight||0)
      ].filter(Boolean)
    );

    const cores=Number(navigator.hardwareConcurrency||0);
    const memory=Number(navigator.deviceMemory||0);
    const reduced=
      typeof matchMedia==='function' &&
      matchMedia('(prefers-reduced-motion: reduce)').matches;

    if(reduced){
      return {
        tier:'lite',
        reason:'reduced-motion',
        ios,longSide,shortSide,cores,memory
      };
    }

    /* iPhone 8 Plus = 414×736 CSS px.
       Equipos equivalentes o más antiguos arrancan en Lite. */
    if(ios&&longSide>0&&longSide<=736){
      return {
        tier:'lite',
        reason:'legacy-ios-viewport',
        ios,longSide,shortSide,cores,memory
      };
    }

    if(memory>0&&memory<=3){
      return {
        tier:'lite',
        reason:'low-memory',
        ios,longSide,shortSide,cores,memory
      };
    }

    if(!ios&&cores>0&&cores<=4){
      return {
        tier:'lite',
        reason:'low-core-count',
        ios,longSide,shortSide,cores,memory
      };
    }

    /* 430×932 (14 Pro Max), 428×926, 414×896 y otros iPhone
       modernos grandes son Premium explícito.
       390×844 también es hardware suficientemente moderno. */
    if(
      (ios&&longSide>=844) ||
      (!ios&&(memory>=8||cores>=8))
    ){
      return {
        tier:'premium',
        reason:'high-capability',
        ios,longSide,shortSide,cores,memory
      };
    }

    return {
      tier:'standard',
      reason:'balanced',
      ios,longSide,shortSide,cores,memory
    };
  };

  const detectSwipeVisualTier=()=>{
    try{
      const forced=new URL(location.href).searchParams.get('evo_swipe');
      if(['premium','standard','lite'].includes(forced)){
        return {
          tier:forced,
          nativeTier:forced,
          reason:'query-override'
        };
      }
    }catch(_){}

    const hardware=baseSwipeHardwareTier();

    /* Premium-capable devices ALWAYS start Premium after a reload/build.
       We intentionally ignore old adaptive downgrades on these devices. */
    if(hardware.tier==='premium'){
      return {
        tier:'premium',
        nativeTier:'premium',
        reason:hardware.reason
      };
    }

    /* Only restore an adaptive downgrade when it belongs to the exact
       same app build. No stale V35/V36/V37 state survives V39. */
    try{
      const saved=sessionStorage.getItem('evolution_swipe_tier_runtime');
      const reason=sessionStorage.getItem('evolution_swipe_tier_reason');
      const build=Number(
        sessionStorage.getItem('evolution_swipe_tier_build')||0
      );

      if(
        build===SWIPE_TIER_STATE_BUILD &&
        saved==='lite' &&
        reason==='fps-downgrade'
      ){
        return {
          tier:'lite',
          nativeTier:hardware.tier,
          reason:'fps-downgrade'
        };
      }
    }catch(_){}

    return {
      tier:hardware.tier,
      nativeTier:hardware.tier,
      reason:hardware.reason
    };
  };

  const initializeSwipeVisualTier=()=>{
    /* Elimina downgrade viejo de otra build. */
    try{
      const storedBuild=Number(
        sessionStorage.getItem('evolution_swipe_tier_build')||0
      );

      if(storedBuild!==SWIPE_TIER_STATE_BUILD){
        sessionStorage.removeItem('evolution_swipe_tier_runtime');
        sessionStorage.removeItem('evolution_swipe_tier_reason');
        sessionStorage.removeItem('evolution_swipe_tier_build');
      }
    }catch(_){}

    const result=detectSwipeVisualTier();
    swipeNativeTier=result.nativeTier||result.tier;
    setSwipeVisualTier(result.tier,result.reason);
  };

  const beginSwipeFrameBudget=()=>{
    swipeFrameLast=0;
    swipeFrameBad=0;
    swipeFrameGood=0;
    swipeLitePaintLast=0;
  };

  const noteSwipeFrameBudget=now=>{
    const t=Number(now)||performance.now();

    if(swipeFrameLast){
      const dt=t-swipeFrameLast;

      /* PREMIUM:
         Ya no cae a Lite por 4 frames lentos.
         Requiere una degradación sostenida y solo baja a Standard. */
      if(swipeVisualTier==='premium'){
        if(dt>42){
          swipeFrameBad++;
          swipeFrameGood=0;
        }else if(dt<25){
          swipeFrameGood++;
          if(swipeFrameGood>=3){
            swipeFrameBad=Math.max(0,swipeFrameBad-1);
            swipeFrameGood=0;
          }
        }

        if(swipeFrameBad>=12){
          setSwipeVisualTier('standard','fps-stepdown');
          swipeFrameBad=0;
          swipeFrameGood=0;
        }
      }

      /* STANDARD:
         Solo baja a Lite si la caída continúa de forma clara. */
      else if(swipeVisualTier==='standard'){
        if(dt>36){
          swipeFrameBad++;
          swipeFrameGood=0;
        }else if(dt<25){
          swipeFrameGood++;
          if(swipeFrameGood>=2){
            swipeFrameBad=Math.max(0,swipeFrameBad-1);
            swipeFrameGood=0;
          }
        }

        if(swipeFrameBad>=10){
          setSwipeVisualTier('lite','fps-downgrade');
          swipeFrameBad=0;
          swipeFrameGood=0;
        }
      }
    }

    swipeFrameLast=t;
  };

  const allowSwipePaint=now=>{
    const t=Number(now)||performance.now();

    if(swipeVisualTier!=='lite')return true;

    /* Lite prioriza estabilidad perceptual en GPU antiguas. */
    if(swipeLitePaintLast&&t-swipeLitePaintLast<23){
      return false;
    }

    swipeLitePaintLast=t;
    return true;
  };


  const mobileSwipeCapable=()=>{
    try{
      return matchMedia('(max-width: 991.98px)').matches &&
        (navigator.maxTouchPoints>0 || 'ontouchstart' in window);
    }catch(_){return false}
  };

  const routeBeside=(key,side)=>{
    const i=MOBILE_SWIPE_ORDER.indexOf(key);
    if(i<0)return null;
    const next=i+(side==='next'?1:-1);
    if(next<0||next>=MOBILE_SWIPE_ORDER.length)return null;
    return ROUTES[MOBILE_SWIPE_ORDER[next]]||null;
  };

  const setSwipeClip=(frame,side,progress)=>{
    if(!frame)return;

    const p=Math.max(0,Math.min(1,Number(progress)||0));
    frame.dataset.swipeSide=side;

    if(swipeVisualTier==='lite'){
      const width=
        frame.clientWidth ||
        innerWidth ||
        document.documentElement.clientWidth ||
        375;

      const hiddenPx=Math.max(0,Math.round((1-p)*width));

      if(side==='next'){
        frame.style.setProperty('clip-path',`inset(0 0 0 ${hiddenPx}px)`,'important');
      }else{
        frame.style.setProperty('clip-path',`inset(0 ${hiddenPx}px 0 0)`,'important');
      }
      return;
    }

    const hidden=((1-p)*100).toFixed(3);

    if(side==='next'){
      frame.style.setProperty('clip-path',`inset(0 0 0 ${hidden}%)`,'important');
    }else{
      frame.style.setProperty('clip-path',`inset(0 ${hidden}% 0 0)`,'important');
    }
  };

  const showSwipeNeighbor=frame=>{
    if(!frame)return;
    frame.classList.add('evo-swipe-visible');
  };

  const hideSwipeNeighbor=frame=>{
    if(!frame)return;
    frame.classList.remove('evo-swipe-visible');
  };

  const ensureSwipeDepth=()=>{
    const host=stage();
    if(!host)return null;
    if(swipeDepthEl?.isConnected)return swipeDepthEl;
    const el=document.createElement('div');
    el.className='evo-swipe-depth';
    el.setAttribute('aria-hidden','true');
    host.appendChild(el);
    swipeDepthEl=el;
    return el;
  };

  const ensureSwipeVeil=()=>{
    const host=stage();
    if(!host)return null;
    if(swipeVeilEl?.isConnected)return swipeVeilEl;
    const el=document.createElement('div');
    el.className='evo-swipe-veil';
    el.setAttribute('aria-hidden','true');
    host.appendChild(el);
    swipeVeilEl=el;
    return el;
  };

  const ensureSwipeGlass=()=>{
    const host=stage();
    if(!host)return null;
    if(swipeGlassEl?.isConnected)return swipeGlassEl;
    const el=document.createElement('div');
    el.className='evo-swipe-glass';
    el.setAttribute('aria-hidden','true');
    host.appendChild(el);
    swipeGlassEl=el;
    return el;
  };

  const clearFrameCardState=frame=>{
    if(!frame)return;
    frame.style.removeProperty('--evo-active-card-scale');
    frame.style.removeProperty('--evo-active-card-radius');
    frame.style.removeProperty('--evo-next-card-scale');
    frame.style.removeProperty('--evo-next-card-radius');
    frame.style.removeProperty('border-radius');
  };

  const updateLiquidGlassSwipe=(active,neighbor,boundaryX,progress=0,side='next')=>{
    const depth=ensureSwipeDepth();
    const veil=ensureSwipeVeil();
    const glass=ensureSwipeGlass();
    if(!active||!neighbor||!depth||!veil||!glass)return;

    const p=Math.max(0,Math.min(1,Number(progress)||0));
    const g=p*p*(3-(2*p));
    const tier=swipeVisualTier;

    if(tier==='lite'){
      active.style.setProperty('--evo-active-card-scale','1');
      active.style.setProperty('--evo-active-card-radius','0px');
      neighbor.style.setProperty('--evo-next-card-scale','1');
      neighbor.style.setProperty('--evo-next-card-radius','0px');

      glass.style.inset='0';
      glass.style.borderRadius='0';
      glass.style.opacity=(g*.48).toFixed(3);
      glass.style.borderColor='transparent';
      glass.style.webkitBackdropFilter='none';
      glass.style.backdropFilter='none';
      glass.style.boxShadow='none';

      veil.style.opacity=(g*.045).toFixed(3);

      depth.classList.toggle('from-next',side==='next');
      depth.classList.toggle('from-prev',side==='prev');
      depth.style.setProperty('--evo-swipe-depth-opacity',(.38-(p*.10)).toFixed(3));

      const blendWidth=76;
      const offset=side==='next'?blendWidth*.68:blendWidth*.32;
      depth.style.transform=`translate3d(${Math.round(boundaryX-offset)}px,0,0)`;
      depth.classList.add('is-visible');
      return;
    }

    const premium=tier==='premium';

    /* V36 PREMIUM:
       anterior 100% -> 86%
       entrante 84.5% -> 100%
       Standard conserva exactamente los valores de V35. */
    const activeScale=1-(p*(premium?.14:.085));
    const base=premium?.845:.885;
    const nextScale=base+(p*(1-base));
    const activeRadius=p*(premium?48:36);
    const nextRadius=(1-p)*(premium?48:36);

    active.style.setProperty('--evo-active-card-scale',activeScale.toFixed(4));
    active.style.setProperty('--evo-active-card-radius',`${activeRadius.toFixed(2)}px`);
    neighbor.style.setProperty('--evo-next-card-scale',nextScale.toFixed(4));
    neighbor.style.setProperty('--evo-next-card-radius',`${nextRadius.toFixed(2)}px`);

    const cardInset=p*(premium?28:17);
    const maxBlur=premium?19:10.5;
    const blur=Math.min(maxBlur,g*maxBlur);
    const glassOpacity=Math.min(premium?.995:.96,g*(premium?.995:.96));

    glass.style.inset=`${cardInset.toFixed(2)}px`;
    glass.style.borderRadius=`${activeRadius.toFixed(2)}px`;
    glass.style.opacity=glassOpacity.toFixed(3);
    glass.style.borderColor=
      `rgba(255,255,255,${(.018+g*(premium?.205:.125)).toFixed(3)})`;

    const saturation=1+(g*(premium?.28:.14));
    glass.style.webkitBackdropFilter=
      `blur(${blur.toFixed(2)}px) saturate(${saturation.toFixed(3)})`;
    glass.style.backdropFilter=
      `blur(${blur.toFixed(2)}px) saturate(${saturation.toFixed(3)})`;

    glass.style.boxShadow=[
      `0 ${(12+g*(premium?34:18)).toFixed(1)}px ${(34+g*(premium?92:48)).toFixed(1)}px rgba(0,0,0,${(.10+g*(premium?.54:.40)).toFixed(3)})`,
      `0 0 ${(premium?46:0)*g}px rgba(212,184,149,${(premium?g*.075:0).toFixed(3)})`,
      `inset 0 1px 0 rgba(255,255,255,${(.035+g*(premium?.23:.12)).toFixed(3)})`,
      `inset 0 0 0 1px rgba(212,184,149,${(g*(premium?.085:.045)).toFixed(3)})`
    ].join(',');

    veil.style.opacity=(g*(premium?.145:.10)).toFixed(3);

    depth.classList.toggle('from-next',side==='next');
    depth.classList.toggle('from-prev',side==='prev');
    depth.style.setProperty(
      '--evo-swipe-depth-opacity',
      ((premium?.80:.66)-(p*(premium?.20:.16))).toFixed(3)
    );

    const blendWidth=premium?184:144;
    const offset=side==='next'?blendWidth*.72:blendWidth*.28;
    depth.style.transform=`translate3d(${Math.round(boundaryX-offset)}px,0,0)`;
    depth.classList.add('is-visible');
  };

  const hideSwipeDepth=()=>{
    if(swipeDepthEl){
      swipeDepthEl.classList.remove('is-visible','from-next','from-prev');
    }
    if(swipeVeilEl)swipeVeilEl.style.opacity='0';
    if(swipeGlassEl){
      swipeGlassEl.style.opacity='0';
      swipeGlassEl.style.inset='0';
      swipeGlassEl.style.borderRadius='0';
      swipeGlassEl.style.borderColor='rgba(255,255,255,0)';
      swipeGlassEl.style.webkitBackdropFilter='blur(0px) saturate(1)';
      swipeGlassEl.style.backdropFilter='blur(0px) saturate(1)';
      swipeGlassEl.style.boxShadow='none';
    }
  };

  const hardResetSwipeVisuals=()=>{
    /* Invalida cualquier timeout pendiente de settle/commit. */
    swipeSettleToken++;
    swipeSettling=false;

    document.body.classList.remove(
      'evo-live-swipe-dragging',
      'evo-live-swipe-settling'
    );

    hideSwipeDepth();
    clearFrameCardState(activeFrame);

    for(const side of ['prev','next']){
      const frame=swipeNeighbors[side];
      if(!frame||frame===activeFrame)continue;
      clearFrameCardState(frame);
      hideSwipeNeighbor(frame);
      frame.style.visibility='hidden';
      frame.style.removeProperty('transform');
      frame.style.removeProperty('transition');
      setSwipeClip(frame,side,0);
    }
  };

  const ensureSwipeEdgeGuards=()=>{
    const host=document.body;
    if(!host||!mobileSwipeCapable())return;

    if(
      swipeEdgeGuards?.left?.isConnected &&
      swipeEdgeGuards?.right?.isConnected
    )return;

    const make=side=>{
      const guard=document.createElement('div');
      guard.className=`evo-swipe-edge-guard ${side}`;
      guard.setAttribute('aria-hidden','true');

      const block=e=>{
        /* Lo importante de V31: antes de bloquear la esquina, reseteamos
           cualquier revelado anterior. Nunca puede quedar media página. */
        hardResetSwipeVisuals();
        if(e.cancelable)e.preventDefault();
        e.stopImmediatePropagation();
      };

      guard.addEventListener('touchstart',block,{passive:false,capture:true});
      guard.addEventListener('touchmove',block,{passive:false,capture:true});
      guard.addEventListener('touchend',block,{passive:false,capture:true});
      guard.addEventListener('touchcancel',block,{passive:false,capture:true});

      host.appendChild(guard);
      return guard;
    };

    swipeEdgeGuards={left:make('left'),right:make('right')};
  };

  const resetSwipeTransition=frame=>{
    if(!frame)return;
    frame.style.removeProperty('transition');
  };

  const positionSwipeNeighbor=(frame,side)=>{
    if(!frame)return;
    hideSwipeNeighbor(frame);
    clearFrameCardState(frame);
    frame.style.visibility='hidden';
    frame.style.removeProperty('transform');
    setSwipeClip(frame,side,0);
  };

  const removeSwipeFrame=frame=>{
    if(!frame||frame===activeFrame)return;
    try{frame.__evolutionLocalControlsObserver?.disconnect?.()}catch(_){}
    try{frame.remove()}catch(_){}
  };

  const clearSwipeNeighbors=()=>{
    hideSwipeDepth();
    const prev=swipeNeighbors.prev;
    const next=swipeNeighbors.next;
    swipeNeighbors={prev:null,next:null};
    if(prev&&prev!==activeFrame)removeSwipeFrame(prev);
    if(next&&next!==activeFrame&&next!==prev)removeSwipeFrame(next);
  };

  const makeSwipeNeighbor=(route,side,generation)=>{
    if(!route||!activeFrame)return null;

    const frame=document.createElement('iframe');
    frame.className='evo-view-frame evo-swipe-neighbor';
    frame.src=`${route.view}?shell=${VERSION}&swipePreview=1`;
    frame.title=route.title;
    frame.loading='eager';
    frame.setAttribute('aria-label',route.title);
    frame.setAttribute('allow','clipboard-read; clipboard-write; payment');
    frame.setAttribute('aria-hidden','true');
    frame.dataset.evoRouteKey=route.key;
    frame.dataset.swipeSide=side;
    frame.style.visibility='hidden';
    positionSwipeNeighbor(frame,side);

    stage()?.appendChild(frame);

    frame.addEventListener('load',()=>{
      if(generation!==swipePreviewGeneration||!frame.isConnected)return;
      if(!handleFrameLoad(frame))return;

      /* Prepare only UI-local controls while hidden. Payment SDK and
         active-route listeners wait until the frame becomes active. */
      repairViewLocalControls(frame,route);
      frame.__evolutionSwipeReady=true;
      frame.style.visibility='hidden';
      positionSwipeNeighbor(frame,side);
    },{once:true});

    return frame;
  };

  const ensureSwipeNeighbor=(side,route,preferred=null)=>{
    const current=swipeNeighbors[side];

    if(!route){
      if(current&&current!==activeFrame)removeSwipeFrame(current);
      swipeNeighbors[side]=null;
      return null;
    }

    if(
      preferred &&
      preferred.isConnected &&
      preferred.dataset.evoRouteKey===route.key
    ){
      if(current&&current!==preferred&&current!==activeFrame)removeSwipeFrame(current);
      preferred.classList.remove('evo-view-active','evo-view-incoming','evo-view-leaving');
      preferred.classList.add('evo-swipe-neighbor');
      preferred.setAttribute('aria-hidden','true');
      preferred.style.visibility='hidden';
      preferred.__evolutionSwipeReady=true;
      positionSwipeNeighbor(preferred,side);
      swipeNeighbors[side]=preferred;
      return preferred;
    }

    if(
      current &&
      current.isConnected &&
      current.dataset.evoRouteKey===route.key
    ){
      positionSwipeNeighbor(current,side);
      return current;
    }

    if(current&&current!==activeFrame)removeSwipeFrame(current);
    const created=makeSwipeNeighbor(route,side,swipePreviewGeneration);
    swipeNeighbors[side]=created;
    return created;
  };

  const refreshSwipeNeighbors=({preferredPrev=null,preferredNext=null}={})=>{
    ensureSwipeEdgeGuards();
    installShellSwipeSurface();

    if(!mobileSwipeCapable()||!activeFrame||!activeKey){
      clearSwipeNeighbors();
      return;
    }

    const prevRoute=routeBeside(activeKey,'prev');
    const nextRoute=routeBeside(activeKey,'next');

    ensureSwipeNeighbor('prev',prevRoute,preferredPrev);
    ensureSwipeNeighbor('next',nextRoute,preferredNext);
  };

  const installActiveFrameFeatures=(frame,route)=>{
    if(!frame||!route)return;

    repairViewLocalControls(frame,route);
    installMobileSwipe(frame,route);

    if(route.key==='grafico'){
      setTimeout(()=>repairViewLocalControls(frame,route),250);
      setTimeout(()=>repairViewLocalControls(frame,route),900);
    }

    injectPaymentsBridge(frame,route);
  };

  const installActiveFrameGuards=frame=>{
    if(!frame||frame.__evolutionActiveGuards)return;
    frame.__evolutionActiveGuards=true;
    attachPersistentGuard(frame);
    attachFrameTelemetry(frame);
  };

  const settleSwipeBack=(active,neighbor,side)=>{
    if(!active)return;

    const settleToken=++swipeSettleToken;
    swipeSettling=true;
    document.body.classList.remove('evo-live-swipe-dragging');
    document.body.classList.add('evo-live-swipe-settling');

    hideSwipeDepth();

    active.style.setProperty('--evo-active-card-scale','1');
    active.style.setProperty('--evo-active-card-radius','0px');

    if(neighbor){
      showSwipeNeighbor(neighbor);
      neighbor.style.visibility='visible';
      neighbor.style.setProperty('--evo-next-card-scale',swipeVisualTier==='premium'?'.845':'.885');
      neighbor.style.setProperty('--evo-next-card-radius',swipeVisualTier==='premium'?'48px':'36px');
      setSwipeClip(neighbor,side,0);
    }

    setTimeout(()=>{
      if(settleToken!==swipeSettleToken)return;
      document.body.classList.remove('evo-live-swipe-settling');
      clearFrameCardState(active);
      resetSwipeTransition(neighbor);
      if(neighbor)positionSwipeNeighbor(neighbor,side);
      swipeSettling=false;
    },315);
  };

  const commitLiveSwipe=(active,neighbor,side,route)=>{
    if(!active||!neighbor||!route||swipeSettling)return;

    const settleToken=++swipeSettleToken;
    swipeSettling=true;
    saveScroll();

    const oldPrev=swipeNeighbors.prev;
    const oldNext=swipeNeighbors.next;

    document.body.classList.remove('evo-live-swipe-dragging');
    document.body.classList.add('evo-live-swipe-settling');

    hideSwipeDepth();

    active.style.setProperty('--evo-active-card-scale',swipeVisualTier==='premium'?'.82':(swipeVisualTier==='standard'?'.89':'1'));
    active.style.setProperty('--evo-active-card-radius',swipeVisualTier==='premium'?'52px':(swipeVisualTier==='standard'?'40px':'0px'));

    showSwipeNeighbor(neighbor);
    neighbor.style.visibility='visible';
    neighbor.style.setProperty('--evo-next-card-scale','1');
    neighbor.style.setProperty('--evo-next-card-radius','0px');
    setSwipeClip(neighbor,side,1);

    setTimeout(()=>{
      if(settleToken!==swipeSettleToken)return;

      activeFrame=neighbor;

      clearFrameCardState(neighbor);
      neighbor.classList.remove(
        'evo-swipe-neighbor','evo-swipe-visible',
        'evo-view-incoming','evo-view-leaving'
      );
      neighbor.classList.add('evo-view-active');
      neighbor.removeAttribute('aria-hidden');
      neighbor.dataset.swipeSide='';
      neighbor.style.removeProperty('clip-path');
      neighbor.style.removeProperty('transform');
      neighbor.style.removeProperty('transition');
      neighbor.style.visibility='visible';

      clearFrameCardState(active);
      active.classList.remove(
        'evo-view-active','evo-view-incoming','evo-view-leaving'
      );
      active.classList.add('evo-swipe-neighbor');
      active.setAttribute('aria-hidden','true');
      active.dataset.evoRouteKey=activeKey||'';
      active.__evolutionSwipeReady=true;

      if(side==='next'){
        if(oldPrev&&oldPrev!==active&&oldPrev!==neighbor)removeSwipeFrame(oldPrev);
        swipeNeighbors.prev=active;
        swipeNeighbors.next=null;
        positionSwipeNeighbor(active,'prev');
      }else{
        if(oldNext&&oldNext!==active&&oldNext!==neighbor)removeSwipeFrame(oldNext);
        swipeNeighbors.next=active;
        swipeNeighbors.prev=null;
        positionSwipeNeighbor(active,'next');
      }

      history.pushState({evolutionRoute:route.key},'',route.path);
      syncRoute(route);

      installActiveFrameFeatures(neighbor,route);
      installActiveFrameGuards(neighbor);

      try{
        window.EvolutionNav?.setScroll(neighbor.contentWindow.scrollY||0);
      }catch(_){}

      document.body.classList.remove('evo-live-swipe-settling');
      swipeSettling=false;

      swipePreviewGeneration++;
      refreshSwipeNeighbors({
        preferredPrev:side==='next'?active:null,
        preferredNext:side==='prev'?active:null
      });

      prewarmAccordingToNetwork();
    },260);
  };

  const installMobileSwipe=(frame,route)=>{
    if(!frame||!route||!MOBILE_SWIPE_ORDER.includes(route.key))return;

    try{
      const win=frame.contentWindow;
      const doc=frame.contentDocument;
      if(!win||!doc||frame.__evolutionLiveSwipeInstalled)return;

      frame.__evolutionLiveSwipeInstalled=true;

      const mobileMQ=win.matchMedia('(max-width: 991.98px)');
      let startX=0,startY=0,lastX=0,lastY=0,startTime=0;
      let previousX=0,previousY=0,previousSampleTime=0;
      let tracking=false,lockedHorizontal=false,currentSide=null;
      let gestureNeighbor=null;
      let anomalousGesture=false;
      let stableMoveSamples=0;
      let autoCommitted=false;
      let renderRaf=0;
      let pendingProgress=0;
      let pendingBoundaryX=0;
      let pendingSide='next';

      const interactiveSelector=[
        'input','textarea','select','button',
        '[contenteditable="true"]','[role="slider"]','[data-no-swipe]',
        '.survey-overlay','.gd-order-modal','.auth-modal','.modal',
        '.swiper','.carousel','[data-carousel]'
      ].join(',');

      const hasHorizontalScroll=el=>{
        let node=el;
        while(node&&node!==doc.body){
          try{
            const s=win.getComputedStyle(node);
            if(
              (s.overflowX==='auto'||s.overflowX==='scroll') &&
              node.scrollWidth>node.clientWidth+8
            )return true;
          }catch(_){}
          node=node.parentElement;
        }
        return false;
      };

      const shouldIgnoreTarget=target=>{
        if(!(target instanceof win.Element))return false;

        /* V32: no ignoramos secciones solo porque tengan overflow-x.
           Eso dejaba franjas completas fuera del pager.
           Solo controles que realmente necesitan gesto propio. */
        if(target.closest(interactiveSelector))return true;
        return false;
      };

      const touchPoint=e=>{
        const t=e.touches?.[0]||e.changedTouches?.[0];
        return t?{x:t.clientX,y:t.clientY}:null;
      };

      const renderGestureFrame=(rafNow)=>{
        renderRaf=0;
        if(!tracking||!lockedHorizontal||!gestureNeighbor||frame!==activeFrame)return;

        noteSwipeFrameBudget(rafNow);
        if(!allowSwipePaint(rafNow)){
          renderRaf=win.requestAnimationFrame(renderGestureFrame);
          return;
        }

        setSwipeClip(gestureNeighbor,pendingSide,pendingProgress);
        updateLiquidGlassSwipe(
          frame,
          gestureNeighbor,
          pendingBoundaryX,
          pendingProgress,
          pendingSide
        );
      };

      const scheduleGestureRender=(side,progress,boundaryX)=>{
        pendingSide=side;
        pendingProgress=progress;
        pendingBoundaryX=boundaryX;
        if(!renderRaf)renderRaf=win.requestAnimationFrame(renderGestureFrame);
      };

      const cancelGestureRender=()=>{
        if(renderRaf){
          win.cancelAnimationFrame(renderRaf);
          renderRaf=0;
        }
      };

      const resetNeighborFromGesture=()=>{
        cancelGestureRender();
        hideSwipeDepth();
        clearFrameCardState(frame);
        if(gestureNeighbor&&currentSide){
          positionSwipeNeighbor(gestureNeighbor,currentSide);
          gestureNeighbor.style.visibility='hidden';
        }
        gestureNeighbor=null;
        currentSide=null;
      };

      const onStart=e=>{
        if(frame!==activeFrame||swipeSettling||!mobileMQ.matches)return;
        if(e.touches&&e.touches.length!==1)return;

        const p=touchPoint(e);
        if(!p||shouldIgnoreTarget(e.target))return;

        /* V31: el pager comienza lejos del gesto de historial de iOS. */
        const width=win.innerWidth||doc.documentElement.clientWidth||0;
        const safeEdge=Math.max(58,Math.min(76,width*.16));
        if(p.x<=safeEdge||(width&&p.x>=width-safeEdge)){
          hardResetSwipeVisuals();
          return;
        }

        hardResetSwipeVisuals();
        beginSwipeFrameBudget();
        startX=lastX=previousX=p.x;
        startY=lastY=previousY=p.y;
        startTime=previousSampleTime=performance.now();
        tracking=true;
        lockedHorizontal=false;
        currentSide=null;
        gestureNeighbor=null;
        anomalousGesture=false;
        stableMoveSamples=0;
        autoCommitted=false;
      };

      const onMove=e=>{
        if(!tracking||frame!==activeFrame)return;
        const p=touchPoint(e);
        if(!p)return;

        const now=performance.now();
        const sampleDt=Math.max(1,now-previousSampleTime);
        const sampleDx=Math.abs(p.x-previousX);
        const viewportWidth=win.innerWidth||doc.documentElement.clientWidth||375;

        /* Safari puede entregar un changedTouches extremo al pelear con su
           gesto de historial. Un salto >38% del viewport en <28ms no es
           un arrastre humano normal: cancelamos, jamás completamos. */
        if(sampleDt<34&&sampleDx>viewportWidth*.27){
          anomalousGesture=true;
          tracking=false;
          document.body.classList.remove('evo-live-swipe-dragging');
          resetNeighborFromGesture();
          hardResetSwipeVisuals();
          return;
        }

        stableMoveSamples++;
        previousX=p.x;
        previousY=p.y;
        previousSampleTime=now;
        lastX=p.x;
        lastY=p.y;

        let dx=lastX-startX;
        const dy=lastY-startY;

        if(!lockedHorizontal){
          if(Math.abs(dx)<9&&Math.abs(dy)<9)return;

          if(Math.abs(dy)>Math.abs(dx)*1.12){
            tracking=false;
            resetNeighborFromGesture();
            return;
          }

          if(Math.abs(dx)>Math.abs(dy)*1.28){
            lockedHorizontal=true;
            document.body.classList.add('evo-live-swipe-dragging');
          }
        }

        if(!lockedHorizontal)return;
        e.preventDefault();

        const side=dx<0?'next':'prev';
        if(side!==currentSide){
          resetNeighborFromGesture();
          currentSide=side;
          gestureNeighbor=swipeNeighbors[side];
          if(gestureNeighbor?.__evolutionSwipeReady){
            gestureNeighbor.style.visibility='visible';
            showSwipeNeighbor(gestureNeighbor);
          }
        }

        const width=win.innerWidth||doc.documentElement.clientWidth||375;

        if(!gestureNeighbor){
          /* En los extremos no movemos la página: evitamos cualquier
             rasterización innecesaria del texto. */
          hideSwipeDepth();
          return;
        }

        gestureNeighbor.style.visibility='visible';
        showSwipeNeighbor(gestureNeighbor);

        const progress=Math.max(
          0,
          Math.min(1,Math.abs(dx)/Math.max(1,width))
        );

        /* V31: máximo un repintado por frame. */
        const revealPx=progress*width;
        const boundaryX=
          side==='next'
            ? width-revealPx
            : revealPx;

        scheduleGestureRender(side,progress,boundaryX);

        /* V38 · MAGNETIC SNAP
           Al cruzar 35% no esperamos touchend. La ruta queda decidida
           y la animación completa sola. */
        if(
          progress>=MOBILE_SWIPE_COMMIT_PROGRESS &&
          stableMoveSamples>=2 &&
          !anomalousGesture &&
          gestureNeighbor.__evolutionSwipeReady
        ){
          const targetRoute=routeBeside(activeKey,side);

          if(targetRoute){
            autoCommitted=true;
            tracking=false;
            lockedHorizontal=false;
            cancelGestureRender();

            /* Congelamos visualmente el punto exacto de captura antes
               de que el settle magnético tome control. */
            setSwipeClip(
              gestureNeighbor,
              side,
              MOBILE_SWIPE_COMMIT_PROGRESS
            );

            const snapReveal=MOBILE_SWIPE_COMMIT_PROGRESS*width;
            const snapBoundary=
              side==='next'
                ? width-snapReveal
                : snapReveal;

            updateLiquidGlassSwipe(
              frame,
              gestureNeighbor,
              snapBoundary,
              MOBILE_SWIPE_COMMIT_PROGRESS,
              side
            );

            commitLiveSwipe(
              frame,
              gestureNeighbor,
              side,
              targetRoute
            );

            currentSide=null;
            gestureNeighbor=null;
          }
        }
      };

      const finish=(cancelled=false)=>{
        cancelGestureRender();

        /* Después del snap al 35%, touchend pertenece al gesto viejo.
           No debe resetear/cancelar el commit que ya está terminando. */
        if(autoCommitted){
          autoCommitted=false;
          tracking=false;
          lockedHorizontal=false;
          return;
        }

        if(!tracking){
          tracking=false;
          lockedHorizontal=false;
          hardResetSwipeVisuals();
          return;
        }

        tracking=false;

        const rawDx=lastX-startX;
        const dy=lastY-startY;
        const elapsed=Math.max(1,performance.now()-startTime);
        const width=win.innerWidth||doc.documentElement.clientWidth||375;
        const dx=Math.max(-width,Math.min(width,rawDx));
        const velocity=Math.abs(dx)/elapsed;

        /* Necesitamos movimiento real y progresivo. Un único salto jamás
           puede cambiar de sección, aunque iOS reporte el dedo al otro lado. */
        if(
          anomalousGesture ||
          stableMoveSamples<2 ||
          Math.abs(rawDx)>width*.96 ||
          !lockedHorizontal ||
          cancelled ||
          !currentSide ||
          !gestureNeighbor
        ){
          hardResetSwipeVisuals();
          lockedHorizontal=false;
          return;
        }

        const distanceRatio=Math.abs(dx)/Math.max(1,width);
        const qualifies=
          Math.abs(dy)<88 &&
          distanceRatio>=MOBILE_SWIPE_COMMIT_PROGRESS;

        const targetRoute=routeBeside(activeKey,currentSide);
        const ready=Boolean(gestureNeighbor.__evolutionSwipeReady);

        if(qualifies&&targetRoute&&ready){
          commitLiveSwipe(frame,gestureNeighbor,currentSide,targetRoute);
        }else{
          settleSwipeBack(frame,gestureNeighbor,currentSide);
        }

        lockedHorizontal=false;
      };

      const onEnd=e=>{
        const p=touchPoint(e);
        if(p){
          const width=win.innerWidth||doc.documentElement.clientWidth||375;
          const endJump=Math.abs(p.x-previousX);

          /* Este era el bug de la captura: changedTouches puede saltar desde
             la esquina hasta casi el otro extremo al terminar el gesto. */
          if(endJump>width*.22){
            anomalousGesture=true;
          }else{
            lastX=p.x;
            lastY=p.y;
          }
        }
        finish(false);
      };

      const onCancel=()=>{
        anomalousGesture=true;
        finish(true);
      };

      doc.addEventListener('touchstart',onStart,{passive:true,capture:true});
      doc.addEventListener('touchmove',onMove,{passive:false,capture:true});
      doc.addEventListener('touchend',onEnd,{passive:true,capture:true});
      doc.addEventListener('touchcancel',onCancel,{passive:true,capture:true});

      if(
        mobileMQ.matches &&
        !sessionStorage.getItem('evolution_live_swipe_hint_v33')
      ){
        sessionStorage.setItem('evolution_live_swipe_hint_v33','1');
        const hint=doc.createElement('div');
        hint.textContent='Desliza · Liquid Glass';
        Object.assign(hint.style,{
          position:'fixed',left:'50%',
          bottom:'calc(92px + env(safe-area-inset-bottom, 0px))',
          transform:'translateX(-50%) translateY(8px)',
          zIndex:'2147483000',padding:'9px 13px',borderRadius:'999px',
          border:'1px solid rgba(255,255,255,.12)',
          background:'rgba(12,12,13,.72)',
          backdropFilter:'blur(18px)',WebkitBackdropFilter:'blur(18px)',
          color:'rgba(255,255,255,.78)',
          font:'600 11px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
          pointerEvents:'none',opacity:'0',
          transition:'opacity .28s ease,transform .28s ease'
        });
        doc.body.appendChild(hint);
        requestAnimationFrame(()=>{
          hint.style.opacity='1';
          hint.style.transform='translateX(-50%) translateY(0)';
        });
        setTimeout(()=>{
          hint.style.opacity='0';
          hint.style.transform='translateX(-50%) translateY(8px)';
          setTimeout(()=>hint.remove(),350);
        },2200);
      }
    }catch(error){
      console.warn('[Evolution App] Live mobile swipe:',error);
    }
  };


  const installShellSwipeSurface=()=>{
    if(document.documentElement.dataset.evolutionShellSwipeV32==='1')return;
    document.documentElement.dataset.evolutionShellSwipeV32='1';

    let startX=0,startY=0,lastX=0,lastY=0,startTime=0;
    let previousX=0,previousSampleTime=0;
    let tracking=false,locked=false,side=null,neighbor=null;
    let stableSamples=0,anomalous=false,autoCommitted=false;
    let renderRaf=0,pendingProgress=0,pendingBoundary=0,pendingSide='next';

    const point=e=>{
      const t=e.touches?.[0]||e.changedTouches?.[0];
      return t?{x:t.clientX,y:t.clientY}:null;
    };

    const ignoreTarget=target=>{
      if(!(target instanceof Element))return false;

      /* El iframe gestiona su propia superficie. */
      if(target.closest('iframe.evo-view-frame'))return true;

      /* Taps delicados: menú, inputs, botones y modales conservan prioridad.
         Los enlaces normales sí pueden iniciar swipe; un tap sin arrastre
         sigue comportándose como enlace. */
      return Boolean(target.closest([
        'input','textarea','select','button',
        '[contenteditable="true"]','[role="slider"]',
        '[data-no-swipe]','.modal','.auth-modal',
        '.survey-overlay','.swiper','.carousel','[data-carousel]'
      ].join(',')));
    };

    const cancelRender=()=>{
      if(renderRaf){
        cancelAnimationFrame(renderRaf);
        renderRaf=0;
      }
    };

    const render=(rafNow)=>{
      renderRaf=0;
      if(!tracking||!locked||!neighbor||!activeFrame)return;

      noteSwipeFrameBudget(rafNow);
      if(!allowSwipePaint(rafNow)){
        renderRaf=requestAnimationFrame(render);
        return;
      }

      setSwipeClip(neighbor,pendingSide,pendingProgress);
      updateLiquidGlassSwipe(
        activeFrame,
        neighbor,
        pendingBoundary,
        pendingProgress,
        pendingSide
      );
    };

    const schedule=(s,p,b)=>{
      pendingSide=s;
      pendingProgress=p;
      pendingBoundary=b;
      if(!renderRaf)renderRaf=requestAnimationFrame(render);
    };

    const resetLocal=({preserveCommit=false}={})=>{
      cancelRender();
      tracking=false;
      locked=false;
      side=null;
      neighbor=null;
      stableSamples=0;
      anomalous=false;
      if(!preserveCommit)autoCommitted=false;
    };

    const suppressNextClick=()=>{
      const stop=e=>{
        e.preventDefault();
        e.stopImmediatePropagation();
      };
      document.addEventListener('click',stop,true);
      setTimeout(()=>document.removeEventListener('click',stop,true),380);
    };

    const onStart=e=>{
      if(!mobileSwipeCapable()||!activeFrame||swipeSettling)return;
      if(e.touches&&e.touches.length!==1)return;
      if(ignoreTarget(e.target))return;

      const p=point(e);
      if(!p)return;

      const width=innerWidth||document.documentElement.clientWidth||375;
      const safeEdge=Math.max(58,Math.min(76,width*.16));

      if(p.x<=safeEdge||p.x>=width-safeEdge){
        hardResetSwipeVisuals();
        resetLocal();
        return;
      }

      hardResetSwipeVisuals();
      beginSwipeFrameBudget();

      startX=lastX=previousX=p.x;
      startY=lastY=p.y;
      startTime=previousSampleTime=performance.now();
      tracking=true;
      locked=false;
      side=null;
      neighbor=null;
      stableSamples=0;
      anomalous=false;
      autoCommitted=false;
    };

    const onMove=e=>{
      if(!tracking||!activeFrame)return;

      const p=point(e);
      if(!p)return;

      const now=performance.now();
      const width=innerWidth||document.documentElement.clientWidth||375;
      const dt=Math.max(1,now-previousSampleTime);
      const jump=Math.abs(p.x-previousX);

      if(dt<34&&jump>width*.27){
        anomalous=true;
        hardResetSwipeVisuals();
        resetLocal();
        return;
      }

      stableSamples++;
      previousX=p.x;
      previousSampleTime=now;
      lastX=p.x;
      lastY=p.y;

      const dx=lastX-startX;
      const dy=lastY-startY;

      if(!locked){
        if(Math.abs(dx)<9&&Math.abs(dy)<9)return;

        if(Math.abs(dy)>Math.abs(dx)*1.12){
          hardResetSwipeVisuals();
          resetLocal();
          return;
        }

        if(Math.abs(dx)>Math.abs(dy)*1.28){
          locked=true;
          document.body.classList.add('evo-live-swipe-dragging');
        }
      }

      if(!locked)return;
      if(e.cancelable)e.preventDefault();

      const nextSide=dx<0?'next':'prev';

      if(nextSide!==side){
        hideSwipeDepth();
        clearFrameCardState(activeFrame);

        if(neighbor&&side){
          positionSwipeNeighbor(neighbor,side);
          neighbor.style.visibility='hidden';
        }

        side=nextSide;
        neighbor=swipeNeighbors[side];

        if(neighbor?.__evolutionSwipeReady){
          neighbor.style.visibility='visible';
          showSwipeNeighbor(neighbor);
        }
      }

      if(!neighbor)return;

      const progress=Math.max(0,Math.min(1,Math.abs(dx)/Math.max(1,width)));
      const reveal=progress*width;
      const boundary=side==='next'?width-reveal:reveal;

      schedule(side,progress,boundary);

      /* V38 · El contenedor padre usa exactamente el mismo punto
         magnético del 35%. */
      if(
        progress>=MOBILE_SWIPE_COMMIT_PROGRESS &&
        stableSamples>=2 &&
        !anomalous &&
        neighbor.__evolutionSwipeReady
      ){
        const route=routeBeside(activeKey,side);

        if(route){
          autoCommitted=true;
          tracking=false;
          locked=false;
          cancelRender();
          suppressNextClick();

          setSwipeClip(
            neighbor,
            side,
            MOBILE_SWIPE_COMMIT_PROGRESS
          );

          const snapReveal=MOBILE_SWIPE_COMMIT_PROGRESS*width;
          const snapBoundary=
            side==='next'
              ? width-snapReveal
              : snapReveal;

          updateLiquidGlassSwipe(
            activeFrame,
            neighbor,
            snapBoundary,
            MOBILE_SWIPE_COMMIT_PROGRESS,
            side
          );

          commitLiveSwipe(
            activeFrame,
            neighbor,
            side,
            route
          );

          resetLocal({preserveCommit:true});
        }
      }
    };

    const finish=(cancelled=false,endPoint=null)=>{
      cancelRender();

      if(autoCommitted){
        autoCommitted=false;
        tracking=false;
        locked=false;
        return;
      }

      if(!tracking){
        hardResetSwipeVisuals();
        resetLocal();
        return;
      }

      if(endPoint){
        const width=innerWidth||document.documentElement.clientWidth||375;
        if(Math.abs(endPoint.x-previousX)>width*.22){
          anomalous=true;
        }else{
          lastX=endPoint.x;
          lastY=endPoint.y;
        }
      }

      tracking=false;

      const width=innerWidth||document.documentElement.clientWidth||375;
      const rawDx=lastX-startX;
      const dx=Math.max(-width,Math.min(width,rawDx));
      const dy=lastY-startY;
      const elapsed=Math.max(1,performance.now()-startTime);
      const velocity=Math.abs(dx)/elapsed;

      if(
        anomalous ||
        stableSamples<2 ||
        Math.abs(rawDx)>width*.96 ||
        !locked ||
        cancelled ||
        !side ||
        !neighbor
      ){
        hardResetSwipeVisuals();
        resetLocal();
        return;
      }

      suppressNextClick();

      const ratio=Math.abs(dx)/Math.max(1,width);
      const qualifies=
        Math.abs(dy)<88 &&
        ratio>=MOBILE_SWIPE_COMMIT_PROGRESS;

      const route=routeBeside(activeKey,side);
      const ready=Boolean(neighbor.__evolutionSwipeReady);

      if(qualifies&&route&&ready){
        commitLiveSwipe(activeFrame,neighbor,side,route);
      }else{
        settleSwipeBack(activeFrame,neighbor,side);
      }

      resetLocal();
    };

    document.addEventListener('touchstart',onStart,{passive:true,capture:true});
    document.addEventListener('touchmove',onMove,{passive:false,capture:true});
    document.addEventListener('touchend',e=>finish(false,point(e)),{passive:true,capture:true});
    document.addEventListener('touchcancel',()=>finish(true),{passive:true,capture:true});
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

    /* La navbar es persistente; reafirmamos el usuario conocido sin esperar
       a que la nueva vista vuelva a inicializar Firebase. */
    if(stableAuth.user?.uid)applyStableAuth();

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

    /* A navbar tap / popstate uses the normal router. Remove only hidden
       swipe previews so duplicate iframes can never survive a direct route. */
    swipePreviewGeneration++;
    clearSwipeNeighbors();

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

      /* Prepara los comportamientos activos de la view. */
      installActiveFrameFeatures(frame,route);

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
        frame.dataset.evoRouteKey=route.key;
        frame.__evolutionSwipeReady=true;
        installActiveFrameGuards(frame);

        swipePreviewGeneration++;
        refreshSwipeNeighbors();
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
    logoutPending=true;

    /* Cierra la sesión REAL del Shell. La vista también recibe el mensaje
       para mantener sincronizada cualquier lógica local de checkout/perfil. */
    initShellAuth()
      .then(()=>window.EvolutionShellAuth?.signOut())
      .catch(error=>console.warn('Evolution logout:',error?.code||error));

    activeFrame?.contentWindow?.postMessage({type:'evolution:logout'},location.origin);

    setTimeout(()=>{
      if(logoutPending)logoutPending=false;
    },12000);
  });

  addEventListener('message',e=>{
    if(e.origin!==location.origin||!e.data)return;
    const data=e.data;

    if(data.type==='evolution:navigate'&&data.href){
      /* Un control href="#" jamás debe convertirse en navegación del Shell. */
      try{
        const raw=String(data.href||'');
        const u=new URL(raw,location.href);
        const frameURL=activeFrame?new URL(activeFrame.contentWindow.location.href):null;

        if(
          frameURL &&
          u.origin===frameURL.origin &&
          u.pathname===frameURL.pathname &&
          (!u.hash || u.hash==='#evolution-ui-control')
        ){
          return;
        }
      }catch(_){}

      /* Los #calculadora-planos, #cotizador-general, etc. viven dentro
         del iframe/vista actual. Nunca pasan por el router principal. */
      if(scrollActiveViewToHash(data.href))return;

      const route=routeFromHref(data.href);
      if(route){loadRoute(route,{push:true,restore:false});return}

      /* Si no es una de las cuatro rutas públicas, respeta el enlace real
         en lugar de mandarlo a Home. */
      location.href=data.href;
      return;
    }

    if(data.type==='evolution:external-nav'&&data.href){location.href=data.href;return}

    if(data.type==='evolution:auth-state'){
      acceptAuthState(data);
      return;
    }

    if(data.type==='evolution:view-title'&&data.title){document.title=data.title}
  });

  addEventListener('popstate',()=>{
    const route=routeFromURL(location.href);

    if(activeFrame&&activeKey===route.key&&location.hash){
      if(scrollActiveViewToHash(location.href))return;
    }

    loadRoute(route,{push:false,restore:true});
  });


  /* ============================================================
     EVOLUTION UPDATE CENTER · V34
     ============================================================ */
  let evolutionRelease=null;
  let evolutionUpdateOverlay=null;
  let evolutionUpdateBusy=false;
  let evolutionReleaseCheckPromise=null;

  const releaseBuild=value=>{
    const n=Number.parseInt(String(value??''),10);
    return Number.isFinite(n)&&n>0?n:0;
  };

  const normalizeRelease=value=>{
    const data=value&&typeof value==='object'?value:{};
    const notes=Array.isArray(data.notes)
      ? data.notes.map(item=>{
          if(typeof item==='string')return {title:item,detail:''};
          return {
            title:String(item?.title||'').trim(),
            detail:String(item?.detail||'').trim()
          };
        }).filter(x=>x.title).slice(0,3)
      :[];

    return {
      build:releaseBuild(data.build),
      version:String(data.version||data.build||'').trim(),
      announce:data.announce===true,
      required:data.required===true,
      subtitle:String(
        data.subtitle||
        'Actualiza para aplicar correcciones de errores, mejoras de estabilidad y la experiencia más reciente de Evolution.'
      ).trim(),
      notes
    };
  };

  const releaseAck=()=>{
    try{return releaseBuild(localStorage.getItem(RELEASE_ACK_KEY))}
    catch(_){return 0}
  };

  const acknowledgeRelease=build=>{
    const safe=releaseBuild(build);
    if(!safe)return;
    try{localStorage.setItem(RELEASE_ACK_KEY,String(safe))}catch(_){}
  };

  const ensureUpdateCenterStyle=()=>{
    if(document.getElementById('evolution-update-center-style'))return;

    const style=document.createElement('style');
    style.id='evolution-update-center-style';
    style.textContent=`
      #evolution-update-center{
        position:fixed;
        inset:0;
        z-index:2147483600;
        display:grid;
        place-items:center;
        padding:
          max(14px,env(safe-area-inset-top))
          max(10px,env(safe-area-inset-right))
          max(14px,env(safe-area-inset-bottom))
          max(10px,env(safe-area-inset-left));
        overflow:auto;
        overscroll-behavior:contain;
        color:#fff;
        font-family:-apple-system,BlinkMacSystemFont,"Inter","SF Pro Display","Segoe UI",sans-serif;
        background:
          radial-gradient(circle at 50% 13%,rgba(212,184,149,.18),transparent 32%),
          radial-gradient(circle at 8% 85%,rgba(84,113,255,.08),transparent 28%),
          rgba(0,0,0,.91);
        -webkit-backdrop-filter:blur(32px) saturate(1.10);
        backdrop-filter:blur(32px) saturate(1.10);
        opacity:0;
        visibility:hidden;
        transition:opacity .36s cubic-bezier(.2,.8,.2,1),visibility 0s linear .36s;
      }
      #evolution-update-center.is-visible{
        opacity:1;
        visibility:visible;
        transition:opacity .36s cubic-bezier(.2,.8,.2,1);
      }
      #evolution-update-center *{box-sizing:border-box}
      .evo-up-card{
        position:relative;
        width:min(720px,100%);
        min-height:min(790px,calc(100dvh - 28px));
        padding:clamp(24px,5vw,48px);
        display:flex;
        flex-direction:column;
        justify-content:space-between;
        gap:26px;
        overflow:hidden;
        border-radius:clamp(30px,6vw,50px);
        border:1px solid rgba(255,255,255,.11);
        background:
          linear-gradient(145deg,rgba(255,255,255,.095),rgba(255,255,255,.022) 44%,rgba(212,184,149,.055)),
          rgba(10,10,12,.74);
        -webkit-backdrop-filter:blur(36px) saturate(1.14);
        backdrop-filter:blur(36px) saturate(1.14);
        box-shadow:0 38px 120px rgba(0,0,0,.65),inset 0 1px 0 rgba(255,255,255,.12);
        transform:translateY(18px) scale(.98);
        transition:transform .48s cubic-bezier(.2,.82,.2,1);
      }
      #evolution-update-center.is-visible .evo-up-card{
        transform:translateY(0) scale(1);
      }
      .evo-up-card::before{
        content:"";
        position:absolute;
        width:460px;
        height:460px;
        left:50%;
        top:-340px;
        transform:translateX(-50%);
        border-radius:50%;
        background:radial-gradient(circle,rgba(212,184,149,.26),transparent 68%);
        pointer-events:none;
      }
      .evo-up-head{
        position:relative;
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:14px;
      }
      .evo-up-logo{
        width:clamp(94px,22vw,132px);
        max-height:42px;
        object-fit:contain;
      }
      .evo-up-build{
        display:flex;
        align-items:center;
        gap:7px;
        min-height:30px;
        padding:0 11px;
        border-radius:999px;
        border:1px solid rgba(212,184,149,.25);
        background:rgba(212,184,149,.07);
        color:#e0c5a3;
        font-size:10px;
        font-weight:800;
        letter-spacing:.12em;
      }
      .evo-up-build::before{
        content:"";
        width:7px;
        height:7px;
        border-radius:50%;
        background:#d4b895;
        box-shadow:0 0 15px rgba(212,184,149,.62);
      }
      .evo-up-orb{
        position:relative;
        width:clamp(92px,24vw,128px);
        aspect-ratio:1;
        margin:clamp(15px,4vh,36px) auto 0;
        display:grid;
        place-items:center;
        border-radius:50%;
        border:1px solid rgba(255,255,255,.14);
        background:
          radial-gradient(circle at 30% 20%,rgba(255,255,255,.23),transparent 25%),
          linear-gradient(145deg,rgba(255,255,255,.10),rgba(212,184,149,.075));
        -webkit-backdrop-filter:blur(18px);
        backdrop-filter:blur(18px);
        box-shadow:0 20px 50px rgba(0,0,0,.45),inset 0 1px 0 rgba(255,255,255,.16);
      }
      .evo-up-orb::before,.evo-up-orb::after{
        content:"";
        position:absolute;
        border-radius:50%;
        border:1px solid rgba(212,184,149,.13);
      }
      .evo-up-orb::before{inset:-13px}
      .evo-up-orb::after{inset:-27px;border-color:rgba(255,255,255,.05)}
      .evo-up-orb svg{width:42%;height:42%;stroke:#fff}
      .evo-up-copy{
        position:relative;
        margin-top:28px;
        text-align:center;
      }
      .evo-up-kicker{
        margin:0 0 13px;
        color:#d4b895;
        font-size:10px;
        font-weight:850;
        letter-spacing:.19em;
        text-transform:uppercase;
      }
      .evo-up-title{
        margin:0 auto;
        max-width:620px;
        color:#fff;
        font-size:clamp(38px,8vw,64px);
        line-height:.94;
        font-weight:790;
        letter-spacing:-.05em;
      }
      .evo-up-title em{
        color:#d4b895;
        font-style:normal;
        font-weight:620;
      }
      .evo-up-sub{
        max-width:585px;
        margin:20px auto 0;
        color:rgba(255,255,255,.58);
        font-size:clamp(14px,3.7vw,17px);
        line-height:1.58;
      }
      .evo-up-grid{
        display:grid;
        grid-template-columns:repeat(3,minmax(0,1fr));
        gap:9px;
        margin-top:27px;
      }
      .evo-up-item{
        min-height:112px;
        padding:15px;
        border-radius:21px;
        border:1px solid rgba(255,255,255,.075);
        background:rgba(255,255,255,.032);
        text-align:left;
        box-shadow:inset 0 1px 0 rgba(255,255,255,.04);
      }
      .evo-up-icon{
        width:31px;
        height:31px;
        margin-bottom:12px;
        display:grid;
        place-items:center;
        border-radius:10px;
        color:#d4b895;
        border:1px solid rgba(212,184,149,.15);
        background:rgba(212,184,149,.085);
      }
      .evo-up-icon svg{width:16px;height:16px;stroke:currentColor}
      .evo-up-item strong{
        display:block;
        color:rgba(255,255,255,.92);
        font-size:12px;
        font-weight:760;
      }
      .evo-up-item p{
        margin:6px 0 0;
        color:rgba(255,255,255,.40);
        font-size:10.5px;
        line-height:1.45;
      }
      .evo-up-actions{
        position:relative;
        display:grid;
        gap:10px;
      }
      .evo-up-btn{
        position:relative;
        width:100%;
        min-height:62px;
        border:0;
        border-radius:21px;
        overflow:hidden;
        cursor:pointer;
        color:#070707;
        background:#f4f2ee;
        font:790 15px/1 -apple-system,BlinkMacSystemFont,"Inter",sans-serif;
        box-shadow:0 18px 38px rgba(0,0,0,.36),inset 0 1px 0 rgba(255,255,255,.9);
        transition:transform .17s ease,opacity .17s ease;
        -webkit-tap-highlight-color:transparent;
      }
      .evo-up-btn:active{transform:scale(.985)}
      .evo-up-btn:disabled{cursor:wait}
      .evo-up-progress{
        position:absolute;
        inset:0 auto 0 0;
        width:var(--evo-up-progress,0%);
        background:linear-gradient(90deg,#d4b895,#eadac7);
        transition:width .4s cubic-bezier(.2,.8,.2,1);
      }
      .evo-up-label{
        position:relative;
        z-index:2;
        display:flex;
        align-items:center;
        justify-content:center;
        gap:9px;
      }
      .evo-up-label svg{width:18px;height:18px;stroke:currentColor}
      .evo-up-btn.is-loading .evo-up-label svg{animation:evoUpSpin .82s linear infinite}
      @keyframes evoUpSpin{to{transform:rotate(360deg)}}
      .evo-up-later{
        min-height:36px;
        border:0;
        background:transparent;
        color:rgba(255,255,255,.37);
        font:650 12px/1 -apple-system,BlinkMacSystemFont,"Inter",sans-serif;
        cursor:pointer;
      }
      .evo-up-safe{
        display:flex;
        align-items:center;
        justify-content:center;
        gap:7px;
        color:rgba(255,255,255,.29);
        font-size:10px;
        line-height:1.35;
        text-align:center;
      }
      .evo-up-safe svg{width:14px;height:14px;stroke:#d4b895;opacity:.72}
      @media(max-width:640px){
        .evo-up-card{
          min-height:calc(100dvh - 20px);
          padding:24px 19px 18px;
          border-radius:30px;
          gap:18px;
        }
        .evo-up-orb{width:88px;margin-top:10px}
        .evo-up-copy{margin-top:21px}
        .evo-up-title{font-size:clamp(40px,12.5vw,55px)}
        .evo-up-sub{margin-top:15px;font-size:14px}
        .evo-up-grid{grid-template-columns:1fr;gap:7px;margin-top:19px}
        .evo-up-item{
          min-height:0;
          padding:11px 12px;
          display:grid;
          grid-template-columns:36px 1fr;
          column-gap:10px;
          border-radius:17px;
        }
        .evo-up-icon{grid-row:1/3;margin:0;align-self:center}
        .evo-up-item p{margin-top:3px;font-size:10px}
        .evo-up-btn{min-height:58px;border-radius:19px}
      }
      @media(prefers-reduced-motion:reduce){
        #evolution-update-center,.evo-up-card,.evo-up-btn,.evo-up-progress{transition:none!important}
        .evo-up-btn.is-loading .evo-up-label svg{animation:none!important}
      }
    `;
    document.head.appendChild(style);
  };

  const updateIcon=index=>[
    '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.7"><path d="M20 7 9 18l-5-5"/><path d="M21 12a9 9 0 1 1-4-7.5"/></svg>',
    '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.7"><path d="M13 2 3 14h9l-1 8 10-12h-9z"/></svg>',
    '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.7"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>'
  ][index%3];

  const fallbackNotes=[
    {title:'Errores corregidos',detail:'Ajustes de navegación, gestos y comportamientos inconsistentes.'},
    {title:'Más estabilidad',detail:'Carga más limpia y una experiencia más fluida en la app.'},
    {title:'Últimas mejoras',detail:'Aplica la versión reciente sin perder tu sesión ni proyectos.'}
  ];

  const setUpdateProgress=(percent,label)=>{
    const overlay=evolutionUpdateOverlay;
    if(!overlay)return;
    overlay.querySelector('[data-evo-update-btn]')
      ?.style.setProperty('--evo-up-progress',`${Math.max(0,Math.min(100,Number(percent)||0))}%`);
    const text=overlay.querySelector('[data-evo-update-label]');
    if(text&&label)text.textContent=label;
  };

  const waitSWMessage=(type,timeout=2300)=>new Promise(resolve=>{
    if(!navigator.serviceWorker){resolve(null);return}
    let done=false;
    const finish=value=>{
      if(done)return;
      done=true;
      clearTimeout(timer);
      navigator.serviceWorker.removeEventListener('message',handler);
      resolve(value);
    };
    const handler=e=>{if(e.data?.type===type)finish(e.data)};
    const timer=setTimeout(()=>finish(null),timeout);
    navigator.serviceWorker.addEventListener('message',handler);
  });

  const waitControllerChange=(timeout=2300)=>new Promise(resolve=>{
    if(!navigator.serviceWorker){resolve(false);return}
    let done=false;
    const finish=value=>{
      if(done)return;
      done=true;
      clearTimeout(timer);
      navigator.serviceWorker.removeEventListener('controllerchange',handler);
      resolve(value);
    };
    const handler=()=>finish(true);
    const timer=setTimeout(()=>finish(false),timeout);
    navigator.serviceWorker.addEventListener('controllerchange',handler,{once:true});
  });

  const deleteCachedEvolutionApp=async()=>{
    if(!('caches'in window))return;

    const keys=await caches.keys().catch(()=>[]);

    await Promise.all(
      keys
        .filter(key=>String(key).startsWith('evolution'))
        .map(async key=>{
          try{
            const cache=await caches.open(key);
            const requests=await cache.keys();

            await Promise.all(
              requests.map(request=>{
                try{
                  const url=new URL(request.url);
                  if(url.origin===location.origin&&url.pathname==='/evolution-app.js'){
                    return cache.delete(request);
                  }
                }catch(_){}
                return Promise.resolve(false);
              })
            );
          }catch(_){}
        })
    );
  };

  const primeLatestEvolutionApp=async release=>{
    const stamp=Date.now();
    const requestURL=`/evolution-app.js?evo-build=${release?.build||APP_BUILD}&t=${stamp}`;

    /* Después de borrar la copia cacheada, el SW V36 puede seguir
       funcionando normalmente: staleWhileRevalidate no encontrará
       evolution-app.js y tendrá que obtener esta copia desde red. */
    const response=await fetch(requestURL,{
      cache:'reload',
      credentials:'same-origin',
      headers:{accept:'application/javascript,text/javascript,*/*;q=0.1'}
    });

    if(!response.ok){
      throw new Error(`APP_REFRESH_HTTP_${response.status}`);
    }

    return true;
  };

  const applyEvolutionUpdate=async release=>{
    if(evolutionUpdateBusy)return;
    evolutionUpdateBusy=true;

    try{
      sessionStorage.setItem(
        'evolution_update_busy_build',
        String(release?.build||APP_BUILD)
      );
    }catch(_){}

    const overlay=evolutionUpdateOverlay;
    const btn=overlay?.querySelector('[data-evo-update-btn]');
    const later=overlay?.querySelector('[data-evo-update-later]');

    btn?.classList.add('is-loading');
    if(btn)btn.disabled=true;
    if(later)later.disabled=true;

    try{
      setUpdateProgress(12,'Verificando la nueva versión…');

      /* Confirmamos una vez más el JSON directamente desde red. */
      const latest=await fetchEvolutionRelease();
      const targetBuild=latest.build||release?.build||APP_BUILD;

      if(targetBuild<=APP_BUILD&&release?.build>APP_BUILD){
        throw new Error('RELEASE_NOT_READY');
      }

      setUpdateProgress(34,'Preparando actualización…');

      /* V37+: NO actualizamos Service Worker y NO vaciamos views,
         imágenes, navbar ni payments. Solo quitamos app.js. */
      await deleteCachedEvolutionApp();

      setUpdateProgress(58,'Descargando Evolution…');
      await primeLatestEvolutionApp(latest.build?latest:release);

      setUpdateProgress(82,'Aplicando mejoras…');
      acknowledgeRelease(targetBuild);

      try{
        sessionStorage.setItem(
          'evolution_update_completed',
          JSON.stringify({
            build:targetBuild,
            at:Date.now(),
            mode:'app-json'
          })
        );
      }catch(_){}

      await new Promise(resolve=>setTimeout(resolve,380));

      setUpdateProgress(100,'Listo · Reiniciando Evolution…');
      await new Promise(resolve=>setTimeout(resolve,520));

      const url=new URL(location.href);
      url.searchParams.set(
        'evo_update',
        `${targetBuild}-${Date.now()}`
      );

      location.replace(url.href);
    }catch(error){
      console.warn('[Evolution Update]',error);

      evolutionUpdateBusy=false;

      try{
        sessionStorage.removeItem('evolution_update_busy_build');
      }catch(_){}

      if(btn){
        btn.disabled=false;
        btn.classList.remove('is-loading');
      }
      if(later)later.disabled=false;

      setUpdateProgress(0,'Intentar nuevamente');

      const status=overlay?.querySelector('[data-evo-update-status]');
      if(status){
        status.textContent=
          'No se pudo descargar la nueva versión. Revisa tu conexión e inténtalo nuevamente.';
      }
    }
  };

  const closeUpdateCenter=()=>{
    if(evolutionUpdateBusy||!evolutionUpdateOverlay)return;
    acknowledgeRelease(evolutionRelease?.build);
    const overlay=evolutionUpdateOverlay;
    overlay.classList.remove('is-visible');
    setTimeout(()=>{
      if(!overlay.classList.contains('is-visible')){
        overlay.remove();
        if(evolutionUpdateOverlay===overlay)evolutionUpdateOverlay=null;
      }
    },420);
  };

  const showUpdateCenter=release=>{
    const data=normalizeRelease(release);
    if(!data.build)data.build=APP_BUILD;

    /* Si esta misma build ya está abierta, no reconstruimos el modal.
       Evita parpadeos o duplicados cuando llegan varios eventos juntos. */
    if(
      evolutionUpdateOverlay?.isConnected &&
      evolutionRelease?.build===data.build
    ){
      return;
    }

    evolutionRelease=data;
    ensureUpdateCenterStyle();

    evolutionUpdateOverlay?.remove();

    const newer=data.build>APP_BUILD;
    const notes=(data.notes.length?data.notes:fallbackNotes).slice(0,3);

    const overlay=document.createElement('div');
    overlay.id='evolution-update-center';
    overlay.setAttribute('role','dialog');
    overlay.setAttribute('aria-modal','true');
    overlay.setAttribute('aria-labelledby','evo-up-title');

    overlay.innerHTML=`
      <section class="evo-up-card">
        <div>
          <header class="evo-up-head">
            <img class="evo-up-logo" src="/img/logo.png" alt="Evolution Design" decoding="async">
            <span class="evo-up-build">BUILD ${data.build}</span>
          </header>

          <div class="evo-up-orb" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke-width="1.55">
              <path d="M20 7h-5V2"/>
              <path d="M20 7a9 9 0 1 0 1 8"/>
              <path d="m20 7-5-5"/>
            </svg>
          </div>

          <div class="evo-up-copy">
            <p class="evo-up-kicker">Evolution · Update Center</p>
            <h1 class="evo-up-title" id="evo-up-title">
              ${newer?'Hay una nueva':'Evolution acaba de'}<br>
              <em>${newer?'versión.':'mejorar.'}</em>
            </h1>
            <p class="evo-up-sub" data-evo-update-status>${data.subtitle}</p>

            <div class="evo-up-grid">
              ${notes.map((note,index)=>`
                <article class="evo-up-item">
                  <span class="evo-up-icon" aria-hidden="true">${updateIcon(index)}</span>
                  <strong>${note.title}</strong>
                  <p>${note.detail||''}</p>
                </article>
              `).join('')}
            </div>
          </div>
        </div>

        <div class="evo-up-actions">
          <button type="button" class="evo-up-btn" data-evo-update-btn>
            <span class="evo-up-progress" aria-hidden="true"></span>
            <span class="evo-up-label">
              <svg viewBox="0 0 24 24" fill="none" stroke-width="1.8">
                <path d="M20 7h-5V2"/>
                <path d="M20 7a9 9 0 1 0 1 8"/>
                <path d="m20 7-5-5"/>
              </svg>
              <span data-evo-update-label>${newer?'Actualizar ahora':'Aplicar actualización'}</span>
            </span>
          </button>

          ${data.required?'':`
            <button type="button" class="evo-up-later" data-evo-update-later>
              Más tarde
            </button>
          `}

          <div class="evo-up-safe">
            <svg viewBox="0 0 24 24" fill="none" stroke-width="1.6">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
              <path d="m9 12 2 2 4-4"/>
            </svg>
            Tu sesión, proyectos y pagos no se modifican.
          </div>
        </div>
      </section>
    `;

    document.body.appendChild(overlay);
    evolutionUpdateOverlay=overlay;

    overlay.querySelector('[data-evo-update-btn]')
      ?.addEventListener('click',()=>applyEvolutionUpdate(data));

    overlay.querySelector('[data-evo-update-later]')
      ?.addEventListener('click',closeUpdateCenter);

    requestAnimationFrame(()=>{
      requestAnimationFrame(()=>overlay.classList.add('is-visible'));
    });
  };

  const fetchEvolutionRelease=async()=>{
    const response=await fetch(
      `${RELEASE_ENDPOINT}?current=${APP_BUILD}&t=${Date.now()}`,
      {
        cache:'no-store',
        credentials:'same-origin',
        headers:{accept:'application/json'}
      }
    );
    if(!response.ok)throw new Error(`RELEASE_HTTP_${response.status}`);
    return normalizeRelease(await response.json());
  };

  const checkEvolutionRelease=async({
    force=false,
    announceCurrent=true
  }={})=>{
    /* Una sola consulta a la vez. Dos mensajes del SW nunca pueden abrir
       dos Update Centers de forma simultánea. */
    if(evolutionReleaseCheckPromise)return evolutionReleaseCheckPromise;

    /* Mientras se está aplicando una actualización ignoramos cualquier
       aviso automático del Service Worker. */
    if(evolutionUpdateBusy&&!force)return false;

    evolutionReleaseCheckPromise=(async()=>{
      try{
        const release=await fetchEvolutionRelease();
        evolutionRelease=release;

        const ack=releaseAck();

        /* Una build nueva solo se anuncia si el usuario todavía NO la
           reconoció. "Más tarde" también reconoce esa build, así no
           vuelve a molestar en cada visibilitychange / SW check. */
        const newer=
          release.build>APP_BUILD &&
          ack<release.build;

        const currentAnnouncement=
          announceCurrent &&
          release.announce &&
          release.build===APP_BUILD &&
          ack<release.build;

        if(newer||currentAnnouncement||force){
          showUpdateCenter(release);
          return true;
        }
        return false;
      }catch(error){
        if(force)console.warn('[Evolution Update] Release check',error);
        return false;
      }finally{
        evolutionReleaseCheckPromise=null;
      }
    })();

    return evolutionReleaseCheckPromise;
  };

  document.addEventListener('evolution:update-center',async event=>{
    if(event.detail?.release){
      showUpdateCenter(event.detail.release);
      return;
    }
    await checkEvolutionRelease({force:true,announceCurrent:true});
  });

  window.EvolutionUpdateArchitecture={
    mode:'app+json',
    app:'/evolution-app.js',
    manifest:'/evolution-version.json',
    serviceWorkerPolicy:'change-only-when-cache-strategy-changes'
  };

  window.EvolutionSwipePerformance={
    get tier(){return swipeVisualTier},
    get nativeTier(){return swipeNativeTier},
    get reason(){return swipeTierReason},
    setPremium:()=>setSwipeVisualTier('premium','manual'),
    setStandard:()=>setSwipeVisualTier('standard','manual'),
    setLite:()=>setSwipeVisualTier('lite','manual'),
    auto:()=>{
      try{
        sessionStorage.removeItem('evolution_swipe_tier_runtime');
        sessionStorage.removeItem('evolution_swipe_tier_reason');
        sessionStorage.removeItem('evolution_swipe_tier_build');
      }catch(_){}

      const result=detectSwipeVisualTier();
      swipeNativeTier=result.nativeTier||result.tier;
      setSwipeVisualTier(result.tier,result.reason);
      return result;
    }
  };

  window.EvolutionUpdate={
    build:APP_BUILD,
    check:()=>checkEvolutionRelease({force:true,announceCurrent:true}),
    show:()=>showUpdateCenter(
      evolutionRelease||{
        build:APP_BUILD,
        announce:true,
        subtitle:'Actualiza para aplicar correcciones de errores, mejoras de estabilidad y los últimos cambios de Evolution.'
      }
    )
  };

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

    if(data.type==='EVOLUTION_SW_ACTIVATED'){
      noteSWVersion(data.version);
      setTimeout(()=>{
        checkEvolutionRelease({force:false,announceCurrent:true});
      },300);
    }

    if(data.type==='EVOLUTION_UPDATE_READY'){
      setTimeout(()=>{
        checkEvolutionRelease({force:false,announceCurrent:true});
      },120);
    }

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

  addEventListener('resize',()=>{
    if(swipeSettling)return;
    swipePreviewGeneration++;
    refreshSwipeNeighbors();
  },{passive:true});

  /* Safari puede cancelar un touch al rotar, ir a background o iniciar
     un gesto del sistema. En todos esos casos V31 vuelve a estado completo. */
  addEventListener('pagehide',hardResetSwipeVisuals,{passive:true});
  addEventListener('blur',hardResetSwipeVisuals,{passive:true});
  addEventListener('orientationchange',()=>{
    hardResetSwipeVisuals();
    setTimeout(()=>refreshSwipeNeighbors(),120);
  },{passive:true});
  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState!=='visible')hardResetSwipeVisuals();
  },{passive:true});

  /* ---------- BOOT ---------- */
  const boot=async()=>{
    initializeSwipeVisualTier();

    const initial=routeFromURL(location.href);

    try{
      sessionStorage.removeItem('evolution_update_busy_build');
    }catch(_){}

    try{
      const updateURL=new URL(location.href);
      if(updateURL.searchParams.has('evo_update')){
        updateURL.searchParams.delete('evo_update');
        history.replaceState(
          history.state,
          '',
          `${updateURL.pathname}${updateURL.search}${updateURL.hash}`
        );
      }
    }catch(_){}

    /* Inicia Firebase Auth en el Shell inmediatamente. Mientras se restaura
       la sesión local, la UI recordada evita parpadeos en la misma apertura. */
    initShellAuth();

    /* Recupera inmediatamente foto/Admin del mismo tab antes de que la
       primera vista termine de consultar Firebase. */
    if(stableAuth.user?.uid){
      requestAnimationFrame(()=>applyStableAuth());
    }

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

    /* La V34 se anuncia una sola vez. En V35+ solo aparece si
       evolution-version.json reporta una build superior. */
    setTimeout(()=>{
      const appLike=
        standalone() ||
        matchMedia('(max-width:991.98px)').matches;

      if(appLike){
        checkEvolutionRelease({
          force:false,
          announceCurrent:true
        });
      }
    },1450);

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
    get network(){return networkMode},
    get auth(){return {user:stableAuth.user?{...stableAuth.user}:null,isAdmin:stableAuth.isAdmin}},
    get shellAuthReady(){return Boolean(shellAuth)}
  };
})();
