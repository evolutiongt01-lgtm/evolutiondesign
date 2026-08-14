/* Evolution Design · Navbar única PC + móvil · v13 */
(() => {
  'use strict';

  const icons = {
    menu:`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M3 12h18M3 18h18"/></svg>`,
    home:`<svg viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/></svg>`,
    arq:`<svg viewBox="0 0 24 24"><path d="M4 21V10l8-7 8 7v11"/><path d="M9 21v-7h6v7"/></svg>`,
    graf:`<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M8 15c1.5-4 3.5-6.5 7-8"/><circle cx="8" cy="15" r="1"/></svg>`,
    web:`<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 13l-2 2 2 2M15 13l2 2-2 2"/></svg>`,
    folder:`<svg viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`,
    login:`<svg viewBox="0 0 24 24"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3"/></svg>`
  };

  const pages = [
    ['home','index.html','Home','Home','home'],
    ['arquitectura','arquitectura.html','Arquitectura','Arquitectura','arq'],
    ['grafico','diseno-grafico.html','Diseño Gráfico','Diseño G.','graf'],
    ['web','diseno-web.html','Diseño Web','Diseño Web','web']
  ];

  const css = `
  evolution-nav{display:block}
  .evo-nav *{box-sizing:border-box}
  .evo-nav a{-webkit-tap-highlight-color:transparent;text-decoration:none}
  .evo-nav svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.6}

  .evo-desktop{display:none;position:fixed;z-index:2147483000;top:0;left:0;right:0;padding:calc(22px + env(safe-area-inset-top,0px)) 22px 0;pointer-events:none}
  .evo-desktop-inner{width:min(1400px,100%);margin:auto;display:flex;gap:12px;align-items:center}
  .evo-pill{pointer-events:auto;flex:1;min-height:58px;padding:7px 9px 7px 14px;border:1px solid rgba(255,255,255,.14);border-radius:999px;background:linear-gradient(135deg,rgba(25,25,28,.96),rgba(8,8,10,.97));box-shadow:0 18px 50px rgba(0,0,0,.45),inset 0 1px rgba(255,255,255,.09);backdrop-filter:blur(24px) saturate(160%);-webkit-backdrop-filter:blur(24px) saturate(160%);display:flex;align-items:center;gap:16px}
  .evo-brand{display:flex;align-items:center;gap:12px;position:relative}
  .evo-logo img{display:block;height:31px;width:auto;max-width:150px}
  .evo-menu-wrap{position:relative}
  .evo-icon{width:42px;height:42px;min-width:42px;display:inline-flex;align-items:center;justify-content:center;border-radius:50%;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.05);color:#fff;transition:.18s ease}
  .evo-icon:hover{background:rgba(255,255,255,.12);transform:scale(1.04)}
  .evo-links{margin-left:auto;display:flex;align-items:center;gap:clamp(12px,1.3vw,21px)}
  .evo-link{position:relative;color:#96969d;font:600 clamp(.70rem,.78vw,.86rem)/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;white-space:nowrap}
  .evo-link:hover,.evo-link.active{color:#fff}
  .evo-link.active:after{content:"";position:absolute;left:0;right:0;bottom:-9px;height:2px;border-radius:9px;background:#d4b895}
  .evo-login{color:#d4b895!important;font-weight:800!important}
  .evo-software{height:42px;padding:0 17px;border-radius:999px;background:#f5f5f3;color:#080808;display:inline-flex;align-items:center;font:800 .73rem/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;white-space:nowrap}
  #floating-profile-desktop{pointer-events:auto;width:42px;height:42px;display:flex;align-items:center;justify-content:center}
  .profile-pic-liquid{width:38px!important;height:38px!important;border-radius:50%;object-fit:cover;border:2px solid rgba(212,184,149,.58)}
  #admin-badge-container-desktop{position:absolute;top:49px;left:53px;z-index:10}
  .admin-badge-btn{display:inline-flex;align-items:center;gap:5px;padding:7px 10px;border-radius:999px;background:rgba(190,38,55,.25);border:1px solid rgba(220,53,69,.5);color:#fff!important;font:800 .61rem/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}

  .evo-drop{position:absolute;left:0;top:52px;min-width:220px;margin:0;padding:7px;list-style:none;border:1px solid rgba(255,255,255,.11);border-radius:16px;background:rgba(13,13,15,.97);box-shadow:0 18px 50px rgba(0,0,0,.5);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);opacity:0;visibility:hidden;pointer-events:none;transform:translateY(-7px) scale(.98);transition:.18s ease}
  .evo-drop.show{opacity:1;visibility:visible;pointer-events:auto;transform:none}
  .evo-drop li{list-style:none}
  .evo-menu-item{display:flex;align-items:center;gap:10px;padding:10px;border-radius:10px;color:#c4c4c8;font:600 .76rem/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
  .evo-menu-item:hover,.evo-menu-item.active{background:rgba(255,255,255,.08);color:#fff}

  .evo-mobile{position:fixed!important;z-index:2147483000!important;top:0!important;left:0!important;right:0!important;width:100%!important;padding-top:env(safe-area-inset-top,0px)!important;background:rgba(5,5,6,.96)!important;border-bottom:1px solid rgba(255,255,255,.07)!important;box-shadow:0 8px 28px rgba(0,0,0,.28)!important;backdrop-filter:blur(12px) saturate(130%)!important;-webkit-backdrop-filter:blur(12px) saturate(130%)!important;transform:translateY(0)!important;transition:transform .28s cubic-bezier(.16,1,.3,1)!important}
  .evo-mobile.hidden{display:block!important;visibility:visible!important;opacity:1!important}
  .evo-mobile.evo-hide{transform:translateY(-105%)!important}
  .evo-mobile-top{min-height:60px;padding:10px 14px 9px;display:grid;grid-template-columns:40px minmax(0,1fr) auto;align-items:center;gap:10px}
  .evo-mobile .evo-logo{justify-self:center}
  .evo-mobile .evo-logo img{height:27px;max-width:128px}
  .evo-mobile .evo-icon{width:40px;height:40px;min-width:40px}
  #auth-mobile-wrapper{min-width:40px;display:flex;align-items:center;justify-content:flex-end;gap:7px}
  .mobile-auth-actions{display:flex;align-items:center;gap:7px}
  .mobile-profile-link,.mobile-auth-action{width:36px;height:36px;display:inline-flex;align-items:center;justify-content:center;border-radius:50%;border:1px solid rgba(255,255,255,.13);background:rgba(255,255,255,.04);color:#fff!important}
  .mobile-profile-link img{width:28px!important;height:28px!important;border-radius:50%;object-fit:cover}
  .evo-tabs{display:grid!important;grid-template-columns:repeat(auto-fit,minmax(62px,1fr))!important;padding:0 7px!important;gap:2px!important}
  .evo-tab{min-width:0;min-height:54px;padding:5px 1px 7px;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#7d7d85;border-bottom:2px solid transparent;font:600 .58rem/1.1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;white-space:nowrap}
  .evo-tab svg{width:19px;height:19px;margin-bottom:4px;opacity:.68}
  .evo-tab.active{color:#fff;border-bottom-color:#d4b895}
  .evo-tab.active svg{opacity:1}
  .d-none{display:none!important}

  @media(min-width:992px){
    .evo-desktop{display:block}
    .evo-mobile{display:none!important}
  }

  @media(max-width:390px){
    .evo-mobile-top{padding-left:10px;padding-right:10px}
    .evo-mobile .evo-logo img{max-width:112px}
    .evo-tab{font-size:.53rem}
  }`;

  if(!document.getElementById('evo-nav-style')){
    const s=document.createElement('style');
    s.id='evo-nav-style';
    s.textContent=css;
    document.head.appendChild(s);
  }

  const infer = () => {
    const p=location.pathname.toLowerCase();
    if(p.includes('arquitectura'))return 'arquitectura';
    if(p.includes('diseno-grafico'))return 'grafico';
    if(p.includes('diseno-web'))return 'web';
    return 'home';
  };

  const link = (p,active,cls='evo-link',short=false) =>
    `<a href="${p[1]}" data-evolution-nav class="${cls}${p[0]===active?' active':''}"${p[0]===active?' aria-current="page"':''}>${short?icons[p[4]]+`<span>${p[3]}</span>`:p[2]}</a>`;

  const dropItems = active =>
    pages.map(p=>`<li>${link(p,active,'evo-menu-item')}</li>`).join('')+
    `<li><a class="evo-menu-item" href="sobre-nosotros">Sobre Nosotros</a></li>
     <li><a class="evo-menu-item" href="feedback">Feedback</a></li>`;

  class EvolutionNav extends HTMLElement{
    connectedCallback(){
      if(this.dataset.rendered)return;
      this.dataset.rendered='1';

      const active=this.getAttribute('active')||infer();
      const projectsVisible = active==='web';
      const projectClass = projectsVisible ? '' : ' d-none';

      this.innerHTML=`
      <nav class="evo-nav evo-desktop desktop-nav" id="navScroll">
        <div class="evo-desktop-inner">
          <div class="evo-pill">
            <div class="evo-brand">
              <div class="evo-menu-wrap">
                <a href="#" id="desktopMenuBtn" class="evo-icon">${icons.menu}</a>

                <ul id="desktopDropdownMenu" class="evo-drop">
                  ${dropItems(active)}
                  <li id="linkProyectosMenuDesktop" class="${projectsVisible?'':'d-none'}">
                    <a class="evo-menu-item" href="proyectos.html">Mis Proyectos</a>
                  </li>
                </ul>
              </div>

              <a href="index.html" class="evo-logo" data-evolution-nav>
                <img src="img/logo.png" alt="Evolution Design">
              </a>

              <div id="admin-badge-container-desktop"></div>
            </div>

            <div class="evo-links">
              ${pages.map(p=>link(p,active)).join('')}

              <a href="proyectos.html"
                 id="linkProyectosDesktop"
                 class="evo-link${projectClass}">
                 Mis Proyectos
              </a>

              <div id="auth-desktop-wrapper">
                <a href="#"
                   class="evo-link evo-login"
                   data-evo-login>
                  ${icons.login}
                  <span>Login</span>
                </a>
              </div>
            </div>

            <a href="https://dingloft.com"
               target="_blank"
               rel="noopener"
               class="evo-software">
               Catálogo de Software →
            </a>
          </div>

          <div id="floating-profile-desktop"></div>
        </div>
      </nav>

      <nav class="evo-nav evo-mobile mobile-app-nav" id="mobileNav">
        <div class="evo-mobile-top">

          <div class="evo-menu-wrap">
            <a href="#" id="mobileMenuBtn" class="evo-icon">
              ${icons.menu}
            </a>

            <ul id="mobileDropdownMenu" class="evo-drop">
              ${dropItems(active)}
            </ul>
          </div>

          <a href="index.html" class="evo-logo" data-evolution-nav>
            <img src="img/logo.png" alt="Evolution Design">
          </a>

          <div id="auth-mobile-wrapper">
            <a href="#" class="evo-icon" data-evo-login>
              ${icons.login}
            </a>
          </div>
        </div>

        <div class="evo-tabs">
          ${pages.map(p=>link(p,active,'evo-tab',true)).join('')}

          <a href="proyectos.html"
             id="linkProyectosMobile"
             class="evo-tab${projectClass}">
            ${icons.folder}
            <span>Proyectos</span>
          </a>
        </div>
      </nav>`;
    }
  }

  if(!customElements.get('evolution-nav')){
    customElements.define('evolution-nav',EvolutionNav);
  }

  const closeMenus=()=>{
    document.getElementById('desktopDropdownMenu')?.classList.remove('show');
    document.getElementById('mobileDropdownMenu')?.classList.remove('show');
  };

  document.addEventListener('click',e=>{
    const el=e.target instanceof Element ? e.target : null;
    if(!el)return;

    const desktop=el.closest('#desktopMenuBtn');
    const mobile=el.closest('#mobileMenuBtn');
    const login=el.closest('[data-evo-login]');

    if(desktop){
      e.preventDefault();
      e.stopImmediatePropagation();

      document.getElementById('mobileDropdownMenu')
        ?.classList.remove('show');

      document.getElementById('desktopDropdownMenu')
        ?.classList.toggle('show');

      return;
    }

    if(mobile){
      e.preventDefault();
      e.stopImmediatePropagation();

      document.getElementById('desktopDropdownMenu')
        ?.classList.remove('show');

      document.getElementById('mobileDropdownMenu')
        ?.classList.toggle('show');

      return;
    }

    if(login){
      e.preventDefault();
      e.stopImmediatePropagation();

      if(typeof window.abrirAuthModal==='function'){
        window.abrirAuthModal();
      }

      return;
    }

    if(!el.closest('.evo-menu-wrap')){
      closeMenus();
    }
  },true);

  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'){
      closeMenus();
    }
  });

  let lastY=0;
  let ticking=false;

  const scrollNav=()=>{
    const nav=document.getElementById('mobileNav');

    if(!nav || !matchMedia('(max-width:991.98px)').matches){
      ticking=false;
      return;
    }

    const y=Math.max(0,scrollY||0);

    nav.classList.remove('hidden');

    if(y<90){
      nav.classList.remove('evo-hide');
    }else if(y>lastY+6){
      nav.classList.add('evo-hide');
    }else if(y<lastY-6){
      nav.classList.remove('evo-hide');
    }

    lastY=y;
    ticking=false;
  };

  addEventListener('scroll',()=>{
    if(!ticking){
      ticking=true;
      requestAnimationFrame(scrollNav);
    }
  },{passive:true});

  addEventListener('pageshow',scrollNav,{passive:true});
  addEventListener('resize',scrollNav,{passive:true});

  window.__EVOLUTION_NAV_OK__='v13';
})();
