/* Evolution Design · Smart Persistent Navigation · v20 · Devices Store */
(() => {
  'use strict';

  const ICONS = {
    menu:`<svg viewBox="0 0 24 24"><path d="M3 6h18M3 12h18M3 18h18"/></svg>`,
    home:`<svg viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/></svg>`,
    arq:`<svg viewBox="0 0 24 24"><path d="M4 4h16"/><path d="M12 4v17"/><path d="M8.5 21h7"/><path d="M6 2v4M9 2v4M12 2v4M15 2v4M18 2v4"/></svg>`,
    graf:`<svg viewBox="0 0 24 24"><path d="M12 2v20M2 12h20"/><path d="m9 5 3-3 3 3M9 19l3 3 3-3M5 9l-3 3 3 3M19 9l3 3-3 3"/></svg>`,
    web:`<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 13l-2 2 2 2M15 13l2 2-2 2"/></svg>`,
    folder:`<svg viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`,
    devices:`<svg viewBox="0 0 24 24"><rect x="2.5" y="5" width="12.5" height="9" rx="1.5"/><path d="M6 18h5.5M8.75 14v4"/><rect x="16.5" y="3" width="5" height="11" rx="1.3"/><path d="M18.25 11.5h1.5"/></svg>`,
    academy:`<svg viewBox="0 0 24 24"><path d="m3 10 9-5 9 5-9 5-9-5Z"/><path d="M7 12.5V17c3 2 7 2 10 0v-4.5M21 10v6"/></svg>`,
    login:`<svg viewBox="0 0 24 24"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3"/></svg>`,
    logout:`<svg viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>`,
    shield:`<svg viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
    install:`<svg viewBox="0 0 24 24"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>`
  };

  const PAGES = [
    {key:'home',href:'/index.html',label:'Home',short:'Home',icon:'home'},
    {key:'arquitectura',href:'/arquitectura.html',label:'Arquitectura',short:'Arq.',icon:'arq'},
    {key:'grafico',href:'/diseno-grafico.html',label:'Diseño Gráfico',short:'Diseño G.',icon:'graf'},
    {key:'web',href:'/diseno-web.html',label:'Diseño Web',short:'Web',icon:'web'},
    {key:'portfolio',href:'/portafolio.html',label:'Proyectos',short:'Proyectos',icon:'folder'},
    {key:'academy',href:'/academia.html',label:'Academia',short:'Cursos',icon:'academy'},
    {key:'devices',href:'/dispositivos.html',label:'Dispositivos',short:'Tienda',icon:'devices'}
  ];
  const MOBILE_PAGES = PAGES.filter(page => page.key !== 'portfolio');

  const escapeHTML = value => String(value ?? '')
    .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
    .replaceAll('"','&quot;').replaceAll("'",'&#39;');

  const inferKey = value => {
    let p='';
    try { p=new URL(value || location.href,location.href).pathname.toLowerCase(); } catch (_) {}
    if(p.includes('arquitectura')) return 'arquitectura';
    if(p.includes('diseno-grafico')) return 'grafico';
    if(p.includes('diseno-web')) return 'web';
    if(p.includes('portafolio')) return 'portfolio';
    if(p.includes('academia')||p.includes('curso-autocad')) return 'academy';
    if(p.includes('dispositivos')) return 'devices';
    return 'home';
  };

  const style = document.createElement('style');
  style.id='evolution-smart-nav-style';
  style.textContent = `
    :root{--evo-accent:#d4b895}
    evolution-nav{display:block;position:relative;z-index:2147483000}
    .evo-nav,.evo-nav *{box-sizing:border-box}
    .evo-nav a{text-decoration:none;-webkit-tap-highlight-color:transparent}
    .evo-nav svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.6}
    .evo-d-none{display:none!important}

    .evo-desktop{display:none;position:fixed;top:0;left:0;right:0;z-index:2147483000;padding:calc(22px + env(safe-area-inset-top,0px)) 22px 0;pointer-events:none}
    .evo-desktop-inner{width:min(1400px,100%);margin:auto;display:flex;align-items:center;gap:12px}
    .evo-pill{pointer-events:auto;position:relative;isolation:isolate;flex:1;min-height:58px;padding:7px 9px 7px 14px;border:1px solid rgba(255,255,255,.13);border-radius:999px;background:linear-gradient(135deg,rgba(24,24,27,.86),rgba(7,7,9,.88));box-shadow:0 14px 42px rgba(0,0,0,.34),inset 0 1px rgba(255,255,255,.08);backdrop-filter:blur(20px) saturate(150%);-webkit-backdrop-filter:blur(20px) saturate(150%);display:flex;align-items:center;gap:16px;transition:background .28s ease,border-color .28s ease,box-shadow .28s ease,backdrop-filter .28s ease,-webkit-backdrop-filter .28s ease}
    evolution-nav.evo-is-scrolled .evo-pill{background:linear-gradient(135deg,rgba(20,20,23,.965),rgba(7,7,9,.975));border-color:rgba(255,255,255,.17);box-shadow:0 20px 55px rgba(0,0,0,.50),inset 0 1px rgba(255,255,255,.10);backdrop-filter:blur(30px) saturate(175%);-webkit-backdrop-filter:blur(30px) saturate(175%)}
    .evo-brand{display:flex;align-items:center;gap:12px;position:relative;flex:0 0 auto}
    .evo-logo{display:flex;align-items:center}
    .evo-logo img{display:block;height:31px;width:auto;max-width:150px}
    .evo-menu-wrap{position:relative}
    .evo-icon{position:relative;isolation:isolate;overflow:hidden;width:42px;height:42px;min-width:42px;display:inline-flex;align-items:center;justify-content:center;border-radius:50%;border:1px solid rgba(255,255,255,.18);background:linear-gradient(180deg,rgba(255,255,255,.16),rgba(255,255,255,.055));color:#fff;box-shadow:0 10px 28px rgba(0,0,0,.28),inset 0 1px 0 rgba(255,255,255,.28),inset 0 -10px 20px rgba(255,255,255,.03);backdrop-filter:blur(22px) saturate(170%);-webkit-backdrop-filter:blur(22px) saturate(170%);transition:transform .2s cubic-bezier(.16,1,.3,1),background .18s ease,border-color .18s ease,box-shadow .18s ease}
    .evo-icon:before{content:"";position:absolute;inset:1px;z-index:-1;border-radius:inherit;background:linear-gradient(180deg,rgba(255,255,255,.16),rgba(255,255,255,.02) 58%,rgba(255,255,255,.01))}
    .evo-icon:after{content:"";position:absolute;left:7px;right:7px;top:5px;height:42%;border-radius:999px;background:linear-gradient(180deg,rgba(255,255,255,.20),rgba(255,255,255,0));opacity:.85;pointer-events:none}
    .evo-icon:hover{background:linear-gradient(180deg,rgba(255,255,255,.22),rgba(255,255,255,.075));border-color:rgba(255,255,255,.24);box-shadow:0 14px 34px rgba(0,0,0,.34),inset 0 1px 0 rgba(255,255,255,.32),inset 0 -12px 22px rgba(255,255,255,.04);transform:scale(1.04)}
    .evo-icon:active{transform:scale(.95)}

    .evo-links{position:relative;margin-left:auto;display:flex;align-items:center;gap:clamp(12px,1.3vw,21px);min-width:0}
    .evo-link{position:relative;color:#929299;font:600 clamp(.70rem,.78vw,.86rem)/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;white-space:nowrap;transition:color .18s ease,transform .20s cubic-bezier(.16,1,.3,1)}
    .evo-link:hover,.evo-link.active{color:#fff}
    .evo-link.active{transform:translateY(-1px)}
    .evo-link.active:after{display:none!important}

    .evo-route-indicator{position:absolute;left:0;bottom:-10px;height:2px;width:var(--evo-ind-w,0px);border-radius:999px;background:var(--evo-accent);box-shadow:0 0 12px rgba(212,184,149,.42);transform:translate3d(var(--evo-ind-x,0px),0,0);opacity:0;pointer-events:none;transition:width .34s cubic-bezier(.16,1,.3,1),transform .34s cubic-bezier(.16,1,.3,1),opacity .18s ease}
    .evo-route-indicator.ready{opacity:1}

    .evo-orders-link{color:#b9b1a7!important}.evo-orders-link:hover{color:#fff!important}
    .evo-login{color:var(--evo-accent)!important;font-weight:800!important;display:inline-flex;align-items:center;gap:5px}
    .evo-software{height:42px;padding:0 17px;border-radius:999px;background:#f5f5f3;color:#080808;display:inline-flex;align-items:center;font:800 .73rem/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;white-space:nowrap;transition:transform .18s ease}
    .evo-software:hover{transform:translateY(-1px)}
    #floating-profile-desktop{pointer-events:auto;width:42px;height:42px;display:flex;align-items:center;justify-content:center}
    .evo-profile-pic{width:38px;height:38px;border-radius:50%;object-fit:cover;border:2px solid rgba(212,184,149,.58);background:#111;box-shadow:0 8px 24px rgba(0,0,0,.3)}
    .evo-avatar-fallback{width:38px;height:38px;border-radius:50%;display:grid;place-items:center;background:#1b1b1e;border:2px solid rgba(212,184,149,.58);color:#fff;font:800 .78rem system-ui}
    #admin-badge-container-desktop{position:absolute;top:49px;left:53px;z-index:10}
    .evo-admin-badge{display:inline-flex;align-items:center;gap:5px;padding:7px 10px;border-radius:999px;background:rgba(190,38,55,.25);border:1px solid rgba(220,53,69,.48);color:#fff!important;font:800 .61rem/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}
    .evo-admin-badge svg{width:13px;height:13px}

    .evo-drop{position:absolute;left:0;top:52px;min-width:220px;margin:0;padding:8px;list-style:none;border:1px solid rgba(255,255,255,.13);border-radius:20px;background:linear-gradient(180deg,rgba(19,19,22,.84),rgba(9,9,11,.92));box-shadow:0 22px 60px rgba(0,0,0,.48),inset 0 1px 0 rgba(255,255,255,.14);backdrop-filter:blur(28px) saturate(165%);-webkit-backdrop-filter:blur(28px) saturate(165%);opacity:0;visibility:hidden;pointer-events:none;transform:translateY(-7px) scale(.98);transform-origin:top left;transition:opacity .18s ease,transform .22s cubic-bezier(.16,1,.3,1),visibility .18s}
    .evo-drop.show{opacity:1;visibility:visible;pointer-events:auto;transform:none}
    .evo-drop li{list-style:none;margin:0;padding:0}
    .evo-menu-item{display:flex;align-items:center;gap:10px;padding:11px 12px;border-radius:13px;color:#d0d0d4;font:600 .76rem/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;transition:background .18s ease,color .18s ease,transform .18s ease}
    .evo-menu-item svg{width:18px;height:18px;opacity:.84}
    .evo-menu-item:hover,.evo-menu-item.active{background:linear-gradient(180deg,rgba(255,255,255,.10),rgba(255,255,255,.045));color:#fff;transform:translateX(1px)}

    .evo-mobile{display:block;position:fixed!important;top:0!important;left:0!important;right:0!important;width:100%!important;z-index:2147483000!important;padding-top:env(safe-area-inset-top,0px)!important;background:rgba(5,5,6,.90)!important;border-bottom:1px solid rgba(255,255,255,.055)!important;box-shadow:0 6px 20px rgba(0,0,0,.18)!important;backdrop-filter:blur(10px) saturate(120%)!important;-webkit-backdrop-filter:blur(10px) saturate(120%)!important;transform:none!important;transition:background .28s ease,border-color .28s ease,box-shadow .28s ease,backdrop-filter .28s ease,-webkit-backdrop-filter .28s ease}
    evolution-nav.evo-is-scrolled .evo-mobile{background:rgba(5,5,6,.975)!important;border-bottom-color:rgba(255,255,255,.09)!important;box-shadow:0 10px 34px rgba(0,0,0,.38)!important;backdrop-filter:blur(20px) saturate(150%)!important;-webkit-backdrop-filter:blur(20px) saturate(150%)!important}
    .evo-mobile-top{min-height:60px;padding:10px 14px 9px;display:grid;grid-template-columns:40px minmax(0,1fr) auto;align-items:center;gap:10px}
    .evo-mobile .evo-logo{justify-self:center}
    .evo-mobile .evo-logo img{height:27px;max-width:128px}
    .evo-mobile .evo-icon{width:40px;height:40px;min-width:40px;border-color:rgba(255,255,255,.18);background:linear-gradient(180deg,rgba(255,255,255,.18),rgba(255,255,255,.065));box-shadow:0 12px 30px rgba(0,0,0,.30),inset 0 1px 0 rgba(255,255,255,.30),inset 0 -10px 20px rgba(255,255,255,.04);backdrop-filter:blur(24px) saturate(180%);-webkit-backdrop-filter:blur(24px) saturate(180%)}
    #mobileMenuBtn{border-color:rgba(255,255,255,.22);background:linear-gradient(180deg,rgba(255,255,255,.22),rgba(255,255,255,.07));box-shadow:0 14px 34px rgba(0,0,0,.34),inset 0 1px 0 rgba(255,255,255,.34),inset 0 -12px 22px rgba(255,255,255,.05)}
    #mobileMenuBtn:focus,#mobileMenuBtn:focus-visible,#mobileMenuBtn[aria-expanded="true"]{outline:none!important;border-color:rgba(212,184,149,.48)!important;background:linear-gradient(180deg,rgba(212,184,149,.22),rgba(255,255,255,.065))!important;color:#fff!important;box-shadow:0 14px 34px rgba(0,0,0,.34),inset 0 1px 0 rgba(255,255,255,.26)!important}
    #mobileMenuBtn svg{stroke-width:1.9}
    #auth-mobile-wrapper{min-width:40px;display:flex;align-items:center;justify-content:flex-end;gap:7px}
    .evo-mobile-auth{display:flex;align-items:center;gap:7px}
    .evo-mobile-profile,.evo-mobile-action{position:relative;isolation:isolate;overflow:hidden;width:36px;height:36px;display:inline-flex;align-items:center;justify-content:center;border-radius:50%;border:1px solid rgba(255,255,255,.15);background:linear-gradient(180deg,rgba(255,255,255,.14),rgba(255,255,255,.05));color:#fff!important;box-shadow:0 8px 22px rgba(0,0,0,.24),inset 0 1px 0 rgba(255,255,255,.20);backdrop-filter:blur(20px) saturate(170%);-webkit-backdrop-filter:blur(20px) saturate(170%)}
    .evo-mobile-profile{border-color:rgba(212,184,149,.5)}
    .evo-mobile-profile img{width:28px;height:28px;border-radius:50%;object-fit:cover}
    .evo-mobile-profile .evo-avatar-fallback{width:28px;height:28px;border:0;font-size:.62rem}

    .evo-tabs{position:relative;display:grid!important;grid-template-columns:repeat(6,minmax(0,1fr))!important;padding:0 7px!important;gap:2px!important}
    .evo-tab{min-width:0;min-height:54px;padding:5px 1px 7px;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#7d7d85;border-bottom:2px solid transparent;font:600 .54rem/1.1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;white-space:nowrap;transition:color .18s ease,transform .22s cubic-bezier(.16,1,.3,1)}
    .evo-tab svg{width:19px;height:19px;margin-bottom:4px;opacity:.66;transition:opacity .18s ease,transform .30s cubic-bezier(.16,1,.3,1)}
    .evo-tab.active{color:#fff}
    .evo-tab.active svg{opacity:1;transform:translateY(-1px) scale(1.09)}
    .evo-tab:active{transform:scale(.95)}
    .evo-mobile-indicator{bottom:0;height:2px}

    evolution-nav[data-network="slow"] .evo-pill,
    evolution-nav[data-network="slow"] .evo-mobile{
      backdrop-filter:blur(8px)!important;
      -webkit-backdrop-filter:blur(8px)!important;
    }

    evolution-nav.evo-academy-light-glass .evo-pill{background:linear-gradient(135deg,rgba(255,255,255,.70),rgba(244,239,231,.48))!important;border-color:rgba(255,255,255,.88)!important;box-shadow:0 18px 55px rgba(73,55,31,.16),inset 0 1px 0 rgba(255,255,255,.96),inset 0 -1px 0 rgba(120,91,53,.08)!important;backdrop-filter:blur(32px) saturate(180%)!important;-webkit-backdrop-filter:blur(32px) saturate(180%)!important}
    evolution-nav.evo-academy-light-glass .evo-logo img{filter:invert(1);opacity:.88}
    evolution-nav.evo-academy-light-glass .evo-link{color:#625d56}
    evolution-nav.evo-academy-light-glass .evo-link:hover,evolution-nav.evo-academy-light-glass .evo-link.active{color:#111113}
    evolution-nav.evo-academy-light-glass .evo-orders-link{color:#7c6b55!important}
    evolution-nav.evo-academy-light-glass .evo-icon{color:#24211d;border-color:rgba(110,87,58,.18);background:linear-gradient(180deg,rgba(255,255,255,.88),rgba(225,214,199,.42));box-shadow:0 12px 28px rgba(70,52,30,.13),inset 0 1px 0 #fff}
    evolution-nav.evo-academy-light-glass .evo-icon:before{background:linear-gradient(180deg,rgba(255,255,255,.78),rgba(255,255,255,.08))}
    evolution-nav.evo-academy-light-glass .evo-icon:after{background:linear-gradient(180deg,rgba(255,255,255,.92),rgba(255,255,255,0))}
    evolution-nav.evo-academy-light-glass .evo-software{background:#191715;color:#fff;box-shadow:0 10px 24px rgba(30,23,15,.18)}
    evolution-nav.evo-academy-light-glass .evo-route-indicator{background:#a97a43;box-shadow:0 0 12px rgba(169,122,67,.3)}
    evolution-nav.evo-academy-light-glass .evo-drop{background:linear-gradient(180deg,rgba(255,255,255,.92),rgba(245,239,231,.9));border-color:rgba(101,76,44,.14);box-shadow:0 24px 60px rgba(56,42,25,.18),inset 0 1px #fff}
    evolution-nav.evo-academy-light-glass .evo-menu-item{color:#4e4943}
    evolution-nav.evo-academy-light-glass .evo-menu-item:hover,evolution-nav.evo-academy-light-glass .evo-menu-item.active{background:rgba(169,122,67,.1);color:#111}
    evolution-nav.evo-academy-light-glass .evo-mobile{background:linear-gradient(180deg,rgba(255,255,255,.82),rgba(245,239,231,.68))!important;border-bottom-color:rgba(99,74,43,.12)!important;box-shadow:0 10px 30px rgba(64,48,28,.13)!important;backdrop-filter:blur(28px) saturate(175%)!important;-webkit-backdrop-filter:blur(28px) saturate(175%)!important}
    evolution-nav.evo-academy-light-glass .evo-tab{color:#77716a}
    evolution-nav.evo-academy-light-glass .evo-tab.active{color:#171513}

    /* Apple 26.1 inspired Liquid Glass · Academy light trial */
    evolution-nav.evo-academy-light-glass .evo-pill{min-height:62px;padding:8px 10px 8px 14px;background:linear-gradient(115deg,rgba(255,255,255,.34),rgba(255,255,255,.16) 48%,rgba(225,216,204,.20))!important;border:1px solid rgba(255,255,255,.72)!important;box-shadow:0 22px 55px rgba(52,42,30,.14),inset 0 1px 0 rgba(255,255,255,.98),inset 0 -1px 0 rgba(102,79,51,.10),inset 18px 0 40px rgba(255,255,255,.15)!important;backdrop-filter:blur(42px) saturate(210%) contrast(104%)!important;-webkit-backdrop-filter:blur(42px) saturate(210%) contrast(104%)!important;overflow:hidden}
    evolution-nav.evo-academy-light-glass .evo-pill:before{content:"";position:absolute;z-index:-1;left:3%;right:3%;top:1px;height:45%;border-radius:999px;background:linear-gradient(180deg,rgba(255,255,255,.58),rgba(255,255,255,.08));filter:blur(.2px);pointer-events:none}
    evolution-nav.evo-academy-light-glass .evo-pill:after{content:"";position:absolute;z-index:-1;width:220px;height:110px;right:18%;top:-58px;border-radius:50%;background:radial-gradient(circle,rgba(255,255,255,.72),rgba(255,255,255,0) 70%);transform:rotate(-10deg);pointer-events:none}
    evolution-nav.evo-academy-light-glass.evo-is-scrolled .evo-pill{background:linear-gradient(115deg,rgba(255,255,255,.50),rgba(246,241,234,.30) 55%,rgba(255,255,255,.38))!important;border-color:rgba(255,255,255,.84)!important;box-shadow:0 26px 68px rgba(43,34,24,.18),inset 0 1px 0 #fff,inset 0 -1px rgba(94,70,42,.10)!important}
    evolution-nav.evo-academy-light-glass .evo-brand{z-index:2}
    evolution-nav.evo-academy-light-glass .evo-logo img{filter:invert(1);opacity:.82}
    evolution-nav.evo-academy-light-glass .evo-links{gap:clamp(4px,.45vw,8px);z-index:2}
    evolution-nav.evo-academy-light-glass .evo-link{padding:10px 11px;border-radius:999px;color:rgba(38,35,31,.68);font-weight:650;transition:color .18s,background .2s,box-shadow .2s,transform .2s}
    evolution-nav.evo-academy-light-glass .evo-link:hover{color:#171513;background:rgba(255,255,255,.34);box-shadow:inset 0 1px rgba(255,255,255,.72)}
    evolution-nav.evo-academy-light-glass .evo-link.active{color:#171513;background:linear-gradient(180deg,rgba(255,255,255,.72),rgba(255,255,255,.34));border:1px solid rgba(255,255,255,.72);box-shadow:0 7px 18px rgba(63,48,30,.10),inset 0 1px #fff,inset 0 -1px rgba(111,82,48,.08);transform:none}
    evolution-nav.evo-academy-light-glass .evo-route-indicator{display:none}
    evolution-nav.evo-academy-light-glass .evo-icon{width:44px;height:44px;min-width:44px;color:#28241f;border:1px solid rgba(255,255,255,.76);background:linear-gradient(145deg,rgba(255,255,255,.62),rgba(255,255,255,.20));box-shadow:0 12px 28px rgba(56,43,28,.13),inset 0 1px #fff,inset 0 -1px rgba(101,76,46,.1);backdrop-filter:blur(28px) saturate(190%);-webkit-backdrop-filter:blur(28px) saturate(190%)}
    evolution-nav.evo-academy-light-glass .evo-icon:hover{background:linear-gradient(145deg,rgba(255,255,255,.82),rgba(255,255,255,.34));border-color:#fff;box-shadow:0 15px 32px rgba(54,41,26,.16),inset 0 1px #fff}
    evolution-nav.evo-academy-light-glass .evo-software{z-index:2;height:44px;padding:0 18px;border:1px solid rgba(255,255,255,.45);background:linear-gradient(145deg,rgba(28,26,23,.92),rgba(49,44,38,.82));color:#fff;box-shadow:0 11px 28px rgba(33,25,16,.20),inset 0 1px rgba(255,255,255,.18);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px)}
    evolution-nav.evo-academy-light-glass #floating-profile-desktop{width:48px;height:48px;border:1px solid rgba(255,255,255,.75);border-radius:50%;background:linear-gradient(145deg,rgba(255,255,255,.55),rgba(255,255,255,.16));box-shadow:0 14px 34px rgba(55,42,27,.16),inset 0 1px #fff;backdrop-filter:blur(28px) saturate(180%);-webkit-backdrop-filter:blur(28px) saturate(180%)}
    evolution-nav.evo-academy-light-glass .evo-profile-pic,evolution-nav.evo-academy-light-glass .evo-avatar-fallback{border-color:rgba(151,111,64,.42)}
    evolution-nav.evo-academy-light-glass .evo-mobile{background:linear-gradient(180deg,rgba(255,255,255,.54),rgba(245,239,231,.28))!important;border-bottom:1px solid rgba(255,255,255,.72)!important;box-shadow:0 14px 38px rgba(55,43,29,.13),inset 0 1px #fff!important;backdrop-filter:blur(38px) saturate(205%)!important;-webkit-backdrop-filter:blur(38px) saturate(205%)!important}
    evolution-nav.evo-academy-light-glass .evo-tab{margin:3px 1px 5px;border:0;border-radius:14px;color:#716b64}
    evolution-nav.evo-academy-light-glass .evo-tab.active{color:#171513;background:rgba(255,255,255,.54);box-shadow:0 7px 18px rgba(67,50,30,.09),inset 0 1px #fff}

    /* Warm amber Liquid Glass reference */
    evolution-nav.evo-academy-light-glass .evo-pill{min-height:64px;padding:0!important;gap:10px;background:transparent!important;border:0!important;box-shadow:none!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important;overflow:visible}
    evolution-nav.evo-academy-light-glass .evo-pill:before,evolution-nav.evo-academy-light-glass .evo-pill:after{display:none}
    evolution-nav.evo-academy-light-glass .evo-brand,evolution-nav.evo-academy-light-glass .evo-links,evolution-nav.evo-academy-light-glass .evo-software,evolution-nav.evo-academy-light-glass #floating-profile-desktop{border:1.5px solid rgba(236,181,105,.72);background:radial-gradient(ellipse at 5% 55%,rgba(20,22,25,.58),transparent 9%),radial-gradient(ellipse at 95% 55%,rgba(23,24,27,.55),transparent 9%),linear-gradient(180deg,rgba(178,142,99,.63),rgba(116,87,55,.58));box-shadow:0 18px 42px rgba(38,27,16,.25),inset 0 2px 2px rgba(255,241,216,.30),inset 0 -2px 2px rgba(44,31,19,.28),inset 12px 0 24px rgba(255,223,177,.08),inset -12px 0 24px rgba(39,29,20,.10);backdrop-filter:blur(24px) saturate(170%) contrast(112%);-webkit-backdrop-filter:blur(24px) saturate(170%) contrast(112%)}
    evolution-nav.evo-academy-light-glass .evo-brand{min-height:62px;padding:8px 18px 8px 8px;border-radius:999px;gap:13px;overflow:hidden}
    evolution-nav.evo-academy-light-glass .evo-links{min-height:62px;margin-left:0;padding:7px 10px;border-radius:999px;gap:2px;overflow:hidden}
    evolution-nav.evo-academy-light-glass .evo-logo img{filter:none;opacity:.96}
    evolution-nav.evo-academy-light-glass .evo-icon{width:44px;height:44px;min-width:44px;color:#fff8ec;border:1px solid rgba(255,230,191,.28);background:linear-gradient(145deg,rgba(255,238,209,.14),rgba(28,27,26,.16));box-shadow:inset 0 1px rgba(255,247,232,.32),0 8px 20px rgba(35,25,16,.18)}
    evolution-nav.evo-academy-light-glass .evo-icon:before{background:linear-gradient(180deg,rgba(255,243,218,.22),rgba(255,255,255,0))}
    evolution-nav.evo-academy-light-glass .evo-icon:after{background:linear-gradient(180deg,rgba(255,238,207,.28),rgba(255,255,255,0))}
    evolution-nav.evo-academy-light-glass .evo-link{padding:11px 10px;color:rgba(255,249,237,.78);text-shadow:0 1px 7px rgba(22,16,10,.45)}
    evolution-nav.evo-academy-light-glass .evo-link:hover{color:#fff;background:rgba(255,240,216,.13);box-shadow:inset 0 1px rgba(255,255,255,.2)}
    evolution-nav.evo-academy-light-glass .evo-link.active{color:#fffdf8;border:1px solid rgba(255,229,188,.3);background:linear-gradient(180deg,rgba(255,235,203,.22),rgba(32,28,24,.15));box-shadow:inset 0 1px rgba(255,255,255,.3),0 6px 16px rgba(38,26,15,.13)}
    evolution-nav.evo-academy-light-glass .evo-orders-link{color:rgba(255,244,226,.74)!important}
    evolution-nav.evo-academy-light-glass .evo-login{color:#fff4df!important}
    evolution-nav.evo-academy-light-glass .evo-software{height:62px;padding:0 20px;border-radius:999px;color:#fffaf1;background:radial-gradient(ellipse at 7% 50%,rgba(20,21,23,.58),transparent 13%),radial-gradient(ellipse at 93% 50%,rgba(20,21,23,.53),transparent 13%),linear-gradient(180deg,rgba(167,130,87,.68),rgba(102,75,47,.62));font-weight:850;text-shadow:0 1px 7px rgba(20,14,9,.48)}
    evolution-nav.evo-academy-light-glass #floating-profile-desktop{width:62px;height:62px;border-radius:50%;background:radial-gradient(circle at 70% 40%,rgba(25,25,27,.48),transparent 27%),linear-gradient(180deg,rgba(171,134,91,.68),rgba(103,76,47,.62))}
    evolution-nav.evo-academy-light-glass .evo-drop{border:1.5px solid rgba(232,177,104,.6);background:linear-gradient(180deg,rgba(134,102,65,.88),rgba(72,54,35,.92));box-shadow:0 25px 65px rgba(34,23,13,.35),inset 0 1px rgba(255,235,204,.24);backdrop-filter:blur(30px) saturate(170%);-webkit-backdrop-filter:blur(30px) saturate(170%)}
    evolution-nav.evo-academy-light-glass .evo-menu-item{color:rgba(255,248,236,.82)}
    evolution-nav.evo-academy-light-glass .evo-menu-item:hover,evolution-nav.evo-academy-light-glass .evo-menu-item.active{background:rgba(255,228,187,.14);color:#fff}
    evolution-nav.evo-academy-light-glass .evo-mobile{background:radial-gradient(ellipse at 3% 45%,rgba(22,23,25,.48),transparent 9%),radial-gradient(ellipse at 97% 45%,rgba(22,23,25,.45),transparent 9%),linear-gradient(180deg,rgba(170,133,90,.72),rgba(100,73,45,.68))!important;border-bottom:1.5px solid rgba(235,180,107,.68)!important;box-shadow:0 16px 38px rgba(36,25,14,.27),inset 0 2px rgba(255,237,207,.22)!important;backdrop-filter:blur(28px) saturate(175%)!important;-webkit-backdrop-filter:blur(28px) saturate(175%)!important}
    evolution-nav.evo-academy-light-glass .evo-mobile .evo-logo img{filter:none}
    evolution-nav.evo-academy-light-glass .evo-tab{color:rgba(255,246,231,.68)}
    evolution-nav.evo-academy-light-glass .evo-tab.active{color:#fff;background:linear-gradient(180deg,rgba(255,235,203,.20),rgba(29,27,24,.16));box-shadow:inset 0 1px rgba(255,255,255,.25),0 7px 17px rgba(35,24,14,.16)}
    /* Neutral glass: its apparent color comes from the page underneath */
    evolution-nav.evo-academy-light-glass .evo-brand,evolution-nav.evo-academy-light-glass .evo-links,evolution-nav.evo-academy-light-glass .evo-software,evolution-nav.evo-academy-light-glass #floating-profile-desktop{border-color:rgba(255,255,255,.62);background:linear-gradient(180deg,rgba(255,255,255,.22),rgba(255,255,255,.075));box-shadow:0 18px 45px rgba(29,27,24,.15),inset 0 1.5px rgba(255,255,255,.86),inset 0 -1px rgba(34,31,27,.12),inset 10px 0 22px rgba(255,255,255,.055),inset -10px 0 22px rgba(22,21,20,.045);backdrop-filter:blur(17px) saturate(175%) contrast(106%);-webkit-backdrop-filter:blur(17px) saturate(175%) contrast(106%)}
    evolution-nav.evo-academy-light-glass .evo-brand{background:linear-gradient(180deg,rgba(255,255,255,.25),rgba(255,255,255,.08))}
    evolution-nav.evo-academy-light-glass .evo-links{background:linear-gradient(180deg,rgba(255,255,255,.20),rgba(255,255,255,.065))}
    evolution-nav.evo-academy-light-glass .evo-links:before{content:"";position:absolute;z-index:-1;inset:3px 7px;border-radius:999px;background:linear-gradient(105deg,rgba(255,255,255,.09),transparent 28%,rgba(255,255,255,.055) 55%,transparent 78%,rgba(255,255,255,.07));pointer-events:none}
    evolution-nav.evo-academy-light-glass .evo-logo img{filter:invert(1);opacity:.82}
    evolution-nav.evo-academy-light-glass .evo-link{color:rgba(28,27,25,.66);text-shadow:0 1px rgba(255,255,255,.28)}
    evolution-nav.evo-academy-light-glass .evo-link:hover{color:#151412;background:rgba(255,255,255,.18)}
    evolution-nav.evo-academy-light-glass .evo-link.active{color:#111;background:linear-gradient(180deg,rgba(255,255,255,.46),rgba(255,255,255,.16));border-color:rgba(255,255,255,.58);box-shadow:0 7px 18px rgba(33,30,26,.09),inset 0 1px rgba(255,255,255,.8)}
    evolution-nav.evo-academy-light-glass .evo-orders-link{color:rgba(35,32,28,.62)!important}
    evolution-nav.evo-academy-light-glass .evo-login{color:#5e4d38!important}
    evolution-nav.evo-academy-light-glass .evo-icon{color:#25231f;border-color:rgba(255,255,255,.62);background:linear-gradient(145deg,rgba(255,255,255,.34),rgba(255,255,255,.09));box-shadow:0 10px 24px rgba(31,28,24,.12),inset 0 1px rgba(255,255,255,.82)}
    evolution-nav.evo-academy-light-glass .evo-software{color:#1e1c19;background:linear-gradient(180deg,rgba(255,255,255,.28),rgba(255,255,255,.09));text-shadow:none}
    evolution-nav.evo-academy-light-glass #floating-profile-desktop{background:linear-gradient(145deg,rgba(255,255,255,.30),rgba(255,255,255,.08))}
    evolution-nav.evo-academy-light-glass .evo-drop{border-color:rgba(255,255,255,.62);background:linear-gradient(180deg,rgba(255,255,255,.72),rgba(246,243,238,.56));box-shadow:0 24px 60px rgba(38,34,29,.18),inset 0 1px rgba(255,255,255,.9);backdrop-filter:blur(28px) saturate(165%);-webkit-backdrop-filter:blur(28px) saturate(165%)}
    evolution-nav.evo-academy-light-glass .evo-menu-item{color:#4d4943}
    evolution-nav.evo-academy-light-glass .evo-menu-item:hover,evolution-nav.evo-academy-light-glass .evo-menu-item.active{background:rgba(255,255,255,.34);color:#111}
    evolution-nav.evo-academy-light-glass .evo-mobile{background:linear-gradient(180deg,rgba(255,255,255,.27),rgba(255,255,255,.08))!important;border-bottom-color:rgba(255,255,255,.6)!important;box-shadow:0 14px 36px rgba(31,28,24,.14),inset 0 1px rgba(255,255,255,.8)!important;backdrop-filter:blur(19px) saturate(175%) contrast(105%)!important;-webkit-backdrop-filter:blur(19px) saturate(175%) contrast(105%)!important}
    evolution-nav.evo-academy-light-glass .evo-mobile .evo-logo img{filter:invert(1)}
    evolution-nav.evo-academy-light-glass .evo-tab{color:rgba(35,33,30,.58)}
    evolution-nav.evo-academy-light-glass .evo-tab.active{color:#151412;background:rgba(255,255,255,.30);box-shadow:inset 0 1px rgba(255,255,255,.75),0 7px 17px rgba(34,30,25,.09)}

    /* v50.74 · Optical Liquid Glass. The backdrop supplies the color. */
    evolution-nav.evo-academy-light-glass .evo-brand,
    evolution-nav.evo-academy-light-glass .evo-links,
    evolution-nav.evo-academy-light-glass .evo-software,
    evolution-nav.evo-academy-light-glass #floating-profile-desktop{
      background:linear-gradient(180deg,rgba(255,255,255,.13),rgba(255,255,255,.035))!important;
      border:1px solid rgba(255,255,255,.56)!important;
      box-shadow:0 18px 42px rgba(25,23,20,.14),inset 0 1px 0 rgba(255,255,255,.94),inset 0 -1px 0 rgba(24,22,19,.11)!important;
      backdrop-filter:blur(11px) saturate(148%) contrast(104%);
      -webkit-backdrop-filter:blur(11px) saturate(148%) contrast(104%);
    }
    evolution-nav.evo-academy-light-glass .evo-brand:after,
    evolution-nav.evo-academy-light-glass .evo-links:after,
    evolution-nav.evo-academy-light-glass .evo-software:after,
    evolution-nav.evo-academy-light-glass #floating-profile-desktop:after{
      content:"";position:absolute;inset:1px;border-radius:inherit;pointer-events:none;
      background:linear-gradient(125deg,rgba(255,255,255,.42),rgba(255,255,255,0) 28%,rgba(255,255,255,.08) 72%,rgba(255,255,255,.31));
      mix-blend-mode:screen;opacity:.72;
    }
    evolution-nav.evo-academy-light-glass .evo-brand,
    evolution-nav.evo-academy-light-glass .evo-links,
    evolution-nav.evo-academy-light-glass .evo-software,
    evolution-nav.evo-academy-light-glass #floating-profile-desktop{position:relative;isolation:isolate}
    evolution-nav.evo-academy-light-glass.evo-optical-ready .evo-optical-glass{
      backdrop-filter:var(--evo-optical-filter) blur(4px) saturate(142%) contrast(105%)!important;
      -webkit-backdrop-filter:var(--evo-optical-filter) blur(4px) saturate(142%) contrast(105%)!important;
    }

    /* v50.75 · Same geometry as dark mode; only the shell material changes. */
    evolution-nav.evo-academy-light-glass .evo-pill{
      pointer-events:auto;position:relative;isolation:isolate;flex:1;min-height:58px!important;
      padding:7px 9px 7px 14px!important;border:1px solid rgba(255,255,255,.58)!important;
      border-radius:999px!important;display:flex;align-items:center;gap:16px!important;overflow:hidden!important;
      background:linear-gradient(180deg,rgba(255,255,255,.15),rgba(255,255,255,.045))!important;
      box-shadow:0 16px 42px rgba(24,22,19,.15),inset 0 1px 0 rgba(255,255,255,.92),inset 0 -1px 0 rgba(25,23,20,.11)!important;
      backdrop-filter:blur(11px) saturate(145%) contrast(104%)!important;
      -webkit-backdrop-filter:blur(11px) saturate(145%) contrast(104%)!important;
    }
    evolution-nav.evo-academy-light-glass .evo-pill:before{
      content:""!important;display:block!important;position:absolute;inset:1px!important;height:auto!important;width:auto!important;
      border-radius:inherit!important;z-index:0!important;pointer-events:none;
      background:linear-gradient(125deg,rgba(255,255,255,.38),transparent 24%,transparent 72%,rgba(255,255,255,.20))!important;
      filter:none!important;transform:none!important;
    }
    evolution-nav.evo-academy-light-glass .evo-pill:after{display:none!important}
    evolution-nav.evo-academy-light-glass.evo-optical-ready .evo-pill.evo-optical-glass{
      backdrop-filter:var(--evo-optical-filter) brightness(108%) saturate(135%)!important;
      -webkit-backdrop-filter:var(--evo-optical-filter) brightness(108%) saturate(135%)!important;
    }
    evolution-nav.evo-academy-light-glass .evo-brand{
      min-height:0!important;padding:0!important;border:0!important;border-radius:0!important;gap:12px!important;overflow:visible!important;
      background:none!important;box-shadow:none!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important;
    }
    evolution-nav.evo-academy-light-glass .evo-links{
      min-height:0!important;margin-left:auto!important;padding:0!important;border:0!important;border-radius:0!important;
      gap:clamp(12px,1.3vw,21px)!important;overflow:visible!important;background:none!important;box-shadow:none!important;
      backdrop-filter:none!important;-webkit-backdrop-filter:none!important;
    }
    evolution-nav.evo-academy-light-glass .evo-links:before,
    evolution-nav.evo-academy-light-glass .evo-links:after,
    evolution-nav.evo-academy-light-glass .evo-brand:after,
    evolution-nav.evo-academy-light-glass .evo-software:after{display:none!important}
    evolution-nav.evo-academy-light-glass .evo-link{padding:0!important;border-radius:0!important;background:none!important;border:0!important;box-shadow:none!important}
    evolution-nav.evo-academy-light-glass .evo-link.active{transform:translateY(-1px)!important}
    evolution-nav.evo-academy-light-glass .evo-software{
      height:42px!important;padding:0 17px!important;border:0!important;border-radius:999px!important;
      background:#171717!important;color:#fff!important;box-shadow:none!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important;
    }
    evolution-nav.evo-academy-light-glass #floating-profile-desktop{width:42px!important;height:42px!important;border-radius:50%!important}

    @media(min-width:992px){.evo-desktop{display:block}.evo-mobile{display:none!important}}
    @media(max-width:390px){.evo-mobile-top{padding-left:10px;padding-right:10px}.evo-mobile .evo-logo img{max-width:112px}.evo-tab{font-size:.49rem}.evo-tab svg{width:18px;height:18px}}
    @media(prefers-reduced-motion:reduce){.evo-nav *{transition:none!important;animation:none!important}}
  `;
  document.head.appendChild(style);

  const isChromiumBackdropSVG = /(Chrome|Chromium)\//.test(navigator.userAgent) && !/CriOS\//.test(navigator.userAgent);
  const opticalFilters = new Map();

  function capsuleMapData(width,height,specular=false){
    const canvas=document.createElement('canvas');
    canvas.width=width;canvas.height=height;
    const ctx=canvas.getContext('2d',{willReadFrequently:false});
    if(!ctx)return '';
    const image=ctx.createImageData(width,height),data=image.data;
    const cy=height/2,r=Math.max(2,cy-1),bezel=Math.max(8,Math.min(24,r*.72));
    const lightX=-.52,lightY=-.85;
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      let nx=0,ny=0,inside=0;
      if(x<r){const dx=x-r,dy=y-cy,d=Math.hypot(dx,dy)||1;nx=-dx/d;ny=-dy/d;inside=r-d}
      else if(x>width-r){const dx=x-(width-r),dy=y-cy,d=Math.hypot(dx,dy)||1;nx=-dx/d;ny=-dy/d;inside=r-d}
      else{const dy=y-cy;ny=dy<0?1:-1;inside=r-Math.abs(dy)}
      const edge=Math.max(0,Math.min(1,1-inside/bezel));
      const magnitude=Math.pow(edge,1.65);
      const i=(y*width+x)*4;
      if(specular){
        const shine=Math.pow(Math.max(0,nx*lightX+ny*lightY),5)*Math.pow(edge,.75);
        data[i]=255;data[i+1]=255;data[i+2]=255;data[i+3]=Math.round(shine*105);
      }else{
        data[i]=Math.round(128+nx*magnitude*127);
        data[i+1]=Math.round(128+ny*magnitude*127);
        data[i+2]=128;data[i+3]=255;
      }
    }
    ctx.putImageData(image,0,0);return canvas.toDataURL('image/png');
  }

  function opticalFilterFor(width,height){
    const w=Math.max(24,Math.round(width)),h=Math.max(24,Math.round(height));
    const key=`${w}x${h}`;
    if(opticalFilters.has(key))return opticalFilters.get(key);
    let svg=document.getElementById('evo-optical-filter-bank');
    if(!svg){
      svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
      svg.id='evo-optical-filter-bank';svg.setAttribute('width','0');svg.setAttribute('height','0');
      svg.style.cssText='position:fixed;width:0;height:0;overflow:hidden;pointer-events:none';
      svg.appendChild(document.createElementNS('http://www.w3.org/2000/svg','defs'));document.body.appendChild(svg);
    }
    const id=`evo-optical-${w}-${h}`;
    const filter=document.createElementNS('http://www.w3.org/2000/svg','filter');
    filter.id=id;filter.setAttribute('x','0');filter.setAttribute('y','0');filter.setAttribute('width',String(w));filter.setAttribute('height',String(h));filter.setAttribute('filterUnits','userSpaceOnUse');filter.setAttribute('color-interpolation-filters','sRGB');
    const map=document.createElementNS('http://www.w3.org/2000/svg','feImage');
    map.setAttribute('href',capsuleMapData(w,h));map.setAttribute('width',String(w));map.setAttribute('height',String(h));map.setAttribute('result','map');
    const sourceBlur=document.createElementNS('http://www.w3.org/2000/svg','feGaussianBlur');
    sourceBlur.setAttribute('in','SourceGraphic');sourceBlur.setAttribute('stdDeviation','.7');sourceBlur.setAttribute('result','blurred-source');
    const displacement=document.createElementNS('http://www.w3.org/2000/svg','feDisplacementMap');
    displacement.setAttribute('in','blurred-source');displacement.setAttribute('in2','map');displacement.setAttribute('scale',String(Math.min(18,h*.27)));displacement.setAttribute('xChannelSelector','R');displacement.setAttribute('yChannelSelector','G');displacement.setAttribute('result','refracted');
    const saturated=document.createElementNS('http://www.w3.org/2000/svg','feColorMatrix');
    saturated.setAttribute('in','refracted');saturated.setAttribute('type','saturate');saturated.setAttribute('values','2.4');saturated.setAttribute('result','refracted-saturated');
    const shine=document.createElementNS('http://www.w3.org/2000/svg','feImage');
    shine.setAttribute('href',capsuleMapData(w,h,true));shine.setAttribute('width',String(w));shine.setAttribute('height',String(h));shine.setAttribute('result','specular');
    const shineBlur=document.createElementNS('http://www.w3.org/2000/svg','feGaussianBlur');
    shineBlur.setAttribute('in','specular');shineBlur.setAttribute('stdDeviation','.8');shineBlur.setAttribute('result','specular-soft');
    const shineMask=document.createElementNS('http://www.w3.org/2000/svg','feComposite');
    shineMask.setAttribute('in','refracted-saturated');shineMask.setAttribute('in2','specular-soft');shineMask.setAttribute('operator','in');shineMask.setAttribute('result','specular-reflection');
    const blend=document.createElementNS('http://www.w3.org/2000/svg','feBlend');
    blend.setAttribute('in','specular-reflection');blend.setAttribute('in2','refracted');blend.setAttribute('mode','normal');
    filter.append(map,sourceBlur,displacement,saturated,shine,shineBlur,shineMask,blend);svg.firstChild.appendChild(filter);
    const value=`url(#${id})`;opticalFilters.set(key,value);return value;
  }

  function installOpticalGlass(host){
    if(!isChromiumBackdropSVG||!host)return;
    const apply=()=>{
      host.querySelectorAll('.evo-pill,#floating-profile-desktop').forEach(el=>{
        const rect=el.getBoundingClientRect();if(rect.width<20||rect.height<20)return;
        el.classList.add('evo-optical-glass');el.style.setProperty('--evo-optical-filter',opticalFilterFor(rect.width,rect.height));
      });
      host.classList.add('evo-optical-ready');
    };
    requestAnimationFrame(()=>requestAnimationFrame(apply));
    const observer=new ResizeObserver(()=>requestAnimationFrame(apply));
    host.querySelectorAll('.evo-pill,#floating-profile-desktop').forEach(el=>observer.observe(el));
  }

  const menuRows = (active,pages=PAGES) => pages.map(p => `
    <li><a href="${p.href}" class="evo-menu-item${p.key===active?' active':''}" data-evo-route="${p.key}">${ICONS[p.icon]}<span>${p.label}</span></a></li>
  `).join('') + `
    <li><a href="/sobre-nosotros" class="evo-menu-item"><span>Sobre Nosotros</span></a></li>
    <li><a href="/feedback" class="evo-menu-item"><span>Feedback</span></a></li>
    <li><a href="/proyectos.html" class="evo-menu-item">${ICONS.folder}<span>Órdenes</span></a></li>
    <li class="evo-install-item evo-d-none"><a href="#" class="evo-menu-item" data-evo-install>${ICONS.install}<span>Instalar Evolution</span></a></li>
  `;

  class EvolutionNav extends HTMLElement {
    connectedCallback(){
      if(this.dataset.rendered==='1') return;
      this.dataset.rendered='1';
      const active=inferKey(location.href);

      this.innerHTML=`
        <nav class="evo-nav evo-desktop" aria-label="Navegación principal">
          <div class="evo-desktop-inner">
            <div class="evo-pill">
              <div class="evo-brand">
                <div class="evo-menu-wrap">
                  <a href="#" class="evo-icon" id="desktopMenuBtn" aria-label="Menú" aria-expanded="false">${ICONS.menu}</a>
                  <ul class="evo-drop" id="desktopDropdownMenu">${menuRows(active)}</ul>
                </div>
                <a href="/index.html" class="evo-logo" data-evo-route="home" aria-label="Evolution Design Home"><img src="/img/logo.png" alt="Evolution Design"></a>
                <div id="admin-badge-container-desktop"></div>
              </div>

              <div class="evo-links">
                ${PAGES.map(p=>`<a href="${p.href}" data-evo-route="${p.key}" class="evo-link${p.key===active?' active':''}">${p.label}</a>`).join('')}
                <a href="/proyectos.html" class="evo-link evo-orders-link">Órdenes</a>
                <div id="auth-desktop-wrapper"><a href="#" class="evo-link evo-login" data-evo-login>${ICONS.login}<span>Login</span></a></div>
                <span class="evo-route-indicator evo-desktop-indicator" aria-hidden="true"></span>
              </div>

              <a href="https://dingloft.com" target="_blank" rel="noopener" class="evo-software">Catálogo de Software →</a>
            </div>
            <div id="floating-profile-desktop"></div>
          </div>
        </nav>

        <nav class="evo-nav evo-mobile" aria-label="Navegación móvil">
          <div class="evo-mobile-top">
            <div class="evo-menu-wrap">
              <a href="#" class="evo-icon" id="mobileMenuBtn" aria-label="Menú" aria-expanded="false">${ICONS.menu}</a>
              <ul class="evo-drop" id="mobileDropdownMenu">${menuRows(active,MOBILE_PAGES)}</ul>
            </div>
            <a href="/index.html" class="evo-logo" data-evo-route="home" aria-label="Evolution Design Home"><img src="/img/logo.png" alt="Evolution Design"></a>
            <div id="auth-mobile-wrapper"><a href="#" class="evo-icon" data-evo-login aria-label="Login">${ICONS.login}</a></div>
          </div>
          <div class="evo-tabs">
            ${MOBILE_PAGES.map(p=>`<a href="${p.href}" data-evo-route="${p.key}" class="evo-tab${p.key===active?' active':''}">${ICONS[p.icon]}<span>${p.short}</span></a>`).join('')}
            <span class="evo-route-indicator evo-mobile-indicator" aria-hidden="true"></span>
          </div>
        </nav>`;

      requestAnimationFrame(()=>requestAnimationFrame(()=>window.EvolutionNav?.positionIndicators()));
      installOpticalGlass(this);
    }
  }

  if(!customElements.get('evolution-nav')) customElements.define('evolution-nav',EvolutionNav);

  const closeMenus=()=>{
    document.getElementById('desktopDropdownMenu')?.classList.remove('show');
    document.getElementById('mobileDropdownMenu')?.classList.remove('show');
    document.getElementById('desktopMenuBtn')?.setAttribute('aria-expanded','false');
    document.getElementById('mobileMenuBtn')?.setAttribute('aria-expanded','false');
  };

  document.addEventListener('click',e=>{
    const el=e.target instanceof Element?e.target:null;
    if(!el) return;

    const d=el.closest('#desktopMenuBtn');
    const m=el.closest('#mobileMenuBtn');

    if(d){
      e.preventDefault();e.stopImmediatePropagation();
      const menu=document.getElementById('desktopDropdownMenu');
      const on=!menu?.classList.contains('show');
      closeMenus();menu?.classList.toggle('show',on);d.setAttribute('aria-expanded',String(on));return;
    }

    if(m){
      e.preventDefault();e.stopImmediatePropagation();
      const menu=document.getElementById('mobileDropdownMenu');
      const on=!menu?.classList.contains('show');
      closeMenus();menu?.classList.toggle('show',on);m.setAttribute('aria-expanded',String(on));return;
    }

    if(el.closest('[data-evo-login]')){
      e.preventDefault();e.stopImmediatePropagation();
      document.dispatchEvent(new CustomEvent('evolution:auth-request'));return;
    }

    if(el.closest('[data-evo-logout]')){
      e.preventDefault();e.stopImmediatePropagation();
      document.dispatchEvent(new CustomEvent('evolution:logout-request'));return;
    }

    if(el.closest('[data-evo-install]')){
      e.preventDefault();e.stopImmediatePropagation();
      document.dispatchEvent(new CustomEvent('evolution:install-request'));closeMenus();return;
    }

    if(!el.closest('.evo-menu-wrap')) closeMenus();
  },true);

  document.addEventListener('keydown',e=>{if(e.key==='Escape') closeMenus()});

  const api = {
    state:{user:null,isAdmin:false,route:inferKey(location.href),scrollY:0,network:'normal'},

    setActive(key){
      api.state.route=key;
      document.querySelectorAll('[data-evo-route]').forEach(a=>{
        const on=a.dataset.evoRoute===key;
        a.classList.toggle('active',on);
        if(on)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');
      });
      requestAnimationFrame(()=>api.positionIndicators());
      closeMenus();
    },

    positionIndicators(){
      const position=(containerSelector,linkSelector,indicatorSelector)=>{
        const container=document.querySelector(containerSelector);
        const link=container?.querySelector(linkSelector);
        const indicator=container?.querySelector(indicatorSelector);
        if(!container||!link||!indicator)return;
        indicator.style.setProperty('--evo-ind-x',`${link.offsetLeft}px`);
        indicator.style.setProperty('--evo-ind-w',`${link.offsetWidth}px`);
        indicator.classList.add('ready');
      };

      const key=api.state.route||inferKey(location.href);
      position('.evo-links',`[data-evo-route="${key}"]`,'.evo-desktop-indicator');
      position('.evo-tabs',`[data-evo-route="${key}"]`,'.evo-mobile-indicator');
    },

    setScroll(y=0){
      api.state.scrollY=Math.max(0,Number(y)||0);
      document.querySelector('evolution-nav')?.classList.toggle('evo-is-scrolled',api.state.scrollY>22);
    },

    setNetwork(mode='normal'){
      api.state.network=mode;
      const host=document.querySelector('evolution-nav');
      if(host)host.dataset.network=mode;
    },

    setInstallAvailable(on){
      document.querySelectorAll('.evo-install-item').forEach(el=>el.classList.toggle('evo-d-none',!on));
    },

    setAuth(payload={}){
      const user=payload.user||null;
      const isAdmin=Boolean(payload.isAdmin);
      api.state.user=user;
      api.state.isAdmin=isAdmin;

      const desktop=document.getElementById('auth-desktop-wrapper');
      const mobile=document.getElementById('auth-mobile-wrapper');
      const profile=document.getElementById('floating-profile-desktop');
      const admin=document.getElementById('admin-badge-container-desktop');

      if(!user){
        if(desktop)desktop.innerHTML=`<a href="#" class="evo-link evo-login" data-evo-login>${ICONS.login}<span>Login</span></a>`;
        if(mobile)mobile.innerHTML=`<a href="#" class="evo-icon" data-evo-login aria-label="Login">${ICONS.login}</a>`;
        if(profile)profile.innerHTML='';
        if(admin)admin.innerHTML='';
        return;
      }

      const initials=escapeHTML((user.displayName||user.email||'U').trim().charAt(0).toUpperCase()||'U');
      const avatar=user.photoURL
        ? `<img src="${escapeHTML(user.photoURL)}" alt="Perfil" class="evo-profile-pic">`
        : `<span class="evo-avatar-fallback">${initials}</span>`;
      const mobileAvatar=user.photoURL
        ? `<img src="${escapeHTML(user.photoURL)}" alt="Perfil">`
        : `<span class="evo-avatar-fallback">${initials}</span>`;

      if(desktop)desktop.innerHTML=`<a href="#" class="evo-link evo-login" data-evo-logout>${ICONS.logout}<span>Salir</span></a>`;
      if(profile)profile.innerHTML=`<a href="/perfil.html" aria-label="Mi perfil">${avatar}</a>`;
      if(mobile)mobile.innerHTML=`<div class="evo-mobile-auth"><a href="/perfil.html" class="evo-mobile-profile" aria-label="Mi perfil">${mobileAvatar}</a>${isAdmin?`<a href="/admin.html" class="evo-mobile-action" aria-label="Panel Admin">${ICONS.shield}</a>`:''}<a href="#" class="evo-mobile-action" data-evo-logout aria-label="Salir">${ICONS.logout}</a></div>`;
      if(admin)admin.innerHTML=isAdmin?`<a href="/admin.html" class="evo-admin-badge">${ICONS.shield}<span>Panel Admin</span></a>`:'';
    }
  };

  window.EvolutionNav=api;

  addEventListener('resize',()=>requestAnimationFrame(()=>api.positionIndicators()),{passive:true});
  addEventListener('evolution:route-changed',e=>api.setActive(e.detail?.key||inferKey(location.href)));
})();
