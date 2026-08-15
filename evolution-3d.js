/* ============================================================
   EVOLUTION DESIGN · 3D VIEWER · V1
   Independent Web Component
   Engine: <model-viewer> 4.3.1 (loaded on demand)
   ============================================================ */
(() => {
  'use strict';

  const VERSION = '1.0.0';
  const DEFAULT_ENGINE =
    window.EVOLUTION_3D_MODEL_VIEWER_URL ||
    'https://ajax.googleapis.com/ajax/libs/model-viewer/4.3.1/model-viewer.min.js';

  let enginePromise = null;
  let bodyLockCount = 0;

  const ICONS = {
    cube: `<svg viewBox="0 0 24 24"><path d="m12 2 8 4.5v11L12 22l-8-4.5v-11z"/><path d="m4 6.5 8 4.5 8-4.5M12 11v11"/></svg>`,
    close: `<svg viewBox="0 0 24 24"><path d="M5 5l14 14M19 5 5 19"/></svg>`,
    rotate: `<svg viewBox="0 0 24 24"><path d="M20 8V3l-2 2.1A9 9 0 1 0 21 12"/><path d="M16 3h4v4"/></svg>`,
    reset: `<svg viewBox="0 0 24 24"><path d="M4 11a8 8 0 1 1 2.34 5.66"/><path d="M4 4v7h7"/></svg>`,
    fullscreen: `<svg viewBox="0 0 24 24"><path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5"/></svg>`,
    ar: `<svg viewBox="0 0 24 24"><path d="m12 2 7 4v8l-7 4-7-4V6z"/><path d="m5 6 7 4 7-4M12 10v8"/><path d="M8 20h8"/></svg>`,
    view: `<svg viewBox="0 0 24 24"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="2.6"/></svg>`,
    download: `<svg viewBox="0 0 24 24"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>`
  };

  function lockBody() {
    bodyLockCount++;
    if (bodyLockCount === 1) {
      document.documentElement.dataset.evolution3dScrollY = String(window.scrollY || 0);
      document.body.dataset.evolution3dPrevOverflow = document.body.style.overflow || '';
      document.body.style.overflow = 'hidden';
    }
  }

  function unlockBody() {
    bodyLockCount = Math.max(0, bodyLockCount - 1);
    if (bodyLockCount === 0) {
      document.body.style.overflow = document.body.dataset.evolution3dPrevOverflow || '';
      delete document.body.dataset.evolution3dPrevOverflow;
    }
  }

  function ensureEngine() {
    if (customElements.get('model-viewer')) {
      return Promise.resolve();
    }
    if (enginePromise) return enginePromise;

    enginePromise = new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-evolution-3d-engine]');
      if (existing) {
        customElements.whenDefined('model-viewer').then(resolve).catch(reject);
        return;
      }

      const script = document.createElement('script');
      script.type = 'module';
      script.src = DEFAULT_ENGINE;
      script.dataset.evolution3dEngine = VERSION;
      script.crossOrigin = 'anonymous';
      script.onload = () => customElements.whenDefined('model-viewer').then(resolve).catch(reject);
      script.onerror = () => reject(new Error('No se pudo cargar el motor 3D.'));
      document.head.appendChild(script);
    });

    return enginePromise;
  }

  function escapeHTML(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '';
    const units = ['B','KB','MB','GB'];
    let value = bytes;
    let i = 0;
    while (value >= 1024 && i < units.length - 1) {
      value /= 1024;
      i++;
    }
    return `${value >= 10 || i === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[i]}`;
  }

  function isSlowConnection() {
    const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (!c) return false;
    if (c.saveData) return true;
    return ['slow-2g','2g'].includes(String(c.effectiveType || '').toLowerCase());
  }

  function supportsFullscreen() {
    return Boolean(document.fullscreenEnabled || document.webkitFullscreenEnabled);
  }

  class Evolution3D extends HTMLElement {
    static get observedAttributes() {
      return ['src','poster','title','subtitle','ios-src','download'];
    }

    constructor() {
      super();
      this.attachShadow({mode:'open'});
      this._opened = false;
      this._loaded = false;
      this._loading = false;
      this._destroyTimer = 0;
      this._autoRotate = false;
      this._lastProgress = 0;
      this._lastFocus = null;
      this._boundKeydown = e => this._onKeydown(e);
    }

    connectedCallback() {
      this.render();
      this.bind();
    }

    disconnectedCallback() {
      document.removeEventListener('keydown', this._boundKeydown, true);
      if (this._opened) unlockBody();
      clearTimeout(this._destroyTimer);
    }

    attributeChangedCallback() {
      if (this.isConnected) {
        this.render();
        this.bind();
      }
    }

    get src() {
      return this.getAttribute('src') || this.dataset.src || '';
    }

    get poster() {
      return this.getAttribute('poster') || this.dataset.poster || '';
    }

    get titleText() {
      return this.getAttribute('title') || this.dataset.title || 'Modelo 3D';
    }

    get subtitleText() {
      return this.getAttribute('subtitle') || this.dataset.subtitle || 'Vista interactiva del proyecto';
    }

    get iosSrc() {
      return this.getAttribute('ios-src') || this.dataset.iosSrc || '';
    }

    get downloadURL() {
      return this.getAttribute('download') || this.dataset.download || '';
    }

    render() {
      const poster = this.poster;
      const title = escapeHTML(this.titleText);
      const subtitle = escapeHTML(this.subtitleText);
      const hasPoster = Boolean(poster);

      this.shadowRoot.innerHTML = `
        <style>
          :host{
            --e3d-accent:#d4b895;
            --e3d-bg:#080809;
            --e3d-panel:rgba(18,18,21,.92);
            --e3d-border:rgba(255,255,255,.11);
            --e3d-muted:#929299;
            display:block;
            width:100%;
            font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","Segoe UI",sans-serif;
            color:#fff;
          }
          *,*::before,*::after{box-sizing:border-box}
          button,a{font:inherit}
          button{-webkit-tap-highlight-color:transparent}
          svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}

          .card{
            position:relative;
            min-height:260px;
            overflow:hidden;
            border:1px solid var(--e3d-border);
            border-radius:24px;
            background:
              radial-gradient(circle at 75% 18%,rgba(212,184,149,.10),transparent 35%),
              linear-gradient(145deg,#121215,#080809 70%);
            box-shadow:0 24px 70px rgba(0,0,0,.28),inset 0 1px rgba(255,255,255,.05);
            cursor:pointer;
            isolation:isolate;
          }
          .card::after{
            content:"";
            position:absolute;
            inset:0;
            background:linear-gradient(to top,rgba(4,4,5,.96),rgba(4,4,5,.08) 65%,rgba(4,4,5,.04));
            z-index:1;
            pointer-events:none;
          }
          .poster{
            position:absolute;
            inset:0;
            width:100%;
            height:100%;
            object-fit:cover;
            transition:transform .65s cubic-bezier(.16,1,.3,1),filter .35s ease;
          }
          .card:hover .poster{transform:scale(1.025)}
          .card-content{
            position:absolute;
            z-index:2;
            left:0;right:0;bottom:0;
            padding:22px;
            display:flex;
            align-items:flex-end;
            justify-content:space-between;
            gap:18px;
          }
          .eyebrow{
            display:flex;align-items:center;gap:7px;
            color:var(--e3d-accent);
            font-size:.68rem;font-weight:800;letter-spacing:.12em;text-transform:uppercase;
            margin-bottom:8px;
          }
          .eyebrow svg{width:16px;height:16px}
          .title{margin:0;font-size:clamp(1.08rem,2vw,1.42rem);font-weight:800;letter-spacing:-.025em}
          .subtitle{margin:5px 0 0;color:#9b9ba2;font-size:.78rem;line-height:1.45}
          .open{
            flex:0 0 auto;
            min-height:43px;
            padding:0 16px;
            display:inline-flex;align-items:center;justify-content:center;gap:8px;
            border:1px solid rgba(255,255,255,.13);
            border-radius:999px;
            background:rgba(245,245,243,.96);
            color:#080809;
            font-size:.72rem;font-weight:850;
            box-shadow:0 10px 30px rgba(0,0,0,.25);
            transition:transform .2s cubic-bezier(.16,1,.3,1),background .2s ease;
          }
          .open:hover{transform:translateY(-1px) scale(1.01);background:#fff}
          .open:active{transform:scale(.97)}
          .placeholder{
            position:absolute;inset:0;
            display:grid;place-items:center;
            color:rgba(255,255,255,.12);
            background:
              linear-gradient(rgba(255,255,255,.025) 1px,transparent 1px),
              linear-gradient(90deg,rgba(255,255,255,.025) 1px,transparent 1px);
            background-size:28px 28px;
          }
          .placeholder svg{width:76px;height:76px;stroke-width:.8}

          .overlay{
            position:fixed;
            inset:0;
            z-index:2147483600;
            display:flex;
            align-items:stretch;
            justify-content:stretch;
            padding:max(12px,env(safe-area-inset-top)) max(12px,env(safe-area-inset-right)) max(12px,env(safe-area-inset-bottom)) max(12px,env(safe-area-inset-left));
            background:rgba(0,0,0,.82);
            backdrop-filter:blur(18px) saturate(130%);
            -webkit-backdrop-filter:blur(18px) saturate(130%);
            opacity:0;
            visibility:hidden;
            pointer-events:none;
            transition:opacity .22s ease,visibility .22s ease;
          }
          .overlay.opened{
            opacity:1;visibility:visible;pointer-events:auto;
          }
          .viewer-shell{
            position:relative;
            width:100%;height:100%;
            min-height:320px;
            overflow:hidden;
            border:1px solid rgba(255,255,255,.12);
            border-radius:24px;
            background:
              radial-gradient(circle at 50% 30%,#1b1b1e,#080809 65%);
            box-shadow:0 30px 100px rgba(0,0,0,.62),inset 0 1px rgba(255,255,255,.06);
            transform:scale(.985) translateY(8px);
            transition:transform .32s cubic-bezier(.16,1,.3,1);
          }
          .overlay.opened .viewer-shell{transform:none}

          model-viewer{
            width:100%;height:100%;
            min-height:320px;
            display:block;
            background:transparent;
            --poster-color:transparent;
            --progress-bar-color:transparent;
          }

          .topbar{
            position:absolute;
            top:0;left:0;right:0;
            z-index:15;
            min-height:74px;
            padding:16px 17px;
            display:flex;align-items:center;gap:12px;
            pointer-events:none;
            background:linear-gradient(to bottom,rgba(6,6,8,.78),transparent);
          }
          .top-copy{min-width:0;flex:1;pointer-events:none}
          .top-title{font-size:.90rem;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
          .top-sub{margin-top:3px;color:#9a9aa1;font-size:.66rem;font-weight:600}
          .top-actions{display:flex;align-items:center;gap:7px;pointer-events:auto}
          .icon-btn{
            width:42px;height:42px;
            border:1px solid rgba(255,255,255,.13);
            border-radius:50%;
            background:rgba(17,17,19,.66);
            color:#fff;
            display:grid;place-items:center;
            backdrop-filter:blur(14px);
            -webkit-backdrop-filter:blur(14px);
            cursor:pointer;
            transition:transform .18s ease,background .18s ease,border-color .18s ease;
          }
          .icon-btn:hover{background:rgba(40,40,44,.84);border-color:rgba(255,255,255,.22);transform:scale(1.035)}
          .icon-btn:active{transform:scale(.94)}

          .bottom{
            position:absolute;
            left:50%;bottom:18px;
            z-index:15;
            transform:translateX(-50%);
            width:min(760px,calc(100% - 26px));
            display:flex;
            align-items:center;
            justify-content:center;
            gap:8px;
            pointer-events:none;
          }
          .dock{
            pointer-events:auto;
            display:flex;align-items:center;gap:5px;
            padding:6px;
            max-width:100%;
            overflow-x:auto;
            scrollbar-width:none;
            border:1px solid rgba(255,255,255,.12);
            border-radius:999px;
            background:rgba(13,13,15,.72);
            box-shadow:0 15px 45px rgba(0,0,0,.34);
            backdrop-filter:blur(20px) saturate(150%);
            -webkit-backdrop-filter:blur(20px) saturate(150%);
          }
          .dock::-webkit-scrollbar{display:none}
          .tool{
            min-height:39px;
            padding:0 12px;
            border:0;
            border-radius:999px;
            background:transparent;
            color:#acacb2;
            display:flex;align-items:center;justify-content:center;gap:7px;
            cursor:pointer;
            white-space:nowrap;
            font-size:.66rem;font-weight:750;
            transition:background .18s ease,color .18s ease,transform .18s ease;
          }
          .tool svg{width:17px;height:17px}
          .tool:hover,.tool.active{background:rgba(255,255,255,.09);color:#fff}
          .tool.active{color:var(--e3d-accent)}
          .tool:active{transform:scale(.96)}

          .loading-layer,.error-layer{
            position:absolute;inset:0;z-index:12;
            display:flex;align-items:center;justify-content:center;
            padding:28px;
            background:
              radial-gradient(circle at 50% 35%,rgba(212,184,149,.08),transparent 35%),
              #080809;
            text-align:center;
            transition:opacity .25s ease,visibility .25s;
          }
          .loading-layer.hidden,.error-layer.hidden{
            opacity:0;visibility:hidden;pointer-events:none;
          }
          .loading-box{width:min(340px,84%)}
          .loading-cube{
            width:54px;height:54px;margin:0 auto 17px;
            display:grid;place-items:center;
            border:1px solid rgba(255,255,255,.12);
            border-radius:16px;
            background:rgba(255,255,255,.035);
            color:var(--e3d-accent);
          }
          .loading-cube svg{width:27px;height:27px;animation:e3dspin 2.7s linear infinite}
          @keyframes e3dspin{to{transform:rotateY(360deg) rotateX(360deg)}}
          .loading-title{font-size:.88rem;font-weight:800}
          .loading-sub{margin-top:5px;color:#85858c;font-size:.68rem;line-height:1.5}
          .progress-track{
            height:3px;margin-top:16px;overflow:hidden;
            border-radius:999px;background:rgba(255,255,255,.08);
          }
          .progress-bar{
            width:0%;height:100%;border-radius:999px;
            background:var(--e3d-accent);
            transition:width .18s ease;
          }
          .progress-label{margin-top:7px;color:#73737b;font-size:.62rem;font-weight:700}

          .error-layer{z-index:20;background:#080809}
          .error-icon{color:#ffb2b2;margin-bottom:12px}
          .error-title{font-size:.9rem;font-weight:800}
          .error-sub{margin:7px auto 16px;max-width:400px;color:#898990;font-size:.70rem;line-height:1.55}
          .retry{
            border:1px solid rgba(255,255,255,.12);
            border-radius:999px;
            background:#f3f3f1;color:#080809;
            min-height:40px;padding:0 15px;
            font-size:.68rem;font-weight:850;cursor:pointer;
          }

          .hint{
            position:absolute;
            left:50%;top:50%;
            z-index:11;
            transform:translate(-50%,-50%);
            padding:9px 12px;
            border:1px solid rgba(255,255,255,.10);
            border-radius:999px;
            background:rgba(8,8,10,.62);
            color:#c2c2c7;
            font-size:.65rem;font-weight:700;
            pointer-events:none;
            opacity:0;
            transition:opacity .25s ease;
            backdrop-filter:blur(12px);
          }
          .hint.show{opacity:1}

          .ar-button{
            position:absolute;
            right:18px;bottom:18px;
            z-index:15;
            min-height:42px;padding:0 14px;
            border:1px solid rgba(255,255,255,.12);
            border-radius:999px;
            background:#f2f2ef;color:#09090a;
            display:flex;align-items:center;gap:7px;
            font-size:.68rem;font-weight:850;
            box-shadow:0 12px 36px rgba(0,0,0,.28);
          }
          .ar-button svg{width:17px;height:17px}

          @media(max-width:700px){
            .card{min-height:230px;border-radius:20px}
            .card-content{padding:17px;align-items:flex-end}
            .open{width:43px;padding:0;font-size:0}
            .open svg{margin:0}
            .viewer-shell{border-radius:18px}
            .overlay{padding:max(7px,env(safe-area-inset-top)) max(7px,env(safe-area-inset-right)) max(7px,env(safe-area-inset-bottom)) max(7px,env(safe-area-inset-left))}
            .topbar{padding:12px 12px 20px}
            .top-sub{display:none}
            .bottom{bottom:max(11px,env(safe-area-inset-bottom))}
            .tool{min-width:40px;padding:0 10px}
            .tool span{display:none}
            .dock{gap:2px}
            .ar-button{right:12px;bottom:70px}
          }

          @media(prefers-reduced-motion:reduce){
            *,*::before,*::after{animation:none!important;transition:none!important}
          }
        </style>

        <div class="card" part="card" tabindex="0" role="button" aria-label="Abrir ${title}">
          ${hasPoster
            ? `<img class="poster" src="${escapeHTML(poster)}" alt="" loading="lazy" decoding="async">`
            : `<div class="placeholder">${ICONS.cube}</div>`}
          <div class="card-content">
            <div>
              <div class="eyebrow">${ICONS.cube}<span>Modelo 3D interactivo</span></div>
              <h3 class="title">${title}</h3>
              <p class="subtitle">${subtitle}</p>
            </div>
            <button class="open" type="button">
              ${ICONS.view}
              <span>Ver modelo 3D</span>
            </button>
          </div>
        </div>

        <div class="overlay" part="overlay" aria-hidden="true">
          <div class="viewer-shell" part="viewer">
            <div class="topbar">
              <div class="top-copy">
                <div class="top-title">${title}</div>
                <div class="top-sub">Arrastra para orbitar · rueda o pellizca para zoom</div>
              </div>
              <div class="top-actions">
                ${this.downloadURL ? `<a class="icon-btn download-btn" href="${escapeHTML(this.downloadURL)}" download aria-label="Descargar archivo">${ICONS.download}</a>` : ''}
                <button class="icon-btn fullscreen-btn" type="button" aria-label="Pantalla completa">${ICONS.fullscreen}</button>
                <button class="icon-btn close-btn" type="button" aria-label="Cerrar">${ICONS.close}</button>
              </div>
            </div>

            <div class="loading-layer">
              <div class="loading-box">
                <div class="loading-cube">${ICONS.cube}</div>
                <div class="loading-title">Preparando modelo 3D</div>
                <div class="loading-sub">${isSlowConnection() ? 'Conexión lenta detectada. Evolution priorizará la carga del modelo.' : 'Cargando geometría, materiales y texturas…'}</div>
                <div class="progress-track"><div class="progress-bar"></div></div>
                <div class="progress-label">0%</div>
              </div>
            </div>

            <div class="error-layer hidden">
              <div>
                <div class="error-icon">${ICONS.cube}</div>
                <div class="error-title">No se pudo abrir el modelo</div>
                <div class="error-sub">Verifica que el archivo sea GLB/GLTF y que el servidor permita cargarlo desde Evolution.</div>
                <button class="retry" type="button">Intentar de nuevo</button>
              </div>
            </div>

            <div class="hint">Arrastra para explorar el proyecto</div>

            <div class="bottom">
              <div class="dock">
                <button class="tool preset-front" type="button" title="Vista frontal">${ICONS.view}<span>Frontal</span></button>
                <button class="tool preset-three" type="button" title="Vista 3/4">${ICONS.view}<span>3/4</span></button>
                <button class="tool preset-top" type="button" title="Vista superior">${ICONS.view}<span>Superior</span></button>
                <button class="tool rotate-btn" type="button" title="Rotación automática">${ICONS.rotate}<span>Rotar</span></button>
                <button class="tool reset-btn" type="button" title="Restablecer cámara">${ICONS.reset}<span>Reiniciar</span></button>
              </div>
            </div>
          </div>
        </div>
      `;
    }

    bind() {
      const $ = sel => this.shadowRoot.querySelector(sel);

      this._card = $('.card');
      this._overlay = $('.overlay');
      this._shell = $('.viewer-shell');
      this._loadingLayer = $('.loading-layer');
      this._errorLayer = $('.error-layer');
      this._progressBar = $('.progress-bar');
      this._progressLabel = $('.progress-label');
      this._hint = $('.hint');

      this._card?.addEventListener('click', () => this.open());
      this._card?.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.open();
        }
      });

      $('.open')?.addEventListener('click', e => {
        e.stopPropagation();
        this.open();
      });

      $('.close-btn')?.addEventListener('click', () => this.close());
      $('.fullscreen-btn')?.addEventListener('click', () => this.toggleFullscreen());
      $('.retry')?.addEventListener('click', () => this.reload());
      $('.rotate-btn')?.addEventListener('click', e => this.toggleRotate(e.currentTarget));
      $('.reset-btn')?.addEventListener('click', () => this.resetCamera());
      $('.preset-front')?.addEventListener('click', () => this.setCamera('0deg 74deg auto'));
      $('.preset-three')?.addEventListener('click', () => this.setCamera('45deg 68deg auto'));
      $('.preset-top')?.addEventListener('click', () => this.setCamera('0deg 8deg auto'));

      this._overlay?.addEventListener('click', e => {
        if (e.target === this._overlay) this.close();
      });

      document.removeEventListener('keydown', this._boundKeydown, true);
      document.addEventListener('keydown', this._boundKeydown, true);

      if (!supportsFullscreen()) {
        $('.fullscreen-btn')?.remove();
      }
    }

    async open() {
      const src = this.src;
      if (!src) {
        this.showError('No hay un archivo 3D asignado a este proyecto.');
        return;
      }

      clearTimeout(this._destroyTimer);
      this._lastFocus = document.activeElement;
      this._opened = true;
      this._overlay?.classList.add('opened');
      this._overlay?.setAttribute('aria-hidden','false');
      lockBody();

      try {
        await ensureEngine();
        if (!this._opened) return;
        await this.createViewer();
      } catch (error) {
        console.error('[Evolution3D]', error);
        this.showError('No se pudo iniciar el motor 3D.');
      }
    }

    async createViewer(force = false) {
      if (this._loading && !force) return;
      if (this._loaded && this._modelViewer && !force) {
        this.hideLoading();
        return;
      }

      this._loading = true;
      this._loaded = false;
      this._lastProgress = 0;
      this.showLoading();
      this.hideError();

      this._modelViewer?.remove();

      const viewer = document.createElement('model-viewer');
      viewer.setAttribute('camera-controls','');
      viewer.setAttribute('touch-action','pan-y');
      viewer.setAttribute('shadow-intensity','1');
      viewer.setAttribute('exposure','1');
      viewer.setAttribute('tone-mapping','neutral');
      viewer.setAttribute('interaction-prompt','none');
      viewer.setAttribute('ar','');
      viewer.setAttribute('ar-modes','webxr scene-viewer quick-look');
      viewer.setAttribute('alt', this.titleText);
      viewer.setAttribute('loading','eager');

      if (this.iosSrc) viewer.setAttribute('ios-src', this.iosSrc);

      if (this.poster) {
        viewer.setAttribute('poster', this.poster);
      }

      const arButton = document.createElement('button');
      arButton.className = 'ar-button';
      arButton.slot = 'ar-button';
      arButton.type = 'button';
      arButton.innerHTML = `${ICONS.ar}<span>Ver en AR</span>`;
      viewer.appendChild(arButton);

      viewer.addEventListener('progress', event => {
        const p = Math.max(0, Math.min(1, Number(event.detail?.totalProgress || 0)));
        this.updateProgress(p);
      });

      viewer.addEventListener('load', () => {
        this._loaded = true;
        this._loading = false;
        this.updateProgress(1);
        setTimeout(() => this.hideLoading(), 180);
        this.flashHint();
        this.dispatchEvent(new CustomEvent('evolution3d:loaded', {
          bubbles:true,
          detail:{src:this.src,title:this.titleText}
        }));
      }, {once:true});

      viewer.addEventListener('error', event => {
        this._loaded = false;
        this._loading = false;
        console.error('[Evolution3D] Model error', event);
        this.showError('El modelo no pudo cargarse. Revisa el archivo o los permisos CORS.');
        this.dispatchEvent(new CustomEvent('evolution3d:error', {
          bubbles:true,
          detail:{src:this.src}
        }));
      });

      viewer.addEventListener('ar-status', event => {
        if (event.detail?.status === 'failed') {
          this.dispatchEvent(new CustomEvent('evolution3d:ar-error', {bubbles:true}));
        }
      });

      this._shell.insertBefore(viewer, this._shell.firstChild);
      this._modelViewer = viewer;

      // Setting src last guarantees that listeners and UI are ready first.
      viewer.src = this.src;
    }

    close() {
      if (!this._opened) return;

      this._opened = false;
      this._overlay?.classList.remove('opened');
      this._overlay?.setAttribute('aria-hidden','true');
      unlockBody();

      if (document.fullscreenElement || document.webkitFullscreenElement) {
        try {
          (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
        } catch (_) {}
      }

      this._lastFocus?.focus?.({preventScroll:true});

      // Release GPU/memory later on phones, while browser cache keeps assets reusable.
      clearTimeout(this._destroyTimer);
      this._destroyTimer = setTimeout(() => {
        if (this._opened) return;
        if (matchMedia('(max-width: 900px)').matches) {
          this.destroyModel();
        }
      }, 45000);

      this.dispatchEvent(new CustomEvent('evolution3d:closed', {bubbles:true}));
    }

    destroyModel() {
      if (!this._modelViewer) return;
      try {
        this._modelViewer.src = '';
        this._modelViewer.remove();
      } catch (_) {}
      this._modelViewer = null;
      this._loaded = false;
      this._loading = false;
      this.updateProgress(0);
    }

    reload() {
      this.destroyModel();
      this.createViewer(true);
    }

    showLoading() {
      this._loadingLayer?.classList.remove('hidden');
      this.updateProgress(this._lastProgress || 0);
    }

    hideLoading() {
      this._loadingLayer?.classList.add('hidden');
    }

    showError(message) {
      if (!this._overlay?.classList.contains('opened')) {
        this._lastFocus = document.activeElement;
        this._opened = true;
        this._overlay?.classList.add('opened');
        this._overlay?.setAttribute('aria-hidden','false');
        lockBody();
      }

      const sub = this._errorLayer?.querySelector('.error-sub');
      if (sub && message) sub.textContent = message;
      this._errorLayer?.classList.remove('hidden');
      this._loadingLayer?.classList.add('hidden');
    }

    hideError() {
      this._errorLayer?.classList.add('hidden');
    }

    updateProgress(progress) {
      this._lastProgress = progress;
      const percent = Math.round(progress * 100);
      if (this._progressBar) this._progressBar.style.width = `${percent}%`;
      if (this._progressLabel) this._progressLabel.textContent = `${percent}%`;
    }

    setCamera(orbit) {
      const viewer = this._modelViewer;
      if (!viewer || !this._loaded) return;
      viewer.cameraTarget = 'auto auto auto';
      viewer.cameraOrbit = orbit;
      viewer.fieldOfView = 'auto';
      viewer.jumpCameraToGoal?.();
    }

    resetCamera() {
      const viewer = this._modelViewer;
      if (!viewer || !this._loaded) return;
      viewer.cameraTarget = 'auto auto auto';
      viewer.cameraOrbit = 'auto auto auto';
      viewer.fieldOfView = 'auto';
      viewer.jumpCameraToGoal?.();
    }

    toggleRotate(button) {
      const viewer = this._modelViewer;
      if (!viewer) return;
      this._autoRotate = !this._autoRotate;
      viewer.autoRotate = this._autoRotate;
      button?.classList.toggle('active', this._autoRotate);
    }

    async toggleFullscreen() {
      const target = this._shell;
      if (!target || !supportsFullscreen()) return;

      try {
        if (document.fullscreenElement || document.webkitFullscreenElement) {
          await (document.exitFullscreen?.() || document.webkitExitFullscreen?.());
        } else {
          await (target.requestFullscreen?.() || target.webkitRequestFullscreen?.());
        }
      } catch (error) {
        console.warn('[Evolution3D] Fullscreen:', error);
      }
    }

    flashHint() {
      if (!this._hint) return;
      this._hint.classList.add('show');
      clearTimeout(this._hintTimer);
      this._hintTimer = setTimeout(() => this._hint?.classList.remove('show'), 2100);
    }

    _onKeydown(event) {
      if (!this._opened) return;
      if (event.key === 'Escape' && !(document.fullscreenElement || document.webkitFullscreenElement)) {
        event.preventDefault();
        this.close();
      }
    }
  }

  if (!customElements.get('evolution-3d')) {
    customElements.define('evolution-3d', Evolution3D);
  }

  /* ------------------------------------------------------------
     AUTO ENHANCER
     Turns any element with data-evolution-model into the viewer.
     Example:
       <div data-evolution-model="/models/casa.glb"
            data-title="Casa JP-04"
            data-poster="/renders/casa.webp"></div>
  ------------------------------------------------------------ */
  function enhanceElement(element) {
    if (!element || element.dataset.evolution3dEnhanced === '1') return;
    const src = element.dataset.evolutionModel;
    if (!src) return;

    const viewer = document.createElement('evolution-3d');
    viewer.setAttribute('src', src);

    if (element.dataset.poster) viewer.setAttribute('poster', element.dataset.poster);
    if (element.dataset.title) viewer.setAttribute('title', element.dataset.title);
    if (element.dataset.subtitle) viewer.setAttribute('subtitle', element.dataset.subtitle);
    if (element.dataset.iosSrc) viewer.setAttribute('ios-src', element.dataset.iosSrc);
    if (element.dataset.download) viewer.setAttribute('download', element.dataset.download);

    element.dataset.evolution3dEnhanced = '1';
    element.replaceChildren(viewer);
  }

  function scan(root = document) {
    root.querySelectorAll?.('[data-evolution-model]').forEach(enhanceElement);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => scan(), {once:true});
  } else {
    scan();
  }

  const observer = new MutationObserver(records => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches?.('[data-evolution-model]')) enhanceElement(node);
        scan(node);
      }
    }
  });

  observer.observe(document.documentElement, {childList:true,subtree:true});

  /* Public API:
       Evolution3D.open({src,title,poster,iosSrc,download})
       Evolution3D.scan()
  */
  window.Evolution3D = Object.freeze({
    version: VERSION,
    ensureEngine,
    scan,
    open(options = {}) {
      const host = document.createElement('evolution-3d');

      if (options.src) host.setAttribute('src', options.src);
      if (options.poster) host.setAttribute('poster', options.poster);
      if (options.title) host.setAttribute('title', options.title);
      if (options.subtitle) host.setAttribute('subtitle', options.subtitle);
      if (options.iosSrc) host.setAttribute('ios-src', options.iosSrc);
      if (options.download) host.setAttribute('download', options.download);

      host.style.display = 'none';
      document.body.appendChild(host);

      requestAnimationFrame(() => {
        host.open();
        host.addEventListener('evolution3d:closed', () => {
          setTimeout(() => host.remove(), 500);
        }, {once:true});
      });

      return host;
    }
  });

})();
