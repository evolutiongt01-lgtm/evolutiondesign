const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const { getStorage } = require('firebase-admin/storage');
const crypto = require('crypto');

admin.initializeApp();
const db = admin.firestore();
const bucket = getStorage().bucket();

const PAYPAL_CLIENT_ID = defineSecret('PAYPAL_CLIENT_ID');
const PAYPAL_CLIENT_SECRET = defineSecret('PAYPAL_CLIENT_SECRET');
const PAYPAL_BASE_URL = 'https://api-m.paypal.com'; // Producción. Para sandbox: https://api-m.sandbox.paypal.com
const REGION = 'us-central1';

const PAYPAL_SUPPORTED_CURRENCIES = new Set([
  'AUD','BRL','CAD','CNY','CZK','DKK','EUR','HKD','HUF','ILS','JPY','MYR','MXN','TWD','NZD','NOK','PHP','PLN','GBP','SGD','SEK','CHF','THB','USD'
]);
const ZERO_DECIMAL = new Set(['JPY','HUF','TWD']);

function paypalRequestId(prefix = 'evo') {
  // UUID = formato seguro y corto para idempotencia de PayPal.
  return `${safeText(prefix, 12)}-${crypto.randomUUID()}`.slice(0, 108);
}

// Respaldo únicamente si la consulta de cambio temporal falla.
const FX_FALLBACK = {
  USD: 1,
  EUR: 0.92,
  MXN: 18.50,
  CNY: 7.25,
  BRL: 5.40,
  JPY: 155,
  GBP: 0.78,
  CAD: 1.37,
  CHF: 0.88,
  AUD: 1.52
};

function requireAuth(request) {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'Debes iniciar sesión antes de pagar.');
  }
  return request.auth;
}

function num(value, name, min = 0.01, max = 100000) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new HttpsError('invalid-argument', `${name} no es válido.`);
  }
  return n;
}

function integer(value, name, min = 1, max = 4) {
  const n = Number.parseInt(value, 10);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new HttpsError('invalid-argument', `${name} no es válido.`);
  }
  return n;
}

function safeText(value, max = 160) {
  return String(value || '').trim().slice(0, max);
}

function countryName(code) {
  if (!code) return 'No reportado';
  try {
    const dn = new Intl.DisplayNames(['es'], { type: 'region' });
    return dn.of(String(code).toUpperCase()) || String(code).toUpperCase();
  } catch (_) {
    return String(code).toUpperCase();
  }
}

function normalizeComplexity(value) {
  const n = Number(value);
  if (Math.abs(n - 1.0) < 0.001) return { code: 'estandar', label: 'Estándar', multiplier: 1.0 };
  if (Math.abs(n - 1.3) < 0.001) return { code: 'profesional', label: 'Profesional', multiplier: 1.3 };
  if (Math.abs(n - 1.6) < 0.001) return { code: 'premium', label: 'Premium', multiplier: 1.6 };
  throw new HttpsError('invalid-argument', 'Nivel de complejidad no válido.');
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function buildQuote(type, input = {}) {
  if (type === 'Planos 2D') {
    const width = num(input.width, 'Ancho');
    const length = num(input.length, 'Largo');
    const levels = integer(input.levels, 'Niveles');
    const packageCode = input.packageCode === 'premium' ? 'premium' : 'basico';
    const area = width * length * levels;
    const premium = packageCode === 'premium';
    const base = premium ? 800 : 390;
    const extraRate = premium ? 2.00 : 1.10;
    const baseUsd = roundMoney(base + Math.max(area - 400, 0) * extraRate);

    return {
      baseUsd,
      category: 'Planos 2D',
      packageCode,
      packageName: premium ? 'Paquete Planos 2D - Premium' : 'Paquete Planos 2D - Básico',
      shortPackageName: premium ? 'Premium 2D' : 'Básico 2D',
      specs: [
        { label: 'Terreno', value: `${width} × ${length} m` },
        { label: 'Niveles', value: `${levels}` },
        { label: 'Área total', value: `${area.toFixed(2)} m²` }
      ],
      uploadTitle: 'Archivos requeridos',
      uploadCopy: 'Sube directamente tu archivo AutoCAD (DWG/DWF), PDF de medidas o una imagen clara de tu dibujo/plano desde esta página.',
      uploadFormats: 'Carga privada en Firebase · Máx. 100 MB por archivo',
      includedHighlights: premium ? [
        'Arquitectura minimalista contemporánea de alta gama',
        'Plano Arquitectónico Amueblado y Acotado por nivel',
        '2 cortes longitudinales y 2 transversales',
        'Fachadas de los 4 lados',
        'Cimentación con detalles constructivos',
        'Columnas, cadenas y armados',
        'Losas / entrepiso y techo',
        'Planos hidráulico, drenajes y eléctrico completos',
        'Acabados, puertas y ventanas',
        'Entrega PDF / CAD lista para trámites y obra'
      ] : [
        'Estilo minimalista contemporáneo',
        'Plano Arquitectónico Amueblado por nivel',
        'Plano Acotado para albañilería',
        '1 corte longitudinal y 1 transversal',
        'Fachadas de los 4 lados',
        'Entrega PDF / CAD lista para obra e impresión'
      ],
      pricingInput: { width, length, levels, packageCode }
    };
  }

  if (type === 'Visualización 3D') {
    const width = num(input.width, 'Ancho');
    const length = num(input.length, 'Largo');
    const levels = integer(input.levels, 'Niveles');
    const serviceCode = ['basico','profesional','premium','cuantificacion'].includes(input.serviceCode) ? input.serviceCode : 'basico';
    const area = width * length * levels;
    let baseUsd = 0;
    if (serviceCode === 'basico') baseUsd = 300 + Math.max(area - 400, 0) * 3;
    if (serviceCode === 'profesional') baseUsd = 499 + Math.max(area - 400, 0) * 3;
    if (serviceCode === 'premium') baseUsd = 949 + Math.max(area - 400, 0) * 3;
    if (serviceCode === 'cuantificacion') baseUsd = area * 1.75;
    baseUsd = roundMoney(baseUsd);

    const configs = {
      basico: {
        category: 'Visualización 3D', packageName: 'Paquete 3D - Básico', shortPackageName: 'Básico 3D',
        uploadCopy: 'Sube directamente tu archivo 2D en PDF, AutoCAD DWG/DWF o una imagen clara de tu plano.',
        includedHighlights: ['Modelado 3D profesional','8 renders realistas','Fachada incluida','Resolución HD','Materiales e iluminación básicos','1 revisión incluida']
      },
      profesional: {
        category: 'Visualización 3D', packageName: 'Paquete 3D - Profesional', shortPackageName: 'Profesional 3D',
        uploadCopy: 'Sube tu archivo 2D (PDF, DWG/DWF o foto clara del plano) y fotografías de referencia del lugar para trabajar el hiperrealismo.',
        includedHighlights: ['Modelado 3D completo','16 renders realistas','Fachada frontal y posterior','3 videos realistas de 8 segundos','Entrega en alta resolución','2 revisiones incluidas']
      },
      premium: {
        category: 'Visualización 3D', packageName: 'Paquete 3D - Premium', shortPackageName: 'Premium 3D',
        uploadCopy: 'Sube tu archivo 2D (PDF, DWG/DWF o foto clara del plano) y fotografías de referencia del lugar para el nivel de hiperrealismo Premium.',
        includedHighlights: ['Modelado 3D completo','26 renders realistas','Recorrido virtual de 1 min 44 s (13 clips de 8 s)','Plano amueblado','Iluminación avanzada','Diseño de paisaje conceptual','Resolución 4K','3 revisiones incluidas']
      },
      cuantificacion: {
        category: 'Cuantificación de Materiales', packageName: 'Cuantificación de Materiales', shortPackageName: 'Cuantificación',
        uploadCopy: 'Sube los planos, medidas o archivos de referencia necesarios para calcular las cantidades de materiales de tu obra.',
        includedHighlights: ['Listado exacto de materiales','Obra gris: cemento, arena, grava, block y ladrillo','Hierro para construcción, losa y lámina','Acabados: piso, repello, puertas, ventanas y pintura']
      }
    };
    const cfg = configs[serviceCode];
    return {
      baseUsd,
      ...cfg,
      packageCode: serviceCode,
      specs: [
        { label: 'Terreno', value: `${width} × ${length} m` },
        { label: 'Niveles', value: `${levels}` },
        { label: 'Área total', value: `${area.toFixed(2)} m²` }
      ],
      uploadTitle: 'Archivos requeridos',
      uploadFormats: 'Carga privada en Firebase · Máx. 100 MB por archivo',
      pricingInput: { width, length, levels, serviceCode }
    };
  }

  if (type === 'Diseño de Fachada') {
    const width = num(input.width, 'Ancho');
    const height = num(input.height, 'Altura');
    const levels = integer(input.levels, 'Niveles');
    const kind = ['Vivienda','Comercio','Edificio'].includes(input.projectKind) ? input.projectKind : 'Vivienda';
    const complexity = normalizeComplexity(input.complexity);
    const renderOn = Boolean(input.renderOn);
    const area = width * height;
    let subtotal = area * 1.50 * complexity.multiplier;
    if (subtotal < 80) subtotal = 80;
    const extraLevel = levels === 3 ? 25 : (levels === 4 ? 30 : 0);
    const renderCost = renderOn ? 40 : 0;
    const baseUsd = roundMoney(subtotal + extraLevel + renderCost);

    return {
      baseUsd,
      category: 'Diseño de Fachada',
      packageCode: complexity.code,
      packageName: `Diseño de Fachada - ${complexity.label}`,
      shortPackageName: complexity.label,
      specs: [
        { label: 'Fachada', value: `${width} × ${height} m` },
        { label: 'Niveles', value: levels === 4 ? '4+' : `${levels}` },
        { label: 'Proyecto', value: kind },
        { label: 'Área', value: `${area.toFixed(2)} m²` },
        { label: 'Renders', value: renderOn ? '3 hiperrealistas' : 'No incluidos' }
      ],
      uploadTitle: 'Archivos y referencias requeridos',
      uploadCopy: renderOn
        ? 'Sube una foto clara de la fachada o terreno y sus medidas. Puedes incluir un dibujo de tu idea y fotografías claras del lugar para los renders hiperrealistas.'
        : 'Sube una foto clara de tu fachada actual o terreno y sus medidas. Opcionalmente puedes incluir un dibujo a mano alzada de tu idea.',
      uploadFormats: 'Carga privada en Firebase · Máx. 100 MB por archivo',
      includedHighlights: [
        `Nivel de diseño ${complexity.label}`,
        '3 propuestas distintas de fachada',
        'Diseño estético y funcional con selección de materiales',
        ...(renderOn ? ['3 renders hiperrealistas de la propuesta elegida'] : [])
      ],
      pricingInput: { width, height, levels, projectKind: kind, complexity: complexity.multiplier, renderOn }
    };
  }

  throw new HttpsError('invalid-argument', 'Tipo de proyecto no reconocido.');
}

async function getFxRate(currency) {
  if (currency === 'USD') return 1;
  try {
    const response = await fetch(`https://api.frankfurter.app/latest?from=USD&to=${encodeURIComponent(currency)}`, {
      headers: { 'User-Agent': 'EvolutionDesign/1.0' }
    });
    if (response.ok) {
      const json = await response.json();
      const rate = Number(json?.rates?.[currency]);
      if (Number.isFinite(rate) && rate > 0) return rate;
    }
  } catch (_) {}
  const fallback = FX_FALLBACK[currency];
  if (fallback) return fallback;
  throw new HttpsError('unavailable', 'No se pudo obtener la tasa de cambio para esta moneda.');
}

function formatCheckoutAmount(baseUsd, currency, rate) {
  const converted = baseUsd * rate;
  return ZERO_DECIMAL.has(currency) ? String(Math.round(converted)) : converted.toFixed(2);
}

async function getPayPalAccessToken() {
  const clientId = PAYPAL_CLIENT_ID.value();
  const secret = PAYPAL_CLIENT_SECRET.value();
  if (!clientId || !secret) throw new HttpsError('failed-precondition', 'PayPal no está configurado en el servidor.');

  const auth = Buffer.from(`${clientId}:${secret}`).toString('base64');
  const response = await fetch(`${PAYPAL_BASE_URL}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });
  const json = await response.json();
  if (!response.ok || !json.access_token) {
    console.error('PayPal token error', response.status, json);
    const detail = json?.error_description || json?.error || 'Credenciales LIVE de PayPal rechazadas.';
    throw new HttpsError('failed-precondition', `PayPal no pudo autenticar el servidor: ${safeText(detail, 220)}`, { paypalStatus: response.status });
  }
  return json.access_token;
}

async function paypalRequest(path, options = {}) {
  const token = await getPayPalAccessToken();
  const response = await fetch(`${PAYPAL_BASE_URL}${path}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...(options.headers || {})
    }
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error('PayPal API error', path, response.status, json);
    const first = Array.isArray(json?.details) && json.details.length ? json.details[0] : null;
    const detail = first?.description || json?.message || first?.issue || json?.name || 'PayPal rechazó la operación.';
    throw new HttpsError('failed-precondition', `PayPal rechazó la operación: ${safeText(detail, 260)}`, {
      paypalStatus: response.status,
      paypalName: safeText(json?.name, 80),
      paypalIssue: safeText(first?.issue, 120),
      debugId: safeText(json?.debug_id, 120)
    });
  }
  return json;
}


const MAX_CLIENT_FILE_BYTES = 100 * 1024 * 1024;
const MAX_DELIVERY_FILE_BYTES = 500 * 1024 * 1024;
const MAX_CLIENT_FILES = 15;

function sanitizeGeo(raw) {
  raw = raw && typeof raw === 'object' ? raw : {};
  return {
    city: safeText(raw.city, 100),
    region: safeText(raw.region, 120),
    country: safeText(raw.country, 120),
    countryCode: safeText(raw.countryCode, 2).toUpperCase(),
    currency: safeText(raw.currency, 3).toUpperCase()
  };
}

function projectAdminKey(ownerUid, projectId) {
  return `${safeText(ownerUid,128)}__${safeText(projectId,128)}`;
}

async function requireAdmin(request) {
  const auth = requireAuth(request);
  const email = String(auth.token?.email || '').toLowerCase();
  const bootstrap = auth.token?.email_verified === true && ['evolutiongt01@gmail.com','tepaz2025@gmail.com'].includes(email);
  if (bootstrap || auth.token?.admin === true) return auth;
  const snap = await db.doc(`admins/${auth.uid}`).get();
  if (!snap.exists || snap.data()?.active === false) {
    throw new HttpsError('permission-denied', 'No tienes permisos de administrador.');
  }
  return auth;
}

function serializeFirestore(value) {
  if (value == null) return value;
  if (value instanceof admin.firestore.Timestamp) return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(serializeFirestore);
  if (typeof value === 'object') {
    const out = {};
    for (const [k,v] of Object.entries(value)) out[k] = serializeFirestore(v);
    return out;
  }
  return value;
}

async function updateClientSummary(uid, data, baseUsd, now) {
  const userRef = db.doc(`users/${uid}`);
  const update = {
    uid,
    email: safeText(data.email, 254),
    displayName: safeText(data.displayName, 120),
    photoURL: safeText(data.photoURL, 1000),
    payerCountry: safeText(data.payerCountry, 120),
    payerCountryCode: safeText(data.payerCountryCode, 2).toUpperCase(),
    lastGeo: sanitizeGeo(data.lastGeo),
    lastPurchaseAt: now,
    lastSeenAt: now,
    updatedAt: now,
    totalSpentUsd: admin.firestore.FieldValue.increment(Number(baseUsd || 0)),
    orderCount: admin.firestore.FieldValue.increment(1)
  };
  const snap = await userRef.get();
  if (!snap.exists) update.createdAt = now;
  await userRef.set(update, { merge: true });
}

async function createPayPalOrderRecord({auth, type, quote, requestedCurrency, clientGeo, customProjectId=''}) {
  const requested = safeText(requestedCurrency || 'USD', 3).toUpperCase();
  const currency = PAYPAL_SUPPORTED_CURRENCIES.has(requested) ? requested : 'USD';
  const rate = await getFxRate(currency);
  const amount = formatCheckoutAmount(quote.baseUsd, currency, rate);
  const order = await paypalRequest('/v2/checkout/orders', {
    method: 'POST',
    headers: { 'PayPal-Request-Id': paypalRequestId('create'), 'Prefer': 'return=representation' },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [{
        reference_id: 'EVOLUTION_DESIGN',
        custom_id: auth.uid.slice(0, 36),
        description: safeText(quote.packageName || type, 127),
        amount: { currency_code: currency, value: amount }
      }],
      application_context: { brand_name:'Evolution Design', shipping_preference:'NO_SHIPPING', user_action:'PAY_NOW' }
    })
  });
  await db.collection('paypalOrders').doc(order.id).set({
    ownerUid: auth.uid,
    ownerEmail: safeText(auth.token?.email, 254),
    type,
    quote,
    baseUsd: quote.baseUsd,
    checkoutAmount: amount,
    checkoutCurrency: currency,
    fxRate: rate,
    clientGeo: sanitizeGeo(clientGeo),
    customProjectId: safeText(customProjectId, 128),
    status: 'CREATED',
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });
  return { orderId: order.id, amount, currency, baseUsd: quote.baseUsd };
}

exports.getPayPalPublicConfig = onCall({ region: REGION, secrets: [PAYPAL_CLIENT_ID] }, async (request) => {
  requireAuth(request);
  const clientId = String(PAYPAL_CLIENT_ID.value() || '').trim();
  if (!clientId) throw new HttpsError('failed-precondition', 'Falta configurar PAYPAL_CLIENT_ID en Firebase Secret Manager.');
  return { clientId, environment: PAYPAL_BASE_URL.includes('sandbox') ? 'sandbox' : 'live' };
});

exports.syncClientProfile = onCall({ region: REGION }, async (request) => {
  const auth = requireAuth(request);
  const ref = db.doc(`users/${auth.uid}`);
  const now = admin.firestore.Timestamp.now();
  const snap = await ref.get();
  const update = {
    uid: auth.uid,
    email: safeText(auth.token?.email, 254),
    displayName: safeText(auth.token?.name, 120),
    photoURL: safeText(auth.token?.picture, 1000),
    lastGeo: sanitizeGeo(request.data?.geo),
    lastSeenAt: now,
    updatedAt: now
  };
  if (!snap.exists) update.createdAt = now;
  await ref.set(update, { merge:true });
  return { ok:true };
});

exports.createPayPalOrder = onCall({ region: REGION, secrets: [PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET] }, async (request) => {
  const auth = requireAuth(request);
  const data = request.data || {};
  const type = safeText(data.type, 60);
  const quote = buildQuote(type, data.projectInput || {});
  return createPayPalOrderRecord({ auth, type, quote, requestedCurrency:data.requestedCurrency, clientGeo:data.clientGeo });
});

exports.createCustomPayPalOrder = onCall({ region: REGION, secrets: [PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET] }, async (request) => {
  const auth = requireAuth(request);
  const projectId = safeText(request.data?.projectId, 128);
  if (!projectId) throw new HttpsError('invalid-argument', 'Falta la orden personalizada.');
  const ref = db.doc(`users/${auth.uid}/projects/${projectId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'La orden personalizada no existe.');
  const project = snap.data();
  if (project.customOrder !== true || project.paymentStatus !== 'pending') {
    throw new HttpsError('failed-precondition', 'Esta orden ya no está pendiente de pago.');
  }
  const quote = { ...(project.projectConfig || {}), baseUsd:Number(project.baseUsd || 0), packageName:project.projectTitle || 'Orden personalizada' };
  if (!(quote.baseUsd > 0)) throw new HttpsError('failed-precondition', 'La orden no tiene un importe válido.');
  return createPayPalOrderRecord({ auth, type:'Orden Personalizada', quote, requestedCurrency:request.data?.requestedCurrency, clientGeo:request.data?.clientGeo, customProjectId:projectId });
});

exports.capturePayPalOrder = onCall({ region: REGION, secrets: [PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET] }, async (request) => {
  const auth = requireAuth(request);
  const orderId = safeText(request.data?.orderId, 64);
  if (!orderId) throw new HttpsError('invalid-argument', 'Falta el ID de la orden.');
  const pendingRef = db.collection('paypalOrders').doc(orderId);
  const pendingSnap = await pendingRef.get();
  if (!pendingSnap.exists) throw new HttpsError('not-found', 'La orden no existe o expiró.');
  const pending = pendingSnap.data();
  if (pending.ownerUid !== auth.uid) throw new HttpsError('permission-denied', 'Esta orden no pertenece a tu cuenta.');
  if (pending.projectId && pending.status === 'COMPLETED') return { projectId:pending.projectId, alreadyCaptured:true };

  const details = await paypalRequest(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
    method:'POST', headers:{ 'PayPal-Request-Id':paypalRequestId('capture'), 'Prefer':'return=representation' }, body:'{}'
  });
  if (details.status !== 'COMPLETED') throw new HttpsError('failed-precondition', `PayPal reportó estado ${details.status || 'desconocido'}.`);
  const unit = details.purchase_units?.[0] || {};
  const capture = unit.payments?.captures?.[0] || {};
  if (!capture.id || capture.status !== 'COMPLETED') throw new HttpsError('failed-precondition', 'PayPal no confirmó la captura del pago.');
  const capturedAmount = String(capture.amount?.value || '');
  const capturedCurrency = String(capture.amount?.currency_code || '').toUpperCase();
  if (capturedAmount !== String(pending.checkoutAmount) || capturedCurrency !== String(pending.checkoutCurrency)) {
    throw new HttpsError('data-loss', 'El importe capturado no coincide con la cotización del servidor.');
  }

  const payer = details.payer || {};
  const source = details.payment_source || {};
  const fullName = [payer.name?.given_name, payer.name?.surname].filter(Boolean).join(' ').trim();
  const countryCode = payer.address?.country_code || source.card?.billing_address?.country_code || source.paypal?.address?.country_code || unit.shipping?.address?.country_code || '';
  const paymentMethod = source.card ? 'Tarjeta vía PayPal' : (source.paypal ? 'PayPal' : 'PayPal Checkout');
  const now = admin.firestore.Timestamp.now();
  const displayOrderId = `#EVO-${String(capture.id).replace(/[^A-Za-z0-9]/g,'').slice(-8).toUpperCase()}`;
  const commonPayment = {
    payerName: fullName || safeText(auth.token?.name,120) || safeText(payer.email_address,120) || 'Cliente PayPal',
    ownerEmail: safeText(auth.token?.email || payer.email_address,254),
    transactionId:capture.id,
    payerCountry:countryName(countryCode), payerCountryCode:countryCode,
    paymentMethod, amount:capturedAmount, currency:capturedCurrency,
    baseUsd:Number(pending.baseUsd || 0), fxRate:Number(pending.fxRate || 1),
    orderId:details.id || orderId, displayOrderId,
    paymentStatus:'paid',
    paidAt:capture.create_time ? admin.firestore.Timestamp.fromDate(new Date(capture.create_time)) : now,
    updatedAt:now
  };

  let projectId = safeText(pending.customProjectId,128);
  if (projectId) {
    const projectRef = db.doc(`users/${auth.uid}/projects/${projectId}`);
    const projectSnap = await projectRef.get();
    if (!projectSnap.exists) throw new HttpsError('not-found','La orden personalizada ya no existe.');
    await projectRef.set({ ...commonPayment, status:'waiting_files' }, { merge:true });
  } else {
    projectId = capture.id;
    const quote = pending.quote || {};
    const projectRef = db.doc(`users/${auth.uid}/projects/${projectId}`);
    await projectRef.set({
      ownerUid:auth.uid,
      ...commonPayment,
      projectType:quote.category || pending.type,
      projectTitle:quote.packageName || pending.type,
      projectConfig:quote,
      source:'catalog', customOrder:false,
      status:'waiting_files', architectName:'Pendiente',
      clientFileCount:0, deliveryFileCount:0,
      clientComments:'', deliveryNote:'',
      createdAt:now
    }, { merge:true });
  }

  await updateClientSummary(auth.uid, {
    email:auth.token?.email || payer.email_address,
    displayName:fullName || auth.token?.name,
    photoURL:auth.token?.picture,
    payerCountry:countryName(countryCode), payerCountryCode:countryCode,
    lastGeo:pending.clientGeo
  }, pending.baseUsd, now);
  await pendingRef.set({ status:'COMPLETED', projectId, captureId:capture.id, completedAt:now }, { merge:true });
  return { projectId, displayOrderId, status:'COMPLETED' };
});

function addBusinessDays(date, days) {
  const result = new Date(date); let added=0;
  while (added < days) { result.setUTCDate(result.getUTCDate()+1); const d=result.getUTCDay(); if (d!==0 && d!==6) added++; }
  return result;
}

function assertStoragePath(path, ownerUid, projectId, role, fileId) {
  const prefix = `projects/${ownerUid}/${projectId}/${role}/${fileId}/`;
  if (!path || !path.startsWith(prefix)) throw new HttpsError('invalid-argument','Ruta de archivo no válida.');
}

async function verifyStoredObject(path, maxBytes) {
  const file = bucket.file(path);
  const [exists] = await file.exists();
  if (!exists) throw new HttpsError('not-found','El archivo no existe en Firebase Storage.');
  const [meta] = await file.getMetadata();
  const size = Number(meta.size || 0);
  if (!size || size > maxBytes) {
    await file.delete({ ignoreNotFound:true }).catch(()=>{});
    throw new HttpsError('invalid-argument',`El archivo supera el tamaño permitido (${Math.round(maxBytes/1024/1024)} MB).`);
  }
  return { file, meta, size };
}

exports.registerClientFile = onCall({ region:REGION }, async (request) => {
  const auth = requireAuth(request);
  const projectId=safeText(request.data?.projectId,128), fileId=safeText(request.data?.fileId,128), storagePath=safeText(request.data?.storagePath,1200);
  if (!projectId || !fileId || !storagePath) throw new HttpsError('invalid-argument','Faltan datos del archivo.');
  const projectRef=db.doc(`users/${auth.uid}/projects/${projectId}`), projectSnap=await projectRef.get();
  if (!projectSnap.exists) throw new HttpsError('not-found','Proyecto no encontrado.');
  if (projectSnap.data()?.paymentStatus !== 'paid') throw new HttpsError('failed-precondition','Completa el pago antes de subir archivos.');
  assertStoragePath(storagePath,auth.uid,projectId,'client',fileId);
  const fileRef=projectRef.collection('clientFiles').doc(fileId), existing=await fileRef.get();
  if (!existing.exists) {
    const activeSnap=await projectRef.collection('clientFiles').where('availability','==','active').limit(MAX_CLIENT_FILES+1).get();
    if (activeSnap.size >= MAX_CLIENT_FILES) {
      await bucket.file(storagePath).delete({ignoreNotFound:true}).catch(()=>{});
      throw new HttpsError('resource-exhausted',`Máximo ${MAX_CLIENT_FILES} archivos activos por proyecto.`);
    }
  }
  const verified=await verifyStoredObject(storagePath,MAX_CLIENT_FILE_BYTES), now=admin.firestore.Timestamp.now();
  await db.runTransaction(async tx=>{
    tx.set(fileRef,{ id:fileId, name:safeText(request.data?.name || verified.meta.name?.split('/').pop(),240), storagePath, size:verified.size, contentType:safeText(verified.meta.contentType || request.data?.contentType,120), availability:'active', uploadedBy:'client', uploadedAt:now, updatedAt:now },{merge:true});
    if (!existing.exists) tx.set(projectRef,{ clientFileCount:admin.firestore.FieldValue.increment(1), updatedAt:now },{merge:true});
  });
  return {ok:true,fileId};
});

exports.submitProjectFiles = onCall({ region:REGION }, async (request) => {
  const auth=requireAuth(request), projectId=safeText(request.data?.projectId,128), comments=safeText(request.data?.comments,3000);
  if (!projectId) throw new HttpsError('invalid-argument','Falta el proyecto.');
  const ref=db.doc(`users/${auth.uid}/projects/${projectId}`), snap=await ref.get();
  if (!snap.exists) throw new HttpsError('not-found','Proyecto no encontrado.');
  if (snap.data()?.paymentStatus !== 'paid') throw new HttpsError('failed-precondition','La orden aún no está pagada.');
  const files=await ref.collection('clientFiles').where('availability','==','active').limit(1).get();
  if (files.empty) throw new HttpsError('failed-precondition','Sube al menos un archivo antes de enviarlo al equipo.');
  const now=new Date(), current=snap.data(), estimated=current.estimatedDeliveryAt || admin.firestore.Timestamp.fromDate(addBusinessDays(now,3));
  await ref.set({ clientComments:comments, filesSubmittedAt:admin.firestore.Timestamp.fromDate(now), estimatedDeliveryAt:estimated, status:current.status==='waiting_files'?'files_received':current.status, updatedAt:admin.firestore.Timestamp.fromDate(now) },{merge:true});
  return {ok:true,estimatedDeliveryAt:serializeFirestore(estimated)};
});

exports.registerDeliveryFile = onCall({ region:REGION }, async (request) => {
  await requireAdmin(request);
  const ownerUid=safeText(request.data?.ownerUid,128), projectId=safeText(request.data?.projectId,128), fileId=safeText(request.data?.fileId,128), storagePath=safeText(request.data?.storagePath,1200);
  if (!ownerUid || !projectId || !fileId || !storagePath) throw new HttpsError('invalid-argument','Faltan datos del archivo de entrega.');
  const projectRef=db.doc(`users/${ownerUid}/projects/${projectId}`), projectSnap=await projectRef.get();
  if (!projectSnap.exists) throw new HttpsError('not-found','Proyecto no encontrado.');
  assertStoragePath(storagePath,ownerUid,projectId,'delivery',fileId);
  const fileRef=projectRef.collection('deliveryFiles').doc(fileId), existing=await fileRef.get();
  const verified=await verifyStoredObject(storagePath,MAX_DELIVERY_FILE_BYTES), now=admin.firestore.Timestamp.now();
  await db.runTransaction(async tx=>{
    tx.set(fileRef,{ id:fileId, name:safeText(request.data?.name || verified.meta.name?.split('/').pop(),240), label:safeText(request.data?.label || request.data?.name,120), storagePath, size:verified.size, contentType:safeText(verified.meta.contentType || request.data?.contentType,120), availability:'active', uploadedBy:'admin', uploadedAt:now, updatedAt:now },{merge:true});
    if (!existing.exists) tx.set(projectRef,{ deliveryFileCount:admin.firestore.FieldValue.increment(1), updatedAt:now },{merge:true});
  });
  return {ok:true,fileId};
});

exports.getProjectFileDownloadUrl = onCall({ region:REGION }, async (request) => {
  const auth=requireAuth(request);
  const ownerUid=safeText(request.data?.ownerUid || auth.uid,128), projectId=safeText(request.data?.projectId,128), fileId=safeText(request.data?.fileId,128), role=request.data?.role==='delivery'?'delivery':'client';
  if (!projectId || !fileId) throw new HttpsError('invalid-argument','Falta el archivo.');
  if (auth.uid !== ownerUid) await requireAdmin(request);
  const projectRef=db.doc(`users/${ownerUid}/projects/${projectId}`), snap=await projectRef.get();
  if (!snap.exists) throw new HttpsError('not-found','Proyecto no encontrado.');
  const fileSnap=await projectRef.collection(role==='delivery'?'deliveryFiles':'clientFiles').doc(fileId).get();
  if (!fileSnap.exists || fileSnap.data()?.availability !== 'active' || !fileSnap.data()?.storagePath) throw new HttpsError('not-found','El archivo ya no está disponible.');
  const [url]=await bucket.file(fileSnap.data().storagePath).getSignedUrl({action:'read',expires:Date.now()+15*60*1000});
  return {url,expiresInSeconds:900};
});

exports.adminDeleteProjectFile = onCall({ region:REGION }, async (request) => {
  await requireAdmin(request);
  const ownerUid=safeText(request.data?.ownerUid,128), projectId=safeText(request.data?.projectId,128), fileId=safeText(request.data?.fileId,128), role=request.data?.role==='delivery'?'delivery':'client';
  const projectRef=db.doc(`users/${ownerUid}/projects/${projectId}`), fileRef=projectRef.collection(role==='delivery'?'deliveryFiles':'clientFiles').doc(fileId), fileSnap=await fileRef.get();
  if (!fileSnap.exists) throw new HttpsError('not-found','Archivo no encontrado.');
  const data=fileSnap.data();
  if (data.storagePath) await bucket.file(data.storagePath).delete({ignoreNotFound:true}).catch(()=>{});
  const now=admin.firestore.Timestamp.now(), countField=role==='delivery'?'deliveryFileCount':'clientFileCount';
  await db.runTransaction(async tx=>{
    const p=await tx.get(projectRef); const current=Math.max(0,Number(p.data()?.[countField]||0)-1);
    tx.set(fileRef,{availability:'deleted',storagePath:null,deletedAt:now,updatedAt:now},{merge:true});
    tx.set(projectRef,{[countField]:current,updatedAt:now},{merge:true});
  });
  return {ok:true};
});

exports.adminGetProjectFiles = onCall({ region:REGION }, async (request) => {
  await requireAdmin(request);
  const ownerUid=safeText(request.data?.ownerUid,128), projectId=safeText(request.data?.projectId,128);
  const ref=db.doc(`users/${ownerUid}/projects/${projectId}`), snap=await ref.get();
  if (!snap.exists) throw new HttpsError('not-found','Proyecto no encontrado.');
  const [client,delivery]=await Promise.all([ref.collection('clientFiles').orderBy('uploadedAt','desc').get(),ref.collection('deliveryFiles').orderBy('uploadedAt','desc').get()]);
  return { clientFiles:client.docs.map(d=>({id:d.id,...serializeFirestore(d.data())})), deliveryFiles:delivery.docs.map(d=>({id:d.id,...serializeFirestore(d.data())})) };
});

exports.adminUpdateProject = onCall({ region:REGION }, async (request) => {
  await requireAdmin(request);
  const d=request.data||{}, ownerUid=safeText(d.ownerUid,128), projectId=safeText(d.projectId,128);
  if (!ownerUid || !projectId) throw new HttpsError('invalid-argument','Falta el cliente o proyecto.');
  const allowed=['awaiting_payment','waiting_files','files_received','assigned','in_progress','review','delivered','cancelled'];
  const ref=db.doc(`users/${ownerUid}/projects/${projectId}`), snap=await ref.get();
  if (!snap.exists) throw new HttpsError('not-found','Proyecto no encontrado.');
  const status=allowed.includes(d.status)?d.status:snap.data().status;
  const now=admin.firestore.Timestamp.now();
  const update={ status, architectName:safeText(d.architectName || 'Pendiente',120), deliveryNote:safeText(d.deliveryNote,2000), updatedAt:now };
  if (status==='delivered') update.deliveredAt=now;
  await ref.set(update,{merge:true});
  await db.doc(`adminProjectData/${projectAdminKey(ownerUid,projectId)}`).set({ownerUid,projectId,internalCostUsd:Math.max(0,Number(d.internalCostUsd||0)),adminNotes:safeText(d.adminNotes,3000),updatedAt:now},{merge:true});
  return {ok:true};
});

exports.adminCreateCustomOrder = onCall({ region:REGION }, async (request) => {
  await requireAdmin(request);
  const d=request.data||{}, ownerUid=safeText(d.ownerUid,128), title=safeText(d.title,140), category=safeText(d.category || 'Orden personalizada',100), description=safeText(d.description,2000);
  const baseUsd=num(d.amountUsd,'Precio',1,1000000), internalCostUsd=Math.max(0,Number(d.internalCostUsd||0));
  if (!ownerUid || !title) throw new HttpsError('invalid-argument','Selecciona cliente y nombre de la orden.');
  let userRecord; try { userRecord=await admin.auth().getUser(ownerUid); } catch(_) { throw new HttpsError('not-found','El cliente no existe en Firebase Authentication.'); }
  const included=(Array.isArray(d.includedHighlights)?d.includedHighlights:[]).slice(0,20).map(x=>safeText(x,180)).filter(Boolean);
  const now=admin.firestore.Timestamp.now(), projectId=`custom_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
  const manualPaid=Boolean(d.manualPaid), displayOrderId=`#EVO-C${Date.now().toString().slice(-7)}`;
  const cfg={ category, packageCode:'custom', packageName:title, shortPackageName:title, description, specs:[], uploadTitle:'Archivos requeridos', uploadCopy:safeText(d.uploadCopy || 'Sube los archivos y referencias indicados por Evolution Design para iniciar este proyecto.',900), uploadFormats:'Carga privada en Firebase', includedHighlights:included, custom:true, baseUsd };
  const project={ ownerUid, ownerEmail:safeText(userRecord.email,254), payerName:safeText(userRecord.displayName || userRecord.email,120), payerCountry:'No reportado', paymentMethod:manualPaid?'Pago manual':'Pendiente de PayPal', amount:manualPaid?baseUsd.toFixed(2):baseUsd.toFixed(2), currency:'USD', baseUsd, displayOrderId, projectType:category, projectTitle:title, projectConfig:cfg, source:'custom', customOrder:true, paymentStatus:manualPaid?'paid':'pending', status:manualPaid?'waiting_files':'awaiting_payment', architectName:'Pendiente', clientFileCount:0, deliveryFileCount:0, clientComments:'', deliveryNote:'', createdAt:now, updatedAt:now };
  if (manualPaid) { project.transactionId=`MANUAL-${Date.now()}`; project.paidAt=now; }
  await db.doc(`users/${ownerUid}/projects/${projectId}`).set(project);
  await db.doc(`adminProjectData/${projectAdminKey(ownerUid,projectId)}`).set({ownerUid,projectId,internalCostUsd,adminNotes:safeText(d.adminNotes,3000),updatedAt:now});
  if (manualPaid) await updateClientSummary(ownerUid,{email:userRecord.email,displayName:userRecord.displayName},baseUsd,now);
  return {ok:true,projectId,displayOrderId};
});

exports.adminDeleteProject = onCall({ region:REGION }, async (request) => {
  await requireAdmin(request);
  const ownerUid=safeText(request.data?.ownerUid,128), projectId=safeText(request.data?.projectId,128);
  if (!ownerUid || !projectId) throw new HttpsError('invalid-argument','Falta el proyecto.');
  const ref=db.doc(`users/${ownerUid}/projects/${projectId}`), snap=await ref.get();
  if (!snap.exists) return {ok:true};
  await bucket.deleteFiles({prefix:`projects/${ownerUid}/${projectId}/`}).catch(()=>{});
  for (const sub of ['clientFiles','deliveryFiles']) { const fs=await ref.collection(sub).get(); if(!fs.empty){ const batch=db.batch(); fs.docs.forEach(x=>batch.delete(x.ref)); await batch.commit(); } }
  await ref.delete();
  await db.doc(`adminProjectData/${projectAdminKey(ownerUid,projectId)}`).delete().catch(()=>{});
  return {ok:true};
});

exports.adminGetDashboard = onCall({ region:REGION }, async (request) => {
  await requireAdmin(request);
  const [usersSnap,projectsSnap,metaSnap]=await Promise.all([
    db.collection('users').orderBy('lastSeenAt','desc').limit(500).get().catch(()=>db.collection('users').limit(500).get()),
    db.collectionGroup('projects').orderBy('createdAt','desc').limit(500).get(),
    db.collection('adminProjectData').limit(1000).get()
  ]);
  const metaMap=new Map(metaSnap.docs.map(d=>[`${d.data().ownerUid}__${d.data().projectId}`,d.data()]));
  const projects=projectsSnap.docs.map(doc=>{const data=doc.data(), ownerUid=data.ownerUid || doc.ref.parent.parent?.id || ''; const meta=metaMap.get(`${ownerUid}__${doc.id}`)||{}; return {id:doc.id,path:doc.ref.path,ownerUid,...serializeFirestore(data),adminMeta:serializeFirestore(meta)};});
  const byUid=new Map();
  for(const p of projects){ if(!byUid.has(p.ownerUid)) byUid.set(p.ownerUid,{orders:0,spent:0,lastProject:null,country:''}); const s=byUid.get(p.ownerUid); if(p.paymentStatus==='paid'){s.orders++;s.spent+=Number(p.baseUsd||0);} if(!s.lastProject)s.lastProject=p.createdAt; if(!s.country && p.payerCountry)s.country=p.payerCountry; }
  const clients=usersSnap.docs.map(doc=>{const data=serializeFirestore(doc.data()), s=byUid.get(doc.id)||{orders:0,spent:0}; return {uid:doc.id,...data,computedOrders:s.orders,computedSpentUsd:roundMoney(s.spent),country:data.payerCountry || data.lastGeo?.country || s.country || 'No reportado'};});
  let gross=0,cost=0,active=0,delivered=0,pending=0;
  projects.forEach(p=>{ if(p.paymentStatus==='paid') gross+=Number(p.baseUsd||0); cost+=Number(p.adminMeta?.internalCostUsd||0); if(p.status==='delivered') delivered++; else if(p.status==='awaiting_payment') pending++; else if(p.status!=='cancelled') active++; });
  const countries={}; clients.forEach(c=>{const k=c.country||'No reportado'; countries[k]=(countries[k]||0)+1;});
  return { metrics:{clients:clients.length,projects:projects.length,active,delivered,pendingPayments:pending,grossRevenueUsd:roundMoney(gross),internalCostUsd:roundMoney(cost),profitUsd:roundMoney(gross-cost)}, countries:Object.entries(countries).map(([country,count])=>({country,count})).sort((a,b)=>b.count-a.count), clients, projects };
});

// Compatibilidad con el panel anterior.
exports.adminListProjects = onCall({ region:REGION }, async (request) => {
  await requireAdmin(request);
  const snap=await db.collectionGroup('projects').orderBy('createdAt','desc').limit(100).get();
  return {projects:snap.docs.map(doc=>({id:doc.id,path:doc.ref.path,...serializeFirestore(doc.data())}))};
});
