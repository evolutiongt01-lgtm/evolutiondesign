/* ============================================================
   EVOLUTION DESIGN · PAYMENTS BRIDGE · V21
   Centralized PayPal SDK loader for App Shell views.
   - Does NOT create/capture orders.
   - Does NOT contain PayPal secret.
   - Server-side payment verification remains in Evolution Worker.
   ============================================================ */
(() => {
  'use strict';

  if (window.EvolutionPayments?.version) return;

  const VERSION = '21';
  const WORKER =
    String(
      window.EVOLUTION_PAYMENTS_WORKER_URL ||
      'https://evolution-design-backend.evolutiongt01.workers.dev'
    ).replace(/\/+$/, '');

  const PAYPAL_BASE = 'https://www.paypal.com/sdk/js';
  const DEFAULT_OPTIONS = Object.freeze({
    currency: 'USD',
    intent: 'capture',
    components: 'buttons,funding-eligibility'
  });

  let paypalPromise = null;
  let configPromise = null;
  let lastError = null;
  let architectureWrapped = false;

  const emit = (name, detail = {}) => {
    try {
      window.dispatchEvent(new CustomEvent(name, {
        detail: { version: VERSION, ...detail }
      }));
    } catch (_) {}
  };

  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

  const paypalReady = () =>
    Boolean(window.paypal && typeof window.paypal.Buttons === 'function');

  async function fetchConfig() {
    if (configPromise) return configPromise;

    configPromise = (async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 9000);

      try {
        const response = await fetch(`${WORKER}/paypal/config`, {
          method: 'GET',
          headers: { accept: 'application/json' },
          cache: 'no-store',
          credentials: 'omit',
          signal: controller.signal
        });

        const body = await response.json().catch(() => ({}));

        if (!response.ok || body?.ok === false || !body?.clientId) {
          throw new Error(
            body?.error ||
            'PayPal todavía no está disponible.'
          );
        }

        return {
          clientId: String(body.clientId).trim()
        };
      } finally {
        clearTimeout(timeout);
      }
    })().catch(error => {
      configPromise = null;
      throw error;
    });

    return configPromise;
  }

  function buildSDKURL(clientId, options = {}) {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const url = new URL(PAYPAL_BASE);

    url.searchParams.set('client-id', clientId);
    url.searchParams.set('currency', String(opts.currency || 'USD').toUpperCase());
    url.searchParams.set('intent', String(opts.intent || 'capture'));
    url.searchParams.set(
      'components',
      String(opts.components || 'buttons,funding-eligibility')
    );

    if (opts.locale) {
      url.searchParams.set('locale', String(opts.locale));
    }

    return url.href;
  }

  async function waitForExistingSDK(script, timeoutMs = 4200) {
    if (paypalReady()) return window.paypal;
    if (!script) return null;

    const started = Date.now();

    while (Date.now() - started < timeoutMs) {
      if (paypalReady()) return window.paypal;
      await delay(90);
    }

    return null;
  }

  async function loadSDK(options = {}) {
    if (paypalReady()) return window.paypal;
    if (paypalPromise) return paypalPromise;

    paypalPromise = (async () => {
      emit('evolution:payments-loading');

      /*
        A view such as Diseño Web may already contain a PayPal SDK tag.
        Give it a short chance to finish before creating another one.
      */
      const existing = Array.from(
        document.querySelectorAll('script[src*="paypal.com/sdk/js"]')
      ).find(script => script.dataset.evolutionPayPalFailed !== '1');

      if (existing) {
        const paypal = await waitForExistingSDK(existing);
        if (paypalReady()) {
          emit('evolution:payments-ready', { source: 'existing-sdk' });
          return paypal;
        }

        /*
          Existing tag did not produce window.paypal. Mark it and load a
          clean SDK using the current client id supplied by the Worker.
        */
        existing.dataset.evolutionPayPalFailed = '1';
      }

      const { clientId } = await fetchConfig();
      const sdkURL = buildSDKURL(clientId, options);

      const staleCentral = document.querySelector(
        'script[data-evolution-paypal-sdk="central"]'
      );

      if (staleCentral && !paypalReady()) {
        staleCentral.remove();
      }

      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        let settled = false;

        const done = callback => value => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          callback(value);
        };

        const timer = setTimeout(
          done(() => reject(new Error('PayPal tardó demasiado en responder.'))),
          15000
        );

        script.src = sdkURL;
        script.async = true;
        script.defer = true;
        script.dataset.evolutionPaypalSdk = 'central';
        script.dataset.evolutionPaypalVersion = VERSION;

        script.onload = done(() => {
          if (paypalReady()) resolve();
          else reject(new Error('PayPal cargó, pero el componente Buttons no está disponible.'));
        });

        script.onerror = done(() => {
          script.dataset.evolutionPayPalFailed = '1';
          reject(new Error('No se pudo descargar el SDK seguro de PayPal.'));
        });

        document.head.appendChild(script);
      });

      if (!paypalReady()) {
        throw new Error('PayPal no terminó de inicializarse.');
      }

      emit('evolution:payments-ready', { source: 'central-sdk' });
      return window.paypal;
    })().catch(error => {
      lastError = error;
      paypalPromise = null;
      emit('evolution:payments-error', {
        message: error?.message || 'No se pudo iniciar PayPal.'
      });
      throw error;
    });

    return paypalPromise;
  }

  async function ensurePayPal(options = {}) {
    if (paypalReady()) return window.paypal;
    return loadSDK(options);
  }

  function paymentStatus(selector, message, type = 'error') {
    try {
      if (
        typeof window.mostrarEstadoPagoInline === 'function' &&
        selector
      ) {
        window.mostrarEstadoPagoInline(selector, message, type);
        return;
      }
    } catch (_) {}

    console[type === 'error' ? 'error' : 'info'](
      '[EvolutionPayments]',
      message
    );
  }

  /*
    Arquitectura already owns the secure create-order / capture-order
    callbacks. We only make sure the PayPal browser SDK is ready BEFORE
    those existing functions render their buttons.
  */
  function wrapArchitectureEntrypoints() {
    if (architectureWrapped) return;

    const names = [
      'renderizarPayPal3D',
      'renderizarPayPal2D',
      'renderizarPayPalFachada'
    ];

    let wrappedAny = false;

    names.forEach(name => {
      const original = window[name];

      if (
        typeof original !== 'function' ||
        original.__evolutionPaymentsWrapped
      ) {
        return;
      }

      const wrapped = async function(...args) {
        const selector = args[1] || '';

        try {
          paymentStatus(
            selector,
            'Preparando pago seguro con PayPal…',
            'info'
          );

          await ensurePayPal();

          return await original.apply(this, args);
        } catch (error) {
          console.error('[EvolutionPayments] PayPal:', error);

          paymentStatus(
            selector,
            error?.message ||
              'No se pudo cargar PayPal. Revisa tu conexión e inténtalo nuevamente.',
            'error'
          );
        }
      };

      wrapped.__evolutionPaymentsWrapped = true;
      wrapped.__evolutionPaymentsOriginal = original;
      window[name] = wrapped;
      wrappedAny = true;
    });

    if (wrappedAny) {
      architectureWrapped = true;
      emit('evolution:payments-architecture-guard-ready');
    }
  }

  function installIntentPreload() {
    const selector = [
      '[data-web-pay="paypal"]',
      '[data-web-pay="card"]',
      '[data-pay-method="paypal"]',
      '[data-pay-method="card"]',
      '[data-method="paypal"]',
      '[data-payment="paypal"]',
      '[id^="btnProceder"]',
      '[id*="paypal"]'
    ].join(',');

    const preload = event => {
      const element = event.target instanceof Element
        ? event.target.closest(selector)
        : null;

      if (!element) return;

      ensurePayPal().catch(() => {});
    };

    document.addEventListener('pointerover', preload, {
      passive: true,
      capture: true
    });

    document.addEventListener('pointerdown', preload, {
      passive: true,
      capture: true
    });

    document.addEventListener('focusin', preload, true);
  }

  function routeName() {
    const path = location.pathname.toLowerCase();

    if (path.includes('arquitectura')) return 'arquitectura';
    if (path.includes('diseno-grafico')) return 'grafico';
    if (path.includes('diseno-web')) return 'web';

    return 'other';
  }

  function boot() {
    installIntentPreload();

    const route = routeName();

    /*
      Arquitectura renders PayPal immediately after the client presses
      "Proceder". Preload there so the SDK is normally ready beforehand.
    */
    if (route === 'arquitectura') {
      wrapArchitectureEntrypoints();

      ensurePayPal().catch(error => {
        console.warn(
          '[EvolutionPayments] Precarga PayPal:',
          error?.message || error
        );
      });

      /*
        The App Shell injects this bridge after the view load event.
        Functions should already exist, but retry briefly in case browser
        scheduling delayed the final inline script.
      */
      let tries = 0;
      const retry = setInterval(() => {
        wrapArchitectureEntrypoints();
        if (architectureWrapped || ++tries >= 20) {
          clearInterval(retry);
        }
      }, 150);
    }
  }

  window.EvolutionPayments = Object.freeze({
    version: VERSION,
    worker: WORKER,
    ensurePayPal,
    preloadPayPal: ensurePayPal,
    wrapArchitectureEntrypoints,
    get ready() {
      return paypalReady();
    },
    get lastError() {
      return lastError;
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
