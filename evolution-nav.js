/*
 * EVOLUTION DESIGN · SHARED NAVIGATION
 * Desktop + Mobile · one source for all public main pages
 * v11 · 2026-08-14
 */
(() => {
  'use strict';

  const STYLE_ID = 'evolution-shared-nav-style';

  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      :root{
        --evo-nav-accent:#d4b895;
        --evo-nav-bg:#0b0b0d;
        --evo-nav-line:rgba(255,255,255,.12);
      }

      evolution-nav{
        display:block;
        view-transition-name:evolution-navigation;
      }

      @view-transition{
        navigation:auto;
      }

      ::view-transition-old(evolution-navigation),
      ::view-transition-new(evolution-navigation){
        animation-duration:.18s;
        animation-timing-function:cubic-bezier(.16,1,.3,1);
      }

      ::view-transition-old(root),
      ::view-transition-new(root){
        animation-duration:.18s;
        animation-timing-function:cubic-bezier(.16,1,.3,1);
      }

      .evo-shared-nav,
      .evo-shared-nav *{
        box-sizing:border-box;
      }

      .evo-shared-nav a{
        -webkit-tap-highlight-color:transparent;
      }

      /* =====================================================
         DESKTOP
         ===================================================== */
      .evo-shared-nav.desktop-nav{
        display:none !important;
        position:fixed;
        top:0;
        left:0;
        right:0;
        z-index:1040 !important;
        padding:calc(25px + env(safe-area-inset-top,0px)) 22px 0;
        pointer-events:none;
        background:transparent !important;
      }

      .evo-desktop-shell{
        width:min(1400px,100%);
        margin:0 auto;
        display:flex;
        align-items:center;
        gap:13px;
        pointer-events:none;
      }

      .evo-shared-nav .nav-pill{
        position:relative;
        isolation:isolate;
        overflow:visible;
        min-height:58px;
        flex:1 1 auto;
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:18px;
        padding:7px 9px 7px 15px;
        border-radius:999px;
        pointer-events:auto;
        background:
          linear-gradient(135deg,rgba(25,25,29,.965),rgba(11,11,14,.97) 52%,rgba(25,21,18,.965)) !important;
        border:1px solid rgba(255,255,255,.16) !important;
        box-shadow:
          0 20px 52px rgba(0,0,0,.46),
          inset 0 1px 0 rgba(255,255,255,.13),
          inset 0 -1px 0 rgba(255,255,255,.025) !important;
        -webkit-backdrop-filter:blur(28px) saturate(175%) !important;
        backdrop-filter:blur(28px) saturate(175%) !important;
      }

      .evo-shared-nav .nav-pill::before{
        content:"";
        position:absolute;
        inset:1px;
        z-index:-1;
        border-radius:inherit;
        pointer-events:none;
        background:
          linear-gradient(180deg,rgba(255,255,255,.085),rgba(255,255,255,.025) 34%,transparent 72%);
      }

      .evo-nav-brand-zone{
        position:relative;
        display:flex;
        align-items:center;
        gap:13px;
        flex:0 0 auto;
      }

      .evo-nav-logo{
        display:flex;
        align-items:center;
        text-decoration:none;
      }

      .evo-nav-logo img{
        display:block;
        width:auto;
        height:31px;
        max-width:150px;
        object-fit:contain;
      }

      .evo-shared-nav .icon-btn{
        width:42px !important;
        height:42px !important;
        min-width:42px !important;
        min-height:42px !important;
        padding:0 !important;
        border-radius:50% !important;
        border:1px solid rgba(255,255,255,.15) !important;
        display:inline-flex !important;
        align-items:center !important;
        justify-content:center !important;
        background:rgba(255,255,255,.055) !important;
        color:#fff !important;
        text-decoration:none !important;
        box-shadow:inset 0 1px 0 rgba(255,255,255,.05) !important;
        transition:
          transform .22s cubic-bezier(.16,1,.3,1),
          background .2s ease,
          border-color .2s ease !important;
      }

      .evo-shared-nav .icon-btn:hover{
        color:#fff !important;
        background:rgba(255,255,255,.12) !important;
        border-color:rgba(255,255,255,.23) !important;
        transform:scale(1.045);
      }

      .evo-shared-nav .icon-btn:active{
        transform:scale(.95);
      }

      .evo-nav-menu-wrap{
        position:relative;
        display:flex;
        align-items:center;
      }

      .evo-shared-nav .desktop-dropdown-menu,
      .evo-shared-nav .mobile-dropdown-menu{
        display:flex !important;
        visibility:hidden;
        pointer-events:none;
        flex-direction:column;
        position:absolute;
        top:52px;
        left:0;
        width:max-content;
        min-width:220px !important;
        margin:0 !important;
        padding:7px !important;
        gap:3px;
        list-style:none !important;
        opacity:0;
        transform:translate3d(0,-8px,0) scale(.97);
        transform-origin:top left;
        z-index:1100;
        border:1px solid rgba(255,255,255,.11) !important;
        border-radius:16px !important;
        background:rgba(14,14,16,.965) !important;
        box-shadow:0 18px 50px rgba(0,0,0,.48) !important;
        -webkit-backdrop-filter:blur(20px) saturate(145%) !important;
        backdrop-filter:blur(20px) saturate(145%) !important;
        transition:
          opacity .18s ease,
          transform .24s cubic-bezier(.16,1,.3,1),
          visibility .18s !important;
      }

      .evo-shared-nav .desktop-dropdown-menu.show,
      .evo-shared-nav .mobile-dropdown-menu.show{
        visibility:visible;
        pointer-events:auto;
        opacity:1;
        transform:none;
      }

      .evo-shared-nav .desktop-dropdown-menu li,
      .evo-shared-nav .mobile-dropdown-menu li{
        list-style:none !important;
        margin:0 !important;
        padding:0 !important;
      }

      .evo-shared-nav .menu-item{
        width:100%;
        min-height:39px;
        display:flex !important;
        align-items:center !important;
        gap:10px !important;
        padding:9px 10px !important;
        border-radius:10px !important;
        color:#bdbdc3 !important;
        background:transparent !important;
        text-decoration:none !important;
        font:600 .76rem/1.2 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif !important;
        transition:background .16s ease,color .16s ease,transform .16s ease !important;
      }

      .evo-shared-nav .menu-item svg{
        flex:0 0 auto;
        opacity:.78;
      }

      .evo-shared-nav .menu-item:hover,
      .evo-shared-nav .menu-item.active,
      .evo-shared-nav .menu-item.current-area{
        color:#fff !important;
        background:rgba(255,255,255,.08) !important;
      }

      .evo-shared-nav .menu-item:active{
        transform:scale(.985);
      }

      .evo-shared-nav .nav-pill-links{
        min-width:0;
        display:flex;
        align-items:center;
        justify-content:center;
        gap:clamp(13px,1.35vw,22px);
        margin-left:auto;
      }

      .evo-shared-nav .nav-pill-link,
      .evo-shared-nav #auth-desktop-wrapper .nav-link-ed{
        position:relative;
        display:inline-flex;
        align-items:center;
        gap:5px;
        color:rgba(255,255,255,.63) !important;
        text-decoration:none !important;
        white-space:nowrap;
        font:500 clamp(.73rem,.78vw,.87rem)/1 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif !important;
        transition:color .18s ease,opacity .18s ease !important;
      }

      .evo-shared-nav .nav-pill-link:hover,
      .evo-shared-nav .nav-pill-link.active,
      .evo-shared-nav .nav-pill-link.current-area,
      .evo-shared-nav #auth-desktop-wrapper .nav-link-ed:hover{
        color:#fff !important;
      }

      .evo-shared-nav .nav-pill-link.active::after,
      .evo-shared-nav .nav-pill-link.current-area::after{
        content:"";
        position:absolute;
        left:0;
        right:0;
        bottom:-8px;
        height:2px;
        border-radius:999px;
        background:var(--evo-nav-accent);
        box-shadow:0 0 12px rgba(212,184,149,.35);
      }

      .evo-software-btn{
        flex:0 0 auto;
        min-height:42px;
        padding:0 17px;
        display:inline-flex;
        align-items:center;
        justify-content:center;
        border-radius:999px;
        background:#f4f4f2 !important;
        color:#080808 !important;
        text-decoration:none !important;
        white-space:nowrap;
        font:800 .74rem/1 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif !important;
        transition:transform .18s ease,background .18s ease !important;
      }

      .evo-software-btn:hover{
        background:#fff !important;
        color:#080808 !important;
        transform:translateY(-1px);
      }

      .evo-shared-nav #admin-badge-container-desktop{
        position:absolute;
        top:calc(100% + 10px);
        left:54px;
        z-index:10;
      }

      .evo-shared-nav .admin-badge-btn{
        min-height:29px;
        display:inline-flex;
        align-items:center;
        gap:5px;
        padding:0 10px;
        border-radius:999px;
        border:1px solid rgba(220,53,69,.5);
        background:rgba(220,53,69,.20);
        color:#fff !important;
        text-decoration:none !important;
        font:800 .61rem/1 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
        -webkit-backdrop-filter:blur(10px);
        backdrop-filter:blur(10px);
      }

      .evo-shared-nav #floating-profile-desktop{
        width:42px;
        height:42px;
        flex:0 0 42px;
        display:flex;
        align-items:center;
        justify-content:center;
        pointer-events:auto;
      }

      .evo-shared-nav .profile-pic-liquid{
        width:38px !important;
        height:38px !important;
        display:block;
        border-radius:50%;
        object-fit:cover;
        border:2px solid rgba(212,184,149,.58);
        background:#111;
        box-shadow:0 8px 24px rgba(0,0,0,.34);
      }

      /* =====================================================
         MOBILE
         ===================================================== */
      .evo-shared-nav.mobile-app-nav{
        display:block !important;
        position:fixed !important;
        top:0 !important;
        left:0 !important;
        right:0 !important;
        width:100% !important;
        width:100dvw !important;
        z-index:1030 !important;
        padding-top:env(safe-area-inset-top,0px) !important;
        background:rgba(5,5,5,.945) !important;
        border:0 !important;
        border-bottom:1px solid rgba(255,255,255,.075) !important;
        box-shadow:0 8px 28px rgba(0,0,0,.28) !important;
        -webkit-backdrop-filter:blur(14px) saturate(135%) !important;
        backdrop-filter:blur(14px) saturate(135%) !important;
        transform:translate3d(0,0,0);
        transition:
          transform .30s cubic-bezier(.16,1,.3,1),
          box-shadow .22s ease,
          background .22s ease !important;
        will-change:transform;
      }

      /* neutraliza scripts viejos que usaban .hidden */
      .evo-shared-nav.mobile-app-nav.hidden{
        display:block !important;
        visibility:visible !important;
        opacity:1 !important;
      }

      .evo-shared-nav.mobile-app-nav.nav-hidden{
        transform:translate3d(0,-105%,0) !important;
        box-shadow:none !important;
      }

      .evo-shared-nav.mobile-app-nav.nav-at-top{
        box-shadow:none !important;
      }

      .evo-shared-nav .app-nav-top{
        min-height:60px;
        padding:10px 14px 9px !important;
        display:grid !important;
        grid-template-columns:42px minmax(0,1fr) auto;
        align-items:center;
        gap:10px;
      }

      .evo-shared-nav .app-nav-top .evo-nav-logo{
        justify-self:center;
        min-width:0;
      }

      .evo-shared-nav .app-nav-top .evo-nav-logo img{
        max-width:128px;
        height:27px;
      }

      .evo-shared-nav .app-nav-top .icon-btn{
        width:40px !important;
        height:40px !important;
        min-width:40px !important;
        min-height:40px !important;
        -webkit-backdrop-filter:none !important;
        backdrop-filter:none !important;
        box-shadow:none !important;
      }

      .evo-shared-nav #auth-mobile-wrapper{
        min-width:40px;
        display:flex;
        align-items:center;
        justify-content:flex-end;
        gap:8px;
      }

      .evo-shared-nav .mobile-auth-actions{
        display:flex;
        align-items:center;
        gap:8px;
      }

      .evo-shared-nav .mobile-profile-link,
      .evo-shared-nav .mobile-auth-action{
        width:36px;
        height:36px;
        min-width:36px;
        display:inline-flex;
        align-items:center;
        justify-content:center;
        border-radius:50%;
        text-decoration:none !important;
        background:rgba(255,255,255,.035);
        border:1px solid rgba(255,255,255,.13);
        color:#fff !important;
      }

      .evo-shared-nav .mobile-profile-link{
        border-color:rgba(212,184,149,.50);
      }

      .evo-shared-nav .mobile-profile-link img{
        width:28px !important;
        height:28px !important;
        border-radius:50%;
        object-fit:cover;
      }

      .evo-shared-nav .app-tabs{
        width:100%;
        display:grid !important;
        grid-template-columns:repeat(auto-fit,minmax(64px,1fr)) !important;
        gap:2px !important;
        padding:0 7px !important;
        margin:0 !important;
        overflow:visible !important;
        border:0 !important;
        background:transparent !important;
        box-shadow:none !important;
      }

      .evo-shared-nav .tab-item{
        position:relative;
        min-width:0;
        min-height:54px;
        display:flex !important;
        flex-direction:column;
        align-items:center;
        justify-content:center;
        padding:5px 1px 7px !important;
        border:0 !important;
        border-bottom:2px solid transparent !important;
        color:#7f7f87 !important;
        background:transparent !important;
        text-decoration:none !important;
        text-align:center;
        white-space:nowrap;
        overflow:hidden;
        text-overflow:ellipsis;
        font:600 .59rem/1.12 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif !important;
        transition:
          color .18s ease,
          transform .18s cubic-bezier(.16,1,.3,1),
          border-color .18s ease !important;
      }

      .evo-shared-nav .tab-item svg{
        width:19px;
        height:19px;
        margin-bottom:4px;
        opacity:.67;
        transition:transform .20s cubic-bezier(.16,1,.3,1),opacity .18s ease;
      }

      .evo-shared-nav .tab-item:hover,
      .evo-shared-nav .tab-item.active,
      .evo-shared-nav .tab-item.current-area{
        color:#fff !important;
        border-bottom-color:var(--evo-nav-accent) !important;
      }

      .evo-shared-nav .tab-item.active svg,
      .evo-shared-nav .tab-item.current-area svg{
        opacity:1;
        transform:translate3d(0,-1px,0) scale(1.08);
      }

      .evo-shared-nav .tab-item:active{
        transform:scale(.94);
      }

      .evo-shared-nav .d-none{
        display:none !important;
      }

      @media(min-width:992px){
        .evo-shared-nav.desktop-nav{
          display:block !important;
        }
        .evo-shared-nav.mobile-app-nav{
          display:none !important;
        }
      }

      @media(min-width:992px) and (max-width:1199.98px){
        .evo-shared-nav .nav-pill-links{
          gap:12px;
        }
        .evo-shared-nav .nav-pill-link,
        .evo-shared-nav #auth-desktop-wrapper .nav-link-ed{
          font-size:.70rem !important;
        }
        .evo-software-btn{
          padding:0 13px;
          font-size:.68rem !important;
        }
      }

      @media(max-width:575.98px){
        .evo-shared-nav.mobile-app-nav{
          -webkit-backdrop-filter:blur(10px) saturate(120%) !important;
          backdrop-filter:blur(10px) saturate(120%) !important;
        }
      }

      @media(max-width:389.98px){
        .evo-shared-nav .app-nav-top{
          padding-left:10px !important;
          padding-right:10px !important;
        }
        .evo-shared-nav .app-nav-top .evo-nav-logo img{
          max-width:112px;
        }
        .evo-shared-nav .tab-item{
          font-size:.54rem !important;
        }
        .evo-shared-nav .tab-item svg{
          width:18px;
          height:18px;
        }
      }

      @media(prefers-reduced-motion:reduce){
        .evo-shared-nav *,
        .evo-shared-nav{
          transition:none !important;
          animation:none !important;
        }
      }
    `;
    document.head.appendChild(style);
  }

  const ICONS = {
    menu: `<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h18M3 6h18M3 18h18"/></svg>`,
    home: `<svg width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`,
    architecture: `<svg width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 21V10l8-7 8 7v11"/><path d="M9 21v-7h6v7"/></svg>`,
    graphic: `<svg width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8 15c1.5-4 3.5-6.5 7-8"/><circle cx="8" cy="15" r="1"/></svg>`,
    web: `<svg width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/><path d="m9 13-2 2 2 2M15 13l2 2-2 2"/></svg>`,
    projects: `<svg width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" aria-hidden="true"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`,
    about: `<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`,
    feedback: `<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>`,
    login: `<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3"/></svg>`
  };

  const PAGES = [
    { key:'home', href:'index.html', label:'Home', short:'Home', icon:'home' },
    { key:'arquitectura', href:'arquitectura.html', label:'Arquitectura', short:'Arquitectura', icon:'architecture' },
    { key:'grafico', href:'diseno-grafico.html', label:'Diseño Gráfico', short:'Diseño G.', icon:'graphic' },
    { key:'web', href:'diseno-web.html', label:'Diseño Web', short:'Diseño Web', icon:'web' }
  ];

  function inferActive() {
    const path = location.pathname.toLowerCase();
    if (path.includes('arquitectura')) return 'arquitectura';
    if (path.includes('diseno-grafico')) return 'grafico';
    if (path.includes('diseno-web')) return 'web';
    return 'home';
  }

  function activeClasses(key, active) {
    return key === active ? ' current-area active' : '';
  }

  function ariaCurrent(key, active) {
    return key === active ? ' aria-current="page"' : '';
  }

  function dropdownItems(active) {
    const main = PAGES.map(item => `
      <li>
        <a class="menu-item${activeClasses(item.key,active)}"
           href="${item.href}"
           data-evolution-nav
           ${ariaCurrent(item.key,active)}>
          ${ICONS[item.icon].replace('22" height="22','18" height="18')}
          <span>${item.label}</span>
        </a>
      </li>
    `).join('');

    return `
      ${main}
      <li><a class="menu-item" href="sobre-nosotros">${ICONS.about}<span>Sobre Nosotros</span></a></li>
      <li><a class="menu-item" href="feedback">${ICONS.feedback}<span>Feedback</span></a></li>
      <li class="d-none" id="linkProyectosMenuDesktop">
        <a class="menu-item" href="proyectos.html" data-evolution-nav>
          ${ICONS.projects.replace('22" height="22','18" height="18')}
          <span>Mis Proyectos</span>
        </a>
      </li>
    `;
  }

  function desktopLinks(active) {
    return PAGES.map(item => `
      <a class="nav-pill-link${activeClasses(item.key,active)}"
         href="${item.href}"
         data-evolution-nav
         ${ariaCurrent(item.key,active)}>${item.label}</a>
    `).join('');
  }

  function mobileTabs(active) {
    const tabs = PAGES.map(item => `
      <a class="tab-item${activeClasses(item.key,active)}"
         href="${item.href}"
         data-evolution-nav
         ${ariaCurrent(item.key,active)}>
        ${ICONS[item.icon]}
        <span>${item.short}</span>
      </a>
    `).join('');

    return `
      ${tabs}
      <a class="tab-item d-none"
         href="proyectos.html"
         id="linkProyectosMobile"
         data-evolution-nav>
        ${ICONS.projects}
        <span>Proyectos</span>
      </a>
    `;
  }

  class EvolutionNav extends HTMLElement {
    connectedCallback() {
      if (this.dataset.rendered === '1') return;
      this.dataset.rendered = '1';

      const active = this.getAttribute('active') || inferActive();

      this.innerHTML = `
        <nav class="evo-shared-nav desktop-nav" id="navScroll" aria-label="Navegación principal">
          <div class="evo-desktop-shell">
            <div class="nav-pill">
              <div class="evo-nav-brand-zone">
                <div class="evo-nav-menu-wrap">
                  <a href="#" id="desktopMenuBtn" class="icon-btn" aria-label="Abrir menú" aria-expanded="false">
                    ${ICONS.menu}
                  </a>
                  <ul class="desktop-dropdown-menu" id="desktopDropdownMenu">
                    ${dropdownItems(active)}
                  </ul>
                </div>

                <a href="index.html" class="evo-nav-logo" data-evolution-nav aria-label="Evolution Design · Home">
                  <img src="img/logo.png" alt="Evolution Design" decoding="async" fetchpriority="high">
                </a>

                <div id="admin-badge-container-desktop"></div>
              </div>

              <div class="nav-pill-links">
                ${desktopLinks(active)}

                <a class="nav-pill-link d-none"
                   href="proyectos.html"
                   id="linkProyectosDesktop"
                   data-evolution-nav>Mis Proyectos</a>

                <div id="auth-desktop-wrapper">
                  <a href="#"
                     class="nav-pill-link"
                     data-evolution-login
                     style="color:#d4b895!important;font-weight:750!important">
                    ${ICONS.login.replace('20" height="20','18" height="18')}
                    <span>Login</span>
                  </a>
                </div>
              </div>

              <a class="evo-software-btn"
                 href="https://dingloft.com"
                 target="_blank"
                 rel="noopener">Catálogo de Software →</a>
            </div>

            <div id="floating-profile-desktop"></div>
          </div>
        </nav>

        <nav class="evo-shared-nav mobile-app-nav"
             id="mobileNav"
             aria-label="Navegación móvil">
          <div class="app-nav-top">
            <div class="evo-nav-menu-wrap">
              <a href="#" id="mobileMenuBtn" class="icon-btn" aria-label="Abrir menú" aria-expanded="false">
                ${ICONS.menu}
              </a>
              <ul class="mobile-dropdown-menu" id="mobileDropdownMenu">
                ${dropdownItems(active)}
              </ul>
            </div>

            <a href="index.html" class="evo-nav-logo" data-evolution-nav aria-label="Evolution Design · Home">
              <img src="img/logo.png" alt="Evolution Design" decoding="async" fetchpriority="high">
            </a>

            <div id="auth-mobile-wrapper">
              <a href="#" class="icon-btn" data-evolution-login aria-label="Login">
                ${ICONS.login}
              </a>
            </div>
          </div>

          <div class="app-tabs">
            ${mobileTabs(active)}
          </div>
        </nav>
      `;

      this.dispatchEvent(new CustomEvent('evolution-nav-ready', {
        bubbles:true,
        detail:{ active }
      }));
    }
  }

  if (!customElements.get('evolution-nav')) {
    customElements.define('evolution-nav', EvolutionNav);
  }

  const closeMenu = (menu, button) => {
    if (!menu) return;
    menu.classList.remove('show');
    button?.setAttribute('aria-expanded','false');
  };

  const toggleMenu = (menu, button) => {
    if (!menu || !button) return;
    const opening = !menu.classList.contains('show');

    document.querySelectorAll('.desktop-dropdown-menu.show,.mobile-dropdown-menu.show')
      .forEach(other => {
        if (other !== menu) other.classList.remove('show');
      });

    document.querySelectorAll('#desktopMenuBtn,#mobileMenuBtn')
      .forEach(other => {
        if (other !== button) other.setAttribute('aria-expanded','false');
      });

    menu.classList.toggle('show',opening);
    button.setAttribute('aria-expanded',String(opening));
  };

  /*
   * Capture phase intentionally owns hamburger behavior.
   * Old page-specific listeners never run, avoiding double toggles.
   */
  document.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const login = target.closest('[data-evolution-login]');
    if (login) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (typeof window.abrirAuthModal === 'function') {
        window.abrirAuthModal();
      }
      return;
    }

    const desktopBtn = target.closest('#desktopMenuBtn');
    if (desktopBtn) {
      event.preventDefault();
      event.stopImmediatePropagation();
      toggleMenu(
        document.getElementById('desktopDropdownMenu'),
        desktopBtn
      );
      return;
    }

    const mobileBtn = target.closest('#mobileMenuBtn');
    if (mobileBtn) {
      event.preventDefault();
      event.stopImmediatePropagation();
      toggleMenu(
        document.getElementById('mobileDropdownMenu'),
        mobileBtn
      );
      return;
    }

    const desktopMenu = document.getElementById('desktopDropdownMenu');
    const mobileMenu = document.getElementById('mobileDropdownMenu');

    if (desktopMenu && !target.closest('#desktopDropdownMenu')) {
      closeMenu(desktopMenu,document.getElementById('desktopMenuBtn'));
    }
    if (mobileMenu && !target.closest('#mobileDropdownMenu')) {
      closeMenu(mobileMenu,document.getElementById('mobileMenuBtn'));
    }
  }, true);

  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    closeMenu(
      document.getElementById('desktopDropdownMenu'),
      document.getElementById('desktopMenuBtn')
    );
    closeMenu(
      document.getElementById('mobileDropdownMenu'),
      document.getElementById('mobileMenuBtn')
    );
  });

  /* Mobile scroll behavior: hide down, reveal up. */
  let lastY = Math.max(0,window.scrollY || 0);
  let scrollTicking = false;

  const syncMobileNav = () => {
    const nav = document.getElementById('mobileNav');
    const mobile = matchMedia('(max-width:991.98px)').matches;
    const y = Math.max(0,window.scrollY || document.documentElement.scrollTop || 0);

    if (!nav || !mobile) {
      nav?.classList.remove('nav-hidden','nav-at-top');
      lastY = y;
      scrollTicking = false;
      return;
    }

    /* Old scripts may still attach .hidden; shared component ignores it. */
    nav.classList.remove('hidden');
    nav.classList.toggle('nav-at-top',y < 12);

    const menuOpen = document.getElementById('mobileDropdownMenu')?.classList.contains('show');

    if (menuOpen || y < 90) {
      nav.classList.remove('nav-hidden');
    } else if (y > lastY + 7) {
      nav.classList.add('nav-hidden');
    } else if (y < lastY - 7) {
      nav.classList.remove('nav-hidden');
    }

    lastY = y;
    scrollTicking = false;
  };

  addEventListener('scroll',() => {
    if (scrollTicking) return;
    scrollTicking = true;
    requestAnimationFrame(syncMobileNav);
  },{passive:true});

  addEventListener('resize',syncMobileNav,{passive:true});
  addEventListener('pageshow',syncMobileNav,{passive:true});

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded',syncMobileNav,{once:true});
  } else {
    syncMobileNav();
  }

  /* Fast same-origin prefetch on intent. */
  const prefetched = new Set();

  const prefetchLink = link => {
    if (!link) return;

    try {
      const url = new URL(link.href,location.href);

      if (
        url.origin !== location.origin ||
        url.pathname === location.pathname ||
        /proyectos|admin|perfil|checkout|payment|pago/i.test(url.pathname) ||
        prefetched.has(url.href)
      ) return;

      const hint = document.createElement('link');
      hint.rel = 'prefetch';
      hint.href = url.href;
      document.head.appendChild(hint);
      prefetched.add(url.href);
    } catch (_) {}
  };

  document.addEventListener('pointerdown',event => {
    const link = event.target instanceof Element
      ? event.target.closest('evolution-nav a[href]')
      : null;
    prefetchLink(link);
  },{passive:true});

  document.addEventListener('pointerover',event => {
    if (!matchMedia('(pointer:fine)').matches) return;
    const link = event.target instanceof Element
      ? event.target.closest('evolution-nav a[href]')
      : null;
    prefetchLink(link);
  },{passive:true});
})();
