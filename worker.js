/* Evolution Store Worker · v50.31 · Product Sold Endpoint + Presence Globe + USD Import Pricing + R2 Product Image Persistence + Recovery */
const FIREBASE_PROJECT_ID = "evolution-design-9b63b";
const FIREBASE_WEB_API_KEY = "AIzaSyA5b-2R5WUQNOt3N2cAKBZK3x5--YhwzHM";
const ADMIN_EMAILS = new Set([
  "evolutiongt01@gmail.com",
  "tepaz2025@gmail.com"
]);

const DEFAULT_ALLOWED_ORIGINS = [
  "https://evolutiondesing.com",
  "https://www.evolutiondesing.com"
];

const RECAPTCHA_ALLOWED_ACTIONS = new Set([
  "LOGIN",
  "SIGNUP",
  "ARCHITECTURE_CHECKOUT",
  "GRAPHIC_CHECKOUT",
  "WEB_CHECKOUT",
  "PROJECT_PAYMENT",
  "MANUAL_PAYMENT",
  "STORE_ORDER"
]);

let zohoTokenCache = { token: "", expiresAt: 0 };
let zohoAccountCache = { fromAddress: "", accountId: "", expiresAt: 0 };

function json(data, status = 200, origin = "") {
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  };
  Object.assign(headers, corsHeaders(origin));
  return new Response(JSON.stringify(data), { status, headers });
}

function corsHeaders(origin) {
  const allowed = new Set(DEFAULT_ALLOWED_ORIGINS);
  if (origin && allowed.has(origin)) {
    return {
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "authorization,content-type",
      "access-control-max-age": "86400",
      vary: "Origin"
    };
  }
  return { vary: "Origin" };
}

function clean(value, max = 240) {
  return String(value ?? "").trim().slice(0, max);
}

function validEmail(value) {
  const email = clean(value, 240).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function htmlEscape(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}


function recaptchaConfig(env) {
  const apiKey = clean(env.RECAPTCHA_API_KEY, 500);
  const projectId = clean(env.RECAPTCHA_PROJECT_ID, 180);
  const siteKey = clean(env.RECAPTCHA_SITE_KEY, 300);
  const configuredMinScore = Number(env.RECAPTCHA_MIN_SCORE);
  const minScore = Number.isFinite(configuredMinScore)
    ? Math.max(0, Math.min(1, configuredMinScore))
    : 0.5;
  const enforceScore = String(env.RECAPTCHA_ENFORCE_SCORE || "").toLowerCase() === "true";

  if (!apiKey || !projectId || !siteKey) throw new Error("RECAPTCHA_CONFIG_INCOMPLETE");
  return { apiKey, projectId, siteKey, minScore, enforceScore };
}

function requestClientIp(request) {
  const direct = clean(request.headers.get("cf-connecting-ip"), 80);
  if (direct) return direct;
  const forwarded = clean(request.headers.get("x-forwarded-for"), 500);
  return clean(forwarded.split(",")[0], 80);
}

function allowedRecaptchaHostname(hostname) {
  const value = clean(hostname, 255).toLowerCase();
  if (!value) return false;
  return DEFAULT_ALLOWED_ORIGINS.some(origin => {
    try { return new URL(origin).hostname.toLowerCase() === value; }
    catch (_) { return false; }
  });
}

function recaptchaAssessmentId(name) {
  const value = clean(name, 500);
  return value ? value.split("/").pop() : "";
}

async function createRecaptchaAssessment(request, env, {
  token,
  expectedAction,
  requestedUri = ""
} = {}) {
  const cfg = recaptchaConfig(env);
  const safeToken = clean(token, 7000);
  const action = clean(expectedAction, 80).toUpperCase();

  if (!safeToken) throw new Error("RECAPTCHA_TOKEN_MISSING");
  if (!RECAPTCHA_ALLOWED_ACTIONS.has(action)) throw new Error("RECAPTCHA_ACTION_INVALID");

  const event = {
    token: safeToken,
    siteKey: cfg.siteKey,
    expectedAction: action,
    userAgent: clean(request.headers.get("user-agent"), 600),
    userIpAddress: requestClientIp(request)
  };
  const safeRequestedUri = clean(requestedUri, 700);
  if (safeRequestedUri) event.requestedUri = safeRequestedUri;

  const endpoint =
    `https://recaptchaenterprise.googleapis.com/v1/projects/${encodeURIComponent(cfg.projectId)}` +
    `/assessments?key=${encodeURIComponent(cfg.apiKey)}`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json; charset=utf-8",
      Accept: "application/json"
    },
    body: JSON.stringify({ event })
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error("reCAPTCHA assessment", response.status, body?.error?.message || body?.error?.status || "unknown");
    throw new Error("RECAPTCHA_ASSESSMENT_FAILED");
  }

  const tokenProps = body?.tokenProperties || {};
  const returnedAction = clean(tokenProps?.action, 80).toUpperCase();
  const hostname = clean(tokenProps?.hostname, 255).toLowerCase();
  const score = Number(body?.riskAnalysis?.score);
  const reasons = Array.isArray(body?.riskAnalysis?.reasons)
    ? body.riskAnalysis.reasons.map(x => clean(x, 120)).filter(Boolean).slice(0, 20)
    : [];

  const tokenValid = tokenProps?.valid === true;
  const actionMatches = returnedAction === action;
  const hostnameAllowed = allowedRecaptchaHostname(hostname);
  const scoreAvailable = Number.isFinite(score);
  const scorePass = !cfg.enforceScore || (scoreAvailable && score >= cfg.minScore);
  const ok = tokenValid && actionMatches && hostnameAllowed && scorePass;

  return {
    ok,
    tokenValid,
    actionMatches,
    hostnameAllowed,
    score: scoreAvailable ? score : null,
    scorePass,
    minScore: cfg.minScore,
    scoreEnforced: cfg.enforceScore,
    action,
    returnedAction,
    hostname,
    reasons,
    invalidReason: clean(tokenProps?.invalidReason, 120),
    assessmentId: recaptchaAssessmentId(body?.name)
  };
}

async function requireRecaptcha(request, env, options = {}) {
  const assessment = await createRecaptchaAssessment(request, env, options);
  if (!assessment.tokenValid) throw Object.assign(new Error("RECAPTCHA_TOKEN_INVALID"), { assessment });
  if (!assessment.actionMatches) throw Object.assign(new Error("RECAPTCHA_ACTION_MISMATCH"), { assessment });
  if (!assessment.hostnameAllowed) throw Object.assign(new Error("RECAPTCHA_HOSTNAME_INVALID"), { assessment });
  if (!assessment.scorePass) throw Object.assign(new Error("RECAPTCHA_RISK_TOO_HIGH"), { assessment });
  return assessment;
}

async function recaptchaConfigRoute(env, origin) {
  try {
    const cfg = recaptchaConfig(env);
    return json({
      ok: true,
      siteKey: cfg.siteKey,
      provider: "google-recaptcha-enterprise",
      scoreEnforced: cfg.enforceScore,
      minScore: cfg.minScore,
      actions: [...RECAPTCHA_ALLOWED_ACTIONS]
    }, 200, origin);
  } catch (error) {
    return json({
      ok: false,
      error: "reCAPTCHA Enterprise todavía no está configurado en el Worker."
    }, 503, origin);
  }
}

async function recaptchaVerifyRoute(request, env, origin) {
  try {
    const payload = await request.json().catch(() => ({}));
    const action = clean(payload.action, 80).toUpperCase();
    const token = clean(payload.token, 7000);
    const requestedUri = clean(payload.requestedUri || "", 700);

    const assessment = await createRecaptchaAssessment(request, env, {
      token,
      expectedAction: action,
      requestedUri
    });

    const status = assessment.ok ? 200 : 403;
    return json({
      ok: assessment.ok,
      provider: "google-recaptcha-enterprise",
      tokenValid: assessment.tokenValid,
      actionMatches: assessment.actionMatches,
      hostnameAllowed: assessment.hostnameAllowed,
      score: assessment.score,
      scorePass: assessment.scorePass,
      scoreEnforced: assessment.scoreEnforced,
      minScore: assessment.minScore,
      action: assessment.action,
      hostname: assessment.hostname,
      reasons: assessment.reasons,
      invalidReason: assessment.invalidReason,
      assessmentId: assessment.assessmentId
    }, status, origin);
  } catch (error) {
    const code = String(error?.message || "");
    const status = ["RECAPTCHA_TOKEN_MISSING", "RECAPTCHA_ACTION_INVALID"].includes(code) ? 400 : 502;
    const publicMap = {
      RECAPTCHA_TOKEN_MISSING: "Falta el token de seguridad.",
      RECAPTCHA_ACTION_INVALID: "La acción de seguridad no es válida.",
      RECAPTCHA_CONFIG_INCOMPLETE: "reCAPTCHA Enterprise todavía no está configurado en el Worker.",
      RECAPTCHA_ASSESSMENT_FAILED: "Google reCAPTCHA no pudo evaluar esta solicitud."
    };
    return json({
      ok: false,
      error: publicMap[code] || "No se pudo verificar reCAPTCHA.",
      code
    }, status, origin);
  }
}

function bearerToken(request) {
  const raw = request.headers.get("authorization") || "";
  const match = raw.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

async function requireFirebaseAdmin(idToken) {
  if (!idToken) throw new Error("AUTH_MISSING");

  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(FIREBASE_WEB_API_KEY)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idToken })
    }
  );

  const body = await response.json().catch(() => ({}));
  if (!response.ok || !Array.isArray(body.users) || !body.users[0]) {
    throw new Error("AUTH_INVALID");
  }

  const user = body.users[0];
  const email = validEmail(user.email);

  if (!email || !ADMIN_EMAILS.has(email)) throw new Error("ADMIN_ONLY");
  return { uid: clean(user.localId, 160), email };
}

function firestoreDocUrl(ownerUid, projectId) {
  return `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/users/${encodeURIComponent(ownerUid)}/projects/${encodeURIComponent(projectId)}`;
}

function fromFirestoreValue(v) {
  if (!v || typeof v !== "object") return null;
  if ("nullValue" in v) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return Number(v.doubleValue);
  if ("timestampValue" in v) return v.timestampValue;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(fromFirestoreValue);
  if ("mapValue" in v) return fromFirestoreFields(v.mapValue.fields || {});
  return null;
}

function fromFirestoreFields(fields) {
  const out = {};
  for (const [key, value] of Object.entries(fields || {})) {
    out[key] = fromFirestoreValue(value);
  }
  return out;
}

function toFirestoreValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  return { stringValue: String(value) };
}

async function getProject(idToken, ownerUid, projectId) {
  const response = await fetch(firestoreDocUrl(ownerUid, projectId), {
    headers: { Authorization: `Bearer ${idToken}`, Accept: "application/json" }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(response.status === 404 ? "PROJECT_NOT_FOUND" : "FIRESTORE_READ_FAILED");
  return fromFirestoreFields(body.fields || {});
}

async function patchProject(idToken, ownerUid, projectId, patch) {
  const params = new URLSearchParams();
  for (const key of Object.keys(patch)) params.append("updateMask.fieldPaths", key);
  const fields = {};
  for (const [key, value] of Object.entries(patch)) fields[key] = toFirestoreValue(value);

  const response = await fetch(`${firestoreDocUrl(ownerUid, projectId)}?${params.toString()}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${idToken}`,
      "content-type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({ fields })
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error("FIRESTORE_WRITE_FAILED");
  return body;
}

function zohoConfig(env) {
  const clientId = clean(env.ZOHO_CLIENT_ID, 300);
  const clientSecret = clean(env.ZOHO_CLIENT_SECRET, 500);
  const refreshToken = clean(env.ZOHO_REFRESH_TOKEN, 1000);
  const fromAddress = validEmail(env.ZOHO_FROM_ADDRESS || "support@evolutiondesing.com");
  const accountId = clean(env.ZOHO_ACCOUNT_ID, 120);
  const accountsBase = clean(env.ZOHO_ACCOUNTS_BASE || "https://accounts.zoho.com", 200).replace(/\/$/, "");
  const mailBase = clean(env.ZOHO_MAIL_BASE || "https://mail.zoho.com", 200).replace(/\/$/, "");
  const portalUrl = clean(env.PORTAL_URL || "https://www.evolutiondesing.com/proyectos.html", 500);

  if (!clientId || !clientSecret || !refreshToken || !fromAddress) throw new Error("ZOHO_CONFIG_INCOMPLETE");
  return { clientId, clientSecret, refreshToken, fromAddress, accountId, accountsBase, mailBase, portalUrl };
}

async function zohoAccessToken(env) {
  if (zohoTokenCache.token && Date.now() < zohoTokenCache.expiresAt) return zohoTokenCache.token;
  const cfg = zohoConfig(env);
  const form = new URLSearchParams({
    refresh_token: cfg.refreshToken, client_id: cfg.clientId, client_secret: cfg.clientSecret, grant_type: "refresh_token"
  });

  const response = await fetch(`${cfg.accountsBase}/oauth/v2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: form.toString()
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) throw new Error("ZOHO_OAUTH_FAILED");

  const ttl = Math.max(300, Number(body.expires_in || 3600));
  zohoTokenCache = { token: String(body.access_token), expiresAt: Date.now() + Math.max(60, ttl - 300) * 1000 };
  return zohoTokenCache.token;
}

async function zohoAccountId(env) {
  const cfg = zohoConfig(env);
  if (cfg.accountId) return cfg.accountId;
  if (zohoAccountCache.accountId && zohoAccountCache.fromAddress === cfg.fromAddress && Date.now() < zohoAccountCache.expiresAt) return zohoAccountCache.accountId;

  const token = await zohoAccessToken(env);
  const response = await fetch(`${cfg.mailBase}/api/accounts`, {
    headers: { Authorization: `Zoho-oauthtoken ${token}`, Accept: "application/json" }
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok || !Array.isArray(body.data)) throw new Error("ZOHO_ACCOUNT_LOOKUP_FAILED");

  const wanted = cfg.fromAddress.toLowerCase();
  const match = body.data.find(account => {
    const addresses = [
      account?.primaryEmailAddress, account?.mailboxAddress, account?.incomingUserName,
      ...(Array.isArray(account?.emailAddress) ? account.emailAddress.map(x => x?.mailId) : [])
    ].filter(Boolean).map(x => String(x).toLowerCase());
    return addresses.includes(wanted);
  });

  const accountId = clean(match?.accountId, 120);
  if (!accountId) throw new Error("ZOHO_SENDER_NOT_FOUND");

  zohoAccountCache = { fromAddress: cfg.fromAddress, accountId, expiresAt: Date.now() + 6 * 60 * 60 * 1000 };
  return accountId;
}

async function sendZohoReadyMail(env, { toAddress, clientName, projectTitle, displayOrderId }) {
  const cfg = zohoConfig(env);
  const token = await zohoAccessToken(env);
  const accountId = await zohoAccountId(env);

  const safeName = htmlEscape(clientName || "Cliente");
  const safeTitle = htmlEscape(projectTitle || "tu proyecto");
  const safeOrder = htmlEscape(displayOrderId || "");
  const safePortal = htmlEscape(cfg.portalUrl);
  const currentYear = new Date().getFullYear();
  const subject = `${projectTitle || "Tu proyecto"} · Listo para revisión | Evolution Design`.slice(0, 220);

  // HTML: BORDES DORADOS TRANSLÚCIDOS Y DEGRADADOS (Adiós bordes blancos invertidos)
  const content = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<style>
  body, table, td, p, a, span, div { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
  a { text-decoration: none; }

  /* Base negra protegida con gradient negro→negro */
  .bg-black {
    background-color:#000000 !important;
    background-image:linear-gradient(180deg,#000000 0%,#000000 100%) !important;
  }

  /* Liquid glass con BORDES TRANSLÚCIDOS DORADOS (inmunes al modo oscuro blanco) */
  .glass-panel {
    background-color:#101014 !important;
    background-image:
      linear-gradient(135deg,rgba(255,255,255,.075) 0%,rgba(255,255,255,.018) 48%,rgba(212,184,149,.035) 100%),
      linear-gradient(180deg,#15151b 0%,#0b0b0f 100%) !important;
    border:1px solid rgba(212, 184, 149, 0.22) !important;
    box-shadow:inset 0 1px 0 rgba(255,255,255,.04), 0 10px 30px rgba(0,0,0,.3);
  }

  .glass-soft {
    background-color:#0d0d11 !important;
    background-image:
      linear-gradient(135deg,rgba(255,255,255,.055) 0%,rgba(255,255,255,.01) 55%),
      linear-gradient(180deg,#101014 0%,#08080b 100%) !important;
    border:1px solid rgba(212, 184, 149, 0.12) !important;
    box-shadow:inset 0 1px 0 rgba(255,255,255,.02);
  }

  .gold-glass {
    background-color:#b99a74 !important;
    background-image:
      linear-gradient(180deg,rgba(255,255,255,.22) 0%,rgba(255,255,255,.04) 48%,rgba(0,0,0,.09) 100%),
      linear-gradient(180deg,#d8bf9c 0%,#b49570 100%) !important;
  }

  /* Texto blanco protegido en Gmail iOS */
  .gmail-screen { background:#000000; mix-blend-mode:screen; }
  .gmail-difference { background:#000000; mix-blend-mode:difference; }

  @media screen and (max-width:600px) {
    .container { width:100% !important; padding:14px 8px !important; }
    .card { width:100% !important; border-radius:17px !important; }
    .glass-header { padding:22px 18px !important; }
    .body-pad { padding:22px 18px 24px !important; }
    .hero-title { font-size:29px !important; line-height:1.08 !important; }
    .btn { width:100% !important; display:block !important; box-sizing:border-box !important; padding:16px 18px !important; }
    .brand-badge { font-size:8px !important; padding:7px 9px !important; }
    .detail-row td { display:block !important; width:100% !important; border-left:none !important; box-sizing:border-box !important; }
    .detail-right { border-top:1px solid rgba(212, 184, 149, 0.15) !important; }
  }
</style>
</head>

<body class="bg-black" bgcolor="#000000" style="margin:0;padding:0;-webkit-font-smoothing:antialiased;">

  <div style="display:none;max-height:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;color:#000000;">
    Tu vista previa protegida ya está disponible en Evolution Design. Revisa tu proyecto ahora.
  </div>

  <table width="100%" border="0" cellpadding="0" cellspacing="0" class="bg-black" role="presentation">
    <tr>
      <td align="center" valign="top" class="container bg-black" style="padding:38px 15px;">

        <!-- TARJETA PRINCIPAL -->
        <table width="600" class="card" border="0" cellpadding="0" cellspacing="0" role="presentation" style="width:600px;max-width:600px;border-radius:22px;overflow:hidden;border:1px solid rgba(212, 184, 149, 0.25);background-color:#050507;background-image:linear-gradient(180deg,#09090c 0%,#030304 100%);box-shadow:0 24px 70px rgba(0,0,0,.42);">

          <!-- HEADER -->
          <tr>
            <td class="glass-header" style="padding:28px 32px 25px;background-color:#17171c;background-image:linear-gradient(145deg,rgba(255,255,255,.09) 0%,rgba(255,255,255,.018) 52%,rgba(212,184,149,.05) 100%),linear-gradient(180deg,#1d1d24 0%,#111115 100%);border-bottom:1px solid rgba(212, 184, 149, 0.25);box-shadow:inset 0 1px 0 rgba(255,255,255,.05);">
              <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation">
                <tr>
                  <td valign="middle" align="left">
                    <a href="https://www.evolutiondesing.com" target="_blank">
                      <img src="https://www.evolutiondesing.com/img/logo.png" alt="Evolution Design" width="140" style="display:block;width:140px;max-width:140px;height:auto;border:0;outline:none;">
                    </a>
                  </td>
                  <td valign="middle" align="right" style="padding-left:12px;">
                    <span class="brand-badge" style="display:inline-block;padding:7px 12px;background-color:#2a241e;background-image:linear-gradient(180deg,rgba(212,184,149,.24) 0%,rgba(212,184,149,.07) 100%);border:1px solid rgba(212,184,149,.40);border-radius:999px;color:#ead8c1;font-size:9px;font-weight:700;letter-spacing:1.1px;text-transform:uppercase;box-shadow:inset 0 1px 0 rgba(255,255,255,.10);white-space:nowrap;">
                      Proyecto Finalizado
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- CONTENIDO -->
          <tr>
            <td class="body-pad" style="padding:30px 34px 32px;background-color:#070709;background-image:linear-gradient(180deg,#0c0c10 0%,#050507 100%);">

              <!-- MICRO ESTADO GLASS -->
              <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" class="glass-soft" style="width:100%;border-radius:14px;margin-bottom:22px;overflow:hidden;">
                <tr>
                  <td width="44" align="center" valign="middle" style="padding:12px 0 12px 14px;">
                    <div style="width:28px;height:28px;line-height:28px;border-radius:999px;text-align:center;background-color:#241e18;background-image:linear-gradient(180deg,rgba(212,184,149,.25),rgba(212,184,149,.06));border:1px solid rgba(212,184,149,.32);color:#d4b895;font-size:13px;font-weight:800;">✓</div>
                  </td>
                  <td valign="middle" style="padding:11px 12px 11px 10px;">
                    <div style="color:#d4b895;font-size:9px;font-weight:800;letter-spacing:1.35px;text-transform:uppercase;margin-bottom:3px;">Vista previa publicada</div>
                    <div class="gmail-screen"><div class="gmail-difference"><div style="color:#ffffff;font-size:11px;line-height:1.4;font-weight:600;">Tu proyecto ya está disponible para revisión.</div></div></div>
                  </td>
                  <td width="58" align="right" valign="middle" style="padding:10px 14px 10px 4px;">
                    <span style="display:inline-block;width:7px;height:7px;border-radius:999px;background-color:#d4b895;box-shadow:0 0 0 5px rgba(212,184,149,.08),0 0 18px rgba(212,184,149,.35);"></span>
                  </td>
                </tr>
              </table>

              <!-- HERO DEGRADADO DORADO -->
              <div style="width:42px;height:2px;background-color:rgba(212,184,149,0.5);background-image:linear-gradient(90deg,#d4b895,#8f7659);border-radius:999px;margin:0 0 15px;"></div>

              <div class="gmail-screen"><div class="gmail-difference">
                <div class="hero-title" style="margin:0;color:#ffffff;font-size:34px;font-weight:720;letter-spacing:-1.05px;line-height:1.06;">
                  Tu proyecto está listo
                </div>
              </div></div>
              <div class="hero-title" style="margin:2px 0 0;color:#d4b895;font-size:34px;font-weight:720;letter-spacing:-1.05px;line-height:1.06;">para revisión.</div>

              <div style="height:16px;line-height:16px;">&nbsp;</div>

              <!-- MENSAJE EN LIQUID GLASS -->
              <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" class="glass-panel" style="width:100%;border-radius:17px;margin-bottom:20px;overflow:hidden;">
                <tr>
                  <td style="padding:18px 18px 17px;border-left:2px solid #b89a76;">
                    <div class="gmail-screen"><div class="gmail-difference">
                      <div style="color:#ffffff;font-size:14px;line-height:1.55;margin-bottom:8px;">Hola <strong>${safeName}</strong>,</div>
                      <div style="color:#ffffff;font-size:12px;line-height:1.72;opacity:.86;">
                        Nuestro equipo ha finalizado el trabajo correspondiente a <strong>${safeTitle}</strong> y publicó una muestra protegida para que puedas revisar el resultado antes de continuar con la entrega final.
                      </div>
                    </div></div>
                  </td>
                </tr>
              </table>

              <!-- TARJETA NEGRA DEL PROYECTO: LIQUID GLASS -->
              <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" class="glass-panel" style="width:100%;border-radius:17px;overflow:hidden;margin-bottom:20px;">
                <tr>
                  <td colspan="2" style="padding:14px 17px 11px;border-bottom:1px solid rgba(212, 184, 149, 0.15);">
                    <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation">
                      <tr>
                        <td valign="middle">
                          <div style="color:#8f8f98;font-size:8px;font-weight:800;letter-spacing:1.45px;text-transform:uppercase;">Evolution Design · Proyecto</div>
                        </td>
                        <td align="right" valign="middle">
                          <span style="color:#d4b895;font-size:8px;font-weight:800;letter-spacing:1.15px;text-transform:uppercase;">● Ready</span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <tr class="detail-row">
                  <td valign="top" style="padding:18px 17px;width:62%;">
                    <div style="color:#7f7f89;font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:1.2px;margin-bottom:7px;">Proyecto</div>
                    <div class="gmail-screen"><div class="gmail-difference"><div style="color:#ffffff;font-size:17px;font-weight:700;line-height:1.3;">${safeTitle}</div></div></div>
                  </td>
                  <td class="detail-right" valign="top" style="padding:18px 17px;width:38%;border-left:1px solid rgba(212, 184, 149, 0.15);">
                    <div style="color:#7f7f89;font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:1.2px;margin-bottom:7px;">Estado</div>
                    <span style="display:inline-block;padding:7px 9px;border-radius:999px;background-color:#2a241e;background-image:linear-gradient(180deg,rgba(212,184,149,.23),rgba(212,184,149,.06));border:1px solid rgba(212,184,149,.30);color:#d9bea0;font-size:9px;font-weight:800;letter-spacing:.45px;white-space:nowrap;">LISTO PARA REVISIÓN</span>
                  </td>
                </tr>

                ${safeOrder ? `
                <tr>
                  <!-- DIVISOR CON DEGRADADO -->
                  <td colspan="2" style="padding:0 17px;"><div style="height:1px;background-color:rgba(212,184,149,0.1);background-image:linear-gradient(90deg,transparent,rgba(212,184,149,.35),transparent);"></div></td>
                </tr>
                <tr>
                  <td colspan="2" style="padding:13px 17px 16px;">
                    <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" class="glass-soft" style="border-radius:11px;overflow:hidden;">
                      <tr>
                        <td style="padding:10px 12px;">
                          <div style="color:#777781;font-size:8px;font-weight:800;text-transform:uppercase;letter-spacing:1.2px;margin-bottom:4px;">ID de orden</div>
                          <div class="gmail-screen"><div class="gmail-difference"><div style="color:#ffffff;font-size:12px;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;letter-spacing:.2px;">${safeOrder}</div></div></div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                ` : ""}
              </table>

              <!-- CTA -->
              <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="width:100%;margin-bottom:20px;">
                <tr>
                  <td align="center" class="gold-glass" style="border-radius:12px;border:1px solid #d4b895;box-shadow:inset 0 1px 0 rgba(255,255,255,.32),0 8px 22px rgba(180,149,112,.16);">
                    <a href="${safePortal}" class="btn" target="_blank" style="display:block;padding:16px 22px;color:#17120d;font-size:13px;font-weight:850;letter-spacing:.55px;text-transform:uppercase;">
                      Ver mi proyecto&nbsp;&nbsp;→
                    </a>
                  </td>
                </tr>
              </table>

              <!-- SEGURIDAD GLASS -->
              <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" class="glass-soft" style="width:100%;border-radius:14px;overflow:hidden;margin-bottom:20px;">
                <tr>
                  <td width="38" valign="top" align="center" style="padding:14px 0 14px 13px;">
                    <div style="width:25px;height:25px;line-height:25px;text-align:center;border-radius:8px;background-color:#211c17;background-image:linear-gradient(180deg,rgba(212,184,149,.18),rgba(212,184,149,.03));border:1px solid rgba(212,184,149,.22);font-size:12px;">🔒</div>
                  </td>
                  <td style="padding:13px 14px 13px 9px;">
                    <div style="color:#d4b895;font-size:9px;font-weight:800;letter-spacing:.8px;text-transform:uppercase;margin-bottom:4px;">Vista previa protegida</div>
                    <div class="gmail-screen"><div class="gmail-difference"><div style="color:#ffffff;font-size:10px;line-height:1.62;opacity:.76;">La muestra no está adjunta a este correo. Tus archivos finales y enlaces de entrega se gestionan únicamente desde tu panel de Evolution Design.</div></div></div>
                  </td>
                </tr>
              </table>

              <!-- ECOSISTEMA -->
              <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="width:100%;border-top:1px solid rgba(212, 184, 149, 0.15);border-bottom:1px solid rgba(212, 184, 149, 0.15);">
                <tr>
                  <td width="50%" valign="top" style="padding:14px 12px 14px 0;">
                    <div style="color:#d4b895;font-size:9px;font-weight:800;margin-bottom:4px;">Evolution Design</div>
                    <a href="https://www.evolutiondesing.com" style="color:#9c9ca5;font-size:9px;">www.evolutiondesing.com</a>
                    <div class="gmail-screen"><div class="gmail-difference"><div style="color:#ffffff;font-size:8px;margin-top:5px;line-height:1.4;opacity:.55;">Arquitectura · Diseño · Desarrollo</div></div></div>
                  </td>
                  <td width="50%" valign="top" style="padding:14px 0 14px 15px;border-left:1px solid rgba(212, 184, 149, 0.15);">
                    <div class="gmail-screen"><div class="gmail-difference"><div style="color:#ffffff;font-size:9px;font-weight:800;margin-bottom:4px;">Dingloft</div></div></div>
                    <a href="https://www.dingloft.com" style="color:#9c9ca5;font-size:9px;">www.dingloft.com</a>
                    <div class="gmail-screen"><div class="gmail-difference"><div style="color:#ffffff;font-size:8px;margin-top:5px;line-height:1.4;opacity:.55;">Música · Tecnología · Recursos Digitales</div></div></div>
                  </td>
                </tr>
              </table>

              <!-- MENSAJE AUTOMÁTICO -->
              <div style="padding:17px 0 0;">
                <div style="color:#d4b895;font-size:8px;font-weight:800;letter-spacing:1.05px;text-transform:uppercase;margin-bottom:6px;">Mensaje generado automáticamente</div>
                <div class="gmail-screen"><div class="gmail-difference"><div style="color:#ffffff;font-size:9px;line-height:1.65;opacity:.55;">
                  Este correo fue generado cuando el equipo responsable marcó el trabajo como finalizado y publicó una vista previa para revisión del cliente.<br><br>
                  <strong>Por favor, no respondas directamente a este mensaje.</strong> Para asistencia utiliza tu panel o escribe a support@evolutiondesing.com.
                </div></div></div>
              </div>

            </td>
          </tr>

          <!-- FOOTER GLASS -->
          <tr>
            <td style="padding:23px 32px 25px;text-align:center;background-color:#0c0c10;background-image:linear-gradient(145deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 60%),linear-gradient(180deg,#101014 0%,#08080a 100%);border-top:1px solid rgba(212, 184, 149, 0.15);box-shadow:inset 0 1px 0 rgba(255,255,255,.02);">
              <div style="color:#d4b895;font-size:9px;font-weight:800;letter-spacing:2px;margin-bottom:8px;">EVOLUTION GROUP</div>
              <div class="gmail-screen"><div class="gmail-difference"><div style="color:#ffffff;font-size:9px;line-height:1.6;opacity:.48;">
                © ${currentYear} Evolution Group · Todos los derechos reservados.<br>
                Evolution Design y Dingloft forman parte del ecosistema Evolution Group.
              </div></div></div>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const response = await fetch(`${cfg.mailBase}/api/accounts/${encodeURIComponent(accountId)}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
      "content-type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({
      fromAddress: cfg.fromAddress,
      toAddress,
      subject,
      content,
      mailFormat: "html",
      encoding: "UTF-8",
      askReceipt: "no"
    })
  });

  const body = await response.json().catch(() => ({}));
  const statusCode = Number(body?.status?.code || response.status || 0);

  if (!response.ok || (statusCode && statusCode >= 400)) {
    console.error("Zoho send", response.status, body?.status?.description || body?.data?.errorCode || "unknown");
    throw new Error("ZOHO_SEND_FAILED");
  }

  return { messageId: clean(body?.data?.messageId || body?.data?.mailId, 160) };
}


const EVOLUTION_MAIL_TYPES = new Set([
  "project_ready",
  "payment_received",
  "subscription_activated",
  "subscription_renewed",
  "subscription_payment_failed",
  "subscription_cancelled",
  "final_delivery_ready"
]);

function safeMailText(value, fallback = "", max = 240) {
  return htmlEscape(clean(value || fallback, max));
}

function buildEvolutionTransactionalMail(type, data = {}, portalUrl = "https://www.evolutiondesing.com/proyectos.html") {
  const currentYear = new Date().getFullYear();
  const name = safeMailText(data.clientName || data.customerName, "Cliente", 160);
  const planName = safeMailText(data.planName, "Evolution PSD", 160);
  const amount = safeMailText(data.amountLabel || data.amount, "—", 80);
  const orderId = safeMailText(data.orderId || data.transactionId, "", 180);
  const subscriptionId = safeMailText(data.subscriptionId, "", 180);
  const nextBillingDate = safeMailText(data.nextBillingDate || data.currentPeriodEnd || data.expiresAt, "—", 120);
  const paymentMethod = safeMailText(data.paymentMethod || data.provider, "—", 120);
  const projectTitle = safeMailText(data.projectTitle || data.title, "Proyecto Evolution Design", 180);
  const safePortal = htmlEscape(clean(data.portalUrl || portalUrl, 500));

  const configs = {
    payment_received: {
      subject: `Pago confirmado · Evolution Design`,
      badge: "Pago confirmado",
      micro: "Transacción aprobada",
      microText: "Tu pago fue registrado correctamente.",
      title1: "Recibimos tu pago",
      title2: "correctamente.",
      greeting: `Hola <strong>${name}</strong>,` ,
      message: `Gracias por tu pago. La transacción fue confirmada y ya quedó registrada en tu cuenta de Evolution Design.`,
      details: [
        ["Concepto", projectTitle],
        ["Monto", amount],
        ["Método", paymentMethod],
        ...(orderId ? [["ID de transacción", orderId]] : [])
      ],
      cta: "Ver en mi cuenta",
      noticeTitle: "Pago verificado",
      noticeText: "Conserva este correo como confirmación. Los detalles del servicio y su estado están disponibles dentro de tu cuenta."
    },
    subscription_activated: {
      subject: `Suscripción activada · ${planName} | Evolution Design`,
      badge: "Suscripción activa",
      micro: "Membresía activada",
      microText: "Tu acceso de suscripción ya está disponible.",
      title1: "Tu suscripción",
      title2: "está activa.",
      greeting: `Bienvenido, <strong>${name}</strong>.`,
      message: `Tu suscripción a <strong>${planName}</strong> fue activada correctamente. Ya puedes utilizar los beneficios incluidos en tu plan.`,
      details: [
        ["Plan", planName],
        ["Precio", amount],
        ["Próxima renovación", nextBillingDate],
        ...(subscriptionId ? [["ID de suscripción", subscriptionId]] : [])
      ],
      cta: "Abrir mi cuenta",
      noticeTitle: "Suscripción administrada desde tu cuenta",
      noticeText: "Desde tu panel puedes revisar el estado de la membresía, la fecha de renovación y la información asociada a tu plan."
    },
    subscription_renewed: {
      subject: `Suscripción renovada · ${planName} | Evolution Design`,
      badge: "Renovación confirmada",
      micro: "Renovación completada",
      microText: "Tu membresía continúa activa sin interrupciones.",
      title1: "Tu suscripción fue",
      title2: "renovada.",
      greeting: `Hola <strong>${name}</strong>,`,
      message: `La renovación de <strong>${planName}</strong> se procesó correctamente y tu acceso continúa activo.`,
      details: [
        ["Plan", planName],
        ["Cobro", amount],
        ["Próxima renovación", nextBillingDate],
        ...(orderId ? [["ID de pago", orderId]] : [])
      ],
      cta: "Ver mi suscripción",
      noticeTitle: "Renovación registrada",
      noticeText: "No necesitas realizar ninguna acción. Puedes consultar los datos de tu membresía desde tu cuenta."
    },
    subscription_payment_failed: {
      subject: `No pudimos procesar tu renovación · ${planName} | Evolution Design`,
      badge: "Pago pendiente",
      micro: "Renovación pendiente",
      microText: "Necesitamos que revises el estado de tu pago.",
      title1: "No pudimos completar",
      title2: "la renovación.",
      greeting: `Hola <strong>${name}</strong>,`,
      message: `El pago de renovación de <strong>${planName}</strong> no pudo confirmarse. Revisa tu cuenta para continuar con el proceso y evitar una interrupción del servicio.`,
      details: [
        ["Plan", planName],
        ["Monto", amount],
        ["Estado", "PAGO PENDIENTE"],
        ["Fecha de referencia", nextBillingDate]
      ],
      cta: "Revisar mi cuenta",
      noticeTitle: "Acción requerida",
      noticeText: "No envíes información bancaria por correo. Gestiona cualquier actualización de pago únicamente desde los canales oficiales de Evolution Design."
    },
    subscription_cancelled: {
      subject: `Suscripción cancelada · ${planName} | Evolution Design`,
      badge: "Suscripción cancelada",
      micro: "Cancelación registrada",
      microText: "La solicitud de cancelación fue procesada.",
      title1: "Tu suscripción quedó",
      title2: "cancelada.",
      greeting: `Hola <strong>${name}</strong>,`,
      message: `La suscripción a <strong>${planName}</strong> fue cancelada. Si tu plan mantiene acceso hasta el final del período contratado, podrás seguir utilizándolo hasta la fecha indicada.`,
      details: [
        ["Plan", planName],
        ["Estado", "CANCELADA"],
        ["Acceso hasta", nextBillingDate],
        ...(subscriptionId ? [["ID de suscripción", subscriptionId]] : [])
      ],
      cta: "Ver mi cuenta",
      noticeTitle: "Cancelación confirmada",
      noticeText: "Este correo confirma el cambio de estado de tu suscripción. Si no reconoces esta acción, contacta a soporte."
    },
    final_delivery_ready: {
      subject: `${projectTitle} · Entrega final disponible | Evolution Design`,
      badge: "Entrega final",
      micro: "Archivos publicados",
      microText: "La entrega final ya está disponible en tu panel.",
      title1: "Tu entrega final",
      title2: "está disponible.",
      greeting: `Hola <strong>${name}</strong>,`,
      message: `La entrega final de <strong>${projectTitle}</strong> ya fue publicada. Ingresa a tu cuenta para consultar y descargar los archivos habilitados.`,
      details: [
        ["Proyecto", projectTitle],
        ["Estado", "ENTREGA PUBLICADA"],
        ...(orderId ? [["Orden", orderId]] : [])
      ],
      cta: "Ir a mis proyectos",
      noticeTitle: "Entrega desde tu cuenta",
      noticeText: "Por seguridad, los archivos finales no se adjuntan directamente a este correo. Utiliza tu panel de Evolution Design."
    }
  };

  const cfg = configs[type];
  if (!cfg) throw new Error("MAIL_TYPE_INVALID");

  const detailRows = cfg.details.map(([label, value], index) => `
    <tr>
      <td style="padding:${index === 0 ? "15px 17px 11px" : "0 17px"};">
        ${index === 0 ? "" : '<div style="height:1px;background-color:rgba(212,184,149,.10);background-image:linear-gradient(90deg,transparent,rgba(212,184,149,.30),transparent);"></div>'}
      </td>
    </tr>
    <tr>
      <td style="padding:${index === 0 ? "0 17px 15px" : "12px 17px 14px"};">
        <div style="color:#7f7f89;font-size:8px;font-weight:800;text-transform:uppercase;letter-spacing:1.2px;margin-bottom:5px;">${label}</div>
        <div class="gmail-screen"><div class="gmail-difference"><div style="color:#ffffff;font-size:13px;line-height:1.45;font-weight:650;">${value || "—"}</div></div></div>
      </td>
    </tr>`).join("");

  const content = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<style>
  body,table,td,p,a,span,div{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif}a{text-decoration:none}
  .bg-black{background-color:#000000!important;background-image:linear-gradient(180deg,#000000 0%,#000000 100%)!important}
  .glass-panel{background-color:#101014!important;background-image:linear-gradient(135deg,rgba(255,255,255,.075) 0%,rgba(255,255,255,.018) 48%,rgba(212,184,149,.035) 100%),linear-gradient(180deg,#15151b 0%,#0b0b0f 100%)!important;border:1px solid rgba(212,184,149,.22)!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.04),0 10px 30px rgba(0,0,0,.3)}
  .glass-soft{background-color:#0d0d11!important;background-image:linear-gradient(135deg,rgba(255,255,255,.055) 0%,rgba(255,255,255,.01) 55%),linear-gradient(180deg,#101014 0%,#08080b 100%)!important;border:1px solid rgba(212,184,149,.12)!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.02)}
  .gold-glass{background-color:#b99a74!important;background-image:linear-gradient(180deg,rgba(255,255,255,.22) 0%,rgba(255,255,255,.04) 48%,rgba(0,0,0,.09) 100%),linear-gradient(180deg,#d8bf9c 0%,#b49570 100%)!important}
  .gmail-screen{background:#000000;mix-blend-mode:screen}.gmail-difference{background:#000000;mix-blend-mode:difference}
  @media screen and (max-width:600px){.container{width:100%!important;padding:14px 8px!important}.card{width:100%!important;border-radius:17px!important}.glass-header{padding:22px 18px!important}.body-pad{padding:22px 18px 24px!important}.hero-title{font-size:29px!important;line-height:1.08!important}.btn{width:100%!important;display:block!important;box-sizing:border-box!important;padding:16px 18px!important}.brand-badge{font-size:8px!important;padding:7px 9px!important}}
</style>
</head>
<body class="bg-black" bgcolor="#000000" style="margin:0;padding:0;-webkit-font-smoothing:antialiased;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;color:#000000;">${cfg.microText}</div>
<table width="100%" border="0" cellpadding="0" cellspacing="0" class="bg-black" role="presentation"><tr><td align="center" valign="top" class="container bg-black" style="padding:38px 15px;">
<table width="600" class="card" border="0" cellpadding="0" cellspacing="0" role="presentation" style="width:600px;max-width:600px;border-radius:22px;overflow:hidden;border:1px solid rgba(212,184,149,.25);background-color:#050507;background-image:linear-gradient(180deg,#09090c 0%,#030304 100%);box-shadow:0 24px 70px rgba(0,0,0,.42);">
<tr><td class="glass-header" style="padding:28px 32px 25px;background-color:#17171c;background-image:linear-gradient(145deg,rgba(255,255,255,.09) 0%,rgba(255,255,255,.018) 52%,rgba(212,184,149,.05) 100%),linear-gradient(180deg,#1d1d24 0%,#111115 100%);border-bottom:1px solid rgba(212,184,149,.25);box-shadow:inset 0 1px 0 rgba(255,255,255,.05);">
<table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation"><tr><td valign="middle" align="left"><a href="https://www.evolutiondesing.com" target="_blank"><img src="https://www.evolutiondesing.com/img/logo.png" alt="Evolution Design" width="140" style="display:block;width:140px;max-width:140px;height:auto;border:0;outline:none;"></a></td><td valign="middle" align="right" style="padding-left:12px;"><span class="brand-badge" style="display:inline-block;padding:7px 12px;background-color:#2a241e;background-image:linear-gradient(180deg,rgba(212,184,149,.24) 0%,rgba(212,184,149,.07) 100%);border:1px solid rgba(212,184,149,.40);border-radius:999px;color:#ead8c1;font-size:9px;font-weight:700;letter-spacing:1.1px;text-transform:uppercase;box-shadow:inset 0 1px 0 rgba(255,255,255,.10);white-space:nowrap;">${cfg.badge}</span></td></tr></table>
</td></tr>
<tr><td class="body-pad" style="padding:30px 34px 32px;background-color:#070709;background-image:linear-gradient(180deg,#0c0c10 0%,#050507 100%);">
<table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" class="glass-soft" style="width:100%;border-radius:14px;margin-bottom:22px;overflow:hidden;"><tr><td width="44" align="center" valign="middle" style="padding:12px 0 12px 14px;"><div style="width:28px;height:28px;line-height:28px;border-radius:999px;text-align:center;background-color:#241e18;background-image:linear-gradient(180deg,rgba(212,184,149,.25),rgba(212,184,149,.06));border:1px solid rgba(212,184,149,.32);color:#d4b895;font-size:13px;font-weight:800;">✓</div></td><td valign="middle" style="padding:11px 12px 11px 10px;"><div style="color:#d4b895;font-size:9px;font-weight:800;letter-spacing:1.35px;text-transform:uppercase;margin-bottom:3px;">${cfg.micro}</div><div class="gmail-screen"><div class="gmail-difference"><div style="color:#ffffff;font-size:11px;line-height:1.4;font-weight:600;">${cfg.microText}</div></div></div></td><td width="58" align="right" valign="middle" style="padding:10px 14px 10px 4px;"><span style="display:inline-block;width:7px;height:7px;border-radius:999px;background-color:#d4b895;box-shadow:0 0 0 5px rgba(212,184,149,.08),0 0 18px rgba(212,184,149,.35);"></span></td></tr></table>
<div style="width:42px;height:2px;background-color:rgba(212,184,149,.5);background-image:linear-gradient(90deg,#d4b895,#8f7659);border-radius:999px;margin:0 0 15px;"></div>
<div class="gmail-screen"><div class="gmail-difference"><div class="hero-title" style="margin:0;color:#ffffff;font-size:34px;font-weight:720;letter-spacing:-1.05px;line-height:1.06;">${cfg.title1}</div></div></div><div class="hero-title" style="margin:2px 0 0;color:#d4b895;font-size:34px;font-weight:720;letter-spacing:-1.05px;line-height:1.06;">${cfg.title2}</div>
<div style="height:16px;line-height:16px;">&nbsp;</div>
<table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" class="glass-panel" style="width:100%;border-radius:17px;margin-bottom:20px;overflow:hidden;"><tr><td style="padding:18px 18px 17px;border-left:2px solid #b89a76;"><div class="gmail-screen"><div class="gmail-difference"><div style="color:#ffffff;font-size:14px;line-height:1.55;margin-bottom:8px;">${cfg.greeting}</div><div style="color:#ffffff;font-size:12px;line-height:1.72;opacity:.86;">${cfg.message}</div></div></div></td></tr></table>
<table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" class="glass-panel" style="width:100%;border-radius:17px;overflow:hidden;margin-bottom:20px;"><tr><td style="padding:14px 17px 11px;border-bottom:1px solid rgba(212,184,149,.15);"><table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation"><tr><td><div style="color:#8f8f98;font-size:8px;font-weight:800;letter-spacing:1.45px;text-transform:uppercase;">Evolution Design · Notificación</div></td><td align="right"><span style="color:#d4b895;font-size:8px;font-weight:800;letter-spacing:1.15px;text-transform:uppercase;">● Confirmado</span></td></tr></table></td></tr>${detailRows}</table>
<table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="width:100%;margin-bottom:20px;"><tr><td align="center" class="gold-glass" style="border-radius:12px;border:1px solid #d4b895;box-shadow:inset 0 1px 0 rgba(255,255,255,.32),0 8px 22px rgba(180,149,112,.16);"><a href="${safePortal}" class="btn" target="_blank" style="display:block;padding:16px 22px;color:#17120d;font-size:13px;font-weight:850;letter-spacing:.55px;text-transform:uppercase;">${cfg.cta}&nbsp;&nbsp;→</a></td></tr></table>
<table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" class="glass-soft" style="width:100%;border-radius:14px;overflow:hidden;margin-bottom:20px;"><tr><td width="38" valign="top" align="center" style="padding:14px 0 14px 13px;"><div style="width:25px;height:25px;line-height:25px;text-align:center;border-radius:8px;background-color:#211c17;background-image:linear-gradient(180deg,rgba(212,184,149,.18),rgba(212,184,149,.03));border:1px solid rgba(212,184,149,.22);font-size:12px;">◆</div></td><td style="padding:13px 14px 13px 9px;"><div style="color:#d4b895;font-size:9px;font-weight:800;letter-spacing:.8px;text-transform:uppercase;margin-bottom:4px;">${cfg.noticeTitle}</div><div class="gmail-screen"><div class="gmail-difference"><div style="color:#ffffff;font-size:10px;line-height:1.62;opacity:.76;">${cfg.noticeText}</div></div></div></td></tr></table>
<table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="width:100%;border-top:1px solid rgba(212,184,149,.15);border-bottom:1px solid rgba(212,184,149,.15);"><tr><td width="50%" valign="top" style="padding:14px 12px 14px 0;"><div style="color:#d4b895;font-size:9px;font-weight:800;margin-bottom:4px;">Evolution Design</div><a href="https://www.evolutiondesing.com" style="color:#9c9ca5;font-size:9px;">www.evolutiondesing.com</a><div class="gmail-screen"><div class="gmail-difference"><div style="color:#ffffff;font-size:8px;margin-top:5px;line-height:1.4;opacity:.55;">Arquitectura · Diseño · Desarrollo</div></div></div></td><td width="50%" valign="top" style="padding:14px 0 14px 15px;border-left:1px solid rgba(212,184,149,.15);"><div class="gmail-screen"><div class="gmail-difference"><div style="color:#ffffff;font-size:9px;font-weight:800;margin-bottom:4px;">Dingloft</div></div></div><a href="https://www.dingloft.com" style="color:#9c9ca5;font-size:9px;">www.dingloft.com</a><div class="gmail-screen"><div class="gmail-difference"><div style="color:#ffffff;font-size:8px;margin-top:5px;line-height:1.4;opacity:.55;">Música · Tecnología · Recursos Digitales</div></div></div></td></tr></table>
<div style="padding:17px 0 0;"><div style="color:#d4b895;font-size:8px;font-weight:800;letter-spacing:1.05px;text-transform:uppercase;margin-bottom:6px;">Mensaje generado automáticamente</div><div class="gmail-screen"><div class="gmail-difference"><div style="color:#ffffff;font-size:9px;line-height:1.65;opacity:.55;">Este correo fue generado automáticamente por Evolution Design como resultado de una acción registrada en tu cuenta.<br><br><strong>Por favor, no respondas directamente a este mensaje.</strong> Para asistencia utiliza tu panel o escribe a support@evolutiondesing.com.</div></div></div></div>
</td></tr>
<tr><td style="padding:23px 32px 25px;text-align:center;background-color:#0c0c10;background-image:linear-gradient(145deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 60%),linear-gradient(180deg,#101014 0%,#08080a 100%);border-top:1px solid rgba(212,184,149,.15);box-shadow:inset 0 1px 0 rgba(255,255,255,.02);"><div style="color:#d4b895;font-size:9px;font-weight:800;letter-spacing:2px;margin-bottom:8px;">EVOLUTION GROUP</div><div class="gmail-screen"><div class="gmail-difference"><div style="color:#ffffff;font-size:9px;line-height:1.6;opacity:.48;">© ${currentYear} Evolution Group · Todos los derechos reservados.<br>Evolution Design y Dingloft forman parte del ecosistema Evolution Group.</div></div></div></td></tr>
</table></td></tr></table>
</body></html>`;

  return { subject: cfg.subject.slice(0, 220), content };
}

async function sendZohoHtmlMail(env, { toAddress, subject, content }) {
  const cfg = zohoConfig(env);
  const token = await zohoAccessToken(env);
  const accountId = await zohoAccountId(env);

  const response = await fetch(`${cfg.mailBase}/api/accounts/${encodeURIComponent(accountId)}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
      "content-type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({
      fromAddress: cfg.fromAddress,
      toAddress,
      subject,
      content,
      mailFormat: "html",
      encoding: "UTF-8",
      askReceipt: "no"
    })
  });

  const body = await response.json().catch(() => ({}));
  const statusCode = Number(body?.status?.code || response.status || 0);
  if (!response.ok || (statusCode && statusCode >= 400)) {
    console.error("Zoho send", response.status, body?.status?.description || body?.data?.errorCode || "unknown");
    throw new Error("ZOHO_SEND_FAILED");
  }

  return { messageId: clean(body?.data?.messageId || body?.data?.mailId, 160) };
}

// ============================================================================
// EVOLUTION PAYMENT BACKEND · PAYPAL + FIRESTORE ADMIN · SIN FIREBASE BLAZE
// ============================================================================

let paypalTokenCache = { token: "", expiresAt: 0 };
let googleTokenCache = { token: "", expiresAt: 0 };

async function requireFirebaseUser(idToken) {
  if (!idToken) throw new Error("AUTH_MISSING");

  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(FIREBASE_WEB_API_KEY)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idToken })
    }
  );

  const body = await response.json().catch(() => ({}));
  if (!response.ok || !Array.isArray(body.users) || !body.users[0]) {
    throw new Error("AUTH_INVALID");
  }

  const user = body.users[0];
  const uid = clean(user.localId, 160);
  const email = validEmail(user.email);
  if (!uid) throw new Error("AUTH_INVALID");

  return {
    uid,
    email,
    displayName: clean(user.displayName || "", 160)
  };
}

function firebaseServiceAccountConfig(env) {
  let email = clean(env.FIREBASE_SERVICE_ACCOUNT_EMAIL, 300);
  let privateKey = String(env.FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY || "");
  let projectId = FIREBASE_PROJECT_ID;

  if (env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    try {
      const parsed = JSON.parse(String(env.FIREBASE_SERVICE_ACCOUNT_JSON));
      email = clean(parsed.client_email || email, 300);
      privateKey = String(parsed.private_key || privateKey || "");
      projectId = clean(parsed.project_id || projectId, 180) || FIREBASE_PROJECT_ID;
    } catch (error) {
      throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON_INVALID");
    }
  }

  privateKey = privateKey.replace(/\\n/g, "\n").trim();
  if (!email || !privateKey.includes("BEGIN PRIVATE KEY")) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_INCOMPLETE");
  }
  if (projectId && projectId !== FIREBASE_PROJECT_ID) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_PROJECT_MISMATCH");
  }

  return { email, privateKey };
}

function base64UrlBytes(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlText(value) {
  return base64UrlBytes(new TextEncoder().encode(String(value)));
}

function pemToArrayBuffer(pem) {
  const raw = String(pem)
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  const binary = atob(raw);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function googleFirestoreAccessToken(env) {
  if (googleTokenCache.token && Date.now() < googleTokenCache.expiresAt) {
    return googleTokenCache.token;
  }

  const cfg = firebaseServiceAccountConfig(env);
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(cfg.privateKey),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlText(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64UrlText(JSON.stringify({
    iss: cfg.email,
    scope: "https://www.googleapis.com/auth/datastore",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
  }));
  const unsigned = `${header}.${payload}`;
  const signature = new Uint8Array(await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned)
  ));
  const assertion = `${unsigned}.${base64UrlBytes(signature)}`;

  const form = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion
  });

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: form.toString()
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) {
    console.error("Google OAuth", response.status, body?.error || "unknown");
    throw new Error("FIREBASE_ADMIN_OAUTH_FAILED");
  }

  const ttl = Math.max(300, Number(body.expires_in || 3600));
  googleTokenCache = {
    token: String(body.access_token),
    expiresAt: Date.now() + Math.max(60, ttl - 300) * 1000
  };
  return googleTokenCache.token;
}

function firestoreAdminUrl(parts = []) {
  const path = parts.map(x => encodeURIComponent(String(x))).join("/");
  return `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/${path}`;
}

function toFirestoreValueDeep(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(toFirestoreValueDeep) } };
  }
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return { nullValue: null };
    return Number.isInteger(value)
      ? { integerValue: String(value) }
      : { doubleValue: value };
  }
  if (typeof value === "object") {
    const fields = {};
    for (const [key, item] of Object.entries(value)) {
      if (item === undefined) continue;
      fields[key] = toFirestoreValueDeep(item);
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(value) };
}

function toFirestoreFieldsDeep(data = {}) {
  const fields = {};
  for (const [key, value] of Object.entries(data || {})) {
    if (value === undefined) continue;
    fields[key] = toFirestoreValueDeep(value);
  }
  return fields;
}

async function adminGetDocument(env, parts, allowMissing = false) {
  const token = await googleFirestoreAccessToken(env);
  const response = await fetch(firestoreAdminUrl(parts), {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }
  });
  if (response.status === 404 && allowMissing) {
    return { exists: false, data: null, name: "", updateTime: "" };
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error("Firestore admin read", response.status, body?.error?.message || "unknown");
    throw new Error("FIRESTORE_ADMIN_READ_FAILED");
  }
  return {
    exists: true,
    data: fromFirestoreFields(body.fields || {}),
    name: body.name || "",
    updateTime: body.updateTime || ""
  };
}

async function adminPatchDocument(env, parts, patch = {}) {
  const token = await googleFirestoreAccessToken(env);
  const params = new URLSearchParams();
  for (const key of Object.keys(patch)) params.append("updateMask.fieldPaths", key);
  const url = `${firestoreAdminUrl(parts)}${params.toString() ? `?${params.toString()}` : ""}`;
  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "content-type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({ fields: toFirestoreFieldsDeep(patch) })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error("Firestore admin patch", response.status, body?.error?.message || "unknown");
    throw new Error("FIRESTORE_ADMIN_WRITE_FAILED");
  }
  return body;
}

async function adminSetDocument(env, parts, data = {}) {
  const token = await googleFirestoreAccessToken(env);
  const response = await fetch(firestoreAdminUrl(parts), {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "content-type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({ fields: toFirestoreFieldsDeep(data) })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error("Firestore admin set", response.status, body?.error?.message || "unknown");
    throw new Error("FIRESTORE_ADMIN_WRITE_FAILED");
  }
  return body;
}

async function adminRunQuery(env, structuredQuery) {
  const token = await googleFirestoreAccessToken(env);
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents:runQuery`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "content-type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({ structuredQuery })
  });
  const body = await response.json().catch(() => ([]));
  if (!response.ok || !Array.isArray(body)) {
    console.error("Firestore admin query", response.status);
    throw new Error("FIRESTORE_ADMIN_QUERY_FAILED");
  }
  return body.filter(x => x?.document).map(x => ({
    name: x.document.name || "",
    id: decodeURIComponent(String(x.document.name || "").split("/").pop() || ""),
    data: fromFirestoreFields(x.document.fields || {})
  }));
}


// ================================================================
// ENTREGA ESTIMADA · EVOLUTION DESIGN
// Arquitectura: 3 días hábiles.
// Diseño Web: 5 días hábiles (1 semana laboral).
// Sábado y domingo no cuentan.
// Hora fija por proyecto: aleatoria entre 22:00 y 22:59,
// usando la zona horaria de Guatemala (UTC-6).
// ================================================================
function estimatedDeliveryAtFromPayment(paymentDate = new Date(), businessDays = 3) {
  const base = paymentDate instanceof Date ? paymentDate : new Date(paymentDate);
  const safeBase = Number.isFinite(base.getTime()) ? base : new Date();

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Guatemala",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(safeBase);

  const pick = type => Number(parts.find(p => p.type === type)?.value || 0);
  const year = pick("year");
  const month = pick("month");
  const day = pick("day");

  // Usamos UTC únicamente como calendario neutro para sumar fechas.
  const calendar = new Date(Date.UTC(year, month - 1, day));
  let added = 0;
  const daysToAdd = Math.max(1, Math.min(60, Number.parseInt(businessDays, 10) || 3));

  while (added < daysToAdd) {
    calendar.setUTCDate(calendar.getUTCDate() + 1);
    const weekday = calendar.getUTCDay();
    if (weekday !== 0 && weekday !== 6) added++;
  }

  const randomMinute = (() => {
    try {
      const values = new Uint32Array(1);
      crypto.getRandomValues(values);
      return values[0] % 60;
    } catch (_) {
      return Math.floor(Math.random() * 60);
    }
  })();

  // Guatemala no usa horario de verano y permanece en UTC-6.
  // 22:MM GT = 04:MM UTC del día siguiente.
  return new Date(Date.UTC(
    calendar.getUTCFullYear(),
    calendar.getUTCMonth(),
    calendar.getUTCDate(),
    28,
    randomMinute,
    0,
    0
  ));
}

function paypalConfig(env) {
  const clientId = clean(env.PAYPAL_CLIENT_ID, 400);
  const clientSecret = clean(env.PAYPAL_CLIENT_SECRET, 800);
  let apiBase = clean(env.PAYPAL_API_BASE || "https://api-m.paypal.com", 240).replace(/\/$/, "");
  if (!/^https:\/\/api-m\.(sandbox\.)?paypal\.com$/i.test(apiBase)) {
    apiBase = "https://api-m.paypal.com";
  }
  if (!clientId || !clientSecret) throw new Error("PAYPAL_CONFIG_INCOMPLETE");
  return { clientId, clientSecret, apiBase };
}

async function paypalAccessToken(env) {
  if (paypalTokenCache.token && Date.now() < paypalTokenCache.expiresAt) {
    return paypalTokenCache.token;
  }
  const cfg = paypalConfig(env);
  const response = await fetch(`${cfg.apiBase}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${cfg.clientId}:${cfg.clientSecret}`)}`,
      "content-type": "application/x-www-form-urlencoded",
      Accept: "application/json"
    },
    body: "grant_type=client_credentials"
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) {
    console.error("PayPal OAuth", response.status, body?.error || "unknown");
    throw new Error("PAYPAL_OAUTH_FAILED");
  }
  const ttl = Math.max(300, Number(body.expires_in || 3600));
  paypalTokenCache = {
    token: String(body.access_token),
    expiresAt: Date.now() + Math.max(60, ttl - 300) * 1000
  };
  return paypalTokenCache.token;
}

async function paypalFetch(env, path, { method = "GET", body, requestId } = {}) {
  const cfg = paypalConfig(env);
  const token = await paypalAccessToken(env);
  const headers = {
    Authorization: `Bearer ${token}`,
    "content-type": "application/json",
    Accept: "application/json"
  };
  if (requestId) headers["PayPal-Request-Id"] = clean(requestId, 108);
  const response = await fetch(`${cfg.apiBase}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

function numberInRange(value, name, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`QUOTE_${name}_INVALID`);
  return n;
}

function allowedInteger(value, name, values) {
  const n = Number(value);
  if (!Number.isInteger(n) || !values.includes(n)) throw new Error(`QUOTE_${name}_INVALID`);
  return n;
}

function allowedChoice(value, name, values) {
  const s = clean(value, 80);
  if (!values.includes(s)) throw new Error(`QUOTE_${name}_INVALID`);
  return s;
}

function moneyNumber(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function moneyText(value) {
  return moneyNumber(value).toFixed(2);
}

function canonicalVideoPriceFromSeconds(value) {
  const seconds = Math.floor(Number(value));
  if (!Number.isFinite(seconds) || seconds < 1 || seconds > 86400) throw new Error("VIDEO_DURATION_INVALID");
  if (seconds <= 60) return { seconds, extraMinutes: 0, priceUsd: 30 };
  const extraMinutes = Math.ceil((seconds - 60) / 60);
  return { seconds, extraMinutes, priceUsd: 30 + (extraMinutes * 8) };
}

function buildCanonicalArchitectureQuote(projectType, raw = {}) {
  const allowed = new Set(["Planos 2D", "Visualización 3D", "Diseño de Fachada"]);
  if (!allowed.has(projectType)) throw new Error("QUOTE_PROJECT_TYPE_INVALID");

  if (projectType === "Planos 2D") {
    const width = numberInRange(raw.width, "WIDTH", 0.01, 10000);
    const length = numberInRange(raw.length, "LENGTH", 0.01, 10000);
    const levels = allowedInteger(raw.levels, "LEVELS", [1, 2, 3, 4]);
    const packageCode = allowedChoice(raw.packageCode || "basico", "PACKAGE", ["basico", "premium"]);
    const area = width * length * levels;
    const premium = packageCode === "premium";
    const base = premium ? 800 : 390;
    const extraRate = premium ? 2 : 1.10;
    const total = moneyNumber(base + (area > 400 ? (area - 400) * extraRate : 0));

    return {
      amount: total,
      projectConfig: {
        category: "Planos 2D",
        packageCode,
        packageName: premium ? "Paquete Planos 2D - Premium" : "Paquete Planos 2D - Básico",
        shortPackageName: premium ? "Premium 2D" : "Básico 2D",
        specs: [
          { label: "Terreno", value: `${width} × ${length} m` },
          { label: "Niveles", value: `${levels}` },
          { label: "Área total", value: `${area.toFixed(2)} m²` }
        ],
        uploadTitle: "Archivos Requeridos",
        uploadCopy: "Sube tu archivo AutoCAD (DWG/DWF), PDF de medidas o una imagen clara de tu dibujo/plano.",
        uploadFormats: "PDF, DWG, DWF, PNG, JPG · Máx. 50MB",
        pricingInput: { width, length, levels, packageCode },
        includedHighlights: premium ? [
          "Arquitectura minimalista contemporánea de alta gama",
          "Plano Arquitectónico Amueblado y Acotado por nivel",
          "2 cortes longitudinales y 2 transversales",
          "Fachadas de los 4 lados",
          "Cimentación con detalles constructivos",
          "Columnas, cadenas y armados",
          "Losas / entrepiso y techo",
          "Planos hidráulico, drenajes y eléctrico completos",
          "Acabados, puertas y ventanas",
          "Entrega PDF / CAD lista para trámites y obra"
        ] : [
          "Estilo minimalista contemporáneo",
          "Plano Arquitectónico Amueblado por nivel",
          "Plano Acotado para albañilería",
          "1 corte longitudinal y 1 transversal",
          "Fachadas de los 4 lados",
          "Entrega PDF / CAD lista para obra e impresión"
        ],
        baseUsd: total
      }
    };
  }

  if (projectType === "Visualización 3D") {
    const width = numberInRange(raw.width, "WIDTH", 0.01, 10000);
    const length = numberInRange(raw.length, "LENGTH", 0.01, 10000);
    const levels = allowedInteger(raw.levels, "LEVELS", [1, 2, 3, 4]);
    const serviceCode = allowedChoice(raw.serviceCode || "basico", "SERVICE", ["basico", "profesional", "premium", "cuantificacion"]);
    const area = width * length * levels;
    const configs = {
      basico: {
        category: "Visualización 3D", packageName: "Paquete 3D - Básico", shortPackageName: "Básico 3D",
        uploadCopy: "Sube tu archivo 2D en PDF, AutoCAD DWG/DWF o una imagen clara de tu plano.",
        includedHighlights: ["Modelado 3D profesional", "8 renders realistas", "Fachada incluida", "Resolución HD", "Materiales e iluminación básicos", "1 revisión incluida"]
      },
      profesional: {
        category: "Visualización 3D", packageName: "Paquete 3D - Profesional", shortPackageName: "Profesional 3D",
        uploadCopy: "Sube tu archivo 2D (PDF, DWG/DWF o foto clara del plano) y fotografías de referencia del lugar para trabajar el hiperrealismo.",
        includedHighlights: ["Modelado 3D completo", "16 renders realistas", "Fachada frontal y posterior", "3 videos realistas de 8 segundos", "Entrega en alta resolución", "2 revisiones incluidas"]
      },
      premium: {
        category: "Visualización 3D", packageName: "Paquete 3D - Premium", shortPackageName: "Premium 3D",
        uploadCopy: "Sube tu archivo 2D (PDF, DWG/DWF o foto clara del plano) y fotografías de referencia del lugar para el nivel de hiperrealismo Premium.",
        includedHighlights: ["Modelado 3D completo", "26 renders realistas", "Recorrido virtual de 1 min 44 s (13 clips de 8 s)", "Plano amueblado", "Iluminación avanzada", "Diseño de paisaje conceptual", "Resolución 4K", "3 revisiones incluidas"]
      },
      cuantificacion: {
        category: "Cuantificación de Materiales", packageName: "Cuantificación de Materiales", shortPackageName: "Cuantificación",
        uploadCopy: "Sube los planos, medidas o archivos de referencia necesarios para calcular las cantidades de materiales de tu obra.",
        includedHighlights: ["Listado exacto de materiales", "Obra gris: cemento, arena, grava, block y ladrillo", "Hierro para construcción, losa y lámina", "Acabados: piso, repello, puertas, ventanas y pintura"]
      }
    };
    let total = 0;
    if (serviceCode === "basico") total = 300 + (area > 400 ? (area - 400) * 3 : 0);
    if (serviceCode === "profesional") total = 499 + (area > 400 ? (area - 400) * 3 : 0);
    if (serviceCode === "premium") total = 949 + (area > 400 ? (area - 400) * 3 : 0);
    if (serviceCode === "cuantificacion") total = area * 1.75;
    total = moneyNumber(total);
    const cfg = configs[serviceCode];
    return {
      amount: total,
      projectConfig: {
        ...cfg,
        packageCode: serviceCode,
        specs: [
          { label: "Terreno", value: `${width} × ${length} m` },
          { label: "Niveles", value: `${levels}` },
          { label: "Área total", value: `${area.toFixed(2)} m²` }
        ],
        uploadTitle: "Archivos Requeridos",
        uploadFormats: "PDF, DWG, DWF, PNG, JPG · Máx. 50MB",
        pricingInput: { width, length, levels, serviceCode },
        baseUsd: total
      }
    };
  }

  const width = numberInRange(raw.width, "WIDTH", 0.01, 10000);
  const height = numberInRange(raw.height, "HEIGHT", 0.01, 10000);
  const levels = allowedInteger(raw.levels, "LEVELS", [1, 2, 3, 4]);
  const projectKind = allowedChoice(raw.projectKind || "Vivienda", "PROJECT_KIND", ["Vivienda", "Comercio", "Edificio"]);
  const complexity = numberInRange(raw.complexity, "COMPLEXITY", 1, 1.6);
  if (![1, 1.3, 1.6].some(x => Math.abs(x - complexity) < 0.0001)) throw new Error("QUOTE_COMPLEXITY_INVALID");
  const renderOn = raw.renderOn === true;
  const area = width * height;
  const complexityName = complexity === 1 ? "Estándar" : complexity === 1.6 ? "Premium" : "Profesional";
  let subtotal = area * 1.50 * complexity;
  if (subtotal < 80) subtotal = 80;
  const extraLevel = levels === 3 ? 25 : levels === 4 ? 30 : 0;
  const renderCost = renderOn ? 40 : 0;
  const total = moneyNumber(subtotal + extraLevel + renderCost);

  return {
    amount: total,
    projectConfig: {
      category: "Diseño de Fachada",
      packageCode: complexityName.toLowerCase(),
      packageName: `Diseño de Fachada - ${complexityName}`,
      shortPackageName: complexityName,
      specs: [
        { label: "Fachada", value: `${width} × ${height} m` },
        { label: "Niveles", value: levels === 4 ? "4+" : `${levels}` },
        { label: "Proyecto", value: projectKind },
        { label: "Área", value: `${area.toFixed(2)} m²` },
        { label: "Renders", value: renderOn ? "3 hiperrealistas" : "No incluidos" }
      ],
      uploadTitle: "Referencias de Fachada",
      uploadCopy: renderOn
        ? "Sube una foto clara de la fachada o terreno y sus medidas. También puedes adjuntar un dibujo de tu idea y fotografías claras del lugar para los renders hiperrealistas."
        : "Sube una foto clara de tu fachada actual o terreno y sus medidas. Opcionalmente puedes adjuntar un dibujo a mano alzada de tu idea.",
      uploadFormats: "PDF, PNG, JPG, DWG, DWF · Máx. 50MB",
      pricingInput: { width, height, levels, projectKind, complexity, renderOn },
      includedHighlights: [
        `Nivel de diseño ${complexityName}`,
        "3 propuestas distintas de fachada",
        "Diseño estético y funcional con selección de materiales",
        ...(renderOn ? ["3 renders hiperrealistas de la propuesta elegida"] : [])
      ],
      baseUsd: total
    }
  };
}

function sanitizeGeo(raw = {}) {
  return {
    city: clean(raw.city, 80),
    region: clean(raw.region, 80),
    country: clean(raw.country, 100),
    countryCode: clean(raw.countryCode, 4).toUpperCase(),
    currency: clean(raw.currency, 8).toUpperCase()
  };
}

function captureFromPayPalOrder(order) {
  return order?.purchase_units?.[0]?.payments?.captures?.[0] || null;
}

function paypalOrderAmount(order) {
  return order?.purchase_units?.[0]?.amount || null;
}

function verifyMoney(value, currency, expectedValue, expectedCurrency) {
  if (String(currency || "").toUpperCase() !== String(expectedCurrency || "").toUpperCase()) {
    throw new Error("PAYPAL_CURRENCY_MISMATCH");
  }
  if (Math.abs(Number(value) - Number(expectedValue)) > 0.009) {
    throw new Error("PAYPAL_AMOUNT_MISMATCH");
  }
}

function paymentPublicError(error) {
  const code = String(error?.message || "");
  const map = {
    AUTH_MISSING: "Debes iniciar sesión antes de pagar.",
    AUTH_INVALID: "Tu sesión ya no es válida. Inicia sesión nuevamente.",
    PAYPAL_CONFIG_INCOMPLETE: "PayPal todavía no está configurado en el servidor.",
    FIREBASE_SERVICE_ACCOUNT_INCOMPLETE: "El acceso seguro a Firestore todavía no está configurado en el servidor.",
    FIREBASE_SERVICE_ACCOUNT_JSON_INVALID: "La cuenta de servicio de Firebase no está configurada correctamente.",
    FIREBASE_SERVICE_ACCOUNT_PROJECT_MISMATCH: "La cuenta de servicio no corresponde al proyecto de Evolution Design.",
    PROJECT_NOT_FOUND: "No encontramos este proyecto.",
    PROJECT_ALREADY_PAID: "Este proyecto ya está pagado.",
    PROJECT_PAYMENT_NOT_REQUESTED: "Este proyecto no tiene un cobro pendiente habilitado.",
    PROJECT_PAYMENT_AMOUNT_INVALID: "El monto pendiente del proyecto no es válido.",
    PAYPAL_ORDER_NOT_FOUND: "Esta orden PayPal no fue creada por Evolution Design.",
    PAYPAL_ORDER_OWNER_MISMATCH: "Esta orden pertenece a otra cuenta.",
    PAYPAL_AMOUNT_MISMATCH: "PayPal devolvió un monto distinto al autorizado.",
    PAYPAL_CURRENCY_MISMATCH: "PayPal devolvió una moneda distinta a la autorizada.",
    PAYPAL_CAPTURE_NOT_COMPLETED: "PayPal todavía no confirmó el pago.",
    PAYPAL_ORDER_CONTEXT_MISMATCH: "La orden PayPal no coincide con esta compra.",
    WEB_PLAN_INVALID: "El plan de diseño web no es válido.",
    WEB_PLAN_MISMATCH: "El plan seleccionado no coincide con el brief guardado.",
    WEB_REQUEST_NOT_FOUND: "No encontramos el brief de diseño web asociado a tu cuenta.",
    PAYMENT_RECEIPT_INVALID: "El comprobante no es válido o es demasiado pesado.",
    BINANCE_PAYMENT_INVALID: "No pudimos preparar el pago de Binance Pay.",
    REGIONAL_PRICE_COUNTRY_MISMATCH: "El precio regional de Guatemala no coincide con el país de pago.",
    REGIONAL_PRICE_COUNTRY_UNVERIFIED: "No pudimos verificar Guatemala como país de pago para aplicar el precio regional.",
    STORE_PRODUCT_UNAVAILABLE: "Esta unidad ya fue confirmada por otro pedido.",
    STORE_ADDRESS_INCOMPLETE: "Completa Departamento, Municipio/Ciudad, Poblado, dirección y referencia.",
    STORE_NAME_INVALID: "Ingresa tu nombre completo.",
    STORE_RECIPIENT_INVALID: "Ingresa el nombre de quien recibirá.",
    STORE_TERMS_REQUIRED: "Debes aceptar la guía y condiciones de compra."
  };
  if (map[code]) return map[code];
  if (code.startsWith("QUOTE_")) return "Los datos de la cotización cambiaron. Recalcula el precio e inténtalo nuevamente.";
  return "No se pudo procesar el pago seguro. Inténtalo nuevamente.";
}

async function sha256Hex(value) {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value))));
  return [...hash].map(x => x.toString(16).padStart(2, "0")).join("");
}


// ================================================================
// DISEÑO WEB · precios canónicos y brief seguro
// El navegador nunca decide el monto final de PayPal.
// ================================================================
const WEB_DESIGN_PLANS = Object.freeze({
  landing: {
    id: "landing", name: "Sitio Web Esencial", amount: 500, gtqAmount: 2000, annualRenewalUsd: 60,
    category: "Diseño Web · Sitio Web Esencial",
    included: ["Código limpio desarrollado a medida", "UI/UX responsive", "Formulario + WhatsApp", "SEO técnico base + SSL/HTTPS", "Dominio + correo empresarial · primer año"]
  },
  pro: {
    id: "pro", name: "Sitio Web Pro", amount: 2800, annualRenewalUsd: 100,
    category: "Diseño Web · Sitio Web Pro",
    included: ["Hasta 5 páginas base + contenido dinámico administrable", "Portal privado para publicar y editar contenido", "UI/UX premium + animaciones avanzadas", "Formularios y automatizaciones según alcance", "Roles de acceso y control administrativo", "Asistencia técnica prioritaria Evolution", "SEO técnico + seguridad reforzada", "Dominio + correo empresarial · primer año"]
  },
  ecommerce: {
    id: "ecommerce", name: "Plataforma Web Avanzada", amount: 5890, annualRenewalUsd: 200,
    category: "Diseño Web · Plataforma Web Avanzada",
    included: ["Portal administrativo personalizado", "E-commerce con hasta 10,000 productos cuando aplique", "Productos / contenido / usuarios / registros administrables", "Marketplaces, membresías, reservas, academias o directorios según proyecto", "Inventario, pedidos y clientes cuando aplique", "Pagos y checkout cuando aplique", "Automatización y panel administrativo según alcance", "Asistencia técnica prioritaria Evolution", "UI/UX premium + seguridad reforzada", "Dominio + correo empresarial · primer año"]
  }
});

function canonicalWebPlan(planId) {
  const key = clean(planId, 32).toLowerCase();
  const plan = WEB_DESIGN_PLANS[key];
  if (!plan) throw new Error("WEB_PLAN_INVALID");
  return plan;
}

function cleanStringArray(value, maxItems = 20, maxLen = 160) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, maxItems).map(x => clean(x, maxLen)).filter(Boolean);
}

function sanitizeWebBrief(raw = {}) {
  return {
    name: clean(raw.name, 120),
    businessName: clean(raw.businessName, 140),
    businessType: clean(raw.businessType, 120),
    existingSite: clean(raw.existingSite, 40),
    goals: cleanStringArray(raw.goals, 12, 140),
    features: cleanStringArray(raw.features, 20, 160),
    style: clean(raw.style, 120),
    email: validEmail(raw.email) || "",
    phone: clean(raw.phone, 60),
    billingCountryCode: clean(raw.billingCountryCode, 8).toUpperCase(),
    domainIdea: clean(raw.domainIdea, 180),
    timeline: clean(raw.timeline, 100),
    referenceSites: clean(raw.referenceSites, 1200),
    notes: clean(raw.notes, 1600),
    brandLogoName: clean(raw.brandLogoName, 160),
    brandLogoType: clean(raw.brandLogoType, 100)
  };
}

function webProjectConfig(plan, brief, webRequestId) {
  return {
    category: "Diseño Web",
    packageCode: plan.id,
    packageName: plan.name,
    shortPackageName: plan.name,
    description: `${plan.name} para ${brief.businessName || "cliente Evolution Design"}`,
    specs: brief.features || [],
    uploadTitle: "Contenido para tu sitio web",
    uploadCopy: "Sube logotipo, fotografías, textos, referencias y cualquier material necesario para desarrollar tu sitio.",
    uploadFormats: "Imágenes, logos, documentos, textos y referencias",
    includedHighlights: plan.included || [],
    custom: false,
    baseUsd: plan.amount,
    annualRenewalUsd: Number(plan.annualRenewalUsd || 0),
    renewalStartsAfterYear: 1,
    renewalType: "essential_services_annual",
    webRequestId,
    brandLogoRequestId: webRequestId,
    brandLogoName: brief.brandLogoName || ""
  };
}

async function getOwnedWebRequest(env, user, webRequestId, planId) {
  const id = clean(webRequestId, 160);
  if (!/^[A-Za-z0-9_-]{8,160}$/.test(id)) throw new Error("WEB_REQUEST_NOT_FOUND");
  const snap = await adminGetDocument(env, ["webRequests", id], true);
  if (!snap.exists) throw new Error("WEB_REQUEST_NOT_FOUND");
  const requestData = snap.data || {};
  if (String(requestData.userUid || "") !== user.uid) throw new Error("WEB_REQUEST_NOT_FOUND");
  const plan = canonicalWebPlan(planId || requestData.planId);
  if (clean(requestData.planId, 32) !== plan.id) throw new Error("WEB_PLAN_MISMATCH");
  const brief = sanitizeWebBrief(requestData);
  return { id, requestData, plan, brief };
}

async function usdGtqRate() {
  try {
    const r = await fetch("https://open.er-api.com/v6/latest/USD", { cf: { cacheTtl: 900, cacheEverything: true } });
    const d = await r.json().catch(() => null);
    const rate = Number(d?.rates?.GTQ || 0);
    if (r.ok && rate > 0) return rate;
  } catch (_) {}
  return 7.65;
}

async function resolveWebRegionalPricing(request, plan, requestData = {}) {
  const edgeCountry = clean(request.cf?.country || "", 4).toUpperCase();
  const declaredCountry = clean(requestData.billingCountryCode || "", 8).toUpperCase();
  const fixedGtq = Number(plan?.gtqAmount || 0);

  if (edgeCountry === "GT" && declaredCountry === "GT" && fixedGtq > 0) {
    const fxRate = await usdGtqRate();
    return {
      regional: true,
      regionalCountry: "GT",
      edgeCountry,
      declaredCountry,
      gtqAmount: moneyNumber(fixedGtq),
      fxRate,
      usdAmount: moneyNumber(fixedGtq / fxRate)
    };
  }

  return {
    regional: false,
    regionalCountry: "",
    edgeCountry,
    declaredCountry,
    gtqAmount: 0,
    fxRate: 0,
    usdAmount: moneyNumber(plan.amount)
  };
}

function paypalApprovedCountryCode(order) {
  const code =
    order?.payment_source?.card?.billing_address?.country_code ||
    order?.payment_source?.paypal?.address?.country_code ||
    order?.payer?.address?.country_code ||
    order?.purchase_units?.[0]?.shipping?.address?.country_code ||
    "";
  return clean(code, 4).toUpperCase();
}

function validEmbeddedReceipt(receipt = {}) {
  const dataUrl = String(receipt?.dataUrl || "");
  const type = clean(receipt?.type, 120);
  if (!dataUrl.startsWith("data:") || dataUrl.length > 650000) throw new Error("PAYMENT_RECEIPT_INVALID");
  if (!(type.startsWith("image/") || type === "application/pdf")) throw new Error("PAYMENT_RECEIPT_INVALID");
  return {
    dataUrl,
    name: clean(receipt?.name || "comprobante", 180),
    type,
    size: Math.max(0, Math.min(Number(receipt?.size || 0), 8 * 1024 * 1024))
  };
}

function validEmbeddedCreativeReference(file = {}) {
  const dataUrl = String(file?.dataUrl || "");
  const type = clean(file?.type, 120);
  if (!dataUrl.startsWith("data:") || dataUrl.length > 650000) throw new Error("GRAPHIC_REFERENCE_INVALID");
  if (!(type.startsWith("image/") || type === "application/pdf")) throw new Error("GRAPHIC_REFERENCE_INVALID");
  return {
    dataUrl,
    name: clean(file?.name || "referencia", 180),
    type,
    size: Math.max(0, Math.min(Number(file?.size || 0), 8 * 1024 * 1024))
  };
}

async function paymentContextId(mode, uid, detail, amount) {
  const hash = await sha256Hex(`${mode}|${uid}|${detail}|${moneyText(amount)}|USD`);
  return `evo:${mode}:${hash.slice(0, 72)}`.slice(0, 127);
}

function safePayPalDocId(value) {
  const out = clean(value, 140).replace(/[^A-Za-z0-9_-]/g, "");
  if (!out || out.length < 5) throw new Error("PAYPAL_ORDER_NOT_FOUND");
  return out;
}

async function getPendingPayPalOrder(env, orderId) {
  const safeId = safePayPalDocId(orderId);
  const snap = await adminGetDocument(env, ["paypalOrders", safeId], true);
  if (!snap.exists) throw new Error("PAYPAL_ORDER_NOT_FOUND");
  return { id: safeId, ...snap.data };
}

async function createPayPalOrderRoute(request, env, origin) {
  let user;
  try {
    user = await requireFirebaseUser(bearerToken(request));
    const payload = await request.json().catch(() => ({}));
    const mode = clean(payload.mode, 60);
    const clientGeo = sanitizeGeo(payload.clientGeo || {});

    let expectedAmount = 0;
    let projectType = "";
    let projectConfig = null;
    let projectId = "";
    let webRequestId = "";
    let webPlanId = "";
    let fundingSource = "";
    let contextDetail = "";
    let description = "Proyecto Evolution Design";
    let projectBefore = null;
    let webPricing = null;

    if (mode === "architecture_purchase") {
      projectType = clean(payload.projectType, 80);
      const quote = buildCanonicalArchitectureQuote(projectType, payload.pricingInput || {});
      expectedAmount = quote.amount;
      projectConfig = quote.projectConfig;
      description = clean(projectConfig.packageName || projectType, 127);
      contextDetail = JSON.stringify(projectConfig.pricingInput || {});
    } else if (mode === "web_purchase") {
      webRequestId = clean(payload.webRequestId, 160);
      webPlanId = clean(payload.planId, 32);
      fundingSource = clean(payload.fundingSource, 20).toLowerCase() === "card" ? "card" : "paypal";
      const web = await getOwnedWebRequest(env, user, webRequestId, webPlanId);
      webPricing = await resolveWebRegionalPricing(request, web.plan, web.requestData);
      expectedAmount = moneyNumber(webPricing.usdAmount);
      projectType = "Diseño Web";
      projectConfig = webProjectConfig(web.plan, web.brief, web.id);
      projectConfig.baseUsd = expectedAmount;
      projectConfig.listPriceUsd = web.plan.amount;
      projectConfig.regionalPricing = webPricing.regional === true;
      projectConfig.regionalPriceGtq = webPricing.gtqAmount || 0;
      projectConfig.regionalFxRate = webPricing.fxRate || 0;
      description = clean(`Evolution Design · ${web.plan.name}`, 127);
      contextDetail = `${web.id}|${webPricing.regional ? "GT" : "GLOBAL"}`;
    } else if (mode === "store_sale_purchase") {
      fundingSource = clean(payload.fundingSource, 20).toLowerCase() === "card" ? "card" : "paypal";
      const sale = await loadTemporarySale(env, payload.saleSlug, true);
      const storeMethod = fundingSource === "card" ? "card_shipping" : "paypal_shipping";

      await requireRecaptcha(request, env, {
        token: clean(payload.recaptchaToken, 7000),
        expectedAction: "STORE_ORDER",
        requestedUri: clean(payload.requestedUri || "", 700)
      });

      const availability = await temporarySaleAvailability(env, sale);
      if (!availability.available) throw new Error("STORE_PRODUCT_UNAVAILABLE");

      const draft = sanitizeStoreDraft(payload.storeDraft || {}, user, storeMethod);
      const quote = temporarySaleQuote(sale, storeMethod);
      const paypalFxRate = await usdGtqRate();

      // PayPal's checkout requires a supported settlement currency internally.
      // This conversion is server-only and is NOT exposed as a USD price in Evolution Store.
      expectedAmount = moneyNumber(Number(quote.totalGtq || 0) / paypalFxRate);
      projectType = sale.title;
      description = clean(`${sale.title} · ${quote.methodLabel}`, 127);
      contextDetail = JSON.stringify({
        sku: sale.sku,
        saleSlug: sale.slug,
        method: storeMethod,
        totalGtq: quote.totalGtq,
        ownerUid: user.uid
      });

      payload.__storeDraft = draft;
      payload.__storeQuote = quote;
      payload.__saleConfig = sale;
    } else if (mode === "store_iphone_purchase") {
      fundingSource=clean(payload.fundingSource,20).toLowerCase()==="card"?"card":"paypal";
      const storeMethod=fundingSource==="card"?"card_shipping":"paypal_shipping";
      await requireRecaptcha(request,env,{token:clean(payload.recaptchaToken,7000),expectedAction:"STORE_ORDER",requestedUri:clean(payload.requestedUri||"",700)});
      const availability=await storeAvailability(env);if(!availability.available)throw new Error("STORE_PRODUCT_UNAVAILABLE");
      const draft=sanitizeStoreDraft(payload.storeDraft||{},user,storeMethod),quote=canonicalStoreQuote(storeMethod),paypalFxRate=await usdGtqRate();
      expectedAmount=moneyNumber(Number(quote.totalGtq||0)/paypalFxRate);projectType=STORE_IPHONE_TITLE;description=clean(`${STORE_IPHONE_TITLE} · ${quote.methodLabel}`,127);contextDetail=JSON.stringify({sku:STORE_IPHONE_SKU,method:storeMethod,totalGtq:quote.totalGtq,ownerUid:user.uid});payload.__storeDraft=draft;payload.__storeQuote=quote;
    } else if (mode === "graphic_design_purchase") {
      const graphicService = clean(payload.graphicService, 50);
      if (!["custom_design", "video_edit", "logo_design"].includes(graphicService)) throw new Error("PAYMENT_MODE_INVALID");

      const sourceBrief = payload.brief || {};
      const graphicBrief = {
        eventName: clean(sourceBrief.eventName, 100),
        designType: clean(sourceBrief.designType, 80),
        mainText: clean(sourceBrief.mainText, 180),
        secondaryText: clean(sourceBrief.secondaryText, 1200),
        eventDate: clean(sourceBrief.eventDate, 20),
        eventTime: clean(sourceBrief.eventTime, 20),
        eventLocation: clean(sourceBrief.eventLocation, 140),
        contactText: clean(sourceBrief.contactText, 180),
        format: clean(sourceBrief.format, 100),
        videoDuration: clean(sourceBrief.videoDuration, 80),
        videoDurationSeconds: Math.floor(Number(sourceBrief.videoDurationSeconds || 0)),
        visualStyle: clean(sourceBrief.visualStyle, 220),
        referenceUrl: clean(sourceBrief.referenceUrl, 500),
        notes: clean(sourceBrief.notes, 1500),
        logoIndustry: clean(sourceBrief.logoIndustry, 120),
        logoStyle: clean(sourceBrief.logoStyle, 100),
        logoUse: clean(sourceBrief.logoUse, 120),
        logoAudience: clean(sourceBrief.logoAudience, 180),
        logoPreferredColors: clean(sourceBrief.logoPreferredColors, 160),
        logoAvoidColors: clean(sourceBrief.logoAvoidColors, 180),
        logoExistingStatus: clean(sourceBrief.logoExistingStatus, 120)
      };
      if (!graphicBrief.eventName || !graphicBrief.designType || !graphicBrief.mainText || !graphicBrief.format) throw new Error("GRAPHIC_BRIEF_INCOMPLETE");

      const isVideo = graphicService === "video_edit";
      const isLogo = graphicService === "logo_design";
      if (isLogo && (!graphicBrief.logoIndustry || !graphicBrief.logoStyle || !graphicBrief.logoUse)) throw new Error("GRAPHIC_BRIEF_INCOMPLETE");

      const videoPricing = isVideo ? canonicalVideoPriceFromSeconds(graphicBrief.videoDurationSeconds) : null;
      expectedAmount = isVideo ? videoPricing.priceUsd : isLogo ? 100 : 16;
      if (isVideo) {
        graphicBrief.videoDurationSeconds = videoPricing.seconds;
        graphicBrief.extraMinutes = videoPricing.extraMinutes;
        graphicBrief.videoPriceUsd = videoPricing.priceUsd;
      }

      projectType = isVideo ? "Video" : isLogo ? "Diseño de Logo" : "Diseño Gráfico";
      const packageName = isVideo ? "Video personalizado" : isLogo ? "Creación de logo profesional" : "Diseño personalizado Photoshop";
      projectConfig = {
        category: projectType,
        packageName,
        service: graphicService,
        priceUsd: expectedAmount,
        pricing: isVideo ? {
          includedSeconds: 60,
          baseUsd: 30,
          extraMinuteUsd: 8,
          extraMinutes: videoPricing.extraMinutes,
          durationSeconds: videoPricing.seconds,
          totalUsd: videoPricing.priceUsd
        } : isLogo ? { baseUsd: 100, totalUsd: 100, model: "fixed_logo_price" } : null,
        brief: graphicBrief
      };
      description = clean(`Evolution Design · ${isVideo ? "Video" : isLogo ? "Logo" : "Diseño gráfico"} · ${graphicBrief.eventName}`, 127);
      contextDetail = JSON.stringify(graphicBrief);
    } else if (mode === "project_balance") {
      projectId = clean(payload.projectId, 160);
      if (!/^[A-Za-z0-9_-]{3,160}$/.test(projectId)) throw new Error("PROJECT_NOT_FOUND");
      const snap = await adminGetDocument(env, ["users", user.uid, "projects", projectId], true);
      if (!snap.exists) throw new Error("PROJECT_NOT_FOUND");
      projectBefore = snap.data || {};
      if (projectBefore.ownerUid && String(projectBefore.ownerUid) !== user.uid) throw new Error("PROJECT_NOT_FOUND");
      if (String(projectBefore.paymentStatus || "").toLowerCase() === "paid") throw new Error("PROJECT_ALREADY_PAID");

      const requestState = String(projectBefore.paymentRequestStatus || "").toLowerCase();
      const payState = String(projectBefore.paymentStatus || "").toLowerCase();
      const allowedPending = projectBefore.paymentRequested === true || ["pending", "pending_review", "rejected", "payment_failed"].includes(requestState) || ["pending", "rejected", "payment_failed"].includes(payState);
      if (!allowedPending) throw new Error("PROJECT_PAYMENT_NOT_REQUESTED");

      expectedAmount = Number(projectBefore.paymentRequestedAmountUsd ?? projectBefore.baseUsd ?? projectBefore.amount ?? 0);
      if (!Number.isFinite(expectedAmount) || expectedAmount <= 0) throw new Error("PROJECT_PAYMENT_AMOUNT_INVALID");
      expectedAmount = moneyNumber(expectedAmount);
      description = clean(projectBefore.projectTitle || projectBefore.projectType || "Saldo proyecto Evolution Design", 127);
      contextDetail = projectId;
    } else {
      throw new Error("PAYMENT_MODE_INVALID");
    }

    const customId = await paymentContextId(mode, user.uid, contextDetail, expectedAmount);
    const requestId = crypto.randomUUID();
    const { response, data } = await paypalFetch(env, "/v2/checkout/orders", {
      method: "POST",
      requestId,
      body: {
        intent: "CAPTURE",
        purchase_units: [{
          reference_id: mode === "project_balance" ? clean(projectId,120) : mode === "web_purchase" ? clean(webRequestId,120) : mode === "graphic_design_purchase" ? clean(payload.graphicService,50) : mode === "store_iphone_purchase" ? STORE_IPHONE_SKU : mode === "store_sale_purchase" ? clean(payload.__saleConfig?.sku,120) : clean(projectType,120),
          custom_id: customId,
          description,
          amount: { currency_code: "USD", value: moneyText(expectedAmount) }
        }]
      }
    });

    if (!response.ok || !data?.id) {
      console.error("PayPal create", response.status, data?.name || data?.message || "unknown", data?.debug_id || "");
      throw new Error("PAYPAL_CREATE_FAILED");
    }

    const orderId = safePayPalDocId(data.id);
    const pending = {
      ownerUid: user.uid,
      ownerEmail: user.email || "",
      ownerDisplayName: user.displayName || "",
      orderId,
      requestId,
      mode,
      expectedAmount: moneyText(expectedAmount),
      expectedCurrency: "USD",
      customId,
      projectType,
      projectConfig: projectConfig || null,
      graphicBrief: mode === "graphic_design_purchase" ? (projectConfig?.brief || {}) : null,
      graphicService: mode === "graphic_design_purchase" ? clean(payload.graphicService, 50) : "",
      projectId,
      webRequestId,
      webPlanId,
      fundingSource,
      storePaymentMethod: ["store_iphone_purchase","store_sale_purchase"].includes(mode) ? (fundingSource === "card" ? "card_shipping" : "paypal_shipping") : "",
      storeDraft: ["store_iphone_purchase","store_sale_purchase"].includes(mode) ? (payload.__storeDraft || null) : null,
      storeQuote: ["store_iphone_purchase","store_sale_purchase"].includes(mode) ? (payload.__storeQuote || null) : null,
      saleSlug: mode === "store_sale_purchase" ? clean(payload.__saleConfig?.slug,80) : "",
      saleConfig: mode === "store_sale_purchase" ? (payload.__saleConfig || null) : null,
      regionalPricing: webPricing?.regional === true,
      regionalCountry: webPricing?.regionalCountry || "",
      regionalPriceGtq: Number(webPricing?.gtqAmount || 0),
      regionalFxRate: Number(webPricing?.fxRate || 0),
      declaredBillingCountryCode: webPricing?.declaredCountry || "",
      edgeCountryCode: webPricing?.edgeCountry || "",
      projectStatusBefore: projectBefore?.status || "",
      paymentRequestProjectStatus: projectBefore?.paymentRequestProjectStatus || "",
      workCompletedBefore: projectBefore?.workCompleted === true,
      deliveryPublishedBefore: projectBefore?.deliveryPublished === true,
      clientGeo,
      status: "CREATED",
      createdAt: new Date(),
      updatedAt: new Date()
    };
    await adminSetDocument(env, ["paypalOrders", orderId], pending);

    return json({
      ok: true,
      orderId,
      amount: moneyText(expectedAmount),
      currency: "USD",
      regionalPricing: webPricing?.regional === true,
      regionalPriceGtq: Number(webPricing?.gtqAmount || 0)
    }, 200, origin);
  } catch (error) {
    console.error("paypal/create-order", error?.message || error);
    const code = String(error?.message || "");
    const status = ["AUTH_MISSING", "AUTH_INVALID"].includes(code) ? 401 : code === "PROJECT_ALREADY_PAID" ? 409 : 400;
    return json({ ok: false, error: paymentPublicError(error), code }, status, origin);
  }
}

function paypalPayerData(order, user, pending) {
  const payer = order?.payer || order?.payment_source?.paypal || {};
  const shipping = order?.purchase_units?.[0]?.shipping?.address || {};
  const geo = pending?.clientGeo || {};
  const given = clean(payer?.name?.given_name, 80);
  const surname = clean(payer?.name?.surname, 80);
  const payerName = clean(`${given} ${surname}`.trim() || user.displayName || user.email || "Cliente", 160);
  const payerEmail = validEmail(payer?.email_address) || user.email || "";
  const payerRegion = clean(shipping.admin_area_1 || shipping.admin_area_2 || geo.region || geo.city || "No reportada", 120);
  const payerCountryCode = clean(
    order?.payment_source?.card?.billing_address?.country_code ||
    shipping.country_code ||
    payer?.address?.country_code ||
    geo.countryCode,
    4
  ).toUpperCase();
  const payerCountry = clean(geo.country || payerCountryCode || "No reportado", 120);
  return { payerName, payerEmail, payerRegion, payerCountryCode, payerCountry };
}

async function sendPaymentReceiptSafely(env, { toAddress, clientName, projectTitle, amount, transactionId, paymentMethod = "PayPal" }) {
  if (!validEmail(toAddress)) return { sent: false, messageId: "", error: "RECIPIENT_MISSING" };
  try {
    const sent = await sendEvolutionMail(env, {
      type: "payment_received",
      toAddress,
      data: {
        clientName,
        projectTitle,
        amount: `${moneyText(amount)} USD`,
        paymentMethod,
        transactionId,
        orderId: transactionId
      }
    });
    return { sent: true, messageId: sent.messageId || "", error: "" };
  } catch (error) {
    console.error("Payment email", error?.message || error);
    return { sent: false, messageId: "", error: "ZOHO_SEND_FAILED" };
  }
}

async function capturePayPalOrderRoute(request, env, origin) {
  try {
    const user = await requireFirebaseUser(bearerToken(request));
    const payload = await request.json().catch(() => ({}));
    const orderId = safePayPalDocId(payload.orderId);
    const pending = await getPendingPayPalOrder(env, orderId);
    if (pending.ownerUid !== user.uid) throw new Error("PAYPAL_ORDER_OWNER_MISMATCH");

    if (pending.status === "COMPLETED") {
      return json({
        ok: true,
        alreadyProcessed: true,
        mode: pending.mode,
        projectId: pending.projectId || pending.resultProjectId || "",
        storeOrderId: pending.storeOrderId || "",
        displayOrderId: pending.displayOrderId || "",
        transactionId: pending.transactionId || "",
        paymentStatus: "paid",
        emailSent: pending.paymentEmailStatus === "sent"
      }, 200, origin);
    }

    const expectedAmount = Number(pending.expectedAmount || 0);
    const expectedCurrency = String(pending.expectedCurrency || "USD").toUpperCase();
    if (!Number.isFinite(expectedAmount) || expectedAmount <= 0) throw new Error("PROJECT_PAYMENT_AMOUNT_INVALID");

    let lookup = await paypalFetch(env, `/v2/checkout/orders/${encodeURIComponent(orderId)}`);
    if (!lookup.response.ok) {
      console.error("PayPal get", lookup.response.status, lookup.data?.debug_id || "");
      throw new Error("PAYPAL_ORDER_NOT_FOUND");
    }
    let order = lookup.data;
    const purchase = order?.purchase_units?.[0] || {};
    const orderAmount = paypalOrderAmount(order);
    verifyMoney(orderAmount?.value, orderAmount?.currency_code, expectedAmount, expectedCurrency);
    if (clean(purchase.custom_id, 127) !== clean(pending.customId, 127)) throw new Error("PAYPAL_ORDER_CONTEXT_MISMATCH");

    if (pending.mode === "web_purchase" && pending.regionalPricing === true && pending.regionalCountry === "GT") {
      const approvedCountry = paypalApprovedCountryCode(order);
      if (!approvedCountry) throw new Error("REGIONAL_PRICE_COUNTRY_UNVERIFIED");
      if (approvedCountry !== "GT") throw new Error("REGIONAL_PRICE_COUNTRY_MISMATCH");
    }

    if (order.status !== "COMPLETED") {
      const captured = await paypalFetch(env, `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
        method: "POST",
        requestId: `capture-${orderId}`.slice(0, 108),
        body: {}
      });
      if (captured.response.ok) {
        order = captured.data;
      } else {
        const retry = await paypalFetch(env, `/v2/checkout/orders/${encodeURIComponent(orderId)}`);
        if (!retry.response.ok || retry.data?.status !== "COMPLETED") {
          console.error("PayPal capture", captured.response.status, captured.data?.name || captured.data?.message || "unknown", captured.data?.debug_id || "");
          throw new Error("PAYPAL_CAPTURE_NOT_COMPLETED");
        }
        order = retry.data;
      }
    }

    if (order.status !== "COMPLETED") throw new Error("PAYPAL_CAPTURE_NOT_COMPLETED");
    const capture = captureFromPayPalOrder(order);
    if (!capture?.id || capture.status !== "COMPLETED") throw new Error("PAYPAL_CAPTURE_NOT_COMPLETED");
    verifyMoney(capture.amount?.value, capture.amount?.currency_code, expectedAmount, expectedCurrency);

    const transactionId = clean(capture.id, 140);
    const payer = paypalPayerData(order, user, pending);
    const now = new Date();
    let resultProjectId = "";
    let displayOrderId = "";
    let projectTitle = "Proyecto Evolution Design";
    let emailTo = payer.payerEmail || user.email || "";
    let emailName = payer.payerName || user.displayName || "Cliente";
    let resultStoreOrder = null;

    const ledger = await adminGetDocument(env, ["paypalTransactions", transactionId], true);
    if (ledger.exists && (ledger.data?.orderId !== orderId || ledger.data?.ownerUid !== user.uid)) {
      throw new Error("PAYPAL_TRANSACTION_ALREADY_USED");
    }

    if (pending.mode === "store_sale_purchase") {
      const sale = pending.saleConfig || await loadTemporarySale(env, pending.saleSlug, false);
      const quote = pending.storeQuote || temporarySaleQuote(
        sale,
        pending.storePaymentMethod || (pending.fundingSource === "card" ? "card_shipping" : "paypal_shipping")
      );
      const draft = sanitizeStoreDraft(pending.storeDraft || {}, user, quote.method);
      const storeOrderIdValue = genericStoreOrderId();

      projectTitle = sale.title;
      displayOrderId = storeOrderIdValue;
      emailTo = validEmail(user.email || payer.payerEmail) || payer.payerEmail;
      emailName = clean(draft.customerName || payer.payerName || user.displayName || "Cliente", 160);

      resultStoreOrder = temporarySaleOrderFromDraft({
        user, sale, draft, quote, orderId: storeOrderIdValue, now,
        paymentStatus: "paid", paymentReviewStatus: "approved", status: "confirmed",
        paymentProvider: "paypal-worker", transactionId, paypalOrderId: orderId, paidUsd: expectedAmount
      });
      resultStoreOrder.paymentVerifiedByServer = true;
      resultStoreOrder.paymentVerificationSource = "paypal-api";

      const deliveryEstimate = await boxfulEstimateForOrderLike(env, resultStoreOrder, sale);
      Object.assign(resultStoreOrder, {
        estimatedDispatchDate: deliveryEstimate.dispatchDate,
        estimatedDeliveryDate: deliveryEstimate.earliestDeliveryDate,
        estimatedDeliveryLatestDate: deliveryEstimate.latestDeliveryDate
      });

      await adminSetDocument(env, ["storeOrders", storeOrderIdValue], resultStoreOrder);
      resultStoreOrder = await boxfulCreateShipmentSafely(env, resultStoreOrder, { saleConfig: sale });

      const genericAdminAddress =
        validEmail(env.ORDER_NOTIFICATION_EMAIL) ||
        validEmail(env.ZOHO_ORDER_NOTIFICATION_EMAIL) ||
        "evolutiongt01@gmail.com";
      let genericAdminMailStatus="sent",genericClientMailStatus="sent",genericAdminMessageId="",genericClientMessageId="";
      try{
        const sent=await sendStoreOrderMail(env,genericAdminAddress,buildStoreOrderAdminMail(resultStoreOrder));
        genericAdminMessageId=sent.messageId||"";
      }catch(error){genericAdminMailStatus="failed";console.error("sale/paypal admin mail",error?.message||error)}
      if(emailTo){
        try{
          const sent=await sendStoreOrderMail(env,emailTo,buildStoreOrderClientMail(resultStoreOrder,false));
          genericClientMessageId=sent.messageId||"";
        }catch(error){genericClientMailStatus="failed";console.error("sale/paypal client mail",error?.message||error)}
      }else genericClientMailStatus="skipped";
      Object.assign(resultStoreOrder,{
        adminNotificationStatus:genericAdminMailStatus,
        adminNotificationMessageId:genericAdminMessageId,
        clientNotificationStatus:genericClientMailStatus,
        clientNotificationMessageId:genericClientMessageId
      });
      await adminPatchDocument(env,["storeOrders",storeOrderIdValue],{
        adminNotificationStatus:genericAdminMailStatus,
        adminNotificationMessageId:genericAdminMessageId,
        clientNotificationStatus:genericClientMailStatus,
        clientNotificationMessageId:genericClientMessageId,
        updatedAt:new Date()
      }).catch(()=>{});

      await adminPatchDocument(env, ["users", user.uid], {
        uid: user.uid,
        email: user.email || payer.payerEmail || "",
        displayName: draft.customerName,
        lastStoreOrderId: storeOrderIdValue,
        lastStoreOrderAt: now,
        lastTransactionId: transactionId,
        lastPayPalOrderId: orderId,
        updatedAt: now
      }).catch(() => {});

      resultProjectId = "";
    } else if (pending.mode === "store_iphone_purchase") {
      const quote=pending.storeQuote||canonicalStoreQuote(pending.storePaymentMethod||(pending.fundingSource==="card"?"card_shipping":"paypal_shipping")),draft=sanitizeStoreDraft(pending.storeDraft||{},user,quote.method),storeOrderIdValue=storeOrderId();
      projectTitle=STORE_IPHONE_TITLE;displayOrderId=storeOrderIdValue;emailTo=validEmail(user.email||payer.payerEmail)||payer.payerEmail;emailName=clean(draft.customerName||payer.payerName||user.displayName||"Cliente",160);
      resultStoreOrder=storeOrderFromDraft({user,draft,quote,orderId:storeOrderIdValue,now,paymentStatus:"paid",paymentReviewStatus:"approved",status:"confirmed",paymentProvider:"paypal-worker",transactionId,paypalOrderId:orderId,paidUsd:expectedAmount});
      resultStoreOrder.paymentVerifiedByServer=true;resultStoreOrder.paymentVerificationSource="paypal-api";resultStoreOrder.paymentMethodLabel=pending.fundingSource==="card"?"Tarjeta débito/crédito · Envío nacional":"PayPal · Envío nacional";
      const iphoneDeliveryEstimate=await boxfulEstimateForOrderLike(env,resultStoreOrder);
      Object.assign(resultStoreOrder,{estimatedDispatchDate:iphoneDeliveryEstimate.dispatchDate,estimatedDeliveryDate:iphoneDeliveryEstimate.earliestDeliveryDate,estimatedDeliveryLatestDate:iphoneDeliveryEstimate.latestDeliveryDate});
      await adminSetDocument(env,["storeOrders",storeOrderIdValue],resultStoreOrder);
      resultStoreOrder=await boxfulCreateShipmentSafely(env,resultStoreOrder);
      await adminPatchDocument(env,["users",user.uid],{uid:user.uid,email:user.email||payer.payerEmail||"",displayName:draft.customerName,lastStoreOrderId:storeOrderIdValue,lastStoreOrderAt:now,lastTransactionId:transactionId,lastPayPalOrderId:orderId,updatedAt:now});
      const adminAddress=validEmail(env.ORDER_NOTIFICATION_EMAIL)||validEmail(env.ZOHO_ORDER_NOTIFICATION_EMAIL)||"evolutiongt01@gmail.com";let adminMailStatus="sent",clientMailStatus="sent",adminMessageId="",clientMessageId="";
      try{const sent=await sendStoreOrderMail(env,adminAddress,buildStoreOrderAdminMail(resultStoreOrder));adminMessageId=sent.messageId||""}catch(error){adminMailStatus="failed";console.error("store/paypal admin mail",error?.message||error)}
      if(emailTo){try{const sent=await sendStoreOrderMail(env,emailTo,buildStoreOrderClientMail(resultStoreOrder,false));clientMessageId=sent.messageId||""}catch(error){clientMailStatus="failed";console.error("store/paypal client mail",error?.message||error)}}else clientMailStatus="skipped";
      resultStoreOrder.adminNotificationStatus=adminMailStatus;resultStoreOrder.adminNotificationMessageId=adminMessageId;resultStoreOrder.clientNotificationStatus=clientMailStatus;resultStoreOrder.clientNotificationMessageId=clientMessageId;await adminPatchDocument(env,["storeOrders",storeOrderIdValue],{adminNotificationStatus:adminMailStatus,adminNotificationMessageId:adminMessageId,clientNotificationStatus:clientMailStatus,clientNotificationMessageId:clientMessageId,updatedAt:new Date()});resultProjectId="";
    } else if (pending.mode === "architecture_purchase") {
      const projectConfig = pending.projectConfig || {};
      const safeOrder = orderId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 100);
      resultProjectId = `paypal_${safeOrder}`;
      displayOrderId = `#EVO-${transactionId.slice(-8).toUpperCase()}`;
      projectTitle = clean(projectConfig.packageName || pending.projectType || "Proyecto Evolution Design", 200);
      const projectData = {
        ownerUid: user.uid,
        ownerEmail: user.email || payer.payerEmail || "",
        payerName: payer.payerName,
        payerEmail: payer.payerEmail || user.email || "",
        payerRegion: payer.payerRegion,
        payerCountry: payer.payerCountry,
        payerCountryCode: payer.payerCountryCode,
        transactionId,
        paypalTransactionId: transactionId,
        paypalOrderId: orderId,
        paypalStatus: "COMPLETED",
        paymentMethod: "PayPal",
        paymentProvider: "paypal-worker",
        amount: moneyText(expectedAmount),
        currency: expectedCurrency,
        baseUsd: expectedAmount,
        displayOrderId,
        projectType: projectConfig.category || pending.projectType || "Proyecto",
        projectTitle,
        projectConfig,
        source: "worker-paypal-verified",
        customOrder: false,
        paymentStatus: "paid",
        paymentReviewStatus: "approved",
        paymentVerifiedByServer: true,
        paymentVerifiedByAdmin: false,
        paymentVerificationSource: "paypal-api",
        paymentRequestStatus: "paid",
        paymentRequested: false,
        deliveryLocked: false,
        status: "waiting_files",
        workCompleted: false,
        clientPreviewPublished: false,
        deliveryPublicationMode: "manual",
        deliveryPublished: false,
        deliveryNeedsRepublish: false,
        architectName: "Pendiente",
        clientFileCount: 0,
        deliveryFileCount: 0,
        clientComments: "",
        deliveryNote: "",
        lastGeo: {
          city: pending.clientGeo?.city || "",
          region: pending.clientGeo?.region || payer.payerRegion || "",
          country: pending.clientGeo?.country || payer.payerCountry || "",
          countryCode: pending.clientGeo?.countryCode || payer.payerCountryCode || "",
          currency: pending.clientGeo?.currency || ""
        },
        createdAt: now,
        updatedAt: now,
        paidAt: now,
        estimatedDeliveryAt: estimatedDeliveryAtFromPayment(now),
        paymentVerifiedAt: now
      };
      await adminSetDocument(env, ["users", user.uid, "projects", resultProjectId], projectData);
      if(boxfulShouldAutoCreate(order)){
      order=await boxfulCreateShipmentSafely(env,order);
    }

    await adminPatchDocument(env, ["users", user.uid], {
        uid: user.uid,
        email: user.email || payer.payerEmail || "",
        displayName: user.displayName || payer.payerName || "",
        payerName: payer.payerName,
        payerRegion: payer.payerRegion,
        payerCountry: payer.payerCountry,
        lastTransactionId: transactionId,
        lastPayPalOrderId: orderId,
        lastPurchaseAt: now,
        updatedAt: now
      });
    } else if (pending.mode === "web_purchase") {
      const web = await getOwnedWebRequest(env, user, pending.webRequestId, pending.webPlanId);
      const projectConfig = webProjectConfig(web.plan, web.brief, web.id);
      const safeOrder = orderId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 100);
      resultProjectId = `web_paypal_${safeOrder}`;
      displayOrderId = `#EVO-W${transactionId.slice(-7).toUpperCase()}`;
      projectTitle = clean(`Diseño Web · ${web.plan.name} · ${web.brief.businessName || web.brief.name || "Cliente"}`, 200);
      const paidMethod = pending.fundingSource === "card" ? "Tarjeta débito/crédito (PayPal)" : "PayPal";
      emailTo = validEmail(user.email || web.brief.email || payer.payerEmail) || payer.payerEmail;
      emailName = clean(web.brief.name || payer.payerName || user.displayName || "Cliente", 160);
      const projectData = {
        ownerUid: user.uid,
        ownerEmail: user.email || web.brief.email || payer.payerEmail || "",
        payerName: payer.payerName || web.brief.name || "Cliente",
        payerEmail: payer.payerEmail || user.email || web.brief.email || "",
        payerRegion: payer.payerRegion,
        payerCountry: payer.payerCountry,
        payerCountryCode: payer.payerCountryCode,
        transactionId,
        paypalTransactionId: transactionId,
        paypalOrderId: orderId,
        paypalStatus: "COMPLETED",
        paymentMethod: paidMethod,
        paymentProvider: "paypal-worker",
        amount: moneyText(expectedAmount),
        currency: expectedCurrency,
        baseUsd: expectedAmount,
        displayOrderId,
        projectType: "Diseño Web",
        projectTitle,
        projectConfig,
        source: "worker-web-paypal-verified",
        serviceType: "web_design",
        customOrder: false,
        webRequestId: web.id,
        webPlanId: web.plan.id,
        webPlanName: web.plan.name,
        webBrief: web.brief,
        brandLogoRequestId: web.id,
        brandLogoName: web.brief.brandLogoName || "",
        paymentStatus: "paid",
        paymentReviewStatus: "approved",
        paymentVerifiedByServer: true,
        paymentVerifiedByAdmin: false,
        paymentVerificationSource: "paypal-api",
        paymentRequestStatus: "paid",
        paymentRequested: false,
        deliveryLocked: false,
        status: "waiting_files",
        workCompleted: false,
        clientPreviewPublished: false,
        deliveryPublicationMode: "manual",
        deliveryPublished: false,
        deliveryNeedsRepublish: false,
        architectName: "Pendiente",
        professionalRole: "Diseñador Web",
        clientFileCount: 0,
        deliveryFileCount: 0,
        clientComments: [web.brief.notes, web.brief.referenceSites ? `Referencias: ${web.brief.referenceSites}` : ""].filter(Boolean).join("\n\n"),
        deliveryNote: "",
        lastGeo: {
          city: pending.clientGeo?.city || "",
          region: pending.clientGeo?.region || payer.payerRegion || "",
          country: pending.clientGeo?.country || payer.payerCountry || "",
          countryCode: pending.clientGeo?.countryCode || payer.payerCountryCode || "",
          currency: pending.clientGeo?.currency || ""
        },
        createdAt: now,
        updatedAt: now,
        paidAt: now,
        estimatedDeliveryAt: estimatedDeliveryAtFromPayment(now, 5),
        estimatedBusinessDays: 5,
        estimatedDeliveryPolicy: "one_work_week_after_payment",
        paymentVerifiedAt: now
      };
      await adminSetDocument(env, ["users", user.uid, "projects", resultProjectId], projectData);
      await adminPatchDocument(env, ["users", user.uid], {
        uid: user.uid,
        email: user.email || web.brief.email || payer.payerEmail || "",
        displayName: user.displayName || web.brief.name || payer.payerName || "",
        payerName: payer.payerName,
        payerRegion: payer.payerRegion,
        payerCountry: payer.payerCountry,
        lastTransactionId: transactionId,
        lastPayPalOrderId: orderId,
        lastPurchaseAt: now,
        lastWebProjectId: resultProjectId,
        lastWebRequestId: web.id,
        updatedAt: now
      });
    } else if (pending.mode === "graphic_design_purchase") {
      const graphicBrief = pending.graphicBrief || pending.projectConfig?.brief || {};
      const graphicService = clean(pending.graphicService || pending.projectConfig?.service || "custom_design", 50);
      const isVideo = graphicService === "video_edit";
      const isLogo = graphicService === "logo_design";
      const serviceName = isVideo ? "Video personalizado" : isLogo ? "Creación de logo profesional" : "Diseño personalizado Photoshop";
      const projectCategory = isVideo ? "Video" : isLogo ? "Diseño de Logo" : "Diseño Gráfico";
      const professionalRole = isVideo ? "Editor de Video" : isLogo ? "Diseñador de Identidad Visual" : "Diseñador Gráfico";
      const safeOrder = orderId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 100);
      resultProjectId = `${isVideo ? "video" : isLogo ? "logo" : "graphic"}_paypal_${safeOrder}`;
      displayOrderId = `${isVideo ? "#EVO-V" : isLogo ? "#EVO-L" : "#EVO-G"}${transactionId.slice(-7).toUpperCase()}`;
      projectTitle = clean(`${projectCategory} · ${graphicBrief.eventName || graphicBrief.designType || serviceName}`, 200);
      emailTo = validEmail(user.email || payer.payerEmail) || payer.payerEmail;
      emailName = clean(payer.payerName || user.displayName || "Cliente", 160);

      const logoDetails = isLogo ? {
        industry: graphicBrief.logoIndustry || "",
        style: graphicBrief.logoStyle || "",
        mainUse: graphicBrief.logoUse || "",
        audience: graphicBrief.logoAudience || "",
        preferredColors: graphicBrief.logoPreferredColors || "",
        avoidColors: graphicBrief.logoAvoidColors || "",
        existingStatus: graphicBrief.logoExistingStatus || ""
      } : null;

      const projectData = {
        ownerUid:user.uid,ownerEmail:user.email||payer.payerEmail||"",
        payerName:payer.payerName||user.displayName||"Cliente",payerEmail:payer.payerEmail||user.email||"",
        payerRegion:payer.payerRegion,payerCountry:payer.payerCountry,payerCountryCode:payer.payerCountryCode,
        transactionId,paypalTransactionId:transactionId,paypalOrderId:orderId,paypalStatus:"COMPLETED",
        paymentMethod:"PayPal",paymentProvider:"paypal-worker",
        amount:moneyText(expectedAmount),currency:expectedCurrency,baseUsd:expectedAmount,displayOrderId,
        projectType:projectCategory,projectTitle,
        projectConfig:{category:projectCategory,packageName:serviceName,service:graphicService,priceUsd:expectedAmount,pricing:isLogo?{baseUsd:100,totalUsd:100,model:"fixed_logo_price"}:pending.projectConfig?.pricing||null,brief:graphicBrief},
        serviceType:isVideo?"video_custom":isLogo?"logo_design_custom":"graphic_design_custom",
        graphicService,graphicBrief,logoDetails,logoReferenceFiles:[],
        source:isVideo?"worker-video-paypal-verified":isLogo?"worker-logo-paypal-verified":"worker-graphic-paypal-verified",
        customOrder:true,paymentStatus:"paid",paymentReviewStatus:"approved",paymentVerifiedByServer:true,paymentVerifiedByAdmin:false,paymentVerificationSource:"paypal-api",
        paymentRequestStatus:"paid",paymentRequested:false,deliveryLocked:false,status:"waiting_files",workCompleted:false,clientPreviewPublished:false,
        deliveryPublicationMode:"manual",deliveryPublished:false,deliveryNeedsRepublish:false,professionalRole,
        clientFileCount:0,deliveryFileCount:0,
        clientComments:[
          graphicBrief.secondaryText,
          graphicBrief.notes,
          graphicBrief.referenceUrl?`Referencia: ${graphicBrief.referenceUrl}`:"",
          graphicBrief.videoDuration?`Duración: ${graphicBrief.videoDuration}`:"",
          isLogo&&graphicBrief.logoIndustry?`Sector: ${graphicBrief.logoIndustry}`:"",
          isLogo&&graphicBrief.logoStyle?`Estilo: ${graphicBrief.logoStyle}`:"",
          isLogo&&graphicBrief.logoUse?`Uso principal: ${graphicBrief.logoUse}`:"",
          isLogo&&graphicBrief.logoAudience?`Público: ${graphicBrief.logoAudience}`:"",
          isLogo&&graphicBrief.logoPreferredColors?`Colores preferidos: ${graphicBrief.logoPreferredColors}`:"",
          isLogo&&graphicBrief.logoAvoidColors?`Evitar: ${graphicBrief.logoAvoidColors}`:"",
          isLogo&&graphicBrief.logoExistingStatus?`Identidad actual: ${graphicBrief.logoExistingStatus}`:""
        ].filter(Boolean).join("\n\n"),
        deliveryNote:"",lastGeo:{city:pending.clientGeo?.city||"",region:pending.clientGeo?.region||payer.payerRegion||"",country:pending.clientGeo?.country||payer.payerCountry||"",countryCode:pending.clientGeo?.countryCode||payer.payerCountryCode||"",currency:pending.clientGeo?.currency||""},
        createdAt:now,updatedAt:now,paidAt:now,
        estimatedDeliveryAt:estimatedDeliveryAtFromPayment(now,isVideo?5:3),
        estimatedBusinessDays:isVideo?5:3,
        estimatedDeliveryPolicy:isVideo?"one_work_week_after_payment":"three_business_days_after_payment",
        paymentVerifiedAt:now
      };
      await adminSetDocument(env,["users",user.uid,"projects",resultProjectId],projectData);
      await adminPatchDocument(env,["users",user.uid],{uid:user.uid,email:user.email||payer.payerEmail||"",displayName:user.displayName||payer.payerName||"",payerName:payer.payerName,payerRegion:payer.payerRegion,payerCountry:payer.payerCountry,lastTransactionId:transactionId,lastPayPalOrderId:orderId,lastPurchaseAt:now,lastGraphicProjectId:resultProjectId,updatedAt:now});
    } else if (pending.mode === "project_balance") {
      resultProjectId = clean(pending.projectId, 160);
      const projectSnap = await adminGetDocument(env, ["users", user.uid, "projects", resultProjectId], true);
      if (!projectSnap.exists) throw new Error("PROJECT_NOT_FOUND");
      const project = projectSnap.data || {};
      if (project.ownerUid && String(project.ownerUid) !== user.uid) throw new Error("PROJECT_NOT_FOUND");
      projectTitle = clean(project.projectTitle || project.projectType || "Proyecto Evolution Design", 200);
      displayOrderId = clean(project.displayOrderId || resultProjectId, 160);
      emailTo = validEmail(project.ownerEmail || project.payerEmail) || user.email || payer.payerEmail;
      emailName = clean(project.payerName || payer.payerName || user.displayName || "Cliente", 160);

      const preserve = clean(project.paymentRequestProjectStatus || project.status || pending.paymentRequestProjectStatus || pending.projectStatusBefore || "waiting_files", 80);
      const resetStates = new Set(["awaiting_payment", "payment_pending_review", "payment_failed", ""]);
      const nextStatus = resetStates.has(preserve) ? "waiting_files" : preserve;
      const paymentPatch = {
        paymentStatus: "paid",
        paymentReviewStatus: "approved",
        paymentRequested: false,
        paymentRequestStatus: "paid",
        deliveryLocked: false,
        paymentMethod: "PayPal",
        paymentProvider: "paypal-worker",
        paymentVerifiedByServer: true,
        paymentVerificationSource: "paypal-api",
        transactionId,
        paypalTransactionId: transactionId,
        paypalOrderId: orderId,
        paypalStatus: "COMPLETED",
        amount: moneyText(expectedAmount),
        currency: expectedCurrency,
        paidAt: now,
        paymentUnlockedAt: now,
        paymentVerifiedAt: now,
        status: nextStatus,
        updatedAt: now
      };

      // No cambiamos una fecha que ya existía. Esto evita que un pago de
      // saldo final reprograme una entrega que ya estaba comprometida.
      if (!project.estimatedDeliveryAt) {
        const normalizedServiceType = String(project.serviceType || "").toLowerCase();
        const normalizedProjectType = String(project.projectType || "").toLowerCase();
        const isWebDesignProject =
          normalizedServiceType === "web_design" ||
          normalizedProjectType === "diseño web" ||
          normalizedProjectType === "diseno web";
        const isVideoProject =
          normalizedServiceType === "video_custom" ||
          normalizedProjectType === "video";
        const deliveryDays = (isWebDesignProject || isVideoProject) ? 5 : 3;
        paymentPatch.estimatedDeliveryAt = estimatedDeliveryAtFromPayment(now, deliveryDays);
        paymentPatch.estimatedBusinessDays = deliveryDays;
        paymentPatch.estimatedDeliveryPolicy = (isWebDesignProject || isVideoProject)
          ? "one_work_week_after_payment"
          : "three_business_days_after_payment";
      }

      await adminPatchDocument(env, ["users", user.uid, "projects", resultProjectId], paymentPatch);
    } else {
      throw new Error("PAYMENT_MODE_INVALID");
    }

    await adminSetDocument(env, ["paypalTransactions", transactionId], {
      orderId,
      transactionId,
      ownerUid: user.uid,
      amount: moneyText(expectedAmount),
      currency: expectedCurrency,
      mode: pending.mode,
      projectId: resultProjectId,
      capturedAt: now
    });

    const mail = ["store_iphone_purchase","store_sale_purchase"].includes(pending.mode) ? {sent:resultStoreOrder?.clientNotificationStatus==="sent",messageId:resultStoreOrder?.clientNotificationMessageId||"",error:resultStoreOrder?.clientNotificationStatus==="failed"?"ZOHO_SEND_FAILED":""} : await sendPaymentReceiptSafely(env,{toAddress:emailTo,clientName:emailName,projectTitle,amount:expectedAmount,transactionId,paymentMethod:pending.mode==="web_purchase"&&pending.fundingSource==="card"?"Tarjeta débito/crédito (PayPal)":"PayPal"});

    if (resultProjectId) {
      await adminPatchDocument(env, ["users", user.uid, "projects", resultProjectId], {
        paymentEmailStatus: mail.sent ? "sent" : "failed",
        paymentEmailSentAt: mail.sent ? now : null,
        paymentEmailMessageId: mail.messageId || "",
        paymentEmailError: mail.error || "",
        updatedAt: new Date()
      }).catch(error => console.error("Payment email metadata", error?.message || error));
    }

    await adminPatchDocument(env, ["paypalOrders", orderId], {
      status: "COMPLETED",
      transactionId,
      resultProjectId,
      projectId: resultProjectId,
      storeOrderId: resultStoreOrder?.orderId || "",
      displayOrderId,
      paymentEmailStatus: mail.sent ? "sent" : "failed",
      paymentEmailMessageId: mail.messageId || "",
      completedAt: now,
      updatedAt: new Date()
    });

    return json({
      ok: true,
      mode: pending.mode,
      projectId: resultProjectId,
      displayOrderId,
      paypalOrderId: orderId,
      transactionId,
      paymentStatus: "paid",
      amount: moneyText(expectedAmount),
      currency: expectedCurrency,
      storeOrder: resultStoreOrder,
      emailSent: mail.sent
    }, 200, origin);
  } catch (error) {
    console.error("paypal/capture-order", error?.message || error);
    const code = String(error?.message || "");
    const status = ["AUTH_MISSING", "AUTH_INVALID"].includes(code) ? 401 : ["PROJECT_ALREADY_PAID"].includes(code) ? 409 : 400;
    return json({ ok: false, error: paymentPublicError(error), code }, status, origin);
  }
}



async function graphicManualPaymentRoute(request, env, origin) {
  try {
    const user = await requireFirebaseUser(bearerToken(request));
    const payload = await request.json().catch(() => ({}));
    const clientGeo = sanitizeGeo(payload.clientGeo || {});
    const method = clean(payload.method, 40).toLowerCase();
    if (!["bank_transfer", "binance_pay"].includes(method)) throw new Error("PAYMENT_MODE_INVALID");

    const requestCountry = clean(request.cf?.country || clientGeo.countryCode, 4).toUpperCase();
    if (method === "bank_transfer" && requestCountry !== "GT") throw new Error("BANK_GT_ONLY");

    const graphicService = clean(payload.graphicService || "custom_design", 50);
    if (!["custom_design", "video_edit", "logo_design"].includes(graphicService)) throw new Error("PAYMENT_MODE_INVALID");
    const isVideo = graphicService === "video_edit";
    const isLogo = graphicService === "logo_design";

    const sourceBrief = payload.brief || {};
    const graphicBrief = {
      eventName:clean(sourceBrief.eventName,100),designType:clean(sourceBrief.designType,80),mainText:clean(sourceBrief.mainText,180),
      secondaryText:clean(sourceBrief.secondaryText,1200),eventDate:clean(sourceBrief.eventDate,20),eventTime:clean(sourceBrief.eventTime,20),
      eventLocation:clean(sourceBrief.eventLocation,140),contactText:clean(sourceBrief.contactText,180),format:clean(sourceBrief.format,100),
      videoDuration:clean(sourceBrief.videoDuration,80),videoDurationSeconds:Math.floor(Number(sourceBrief.videoDurationSeconds||0)),visualStyle:clean(sourceBrief.visualStyle,220),referenceUrl:clean(sourceBrief.referenceUrl,500),notes:clean(sourceBrief.notes,1500),
      logoIndustry:clean(sourceBrief.logoIndustry,120),logoStyle:clean(sourceBrief.logoStyle,100),logoUse:clean(sourceBrief.logoUse,120),logoAudience:clean(sourceBrief.logoAudience,180),logoPreferredColors:clean(sourceBrief.logoPreferredColors,160),logoAvoidColors:clean(sourceBrief.logoAvoidColors,180),logoExistingStatus:clean(sourceBrief.logoExistingStatus,120)
    };
    if (!graphicBrief.eventName || !graphicBrief.designType || !graphicBrief.mainText || !graphicBrief.format) throw new Error("GRAPHIC_BRIEF_INCOMPLETE");
    if (isLogo && (!graphicBrief.logoIndustry || !graphicBrief.logoStyle || !graphicBrief.logoUse)) throw new Error("GRAPHIC_BRIEF_INCOMPLETE");

    const videoPricing = isVideo ? canonicalVideoPriceFromSeconds(graphicBrief.videoDurationSeconds) : null;
    const baseUsd = isVideo ? videoPricing.priceUsd : isLogo ? 100 : 16;
    if (isVideo) {
      graphicBrief.videoDurationSeconds = videoPricing.seconds;
      graphicBrief.extraMinutes = videoPricing.extraMinutes;
      graphicBrief.videoPriceUsd = videoPricing.priceUsd;
    }

    const reference = clean(payload.reference, 160);
    if (!reference) throw new Error("PAYMENT_REFERENCE_REQUIRED");
    const payerName = clean(payload.payerName || user.displayName || user.email || "Cliente", 160);
    const receipt = validEmbeddedReceipt(payload.receipt || {});
    const now = new Date();
    const projectPrefix = isVideo ? "video" : isLogo ? "logo" : "graphic";
    const projectId = `${projectPrefix}_${method}_${crypto.randomUUID().replace(/-/g, "")}`.slice(0, 150);
    const proofId = crypto.randomUUID().replace(/-/g, "");
    const displayOrderId = `${isVideo ? "#EVO-VM" : isLogo ? "#EVO-LM" : "#EVO-GM"}${Date.now().toString().slice(-6)}`;

    let expectedAmount = baseUsd, expectedCurrency = "USDT", paymentMethod = "Binance Pay", paymentProvider = "binance_pay", bankKey = "", bankName = "", conversionRate = 1;
    if (method === "bank_transfer") {
      conversionRate = await usdGtqRate();
      expectedAmount = moneyNumber(baseUsd * conversionRate);
      expectedCurrency = "GTQ";
      bankKey = clean(payload.bankKey, 40);
      const bankNames = { bac:"BAC Credomatic", promerica:"Promerica", banrural:"Banrural" };
      if (!bankNames[bankKey]) throw new Error("BANK_ACCOUNT_INVALID");
      bankName = bankNames[bankKey];
      paymentMethod = `Transferencia bancaria - ${bankName}`;
      paymentProvider = "bank-transfer-manual";
    }

    await adminSetDocument(env,["paymentProofs",proofId],{ownerUid:user.uid,projectId,method,reference,receiptDataUrl:receipt.dataUrl,receiptName:receipt.name,receiptType:receipt.type,receiptSize:receipt.size,createdAt:now});

    const projectCategory = isVideo ? "Video" : isLogo ? "Diseño de Logo" : "Diseño Gráfico";
    const serviceName = isVideo ? "Video personalizado" : isLogo ? "Creación de logo profesional" : "Diseño personalizado Photoshop";
    const logoDetails = isLogo ? {industry:graphicBrief.logoIndustry,style:graphicBrief.logoStyle,mainUse:graphicBrief.logoUse,audience:graphicBrief.logoAudience,preferredColors:graphicBrief.logoPreferredColors,avoidColors:graphicBrief.logoAvoidColors,existingStatus:graphicBrief.logoExistingStatus} : null;
    const projectData = {
      ownerUid:user.uid,ownerEmail:user.email||"",payerName,payerEmail:user.email||"",
      payerRegion:clean(clientGeo.region||clientGeo.city||"No reportada",120),payerCountry:clean(clientGeo.country||"",120),payerCountryCode:requestCountry||"",
      transactionId:reference,manualPaymentReference:reference,paymentMethod,paymentProvider,bankKey,bankName,
      amount:String(expectedAmount),currency:expectedCurrency,baseUsd,expectedAmount:String(expectedAmount),expectedCurrency,conversionRate,displayOrderId,
      projectType:projectCategory,projectTitle:clean(`${projectCategory} · ${graphicBrief.eventName||graphicBrief.designType||serviceName}`,200),
      projectConfig:{category:projectCategory,packageName:serviceName,service:graphicService,priceUsd:baseUsd,pricing:isVideo?{includedSeconds:60,baseUsd:30,extraMinuteUsd:8,extraMinutes:videoPricing.extraMinutes,durationSeconds:videoPricing.seconds,totalUsd:videoPricing.priceUsd}:isLogo?{baseUsd:100,totalUsd:100,model:"fixed_logo_price"}:null,brief:graphicBrief},
      serviceType:isVideo?"video_custom":isLogo?"logo_design_custom":"graphic_design_custom",graphicService,graphicBrief,logoDetails,logoReferenceFiles:[],
      source:method==="bank_transfer"?(isVideo?"worker-video-bank-manual":isLogo?"worker-logo-bank-manual":"worker-graphic-bank-manual"):(isVideo?"worker-video-binance-manual":isLogo?"worker-logo-binance-manual":"worker-graphic-binance-manual"),
      customOrder:true,paymentStatus:"pending_review",paymentReviewStatus:"pending",paymentVerifiedByAdmin:false,paymentVerifiedByServer:false,
      paymentRequested:true,paymentRequestStatus:"pending_review",deliveryLocked:true,status:"awaiting_payment",workCompleted:false,clientPreviewPublished:false,deliveryPublished:false,
      receiptProofId:proofId,receiptStoragePath:`firestore:paymentProofs/${proofId}`,receiptName:receipt.name,receiptSize:receipt.size,receiptContentType:receipt.type,
      professionalRole:isVideo?"Editor de Video":isLogo?"Diseñador de Identidad Visual":"Diseñador Gráfico",clientFileCount:0,deliveryFileCount:0,
      clientComments:[graphicBrief.secondaryText,graphicBrief.notes,graphicBrief.referenceUrl?`Referencia: ${graphicBrief.referenceUrl}`:"",graphicBrief.videoDuration?`Duración: ${graphicBrief.videoDuration}`:"",isLogo&&graphicBrief.logoIndustry?`Sector: ${graphicBrief.logoIndustry}`:"",isLogo&&graphicBrief.logoStyle?`Estilo: ${graphicBrief.logoStyle}`:"",isLogo&&graphicBrief.logoUse?`Uso principal: ${graphicBrief.logoUse}`:"",isLogo&&graphicBrief.logoAudience?`Público: ${graphicBrief.logoAudience}`:"",isLogo&&graphicBrief.logoPreferredColors?`Colores preferidos: ${graphicBrief.logoPreferredColors}`:"",isLogo&&graphicBrief.logoAvoidColors?`Evitar: ${graphicBrief.logoAvoidColors}`:"",isLogo&&graphicBrief.logoExistingStatus?`Identidad actual: ${graphicBrief.logoExistingStatus}`:""].filter(Boolean).join("\n\n"),
      deliveryNote:"",lastGeo:clientGeo,createdAt:now,updatedAt:now,paymentSubmittedAt:now,
      estimatedBusinessDays:isVideo?5:3,
      estimatedDeliveryPolicy:isVideo?"one_work_week_after_payment_approval":"three_business_days_after_payment_approval"
    };

    await adminSetDocument(env,["users",user.uid,"projects",projectId],projectData);
    await adminPatchDocument(env,["users",user.uid],{uid:user.uid,email:user.email||"",displayName:user.displayName||payerName||"",lastGraphicProjectId:projectId,lastManualPaymentMethod:paymentMethod,lastManualPaymentAt:now,updatedAt:now});

    return json({ok:true,projectId,displayOrderId,paymentStatus:"pending_review",amount:String(expectedAmount),currency:expectedCurrency},200,origin);
  } catch(error) {
    console.error("graphic/manual-payment",error?.message||error);
    const code=String(error?.message||"");
    const publicMap={AUTH_MISSING:"Inicia sesión nuevamente.",AUTH_INVALID:"Tu sesión ya no es válida.",PAYMENT_RECEIPT_INVALID:"El comprobante no es válido o es demasiado pesado.",PAYMENT_REFERENCE_REQUIRED:"Ingresa la referencia de la transacción.",BANK_GT_ONLY:"La transferencia bancaria local está disponible únicamente para clientes ubicados en Guatemala.",BANK_ACCOUNT_INVALID:"Selecciona una cuenta bancaria válida.",GRAPHIC_BRIEF_INCOMPLETE:"Completa los datos obligatorios antes de pagar.",VIDEO_DURATION_INVALID:"Indica una duración válida para el video."};
    const status=["AUTH_MISSING","AUTH_INVALID"].includes(code)?401:400;
    return json({ok:false,error:publicMap[code]||"No se pudo registrar el pago manual.",code},status,origin);
  }
}

async function graphicLogoReferencesRoute(request, env, origin) {
  try {
    const user = await requireFirebaseUser(bearerToken(request));
    const payload = await request.json().catch(() => ({}));
    const projectId = clean(payload.projectId, 160);
    if (!/^[A-Za-z0-9_-]{3,160}$/.test(projectId)) throw new Error("PROJECT_NOT_FOUND");

    const snap = await adminGetDocument(env,["users",user.uid,"projects",projectId],true);
    if (!snap.exists) throw new Error("PROJECT_NOT_FOUND");
    const project = snap.data || {};
    if (project.ownerUid && String(project.ownerUid) !== user.uid) throw new Error("PROJECT_NOT_FOUND");
    if (clean(project.graphicService || project.projectConfig?.service,50) !== "logo_design") throw new Error("PROJECT_NOT_FOUND");

    const refs = Array.isArray(payload.references) ? payload.references.slice(0,2) : [];
    if (!refs.length) return json({ok:true,count:0,files:[]},200,origin);

    const summaries=[];
    const now=new Date();
    for (const item of refs) {
      const kind=clean(item?.kind,40);
      if (!["current_logo","sketch"].includes(kind)) throw new Error("GRAPHIC_REFERENCE_INVALID");
      const file=validEmbeddedCreativeReference(item?.file||{});
      const referenceId=crypto.randomUUID().replace(/-/g,"");
      await adminSetDocument(env,["graphicReferenceFiles",referenceId],{
        ownerUid:user.uid,projectId,kind,name:file.name,type:file.type,size:file.size,dataUrl:file.dataUrl,createdAt:now
      });
      summaries.push({id:referenceId,kind,name:file.name,type:file.type,size:file.size});
    }

    await adminPatchDocument(env,["users",user.uid,"projects",projectId],{
      logoReferenceFiles:summaries,
      logoReferencesUploadedAt:now,
      updatedAt:new Date()
    });
    return json({ok:true,count:summaries.length,files:summaries},200,origin);
  } catch(error) {
    console.error("graphic/logo-references",error?.message||error);
    const code=String(error?.message||"");
    const publicMap={AUTH_MISSING:"Inicia sesión nuevamente.",AUTH_INVALID:"Tu sesión ya no es válida.",PROJECT_NOT_FOUND:"No encontramos el proyecto de logo.",GRAPHIC_REFERENCE_INVALID:"La referencia no es válida o es demasiado pesada."};
    const status=["AUTH_MISSING","AUTH_INVALID"].includes(code)?401:code==="PROJECT_NOT_FOUND"?404:400;
    return json({ok:false,error:publicMap[code]||"No se pudieron adjuntar las referencias.",code},status,origin);
  }
}

async function webManualPaymentRoute(request, env, origin) {
  try {
    const user = await requireFirebaseUser(bearerToken(request));
    const payload = await request.json().catch(() => ({}));
    const clientGeo = sanitizeGeo(payload.clientGeo || {});
    const method = clean(payload.method, 40).toLowerCase();
    if (!["bank_transfer", "binance_pay"].includes(method)) throw new Error("PAYMENT_MODE_INVALID");
    const web = await getOwnedWebRequest(env, user, payload.webRequestId, payload.planId);
    const reference = clean(payload.reference, 160);
    if (!reference) throw new Error("PAYMENT_REFERENCE_REQUIRED");
    const payerName = clean(payload.payerName || user.displayName || web.brief.name || user.email || "Cliente", 160);
    const receipt = validEmbeddedReceipt(payload.receipt || {});
    const now = new Date();
    const projectId = `web_${method}_${crypto.randomUUID().replace(/-/g, "")}`.slice(0, 150);
    const proofId = crypto.randomUUID().replace(/-/g, "");
    const displayOrderId = `#EVO-WM${Date.now().toString().slice(-6)}`;
    const projectConfig = webProjectConfig(web.plan, web.brief, web.id);
    const requestCountry = clean(request.cf?.country || clientGeo.countryCode, 4).toUpperCase();
    const webPricing = await resolveWebRegionalPricing(request, web.plan, web.requestData);

    let expectedAmount = webPricing.usdAmount;
    let expectedCurrency = "USD";
    let paymentMethod = "Binance Pay";
    let paymentProvider = "binance_pay";
    let bankKey = "";
    let bankName = "";
    let conversionRate = webPricing.fxRate || 0;

    if (method === "bank_transfer") {
      if (requestCountry !== "GT") throw new Error("BANK_GT_ONLY");
      if (web.brief.billingCountryCode !== "GT") throw new Error("REGIONAL_PRICE_COUNTRY_MISMATCH");
      conversionRate = webPricing.fxRate || await usdGtqRate();
      expectedAmount = webPricing.regional
        ? moneyNumber(webPricing.gtqAmount)
        : moneyNumber(web.plan.amount * conversionRate);
      expectedCurrency = "GTQ";
      bankKey = clean(payload.bankKey, 40);
      const bankNames = { bac: "BAC Credomatic", promerica: "Promerica", banrural: "Banrural" };
      bankName = bankNames[bankKey] || "Banco Guatemala";
      paymentMethod = `Transferencia bancaria - ${bankName}`;
      paymentProvider = "bank-transfer-manual";
    } else {
      if (webPricing.regional) {
        conversionRate = webPricing.fxRate || await usdGtqRate();
        expectedAmount = moneyNumber(webPricing.gtqAmount / conversionRate);
      } else {
        conversionRate = 1;
        expectedAmount = moneyNumber(web.plan.amount);
      }
      expectedCurrency = "USDT";
      paymentMethod = "Binance Pay";
      paymentProvider = "binance_pay";
    }

    await adminSetDocument(env, ["paymentProofs", proofId], {
      ownerUid: user.uid,
      webRequestId: web.id,
      projectId,
      method,
      reference,
      receiptDataUrl: receipt.dataUrl,
      receiptName: receipt.name,
      receiptType: receipt.type,
      receiptSize: receipt.size,
      createdAt: now
    });

    const projectData = {
      ownerUid: user.uid,
      ownerEmail: user.email || web.brief.email || "",
      payerName,
      payerEmail: user.email || web.brief.email || "",
      payerRegion: clean(clientGeo.region || clientGeo.city || "No reportada", 120),
      payerCountry: clean(clientGeo.country || requestCountry || "No reportado", 120),
      payerCountryCode: requestCountry,
      transactionId: reference,
      manualPaymentReference: reference,
      paymentMethod,
      paymentProvider,
      bankKey,
      bankName,
      amount: String(expectedAmount),
      currency: expectedCurrency,
      baseUsd: webPricing.usdAmount,
      listPriceUsd: web.plan.amount,
      regionalPricing: webPricing.regional === true,
      regionalPriceGtq: webPricing.gtqAmount || 0,
      regionalFxRate: webPricing.fxRate || 0,
      expectedAmount: String(expectedAmount),
      expectedCurrency,
      conversionRate,
      displayOrderId,
      projectType: "Diseño Web",
      projectTitle: `Diseño Web · ${web.plan.name} · ${web.brief.businessName || web.brief.name || "Cliente"}`,
      projectConfig,
      source: method === "bank_transfer" ? "worker-web-bank-manual" : "worker-web-binance-manual",
      serviceType: "web_design",
      customOrder: false,
      webRequestId: web.id,
      webPlanId: web.plan.id,
      webPlanName: web.plan.name,
      webBrief: web.brief,
      brandLogoRequestId: web.id,
      brandLogoName: web.brief.brandLogoName || "",
      paymentStatus: "pending_review",
      paymentReviewStatus: "pending",
      paymentVerifiedByAdmin: false,
      paymentVerifiedByServer: false,
      paymentRequested: true,
      paymentRequestStatus: "pending_review",
      deliveryLocked: true,
      status: "awaiting_payment",
      workCompleted: false,
      clientPreviewPublished: false,
      deliveryPublished: false,
      receiptProofId: proofId,
      receiptStoragePath: `firestore:paymentProofs/${proofId}`,
      receiptName: receipt.name,
      receiptSize: receipt.size,
      receiptContentType: receipt.type,
      architectName: "Pendiente",
      professionalRole: "Diseñador Web",
      clientFileCount: 0,
      deliveryFileCount: 0,
      clientComments: [web.brief.notes, web.brief.referenceSites ? `Referencias: ${web.brief.referenceSites}` : ""].filter(Boolean).join("\n\n"),
      deliveryNote: "",
      lastGeo: clientGeo,
      createdAt: now,
      updatedAt: now,
      paymentSubmittedAt: now,
      estimatedBusinessDays: 5,
      estimatedDeliveryPolicy: "one_work_week_after_payment"
    };
    await adminSetDocument(env, ["users", user.uid, "projects", projectId], projectData);
    await adminPatchDocument(env, ["users", user.uid], {
      uid: user.uid,
      email: user.email || web.brief.email || "",
      displayName: user.displayName || web.brief.name || "",
      lastWebProjectId: projectId,
      lastWebRequestId: web.id,
      lastManualPaymentMethod: paymentMethod,
      lastManualPaymentAt: now,
      updatedAt: now
    });

    return json({ ok: true, projectId, displayOrderId, paymentStatus: "pending_review", amount: String(expectedAmount), currency: expectedCurrency }, 200, origin);
  } catch (error) {
    console.error("web/manual-payment", error?.message || error);
    const code = String(error?.message || "");
    const publicMap = {
      AUTH_MISSING: "Inicia sesión nuevamente.", AUTH_INVALID: "Tu sesión ya no es válida.",
      WEB_REQUEST_NOT_FOUND: "No encontramos el brief asociado a tu cuenta.", WEB_PLAN_INVALID: "El plan seleccionado no es válido.",
      WEB_PLAN_MISMATCH: "El plan no coincide con el brief guardado.", PAYMENT_RECEIPT_INVALID: "El comprobante no es válido o es demasiado pesado.",
      PAYMENT_REFERENCE_REQUIRED: "Ingresa la referencia de la transacción.", BANK_GT_ONLY: "Transferencia bancaria solo está disponible para clientes ubicados en Guatemala.",
      BINANCE_PAYMENT_INVALID: "No pudimos preparar el pago de Binance Pay."
    };
    const status = ["AUTH_MISSING", "AUTH_INVALID"].includes(code) ? 401 : 400;
    return json({ ok: false, error: publicMap[code] || "No se pudo registrar el pago manual.", code }, status, origin);
  }
}

async function verifyPayPalWebhook(request, env, event) {
  const webhookId = clean(env.PAYPAL_WEBHOOK_ID, 120);
  if (!webhookId) throw new Error("PAYPAL_WEBHOOK_NOT_CONFIGURED");
  const transmissionId = clean(request.headers.get("paypal-transmission-id"), 100);
  const transmissionTime = clean(request.headers.get("paypal-transmission-time"), 120);
  const transmissionSig = clean(request.headers.get("paypal-transmission-sig"), 700);
  const certUrl = clean(request.headers.get("paypal-cert-url"), 700);
  const authAlgo = clean(request.headers.get("paypal-auth-algo"), 120);
  if (!transmissionId || !transmissionTime || !transmissionSig || !certUrl || !authAlgo) {
    throw new Error("PAYPAL_WEBHOOK_HEADERS_MISSING");
  }

  const checked = await paypalFetch(env, "/v1/notifications/verify-webhook-signature", {
    method: "POST",
    body: {
      auth_algo: authAlgo,
      cert_url: certUrl,
      transmission_id: transmissionId,
      transmission_sig: transmissionSig,
      transmission_time: transmissionTime,
      webhook_id: webhookId,
      webhook_event: event
    }
  });
  if (!checked.response.ok || checked.data?.verification_status !== "SUCCESS") {
    throw new Error("PAYPAL_WEBHOOK_SIGNATURE_INVALID");
  }
  return true;
}

function subscriptionIdFromWebhook(event) {
  const resource = event?.resource || {};
  const type = String(event?.event_type || "");
  if (type.startsWith("BILLING.SUBSCRIPTION.")) return clean(resource.id, 180);
  return clean(
    resource.billing_agreement_id ||
    resource.billing_agreement?.id ||
    resource.supplementary_data?.related_ids?.subscription_id ||
    resource.supplementary_data?.related_ids?.billing_agreement_id ||
    "",
    180
  );
}

async function findSubscriptionByPayPalId(env, subscriptionId) {
  if (!subscriptionId) return null;
  const direct = await adminGetDocument(env, ["subscriptions", subscriptionId], true);
  if (direct.exists) return { id: subscriptionId, data: direct.data || {} };
  const rows = await adminRunQuery(env, {
    from: [{ collectionId: "subscriptions" }],
    where: {
      fieldFilter: {
        field: { fieldPath: "subscriptionId" },
        op: "EQUAL",
        value: { stringValue: subscriptionId }
      }
    },
    limit: 2
  });
  return rows[0] || null;
}

function webhookPaymentAmount(resource, subscription) {
  const value = resource?.amount?.total ?? resource?.amount?.value ?? resource?.billing_info?.last_payment?.amount?.value ?? subscription?.priceUsd ?? 0;
  const currency = clean(resource?.amount?.currency ?? resource?.amount?.currency_code ?? resource?.billing_info?.last_payment?.amount?.currency_code ?? subscription?.currency ?? "USD", 12).toUpperCase();
  const n = Number(value || 0);
  return { amount: Number.isFinite(n) && n > 0 ? moneyText(n) : moneyText(Number(subscription?.priceUsd || 0)), currency: currency || "USD" };
}

async function paypalWebhookRoute(request, env) {
  try {
    const event = await request.json().catch(() => null);
    if (!event || typeof event !== "object") return json({ ok: false, error: "Webhook inválido." }, 400, "");
    await verifyPayPalWebhook(request, env, event);

    const eventId = clean(event.id, 180);
    const safeEventId = eventId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 180);
    if (!safeEventId) return json({ ok: false, error: "Evento PayPal sin ID." }, 400, "");
    const eventSnap = await adminGetDocument(env, ["paypalWebhookEvents", safeEventId], true);
    if (eventSnap.exists && eventSnap.data?.processed === true) {
      return json({ ok: true, duplicate: true }, 200, "");
    }

    const eventType = clean(event.event_type, 120);
    const handledTypes = new Set([
      "BILLING.SUBSCRIPTION.ACTIVATED",
      "BILLING.SUBSCRIPTION.CANCELLED",
      "BILLING.SUBSCRIPTION.PAYMENT.FAILED",
      "PAYMENT.SALE.COMPLETED"
    ]);
    if (!handledTypes.has(eventType)) {
      await adminSetDocument(env, ["paypalWebhookEvents", safeEventId], { eventId, eventType, processed: true, ignored: true, processedAt: new Date() });
      return json({ ok: true, ignored: true }, 200, "");
    }

    const paypalSubscriptionId = subscriptionIdFromWebhook(event);
    const found = await findSubscriptionByPayPalId(env, paypalSubscriptionId);
    if (!found) {
      await adminSetDocument(env, ["paypalWebhookEvents", safeEventId], {
        eventId, eventType, paypalSubscriptionId, processed: true, subscriptionFound: false, processedAt: new Date()
      });
      return json({ ok: true, subscriptionFound: false }, 200, "");
    }

    const subscription = found.data || {};
    const ownerEmail = validEmail(subscription.ownerEmail || subscription.payerEmail || subscription.email);
    const ownerName = clean(subscription.payerName || subscription.ownerName || subscription.clientName || "Cliente", 160);
    const planName = clean(subscription.planName || "Evolution PSD", 160);
    const nextBilling = event?.resource?.billing_info?.next_billing_time || subscription.currentPeriodEnd || subscription.nextPaymentAt || subscription.expiresAt || "";
    const pay = webhookPaymentAmount(event.resource || {}, subscription);
    const now = new Date();
    const patch = {
      provider: "PayPal",
      paymentProvider: "paypal-webhook",
      subscriptionId: paypalSubscriptionId || subscription.subscriptionId || found.id,
      lastWebhookEventId: eventId,
      lastWebhookEventType: eventType,
      updatedAt: now
    };
    let mailType = "";

    if (eventType === "BILLING.SUBSCRIPTION.ACTIVATED") {
      patch.status = "active";
      patch.paymentStatus = "paid";
      patch.activatedAt = subscription.activatedAt || now;
      if (nextBilling) patch.currentPeriodEnd = nextBilling;
      if (!subscription.subscriptionActivatedEmailSentAt) mailType = "subscription_activated";
    } else if (eventType === "PAYMENT.SALE.COMPLETED") {
      patch.status = "active";
      patch.paymentStatus = "paid";
      patch.lastPaymentAt = now;
      patch.lastPaymentTransactionId = clean(event?.resource?.id, 180);
      if (nextBilling) patch.currentPeriodEnd = nextBilling;
      mailType = subscription.subscriptionActivatedEmailSentAt ? "subscription_renewed" : "subscription_activated";
    } else if (eventType === "BILLING.SUBSCRIPTION.PAYMENT.FAILED") {
      patch.status = "past_due";
      patch.paymentStatus = "past_due";
      patch.lastPaymentFailedAt = now;
      if (nextBilling) patch.nextPaymentAt = nextBilling;
      mailType = "subscription_payment_failed";
    } else if (eventType === "BILLING.SUBSCRIPTION.CANCELLED") {
      patch.status = "cancelled";
      patch.cancelledAt = now;
      patch.cancelAtPeriodEnd = false;
      patch.cancellationRequested = false;
      mailType = "subscription_cancelled";
    }

    await adminPatchDocument(env, ["subscriptions", found.id], patch);

    let mailSent = false;
    let mailMessageId = "";
    if (mailType && ownerEmail) {
      const sent = await sendEvolutionMail(env, {
        type: mailType,
        toAddress: ownerEmail,
        data: {
          clientName: ownerName,
          planName,
          amount: `${pay.amount} ${pay.currency}`,
          nextBillingDate: nextBilling || "—",
          subscriptionId: paypalSubscriptionId || found.id,
          transactionId: clean(event?.resource?.id, 180),
          provider: "PayPal"
        }
      });
      mailSent = true;
      mailMessageId = sent.messageId || "";
      const mailPatch = {
        lastSubscriptionEmailType: mailType,
        lastSubscriptionEmailAt: new Date(),
        lastSubscriptionEmailMessageId: mailMessageId,
        updatedAt: new Date()
      };
      if (mailType === "subscription_activated") mailPatch.subscriptionActivatedEmailSentAt = new Date();
      await adminPatchDocument(env, ["subscriptions", found.id], mailPatch);
    }

    await adminSetDocument(env, ["paypalWebhookEvents", safeEventId], {
      eventId,
      eventType,
      paypalSubscriptionId,
      subscriptionDocId: found.id,
      processed: true,
      mailType,
      mailSent,
      mailMessageId,
      processedAt: new Date()
    });

    return json({ ok: true, processed: true, eventType, mailSent }, 200, "");
  } catch (error) {
    console.error("paypal/webhook", error?.message || error);
    const code = String(error?.message || "");
    const status = code === "PAYPAL_WEBHOOK_SIGNATURE_INVALID" ? 401 : code === "PAYPAL_WEBHOOK_NOT_CONFIGURED" ? 503 : 500;
    return json({ ok: false, error: "No se pudo procesar el webhook de PayPal.", code }, status, "");
  }
}


async function sendEvolutionMail(env, { type, toAddress, data = {} }) {
  if (!EVOLUTION_MAIL_TYPES.has(type)) throw new Error("MAIL_TYPE_INVALID");
  const email = validEmail(toAddress);
  if (!email) throw new Error("MAIL_RECIPIENT_INVALID");

  if (type === "project_ready") {
    return sendZohoReadyMail(env, {
      toAddress: email,
      clientName: data.clientName,
      projectTitle: data.projectTitle,
      displayOrderId: data.displayOrderId || data.orderId
    });
  }

  const cfg = zohoConfig(env);
  const rendered = buildEvolutionTransactionalMail(type, data, cfg.portalUrl);
  return sendZohoHtmlMail(env, { toAddress: email, ...rendered });
}

async function sendTransactionalEmailRoute(request, env, origin) {
  const idToken = bearerToken(request);
  try {
    await requireFirebaseAdmin(idToken);
  } catch (e) {
    const code = String(e?.message || "");
    if (code === "ADMIN_ONLY") return json({ ok:false, error:"Solo Administración puede enviar correos transaccionales." }, 403, origin);
    return json({ ok:false, error:"Tu sesión de Firebase no es válida." }, 401, origin);
  }

  const payload = await request.json().catch(() => ({}));
  const type = clean(payload.type, 80);
  const toAddress = validEmail(payload.toAddress);
  const data = payload.data && typeof payload.data === "object" ? payload.data : {};

  if (!EVOLUTION_MAIL_TYPES.has(type)) {
    return json({ ok:false, error:"Tipo de correo no permitido.", allowedTypes:[...EVOLUTION_MAIL_TYPES] }, 400, origin);
  }
  if (!toAddress) return json({ ok:false, error:"Correo del destinatario inválido." }, 400, origin);

  try {
    const sent = await sendEvolutionMail(env, { type, toAddress, data });
    return json({ ok:true, type, toAddress, messageId:sent.messageId || "" }, 200, origin);
  } catch (error) {
    console.error("send-transactional-email", error?.message || error);
    return json({ ok:false, error:"No se pudo enviar el correo transaccional." }, 500, origin);
  }
}

async function notifyClientPreview(request, env, origin) {
  const idToken = bearerToken(request);
  let admin;

  try {
    admin = await requireFirebaseAdmin(idToken);
  } catch (e) {
    const code = String(e?.message || "");
    if (code === "ADMIN_ONLY") return json({ ok: false, error: "Solo Administración puede enviar notificaciones." }, 403, origin);
    return json({ ok: false, error: "Tu sesión de Firebase no es válida. Vuelve a iniciar sesión." }, 401, origin);
  }

  const payload = await request.json().catch(() => ({}));
  const ownerUid = clean(payload.ownerUid, 160);
  const projectId = clean(payload.projectId, 160);

  if (!/^[A-Za-z0-9_-]{5,160}$/.test(ownerUid) || !/^[A-Za-z0-9_-]{3,160}$/.test(projectId)) {
    return json({ ok: false, error: "Proyecto inválido." }, 400, origin);
  }

  try {
    const project = await getProject(idToken, ownerUid, projectId);
    if (project.ownerUid && String(project.ownerUid) !== ownerUid) return json({ ok: false, error: "El propietario del proyecto no coincide." }, 409, origin);
    if (project.workCompleted !== true) return json({ ok: false, error: "Primero marca el trabajo como terminado." }, 409, origin);
    
    const previewPath = clean(project.clientPreviewStoragePath || project.paymentPreviewStoragePath, 900);
    if (!previewPath) return json({ ok: false, error: "Primero sube una muestra del trabajo." }, 409, origin);

    const toAddress = validEmail(project.ownerEmail || project.payerEmail);
    if (!toAddress) return json({ ok: false, error: "El proyecto no tiene un correo de cliente válido." }, 409, origin);

    const now = new Date();
    const firstPublish = project.clientPreviewPublished !== true;

    const publishPatch = {
      clientPreviewPublished: true,
      clientPreviewNotifiedAt: now,
      clientPreviewNotifiedByAdminEmail: admin.email,
      clientNotificationEmail: toAddress,
      clientNotificationProvider: "zoho-cloudflare",
      clientNotificationStatus: "sending",
      updatedAt: now
    };

    if (firstPublish) publishPatch.clientPreviewPublishedAt = now;
    await patchProject(idToken, ownerUid, projectId, publishPatch);

    try {
      const sent = await sendEvolutionMail(env, {
        type: "project_ready",
        toAddress,
        data: {
          clientName: project.payerName || project.ownerEmail || "Cliente",
          projectTitle: project.projectTitle || "Proyecto Evolution Design",
          displayOrderId: project.displayOrderId || projectId
        }
      });

      await patchProject(idToken, ownerUid, projectId, {
        clientNotificationStatus: "sent",
        clientNotificationSentAt: new Date(),
        clientNotificationEmail: toAddress,
        clientNotificationProvider: "zoho-cloudflare",
        clientNotificationMessageId: sent.messageId || "",
        clientNotificationError: "",
        updatedAt: new Date()
      });

      return json({ ok: true, previewPublished: true, emailSent: true, toAddress }, 200, origin);

    } catch (mailError) {
      console.error("Notify mail", mailError?.message || mailError);
      const publicError = "Zoho no pudo enviar el correo. Puedes reintentarlo.";
      
      await patchProject(idToken, ownerUid, projectId, {
        clientNotificationStatus: "failed",
        clientNotificationFailedAt: new Date(),
        clientNotificationEmail: toAddress,
        clientNotificationProvider: "zoho-cloudflare",
        clientNotificationError: publicError,
        updatedAt: new Date()
      });

      return json({ ok: true, previewPublished: true, emailSent: false, toAddress, error: publicError }, 200, origin);
    }
  } catch (error) {
    console.error("notify-client-preview", error?.message || error);
    return json({ ok: false, error: "No se pudo procesar la notificación. Revisa la configuración del Worker." }, 500, origin);
  }
}




// ============================================================================
// TEMP STORE · IPHONE 8 PLUS · FIREBASE AUTH + FIRESTORE ADMIN + ZOHO
// ============================================================================


/* ==========================================================================
   BOXFUL API · PHASE 1
   Auth + connection test + pickup addresses + selected collection address.
   Secrets stay in Cloudflare Worker:
     BOXFUL_EMAIL
     BOXFUL_PASSWORD
   Optional overrides:
     BOXFUL_ACCESS_TOKEN
     BOXFUL_AUTH_JSON
   ========================================================================== */
const BOXFUL_API_BASE = "https://api.goboxful.com";
let BOXFUL_TOKEN_CACHE = { token: "", expiresAt: 0 };

function boxfulConfigured(env) {
  return Boolean(
    clean(env.BOXFUL_ACCESS_TOKEN, 9000) ||
    (clean(env.BOXFUL_EMAIL, 320) && clean(env.BOXFUL_PASSWORD, 1000)) ||
    clean(env.BOXFUL_AUTH_JSON, 6000)
  );
}

function boxfulSafeAddress(a = {}) {
  return {
    id: clean(a.id, 120),
    address: clean(a.address, 240),
    referencePoint: clean(a.referencePoint, 240),
    latitude: Number.isFinite(Number(a.latitude)) ? Number(a.latitude) : null,
    longitude: Number.isFinite(Number(a.longitude)) ? Number(a.longitude) : null,
    cityId: clean(a.cityId, 120),
    stateId: clean(a.stateId, 120),
    addressPhone: clean(a.addressPhone, 60),
    addressAreaCode: clean(a.addressAreaCode, 12)
  };
}

function boxfulExtractToken(data = {}) {
  const candidates = [
    data.accessToken,
    data.access_token,
    data.token,
    data.bearerToken,
    data?.data?.accessToken,
    data?.data?.access_token,
    data?.data?.token,
    data?.auth?.accessToken,
    data?.auth?.token,
    data?.result?.accessToken,
    data?.result?.token
  ];
  return clean(candidates.find(Boolean), 9000);
}

function boxfulAuthBodies(env) {
  const bodies = [];
  const custom = clean(env.BOXFUL_AUTH_JSON, 6000);
  if (custom) {
    try {
      const parsed = JSON.parse(custom);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) bodies.push(parsed);
    } catch {
      throw new Error("BOXFUL_AUTH_JSON_INVALID");
    }
  }

  const email = clean(env.BOXFUL_EMAIL, 320);
  const password = clean(env.BOXFUL_PASSWORD, 1000);
  if (email && password) {
    bodies.push({ email, password });
    bodies.push({ username: email, password });
  }

  const unique = [];
  const seen = new Set();
  for (const body of bodies) {
    const key = JSON.stringify(body);
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(body);
    }
  }
  return unique;
}

async function boxfulAuthenticate(env, force = false) {
  const direct = clean(env.BOXFUL_ACCESS_TOKEN, 9000);
  if (direct) return direct;

  const now = Date.now();
  if (!force && BOXFUL_TOKEN_CACHE.token && BOXFUL_TOKEN_CACHE.expiresAt > now + 60_000) {
    return BOXFUL_TOKEN_CACHE.token;
  }

  if (!boxfulConfigured(env)) throw new Error("BOXFUL_NOT_CONFIGURED");

  const bodies = boxfulAuthBodies(env);
  if (!bodies.length) throw new Error("BOXFUL_NOT_CONFIGURED");

  let lastStatus = 0;
  let lastMessage = "";

  for (const body of bodies) {
    try {
      const response = await fetch(`${BOXFUL_API_BASE}/auth/v2/client`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "accept": "application/json"
        },
        body: JSON.stringify(body)
      });

      lastStatus = response.status;
      const text = await response.text();
      let data = {};
      try { data = text ? JSON.parse(text) : {}; } catch {}

      const token = boxfulExtractToken(data);
      if (response.ok && token) {
        const expiresIn = Number(
          data.expiresIn ||
          data.expires_in ||
          data?.data?.expiresIn ||
          data?.data?.expires_in ||
          3300
        );
        BOXFUL_TOKEN_CACHE = {
          token,
          expiresAt: Date.now() + Math.max(300, Math.min(expiresIn || 3300, 86400)) * 1000
        };
        return token;
      }

      lastMessage = clean(
        data?.message ||
        data?.error ||
        data?.data?.message ||
        text,
        500
      );
    } catch (error) {
      lastMessage = clean(error?.message || "NETWORK_ERROR", 500);
    }
  }

  console.warn("Boxful auth failed", lastStatus, lastMessage);
  throw new Error(
    lastStatus === 401 || lastStatus === 403
      ? "BOXFUL_AUTH_REJECTED"
      : "BOXFUL_AUTH_FAILED"
  );
}

async function boxfulApi(env, pathname, { method = "GET", body, forceAuth = false } = {}) {
  const call = async (token) => {
    const headers = {
      "accept": "application/json",
      "authorization": `Bearer ${token}`
    };
    let requestBody;
    if (body !== undefined) {
      headers["content-type"] = "application/json";
      requestBody = JSON.stringify(body);
    }

    const response = await fetch(`${BOXFUL_API_BASE}${pathname}`, {
      method,
      headers,
      body: requestBody
    });

    const text = await response.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; }
    catch { data = { raw: clean(text, 4000) }; }

    return { response, data };
  };

  let token = await boxfulAuthenticate(env, forceAuth);
  let result = await call(token);

  if (result.response.status === 401 && !clean(env.BOXFUL_ACCESS_TOKEN, 9000)) {
    BOXFUL_TOKEN_CACHE = { token: "", expiresAt: 0 };
    token = await boxfulAuthenticate(env, true);
    result = await call(token);
  }

  if (!result.response.ok) {
    const status = result.response.status;
    const message = clean(
      result.data?.message ||
      result.data?.error ||
      result.data?.data?.message ||
      "",
      500
    );
    console.warn("Boxful API", pathname, status, message);
    const error = new Error(
      status === 401 || status === 403
        ? "BOXFUL_AUTH_REJECTED"
        : "BOXFUL_API_ERROR"
    );
    error.boxfulStatus = status;
    throw error;
  }

  return result.data;
}

async function boxfulAddresses(env) {
  const data = await boxfulApi(env, "/addresses");
  const list = Array.isArray(data?.addresses)
    ? data.addresses
    : Array.isArray(data?.data?.addresses)
      ? data.data.addresses
      : Array.isArray(data?.data)
        ? data.data
        : [];

  return list
    .map(boxfulSafeAddress)
    .filter(a => a.id);
}


let BOXFUL_COURIER_CACHE = { id: "", name: "", expiresAt: 0 };

function boxfulExtractCourierCandidates(data) {
  const objects = boxfulCollectObjects(data, []);
  const rows = [];
  const seen = new Set();

  for (const obj of objects) {
    if (!obj || typeof obj !== "object") continue;

    const nested = boxfulCourierFromObject(obj);
    const id = clean(
      nested.id || obj.courierId || obj.carrierId || obj.providerId || obj.id || obj._id || "",
      180
    );
    const name = clean(
      nested.name || obj.courierName || obj.carrierName || obj.providerName || obj.companyName || obj.name || obj.title || "",
      180
    );

    if (!id || !name) continue;
    const key = `${id}|${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ id, name });
  }

  return rows;
}

function boxfulChooseCargoCourier(candidates = []) {
  let best = null;
  let bestScore = -1;
  for (const row of candidates) {
    const text = String(row?.name || "").toLowerCase();
    let score = 0;
    if (text.includes("cargo")) score += 12;
    if (text.includes("expreso")) score += 12;
    if (text.includes("express")) score += 8;
    if (text.includes("cargo expreso")) score += 20;
    if (score > bestScore) {
      bestScore = score;
      best = row;
    }
  }
  return bestScore > 0 ? { ...best, score: bestScore } : null;
}

async function boxfulRawGet(env, pathname) {
  const token = await boxfulAuthenticate(env);
  const response = await fetch(`${BOXFUL_API_BASE}${pathname}`, {
    method: "GET",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`
    }
  });

  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; }
  catch { data = { raw: clean(text, 6000) }; }

  return {
    pathname,
    status: response.status,
    ok: response.ok,
    data
  };
}

async function boxfulDiscoverCargoCourier(env) {
  const now = Date.now();
  if (BOXFUL_COURIER_CACHE.id && BOXFUL_COURIER_CACHE.expiresAt > now) {
    return {
      found: true,
      courier: { id: BOXFUL_COURIER_CACHE.id, name: BOXFUL_COURIER_CACHE.name },
      source: "memory-cache",
      attempts: []
    };
  }

  // These are read-only discovery attempts. Boxful's public indexed docs do
  // not currently expose a documented courier-list endpoint, so diagnostics
  // are intentionally returned instead of silently guessing an ID.
  const paths = ["/couriers", "/courier", "/shipping/couriers"];
  const attempts = [];
  const combined = [];

  for (const pathname of paths) {
    try {
      const result = await boxfulRawGet(env, pathname);
      const candidates = result.ok ? boxfulExtractCourierCandidates(result.data) : [];
      attempts.push({
        pathname,
        status: result.status,
        ok: result.ok,
        candidates: candidates.slice(0, 20),
        response: result.ok ? undefined : boxfulSafeDiagnostic(result.data, 1200)
      });
      combined.push(...candidates);

      const selected = boxfulChooseCargoCourier(candidates);
      if (selected) {
        BOXFUL_COURIER_CACHE = {
          id: selected.id,
          name: selected.name,
          expiresAt: Date.now() + 6 * 60 * 60 * 1000
        };
        return {
          found: true,
          courier: { id: selected.id, name: selected.name },
          source: pathname,
          attempts
        };
      }
    } catch (error) {
      attempts.push({ pathname, status: 0, ok: false, error: clean(error?.message || "ERROR", 500) });
    }
  }

  const selected = boxfulChooseCargoCourier(combined);
  if (selected) {
    return {
      found: true,
      courier: { id: selected.id, name: selected.name },
      source: "combined",
      attempts
    };
  }

  return { found: false, courier: null, source: "none", attempts };
}

async function boxfulResolveCourier(env, config = {}, quoteContext = {}) {
  const configuredId = clean(config.courierId, 180);
  if (configuredId) {
    return {
      id: configuredId,
      name: clean(config.courierName || "Cargo Expreso", 180),
      source: "store-config"
    };
  }

  const secretId = clean(env.BOXFUL_COURIER_ID, 180);
  if (secretId) {
    return {
      id: secretId,
      name: clean(env.BOXFUL_COURIER_NAME || "Cargo Expreso", 180),
      source: "worker-secret"
    };
  }

  const quoteId = clean(quoteContext.courierId, 180);
  if (quoteId) {
    return {
      id: quoteId,
      name: clean(quoteContext.courierName || "Cargo Expreso", 180),
      source: "quoter"
    };
  }

  const discovered = await boxfulDiscoverCargoCourier(env);
  if (discovered.found && discovered.courier?.id) {
    return {
      id: discovered.courier.id,
      name: discovered.courier.name || "Cargo Expreso",
      source: `discovery:${discovered.source}`,
      attempts: discovered.attempts
    };
  }

  const error = new Error("BOXFUL_COURIER_ID_MISSING");
  error.boxful = {
    status: 0,
    message: "No se encontró el courierId de Cargo Expreso. Usa Detectar Cargo Expreso en Admin o guarda el ID manualmente.",
    data: { discoveryAttempts: discovered.attempts }
  };
  error.boxfulAttempts = discovered.attempts;
  throw error;
}

async function boxfulAdminCourierDiscoveryRoute(request, env, origin) {
  try {
    await requireFirebaseAdmin(bearerToken(request));
    if (!boxfulConfigured(env)) throw new Error("BOXFUL_NOT_CONFIGURED");

    const discovered = await boxfulDiscoverCargoCourier(env);
    return json({
      ok: true,
      found: discovered.found,
      courier: discovered.courier,
      source: discovered.source,
      attempts: discovered.attempts
    }, 200, origin);
  } catch (error) {
    const code = String(error?.message || "");
    return json({
      ok: false,
      code,
      error: code === "BOXFUL_NOT_CONFIGURED"
        ? "Configura primero la cuenta Boxful."
        : "No se pudo consultar la información de couriers.",
      diagnostic: error?.boxful || null
    }, 400, origin);
  }
}

async function loadBoxfulStoreConfig(env) {
  try {
    const snap = await adminGetDocument(env, ["storeConfig", "boxful"], true);
    if (!snap.exists || !snap.data) {
      return {
        recolectionAddressId: "",
        courierId: "",
        courierName: "Cargo Expreso",
        packageWeightKg: 1,
        packageLengthCm: 20,
        packageWidthCm: 15,
        packageHeightCm: 8,
        autoCreateShipment: true,
        updatedAt: null,
        updatedByAdminEmail: ""
      };
    }
    return {
      recolectionAddressId: clean(snap.data.recolectionAddressId, 120),
      courierId: clean(snap.data.courierId, 180),
      courierName: clean(snap.data.courierName || "Cargo Expreso", 180),
      packageWeightKg: boxfulNumber(snap.data.packageWeightKg, 1, 0.01, 100),
      packageLengthCm: boxfulNumber(snap.data.packageLengthCm, 20, 1, 300),
      packageWidthCm: boxfulNumber(snap.data.packageWidthCm, 15, 1, 300),
      packageHeightCm: boxfulNumber(snap.data.packageHeightCm, 8, 1, 300),
      autoCreateShipment: snap.data.autoCreateShipment !== false,
      updatedAt: snap.data.updatedAt || null,
      updatedByAdminEmail: clean(snap.data.updatedByAdminEmail, 320)
    };
  } catch {
    return {
      recolectionAddressId: "",
      packageWeightKg: 1,
      packageLengthCm: 20,
      packageWidthCm: 15,
      packageHeightCm: 8,
      autoCreateShipment: true,
      updatedAt: null,
      updatedByAdminEmail: ""
    };
  }
}

async function boxfulAdminStatusRoute(request, env, origin) {
  try {
    await requireFirebaseAdmin(bearerToken(request));

    const configured = boxfulConfigured(env);
    if (!configured) {
      return json({
        ok: true,
        configured: false,
        connected: false,
        apiBase: BOXFUL_API_BASE,
        addresses: [],
        config: await loadBoxfulStoreConfig(env)
      }, 200, origin);
    }

    const addresses = await boxfulAddresses(env);
    const config = await loadBoxfulStoreConfig(env);

    return json({
      ok: true,
      configured: true,
      connected: true,
      apiBase: BOXFUL_API_BASE,
      addresses,
      config,
      authMode: clean(env.BOXFUL_ACCESS_TOKEN, 9000)
        ? "access_token"
        : clean(env.BOXFUL_AUTH_JSON, 6000)
          ? "custom_json"
          : "account_credentials"
    }, 200, origin);
  } catch (error) {
    const code = String(error?.message || "");
    const map = {
      AUTH_MISSING: "Tu sesión administrativa no está activa.",
      AUTH_INVALID: "Tu sesión administrativa no es válida.",
      ADMIN_ONLY: "Solo Administración puede probar Boxful.",
      BOXFUL_NOT_CONFIGURED: "Faltan las credenciales de Boxful en los Secrets del Worker.",
      BOXFUL_AUTH_JSON_INVALID: "BOXFUL_AUTH_JSON no contiene JSON válido.",
      BOXFUL_AUTH_REJECTED: "Boxful rechazó las credenciales. Revisa correo y contraseña.",
      BOXFUL_AUTH_FAILED: "No se pudo obtener el token de Boxful.",
      BOXFUL_API_ERROR: "Boxful respondió con un error al consultar la cuenta."
    };
    return json({
      ok: false,
      configured: boxfulConfigured(env),
      connected: false,
      code,
      error: map[code] || "No se pudo conectar con Boxful."
    }, ["AUTH_MISSING","AUTH_INVALID"].includes(code) ? 401 : code === "ADMIN_ONLY" ? 403 : 502, origin);
  }
}

async function boxfulAdminConfigRoute(request, env, origin) {
  try {
    const admin = await requireFirebaseAdmin(bearerToken(request));

    if (request.method === "GET") {
      return json({ ok: true, config: await loadBoxfulStoreConfig(env) }, 200, origin);
    }

    const payload = await request.json().catch(() => ({}));
    const recolectionAddressId = clean(payload.recolectionAddressId, 120);
    const courierId = clean(payload.courierId, 180);
    const courierName = clean(payload.courierName || "Cargo Expreso", 180);
    const packageWeightKg = boxfulNumber(payload.packageWeightKg, 1, 0.01, 100);
    const packageLengthCm = boxfulNumber(payload.packageLengthCm, 20, 1, 300);
    const packageWidthCm = boxfulNumber(payload.packageWidthCm, 15, 1, 300);
    const packageHeightCm = boxfulNumber(payload.packageHeightCm, 8, 1, 300);
    const autoCreateShipment = payload.autoCreateShipment !== false;

    if (!recolectionAddressId) throw new Error("BOXFUL_ADDRESS_REQUIRED");

    const addresses = await boxfulAddresses(env);
    const selected = addresses.find(a => a.id === recolectionAddressId);
    if (!selected) throw new Error("BOXFUL_ADDRESS_NOT_FOUND");

    const now = new Date();
    const stored = {
      recolectionAddressId,
      courierId,
      courierName,
      recolectionAddressLabel: clean(
        [selected.address, selected.referencePoint].filter(Boolean).join(" · "),
        500
      ),
      packageWeightKg,
      packageLengthCm,
      packageWidthCm,
      packageHeightCm,
      autoCreateShipment,
      updatedAt: now,
      updatedByAdminEmail: admin.email
    };

    await adminSetDocument(env, ["storeConfig", "boxful"], stored);

    return json({
      ok: true,
      config: {
        ...stored,
        updatedAt: now.toISOString()
      },
      address: selected
    }, 200, origin);
  } catch (error) {
    const code = String(error?.message || "");
    const map = {
      AUTH_MISSING: "Tu sesión administrativa no está activa.",
      AUTH_INVALID: "Tu sesión administrativa no es válida.",
      ADMIN_ONLY: "Solo Administración puede modificar Boxful.",
      BOXFUL_ADDRESS_REQUIRED: "Selecciona una dirección de recolección.",
      BOXFUL_ADDRESS_NOT_FOUND: "Esa dirección ya no existe en tu cuenta Boxful.",
      BOXFUL_NOT_CONFIGURED: "Primero configura Boxful en los Secrets del Worker.",
      BOXFUL_AUTH_REJECTED: "Boxful rechazó las credenciales.",
      BOXFUL_AUTH_FAILED: "No se pudo autenticar la cuenta Boxful.",
      BOXFUL_API_ERROR: "No se pudieron consultar las direcciones de Boxful."
    };
    return json({
      ok: false,
      code,
      error: map[code] || "No se pudo guardar la configuración Boxful."
    }, ["AUTH_MISSING","AUTH_INVALID"].includes(code) ? 401 : code === "ADMIN_ONLY" ? 403 : 400, origin);
  }
}


/* ==========================================================================
   BOXFUL API · PHASE 2
   - Delivery estimate during checkout
   - Automatic shipment/guide creation
   - Tracking refresh
   - Transfer remains manual until Admin confirms
   ========================================================================== */

function boxfulNumber(value, fallback, min = 0.01, max = 10000) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) return fallback;
  return n;
}

function boxfulLocalParts(date = new Date()) {
  // Guatemala is UTC-06:00 year-round.
  const gt = new Date(date.getTime() - 6 * 60 * 60 * 1000);
  return {
    year: gt.getUTCFullYear(),
    month: gt.getUTCMonth(),
    day: gt.getUTCDate(),
    weekday: gt.getUTCDay(),
    hour: gt.getUTCHours()
  };
}

function boxfulLocalDateFromParts(parts) {
  return new Date(Date.UTC(parts.year, parts.month, parts.day));
}

function boxfulIsBusinessDay(dateUtc) {
  const d = dateUtc.getUTCDay();
  return d !== 0 && d !== 6;
}

function boxfulAddBusinessDays(dateUtc, count) {
  const d = new Date(dateUtc.getTime());
  let left = Math.max(0, Number(count) || 0);
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (boxfulIsBusinessDay(d)) left -= 1;
  }
  return d;
}

function boxfulNextBusinessDay(dateUtc, includeCurrent = false) {
  const d = new Date(dateUtc.getTime());
  if (includeCurrent && boxfulIsBusinessDay(d)) return d;
  do { d.setUTCDate(d.getUTCDate() + 1); }
  while (!boxfulIsBusinessDay(d));
  return d;
}

function boxfulIsoDay(dateUtc) {
  return dateUtc.toISOString().slice(0, 10);
}

function boxfulPolicyEstimate(now = new Date()) {
  const p = boxfulLocalParts(now);
  let dispatch = boxfulLocalDateFromParts(p);

  if (p.weekday === 6) {
    dispatch.setUTCDate(dispatch.getUTCDate() + 2);
  } else if (p.weekday === 0) {
    dispatch.setUTCDate(dispatch.getUTCDate() + 1);
  } else if (!boxfulIsBusinessDay(dispatch)) {
    dispatch = boxfulNextBusinessDay(dispatch, false);
  }

  const earliest = boxfulAddBusinessDays(dispatch, 1);
  const latest = boxfulAddBusinessDays(dispatch, 3);

  return {
    dispatchDate: boxfulIsoDay(dispatch),
    earliestDeliveryDate: boxfulIsoDay(earliest),
    latestDeliveryDate: boxfulIsoDay(latest),
    weekendDispatchAt10: p.weekday === 0 || p.weekday === 6,
    source: "evolution-shipping-policy"
  };
}

function boxfulCleanCoordinates(source = {}) {
  const lat = Number(source.latitude ?? source.lat ?? source.destinationLat);
  const lng = Number(source.longitude ?? source.lng ?? source.long ?? source.destinationLng);
  return {
    latitude: Number.isFinite(lat) && lat >= -90 && lat <= 90 ? lat : null,
    longitude: Number.isFinite(lng) && lng >= -180 && lng <= 180 ? lng : null
  };
}

function boxfulPackageFromConfig(config = {}, fallback = {}) {
  return {
    weight: boxfulNumber(config.packageWeightKg ?? fallback.weight, 1, 0.01, 100),
    length: boxfulNumber(config.packageLengthCm ?? fallback.length, 20, 1, 300),
    width: boxfulNumber(config.packageWidthCm ?? fallback.width, 15, 1, 300),
    height: boxfulNumber(config.packageHeightCm ?? fallback.height, 8, 1, 300)
  };
}

function boxfulOrderDestination(order = {}) {
  const coords = boxfulCleanCoordinates(order);
  return {
    recipientName: clean(order.recipientName || order.customerName, 120),
    recipientPhone: clean(order.phone, 60),
    recipientEmail: validEmail(order.ownerEmail) || "",
    department: clean(order.department, 80),
    municipality: clean(order.municipality, 100),
    poblado: clean(order.poblado, 120),
    address: clean(order.address, 240),
    referencePoint: clean(order.reference, 240),
    latitude: coords.latitude,
    longitude: coords.longitude
  };
}


function boxfulCustomerParts(order = {}, destination = {}) {
  const raw = clean(
    destination.recipientName ||
    order.recipientName ||
    order.customerName ||
    "Cliente Evolution",
    160
  ).replace(/\s+/g, " ").trim();

  const parts = raw.split(" ").filter(Boolean);
  if (parts.length >= 2) {
    return {
      customerName: clean(parts.slice(0, -1).join(" "), 100),
      customerLastname: clean(parts[parts.length - 1], 100)
    };
  }

  return {
    customerName: clean(parts[0] || "Cliente", 100),
    customerLastname: "Evolution"
  };
}

function boxfulCourierFromObject(obj = {}) {
  if (!obj || typeof obj !== "object") return { id: "", name: "" };

  const directName = clean(
    obj.courierName ||
    obj.carrierName ||
    obj.providerName ||
    obj.companyName ||
    obj.name ||
    "",
    180
  );
  const directId = clean(
    obj.courierId ||
    obj.carrierId ||
    obj.providerId ||
    obj.shippingCompanyId ||
    obj.id ||
    "",
    180
  );

  const text = directName.toLowerCase();
  if (directId && (
    text.includes("cargo") ||
    text.includes("expreso") ||
    text.includes("express")
  )) {
    return { id: directId, name: directName };
  }

  for (const key of ["courier","carrier","provider","shippingCompany","company"]) {
    const nested = obj[key];
    if (nested && typeof nested === "object") {
      const nestedId = clean(nested.id || nested._id || nested.courierId || "", 180);
      const nestedName = clean(nested.name || nested.title || nested.courierName || "", 180);
      if (nestedId) return { id: nestedId, name: nestedName };
    }
  }

  return { id: "", name: "" };
}

function boxfulCodAmount(order = {}) {
  return ["cod_forza", "cod_cargo"].includes(String(order.paymentMethod || ""))
    ? Number(order.totalGtq || 0)
    : 0;
}

function boxfulQuoterCandidates({ recolectionAddressId, destination, packageInfo, order }) {
  const codAmount = boxfulCodAmount(order);
  return [
    {
      recolectionAddressId,
      deliveryAddress: destination.address,
      deliveryReferencePoint: destination.referencePoint,
      deliveryState: destination.department,
      deliveryCity: destination.municipality,
      deliveryPoblado: destination.poblado,
      deliveryLatitude: destination.latitude,
      deliveryLongitude: destination.longitude,
      deliveryPhone: destination.recipientPhone,
      weight: packageInfo.weight,
      length: packageInfo.length,
      width: packageInfo.width,
      height: packageInfo.height,
      cashOnDeliveryAmount: codAmount
    },
    {
      recolectionAddressId,
      address: destination.address,
      referencePoint: destination.referencePoint,
      state: destination.department,
      city: destination.municipality,
      poblado: destination.poblado,
      latitude: destination.latitude,
      longitude: destination.longitude,
      phone: destination.recipientPhone,
      package: {
        weight: packageInfo.weight,
        length: packageInfo.length,
        width: packageInfo.width,
        height: packageInfo.height,
        quantity: 1
      },
      collectAmount: codAmount
    },
    {
      recolectionAddressId,
      destination: {
        name: destination.recipientName,
        phone: destination.recipientPhone,
        email: destination.recipientEmail,
        address: destination.address,
        referencePoint: destination.referencePoint,
        state: destination.department,
        city: destination.municipality,
        poblado: destination.poblado,
        latitude: destination.latitude,
        longitude: destination.longitude
      },
      packages: [{
        weight: packageInfo.weight,
        length: packageInfo.length,
        width: packageInfo.width,
        height: packageInfo.height,
        quantity: 1
      }],
      cashOnDelivery: codAmount > 0,
      cashOnDeliveryAmount: codAmount
    }
  ];
}


function boxfulCollectObjects(value, out = [], depth = 0) {
  if (!value || depth > 8) return out;
  if (Array.isArray(value)) {
    for (const item of value) boxfulCollectObjects(item, out, depth + 1);
    return out;
  }
  if (typeof value !== "object") return out;
  out.push(value);
  for (const child of Object.values(value)) {
    if (child && typeof child === "object") boxfulCollectObjects(child, out, depth + 1);
  }
  return out;
}

function boxfulObjectSearchText(obj = {}) {
  const pieces = [];
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined || typeof value === "object") continue;
    if (/name|courier|carrier|provider|service|company|paquet|shipping|delivery|type/i.test(key)) pieces.push(String(value));
  }
  return pieces.join(" ").toLowerCase();
}

function boxfulQuoteContext(obj = {}) {
  const get = keys => clean(boxfulDeepFind(obj, keys), 180);
  const courier = boxfulCourierFromObject(obj);

  let courierId = get([
    "courierId","courier_id","carrierId","carrier_id",
    "providerId","provider_id","shippingCompanyId"
  ]);
  let courierName = get([
    "courierName","courier_name","carrierName","carrier_name",
    "providerName","provider_name","companyName"
  ]);

  if (!courierId && courier.id) courierId = courier.id;
  if (!courierName && courier.name) courierName = courier.name;

  return {
    quoteId: get(["quoteId","quote_id","quotationId","quotation_id","quoterId","quoter_id"]),
    courierId,
    serviceId: get(["serviceId","service_id","shippingServiceId","shipping_service_id"]),
    rateId: get(["rateId","rate_id","tariffId","tariff_id"]),
    optionId: get(["optionId","option_id","shippingOptionId","shipping_option_id"]),
    courierName,
    serviceName: get(["serviceName","service_name","shippingServiceName","typeName","type"]),
    deliveryStateId: get(["deliveryStateId","delivery_state_id","stateId","state_id"]),
    deliveryCityId: get(["deliveryCityId","delivery_city_id","cityId","city_id"])
  };
}

function boxfulSelectQuoteOption(data = {}, preferred = "Cargo Expreso") {
  const objects = boxfulCollectObjects(data, []);
  const terms = String(preferred || "Cargo Expreso").toLowerCase().split(/\s+/).filter(Boolean);
  let best = { score: -1, object: data };

  for (const obj of objects) {
    const text = boxfulObjectSearchText(obj);
    const ctx = boxfulQuoteContext(obj);
    const price = boxfulDeepFind(obj, ["price","amount","total","cost","rate"]);
    let score = 0;
    if (price !== "" && price !== null && price !== undefined) score += 2;
    if (ctx.quoteId || ctx.courierId || ctx.serviceId || ctx.rateId || ctx.optionId) score += 4;
    for (const term of terms) if (term && text.includes(term)) score += 6;
    if (text.includes("cargo")) score += 7;
    if (text.includes("expreso") || text.includes("express")) score += 6;
    if (score > best.score) best = { score, object: obj };
  }

  let context = boxfulQuoteContext(best.object || data);

  if (!context.courierId) {
    for (const obj of objects) {
      const courier = boxfulCourierFromObject(obj);
      const name = String(courier.name || "").toLowerCase();
      if (courier.id && (
        name.includes("cargo") ||
        name.includes("expreso") ||
        name.includes("express")
      )) {
        context = {
          ...context,
          courierId: courier.id,
          courierName: courier.name || context.courierName
        };
        break;
      }
    }
  }

  return {
    score: best.score,
    context
  };
}

function boxfulShipmentContextFields(ctx = {}) {
  const out = {};
  if (ctx.quoteId) { out.quoteId = ctx.quoteId; out.quotationId = ctx.quoteId; }
  if (ctx.courierId) { out.courierId = ctx.courierId; out.carrierId = ctx.courierId; }
  if (ctx.serviceId) out.serviceId = ctx.serviceId;
  if (ctx.rateId) out.rateId = ctx.rateId;
  if (ctx.optionId) out.optionId = ctx.optionId;
  if (ctx.courierName) { out.courier = ctx.courierName; out.carrier = ctx.courierName; }
  if (ctx.serviceName) out.service = ctx.serviceName;
  return out;
}

function boxfulSafeDiagnostic(value, max = 3500) {
  try { return clean(JSON.stringify(value), max); }
  catch { return clean(String(value || ""), max); }
}


function boxfulNormText(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function boxfulGeoRows(data, kind = "state") {
  const objects = boxfulCollectObjects(data, []);
  const rows = [];
  const seen = new Set();

  for (const obj of objects) {
    if (!obj || typeof obj !== "object") continue;

    const id = clean(
      obj.id || obj._id ||
      (kind === "state" ? (obj.stateId || obj.state_id) : (obj.cityId || obj.city_id)) ||
      "",
      180
    );

    const name = clean(
      obj.name || obj.title || obj.label ||
      (kind === "state"
        ? (obj.stateName || obj.state_name || obj.department || obj.departamento)
        : (obj.cityName || obj.city_name || obj.municipality || obj.municipio)) ||
      "",
      180
    );

    if (!id || !name) continue;
    const key = `${id}|${boxfulNormText(name)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ id, name });
  }
  return rows;
}

function boxfulFindGeoRow(rows = [], wanted = "") {
  const target = boxfulNormText(wanted);
  if (!target) return null;

  let exact = rows.find(row => boxfulNormText(row.name) === target);
  if (exact) return exact;

  exact = rows.find(row => {
    const n = boxfulNormText(row.name);
    return n && (n.includes(target) || target.includes(n));
  });
  return exact || null;
}

async function boxfulDiscoverDestinationGeoIds(env, destination = {}) {
  const wantedState = clean(destination.department, 100);
  const wantedCity = clean(destination.municipality, 120);
  const attempts = [];

  // Official Boxful docs: state/city IDs come from GET /states.
  // The response may contain nested cities, so resolve both from that single
  // read-only endpoint instead of probing undocumented /cities aliases.
  try {
    const result = await boxfulRawGet(env, "/states");
    const objects = result.ok ? boxfulCollectObjects(result.data, []) : [];

    const objectName = obj => clean(
      obj?.name || obj?.title || obj?.label ||
      obj?.stateName || obj?.state_name ||
      obj?.cityName || obj?.city_name ||
      obj?.department || obj?.departamento ||
      obj?.municipality || obj?.municipio || "",
      180
    );
    const objectId = obj => clean(
      obj?.id || obj?._id || obj?.stateId || obj?.state_id || obj?.cityId || obj?.city_id || "",
      180
    );

    let stateObj = null;
    for (const obj of objects) {
      if (!obj || typeof obj !== "object") continue;
      const name = objectName(obj);
      const id = objectId(obj);
      if (id && name && boxfulNormText(name) === boxfulNormText(wantedState)) {
        stateObj = obj;
        break;
      }
    }

    let stateId = stateObj ? objectId(stateObj) : "";
    let stateName = stateObj ? objectName(stateObj) : "";
    let cityObj = null;

    // Prefer a city nested under the matched state.
    if (stateObj) {
      const nested = boxfulCollectObjects(stateObj, []);
      cityObj = nested.find(obj => {
        if (!obj || obj === stateObj || typeof obj !== "object") return false;
        const name = objectName(obj);
        const id = objectId(obj);
        return id && name && boxfulNormText(name) === boxfulNormText(wantedCity);
      }) || null;
    }

    // Fallback for flat responses: match city by name and, when present,
    // require its state reference to equal the chosen state.
    if (!cityObj) {
      cityObj = objects.find(obj => {
        if (!obj || typeof obj !== "object") return false;
        const name = objectName(obj);
        const id = objectId(obj);
        if (!id || !name || boxfulNormText(name) !== boxfulNormText(wantedCity)) return false;
        const parentStateId = clean(
          obj.stateId || obj.state_id || obj.parentStateId || obj.parent_state_id || obj.state?.id || obj.state?._id || "",
          180
        );
        return !stateId || !parentStateId || parentStateId === stateId;
      }) || null;
    }

    const cityId = cityObj ? objectId(cityObj) : "";
    const cityName = cityObj ? objectName(cityObj) : "";

    attempts.push({
      pathname: "/states",
      status: result.status,
      ok: result.ok,
      wantedState,
      wantedCity,
      stateMatch: stateId ? { id: stateId, name: stateName } : null,
      cityMatch: cityId ? { id: cityId, name: cityName } : null
    });

    if (result.ok && stateId && cityId) {
      return {
        found: true,
        stateId,
        cityId,
        stateName: stateName || wantedState,
        cityName: cityName || wantedCity,
        source: "/states",
        attempts
      };
    }
  } catch (error) {
    attempts.push({ pathname: "/states", status: 0, ok: false, error: clean(error?.message || "ERROR", 500) });
  }

  // Secondary fallback: some saved pickup/address objects may expose IDs.
  // This remains read-only and never creates anything.
  try {
    const addresses = await boxfulRawGet(env, "/addresses");
    attempts.push({ pathname: "/addresses", status: addresses.status, ok: addresses.ok });
    if (addresses.ok) {
      const objects = boxfulCollectObjects(addresses.data, []);
      for (const obj of objects) {
        if (!obj || typeof obj !== "object") continue;
        const stateId = clean(obj.stateId || obj.state_id || obj.state?.id || obj.state?._id || "", 180);
        const cityId = clean(obj.cityId || obj.city_id || obj.city?.id || obj.city?._id || "", 180);
        const stateName = clean(obj.stateName || obj.state_name || obj.state?.name || obj.state?.title || "", 180);
        const cityName = clean(obj.cityName || obj.city_name || obj.city?.name || obj.city?.title || "", 180);
        if (
          stateId && cityId && stateName && cityName &&
          boxfulNormText(stateName) === boxfulNormText(wantedState) &&
          boxfulNormText(cityName) === boxfulNormText(wantedCity)
        ) {
          return { found: true, stateId, cityId, stateName, cityName, source: "/addresses", attempts };
        }
      }
    }
  } catch (error) {
    attempts.push({ pathname: "/addresses", status: 0, ok: false, error: clean(error?.message || "ERROR", 500) });
  }

  return {
    found: false,
    reason: "STATE_OR_CITY_ID_NOT_FOUND",
    wantedState,
    wantedCity,
    attempts
  };
}

async function boxfulResolveDestinationGeoIds(env, destination = {}, quoteContext = {}) {
  const quoteStateId = clean(
    quoteContext.deliveryStateId || quoteContext.stateId || "",
    180
  );
  const quoteCityId = clean(
    quoteContext.deliveryCityId || quoteContext.cityId || "",
    180
  );

  if (quoteStateId && quoteCityId) {
    return {
      stateId: quoteStateId,
      cityId: quoteCityId,
      stateName: clean(destination.department, 100),
      cityName: clean(destination.municipality, 120),
      source: "quoter"
    };
  }

  const discovered = await boxfulDiscoverDestinationGeoIds(env, destination);
  if (discovered.found) {
    return {
      stateId: discovered.stateId,
      cityId: discovered.cityId,
      stateName: discovered.stateName || clean(destination.department, 100),
      cityName: discovered.cityName || clean(destination.municipality, 120),
      source: `discovery:${discovered.source}`,
      attempts: discovered.attempts
    };
  }

  const error = new Error("BOXFUL_DESTINATION_IDS_MISSING");
  error.boxful = {
    status: 0,
    message: `No se pudieron resolver los IDs internos de Boxful para ${clean(destination.department,100)} / ${clean(destination.municipality,120)}.`,
    data: discovered
  };
  error.boxfulAttempts = discovered.attempts || [];
  throw error;
}

function boxfulShipmentCandidates({ recolectionAddressId, destination, packageInfo, order, quoteContext = {}, geo = {} }) {
  const codAmount = Math.round(boxfulCodAmount(order) * 100) / 100;
  const content = clean(order.productTitle || "Producto Evolution Design", 180);
  const phone = clean(destination.recipientPhone, 60).replace(/[^\d]/g, "");
  const email = validEmail(destination.recipientEmail || order.ownerEmail) || "support@evolutiondesing.com";
  const customer = boxfulCustomerParts(order, destination);
  const courierId = clean(quoteContext.courierId, 180);

  const addressParts = [
    clean(destination.address, 240),
    clean(destination.poblado, 140),
    clean(destination.municipality, 120),
    clean(destination.department, 100)
  ].filter(Boolean);

  const seenAddressParts = new Set();
  const fullCustomerAddress = addressParts.filter(part => {
    const key = part.toLowerCase().trim();
    if (!key || seenAddressParts.has(key)) return false;
    seenAddressParts.add(key);
    return true;
  }).join(", ");

  let weight = Number(packageInfo.weight);
  let length = Number(packageInfo.length);
  let width = Number(packageInfo.width);
  let height = Number(packageInfo.height);

  if (order.sku === STORE_IPHONE_SKU) {
    if (!Number.isFinite(weight) || weight <= 0 || weight > 2) weight = 0.5;
    if (!Number.isFinite(length) || length <= 0 || length > 60) length = 20;
    if (!Number.isFinite(width) || width <= 0 || width > 60) width = 15;
    if (!Number.isFinite(height) || height <= 0 || height > 60) height = 8;
  }

  const stateId = clean(geo.stateId, 180);
  const cityId = clean(geo.cityId, 180);
  if (!stateId || !cityId) throw new Error("BOXFUL_DESTINATION_IDS_MISSING");

  // Keep this request intentionally minimal and aligned to Boxful's official
  // POST /shipment quickstart. Extra undocumented aliases are omitted because
  // they can make Boxful's backend fail with a generic 500.
  const payload = {
    courierId,
    recolectionAddressId,
    customerName: customer.customerName,
    customerLastname: customer.customerLastname,
    customerEmail: email,
    customerPhone: phone,
    customerPhoneAreaCode: "+502",
    customerAddress: fullCustomerAddress,
    customerState: stateId,
    customerCity: cityId,
    parcels: [{
      content,
      height,
      length,
      width,
      weight,
      price: 1,
      isFragile: false
    }],
    cod: codAmount > 0,
    codAmount: codAmount > 0 ? codAmount : 0
  };

  // IMPORTANT: exactly one POST /shipment per click.
  return [payload];
}


function boxfulShipmentDiagnostic(body = {}) {
  const firstParcel = Array.isArray(body.parcels) && body.parcels.length ? body.parcels[0] : null;

  return {
    recolectionAddressId: clean(body.recolectionAddressId, 180),
    courierId: clean(body.courierId, 180),

    customerPhoneType: typeof body.customerPhone,
    customerPhoneLength: String(body.customerPhone || "").length,
    customerPhoneAreaCode: clean(body.customerPhoneAreaCode || "", 20),
    customerNameType: typeof body.customerName,
    customerNameLength: String(body.customerName || "").length,
    customerLastnameType: typeof body.customerLastname,
    customerLastnameLength: String(body.customerLastname || "").length,
    customerEmailValid: Boolean(validEmail(body.customerEmail || "")),

    codType: typeof body.cod,
    cod: body.cod === true,
    codAmount: Number(body.codAmount || 0),

    parcelsIsArray: Array.isArray(body.parcels),
    parcelsCount: Array.isArray(body.parcels) ? body.parcels.length : -1,
    parcel: firstParcel ? {
      contentLength: String(firstParcel.content || "").length,
      weight: Number(firstParcel.weight),
      weightType: typeof firstParcel.weight,
      length: Number(firstParcel.length),
      width: Number(firstParcel.width),
      height: Number(firstParcel.height),
      price: Number(firstParcel.price),
      priceType: typeof firstParcel.price,
      isFragile: firstParcel.isFragile === true,
      isFragileType: typeof firstParcel.isFragile
    } : null,

    deliveryAddressLength: String(body.customerAddress || "").length,
    deliveryStateId: clean(body.customerState || "", 180),
    deliveryCityId: clean(body.customerCity || "", 180),
    requestKeys: Object.keys(body)
  };
}


async function boxfulTryCandidates(env, pathname, candidates) {
  const token = await boxfulAuthenticate(env);
  let last = null;
  const attempts = [];

  for (let index = 0; index < candidates.length; index++) {
    const body = candidates[index];
    const response = await fetch(`${BOXFUL_API_BASE}${pathname}`, {
      method: "POST",
      headers: {
        "accept": "application/json",
        "content-type": "application/json",
        "authorization": `Bearer ${token}`
      },
      body: JSON.stringify(body)
    });

    const text = await response.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; }
    catch { data = { raw: clean(text, 5000) }; }

    if (response.ok) return { ok: true, data, adapterIndex: index, requestKeys: Object.keys(body) };

    const message = clean(
      data?.message || data?.error || data?.data?.message ||
      data?.errors?.[0]?.message || text,
      1200
    );

    last = { status: response.status, data, adapterIndex: index, message };
    attempts.push({
      adapterIndex: index,
      status: response.status,
      message,
      response: boxfulSafeDiagnostic(data, 2200),
      requestKeys: Object.keys(body).join(","),
      requestDiagnostic: boxfulShipmentDiagnostic(body)
    });

    if (pathname === "/shipment") break;
    if (![400,404,409,422].includes(response.status)) break;
  }

  const err = new Error(pathname === "/shipment" ? "BOXFUL_SHIPMENT_FAILED" : "BOXFUL_QUOTE_FAILED");
  err.boxful = last;
  err.boxfulAttempts = attempts;
  throw err;
}

function boxfulDeepFind(obj, keys, depth = 0) {
  if (!obj || depth > 7) return "";
  const wanted = new Set(keys.map(x => String(x).toLowerCase()));
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = boxfulDeepFind(item, keys, depth + 1);
      if (found !== "" && found !== null && found !== undefined) return found;
    }
    return "";
  }
  if (typeof obj !== "object") return "";

  for (const [key, value] of Object.entries(obj)) {
    if (wanted.has(String(key).toLowerCase()) && value !== null && value !== undefined && value !== "") {
      return value;
    }
  }
  for (const value of Object.values(obj)) {
    if (value && typeof value === "object") {
      const found = boxfulDeepFind(value, keys, depth + 1);
      if (found !== "" && found !== null && found !== undefined) return found;
    }
  }
  return "";
}

function boxfulShipmentResult(data = {}) {
  const shipmentNumber = clean(boxfulDeepFind(data, [
    "shipmentNumber", "shipment_number", "trackingNumber", "tracking_number",
    "guideNumber", "guide", "tracking", "number"
  ]), 160);
  const shipmentId = clean(boxfulDeepFind(data, [
    "shipmentId", "shipment_id", "id"
  ]), 160);
  const trackingUrlRaw = clean(boxfulDeepFind(data, [
    "trackingUrl", "tracking_url", "url"
  ]), 900);
  let trackingUrl = "";
  try {
    if (trackingUrlRaw) {
      const u = new URL(trackingUrlRaw);
      if (["http:", "https:"].includes(u.protocol)) trackingUrl = u.href;
    }
  } catch {}

  return { shipmentNumber: shipmentNumber || shipmentId, shipmentId, trackingUrl };
}

function boxfulQuoteResult(data = {}) {
  const amountRaw = boxfulDeepFind(data, ["price", "amount", "total", "cost", "rate"]);
  const currency = clean(boxfulDeepFind(data, ["currency", "coin", "currencyCode"]), 12);
  const etaRaw = boxfulDeepFind(data, [
    "estimatedDeliveryDate", "estimated_delivery_date", "deliveryDate",
    "delivery_date", "eta", "estimatedDate"
  ]);
  return {
    amount: Number.isFinite(Number(amountRaw)) ? Number(amountRaw) : null,
    currency,
    estimatedDeliveryDate: clean(etaRaw, 80)
  };
}

function boxfulShouldAutoCreate(order = {}) {
  const method = String(order.paymentMethod || "");
  if (!method || method === "pickup_pana" || method === "transfer_shipping") return false;
  return true;
}

async function boxfulEstimateForOrderLike(env, orderLike = {}, saleConfig = null) {
  const policy = boxfulPolicyEstimate(new Date());
  if (!boxfulConfigured(env) || String(orderLike.paymentMethod || "") === "pickup_pana") {
    return { ...policy, boxfulConnected: boxfulConfigured(env), quoteAvailable: false };
  }

  try {
    const config = await loadBoxfulStoreConfig(env);
    if (!config.recolectionAddressId) {
      return { ...policy, boxfulConnected: true, quoteAvailable: false, code: "BOXFUL_PICKUP_NOT_SELECTED" };
    }

    const destination = boxfulOrderDestination(orderLike);
    const packageInfo = boxfulPackageFromConfig(
      saleConfig?.package || saleConfig || config,
      {
        weight: config.packageWeightKg,
        length: config.packageLengthCm,
        width: config.packageWidthCm,
        height: config.packageHeightCm
      }
    );

    const result = await boxfulTryCandidates(
      env,
      "/quoter",
      boxfulQuoterCandidates({
        recolectionAddressId: config.recolectionAddressId,
        destination,
        packageInfo,
        order: orderLike
      })
    );
    const quote = boxfulQuoteResult(result.data);
    const selected = boxfulSelectQuoteOption(result.data, orderLike.carrier || "Cargo Expreso");
    return {
      ...policy,
      boxfulConnected: true,
      quoteAvailable: true,
      quote,
      adapterIndex: result.adapterIndex,
      rawEta: quote.estimatedDeliveryDate || "",
      quoteContext: selected.context,
      quoteOptionScore: selected.score
    };
  } catch (error) {
    console.warn("Boxful quote fallback:", error?.message || error, error?.boxful?.status || "");
    return {
      ...policy,
      boxfulConnected: true,
      quoteAvailable: false,
      code: String(error?.message || "BOXFUL_QUOTE_FAILED")
    };
  }
}

async function boxfulCreateShipmentForOrder(env, order, { force = false, saleConfig = null } = {}) {
  if (!order?.orderId) throw new Error("STORE_ORDER_NOT_FOUND");
  if (order.boxfulShipmentNumber || order.boxfulShipmentId) return order;
  if (!force && !boxfulShouldAutoCreate(order)) return order;
  if (String(order.paymentMethod || "") === "pickup_pana") return order;

  const config = await loadBoxfulStoreConfig(env);
  if (!force && config.autoCreateShipment === false) return order;
  if (!config.recolectionAddressId) throw new Error("BOXFUL_PICKUP_NOT_SELECTED");
  if (!boxfulConfigured(env)) throw new Error("BOXFUL_NOT_CONFIGURED");

  const estimate = await boxfulEstimateForOrderLike(env, order, saleConfig);
  const destination = boxfulOrderDestination(order);
  const packageInfo = boxfulPackageFromConfig(
    saleConfig?.package || saleConfig || config,
    {
      weight: config.packageWeightKg,
      length: config.packageLengthCm,
      width: config.packageWidthCm,
      height: config.packageHeightCm
    }
  );

  const quoteContext = estimate.quoteContext || {};
  const resolvedCourier = await boxfulResolveCourier(env, config, quoteContext);
  quoteContext.courierId = resolvedCourier.id;
  quoteContext.courierName = resolvedCourier.name || "Cargo Expreso";

  // Do not call /shipment until Boxful's own state/city IDs are resolved.
  // This prevents another server-side 500 caused by sending display names
  // where the backend expects internal identifiers.
  const resolvedGeo = await boxfulResolveDestinationGeoIds(env, destination, quoteContext);

  const result = await boxfulTryCandidates(
    env,
    "/shipment",
    boxfulShipmentCandidates({
      recolectionAddressId: config.recolectionAddressId,
      destination,
      packageInfo,
      order,
      quoteContext,
      geo: resolvedGeo
    })
  );
  const created = boxfulShipmentResult(result.data);
  if (!created.shipmentNumber) throw new Error("BOXFUL_SHIPMENT_NUMBER_MISSING");

  const now = new Date();
  const patch = {
    boxfulStatus: "created",
    boxfulCourierId: quoteContext.courierId || "",
    boxfulCourierName: quoteContext.courierName || "Cargo Expreso",
    boxfulCourierSource: resolvedCourier.source || "",
    boxfulDeliveryStateId: resolvedGeo.stateId || "",
    boxfulDeliveryCityId: resolvedGeo.cityId || "",
    boxfulDeliveryGeoSource: resolvedGeo.source || "",
    boxfulShipmentNumber: created.shipmentNumber,
    boxfulShipmentId: created.shipmentId || "",
    trackingNumber: created.shipmentNumber,
    trackingUrl: created.trackingUrl || order.trackingUrl || "",
    carrier: order.carrier && order.carrier !== "Envío nacional" ? order.carrier : "Boxful",
    boxfulCreatedAt: now,
    boxfulAdapterIndex: result.adapterIndex,
    estimatedDispatchDate: estimate.dispatchDate,
    estimatedDeliveryDate: estimate.earliestDeliveryDate,
    estimatedDeliveryLatestDate: estimate.latestDeliveryDate,
    updatedAt: now
  };

  await adminPatchDocument(env, ["storeOrders", order.orderId], patch);
  return { ...order, ...patch };
}

async function boxfulCreateShipmentSafely(env, order, options = {}) {
  try {
    return await boxfulCreateShipmentForOrder(env, order, options);
  } catch (error) {
    const patch = {
      boxfulStatus: "pending_retry",
      boxfulErrorCode: String(error?.message || "BOXFUL_SHIPMENT_FAILED"),
      boxfulErrorStatus: Number(error?.boxful?.status || 0),
      boxfulErrorMessage: clean(error?.boxful?.message || "", 1200),
      boxfulErrorDetails: boxfulSafeDiagnostic(error?.boxful?.data || {}, 3500),
      boxfulErrorAttempts: boxfulSafeDiagnostic(error?.boxfulAttempts || [], 5000),
      boxfulErrorAdapterIndex: Number(error?.boxful?.adapterIndex ?? -1),
      boxfulErrorServerSide: Number(error?.boxful?.status || 0) >= 500,
      boxfulErrorAt: new Date(),
      updatedAt: new Date()
    };
    if (order?.orderId) {
      await adminPatchDocument(env, ["storeOrders", order.orderId], patch).catch(() => {});
    }
    console.warn("Boxful shipment pending retry", order?.orderId, patch.boxfulErrorCode, patch.boxfulErrorStatus);
    return { ...order, ...patch };
  }
}

async function boxfulRefreshOrderTracking(env, order) {
  const shipmentNumber = clean(order.boxfulShipmentNumber || order.trackingNumber, 160);
  if (!shipmentNumber) return order;

  try {
    const data = await boxfulApi(env, `/tracking/${encodeURIComponent(shipmentNumber)}`);
    const status = clean(boxfulDeepFind(data, [
      "status", "statusName", "status_name", "shipmentStatus", "shipment_status"
    ]), 120);
    const description = clean(boxfulDeepFind(data, [
      "description", "statusDescription", "status_description", "message"
    ]), 400);
    const now = new Date();

    const patch = {
      boxfulTrackingStatus: status,
      boxfulTrackingDescription: description,
      boxfulLastTrackingAt: now,
      updatedAt: now
    };
    await adminPatchDocument(env, ["storeOrders", order.orderId], patch);
    return { ...order, ...patch };
  } catch (error) {
    console.warn("Boxful tracking refresh", order.orderId, error?.message || error);
    return order;
  }
}

async function boxfulEstimateRoute(request, env, origin) {
  try {
    const user = await requireFirebaseUser(bearerToken(request));
    const payload = await request.json().catch(() => ({}));
    const method = clean(payload.paymentMethod, 40).toLowerCase();
    if (!STORE_PAYMENT_METHODS.has(method)) throw new Error("STORE_METHOD_INVALID");

    let saleConfig=null;
    if(payload.saleSlug){
      saleConfig=await loadTemporarySale(env,payload.saleSlug,true);
    }
    if(saleConfig&&saleImportPending(saleConfig))return json({ok:true,estimate:null,importPending:true,importInfo:saleConfig.importInfo},200,origin);
    const orderLike = {
      orderId: "ESTIMATE",
      paymentMethod: method,
      ownerEmail: user.email || "",
      productTitle: clean(payload.productTitle || saleConfig?.title || STORE_IPHONE_TITLE, 180),
      totalGtq: Number(payload.totalGtq || 0),
      customerName: clean(payload.customerName || user.displayName || "Cliente",120),
      recipientName: clean(payload.recipientName || payload.customerName || user.displayName || "Cliente",120),
      phone: clean(payload.phone || "00000000",40),
      department: clean(payload.department,80),
      municipality: clean(payload.municipality,100),
      poblado: clean(payload.poblado,120),
      address: clean(payload.address || payload.poblado || payload.municipality || "Dirección pendiente",240),
      reference: clean(payload.reference || "Referencia pendiente",240),
      destinationLat: Number(payload.destinationLat),
      destinationLng: Number(payload.destinationLng)
    };
    const estimate = await boxfulEstimateForOrderLike(env, orderLike, saleConfig);
    return json({ ok: true, estimate }, 200, origin);
  } catch (error) {
    const code = String(error?.message || "");
    return json({
      ok: false,
      code,
      error: code === "AUTH_MISSING" || code === "AUTH_INVALID"
        ? "Inicia sesión para calcular la entrega."
        : "No se pudo calcular la entrega aproximada."
    }, code === "AUTH_MISSING" || code === "AUTH_INVALID" ? 401 : 400, origin);
  }
}

async function boxfulAdminCreateShipmentRoute(request, env, origin) {
  let orderId = "";

  try {
    await requireFirebaseAdmin(bearerToken(request));
    const payload = await request.json().catch(() => ({}));
    orderId = clean(payload.orderId, 120);

    const snap = await adminGetDocument(env, ["storeOrders", orderId], true);
    if (!snap.exists) throw new Error("STORE_ORDER_NOT_FOUND");
    const order = { orderId, ...(snap.data || {}) };

    let saleConfig = null;
    if (order.saleSlug) saleConfig = await loadTemporarySale(env, order.saleSlug, false).catch(() => null);

    const updated = await boxfulCreateShipmentForOrder(env, order, {
      force: true,
      saleConfig
    });

    return json({ ok: true, order: normalizeStoreOrder(updated) }, 200, origin);
  } catch (error) {
    const code = String(error?.message || "");
    const status = Number(error?.boxful?.status || 0);
    const boxfulMessage = clean(error?.boxful?.message || "", 1200);
    const attempts = Array.isArray(error?.boxfulAttempts) ? error.boxfulAttempts : [];

    // IMPORTANT:
    // Manual retries previously returned the diagnostic to the browser but
    // did not persist it in storeOrders. Admin refresh therefore had nothing
    // to render and kept storeOrderBoxfulDiagnosticWrap hidden.
    if (orderId && code !== "STORE_ORDER_NOT_FOUND" && code !== "ADMIN_ONLY") {
      const diagnosticPatch = {
        boxfulStatus: "pending_retry",
        boxfulErrorCode: code || "BOXFUL_SHIPMENT_FAILED",
        boxfulErrorStatus: status,
        boxfulErrorMessage: boxfulMessage,
        boxfulErrorDetails: boxfulSafeDiagnostic(error?.boxful?.data || {}, 3500),
        boxfulErrorAttempts: boxfulSafeDiagnostic(attempts, 5000),
        boxfulErrorAdapterIndex: Number(error?.boxful?.adapterIndex ?? -1),
        boxfulErrorServerSide: status >= 500,
        boxfulErrorAt: new Date(),
        updatedAt: new Date()
      };

      await adminPatchDocument(
        env,
        ["storeOrders", orderId],
        diagnosticPatch
      ).catch(persistError => {
        console.warn(
          "Could not persist Boxful manual retry diagnostic",
          orderId,
          persistError?.message || persistError
        );
      });
    }

    const base = ({
      ADMIN_ONLY: "Solo Administración puede crear guías.",
      STORE_ORDER_NOT_FOUND: "No encontramos ese pedido.",
      BOXFUL_NOT_CONFIGURED: "Boxful no está configurado.",
      BOXFUL_PICKUP_NOT_SELECTED: "Selecciona primero la dirección de recolección.",
      BOXFUL_SHIPMENT_FAILED: "La paquetería rechazó la creación del envío.",
      BOXFUL_COURIER_ID_MISSING: "No se pudo identificar el courierId de Cargo Expreso.",
      BOXFUL_DESTINATION_IDS_MISSING: "No se pudieron resolver los IDs internos de departamento/municipio en Boxful.",
      BOXFUL_SHIPMENT_NUMBER_MISSING: "La paquetería respondió, pero no devolvió un número de guía reconocible."
    })[code] || "No se pudo crear la guía.";

    const visibleError = boxfulMessage
      ? `${base} HTTP ${status || "?"} · ${boxfulMessage}`
      : base;

    return json({
      ok: false,
      code,
      error: visibleError,
      diagnostic: {
        status,
        message: boxfulMessage,
        response: error?.boxful?.data || {},
        adapterIndex: Number(error?.boxful?.adapterIndex ?? -1),
        attempts
      }
    }, code === "ADMIN_ONLY" ? 403 : code === "STORE_ORDER_NOT_FOUND" ? 404 : 400, origin);
  }
}

const STORE_IPHONE_SKU = "iphone-8-plus-temp";
const STORE_IPHONE_TITLE = "iPhone 8 Plus";
const STORE_IPHONE_BASE_CENTS = 95000; // Q950.00
const STORE_TRANSFER_SHIPPING_CENTS = 4000; // Q40.00
const STORE_COD_SURCHARGE_BPS = 700; // 7.00%
const STORE_VISACUOTAS_URL = "https://app.recurrente.com/s/evolutiondesing/o/iphone-8-plus";

const STORE_BANK_ACCOUNTS = [
  {
    key: "bac",
    bank: "BAC Credomatic",
    accountHolder: "César Mátzar",
    accountNumber: "973883242",
    accountType: "Cuenta de ahorro",
    currency: "GTQ"
  },
  {
    key: "promerica",
    bank: "Promerica",
    accountHolder: "César Mátzar",
    accountNumber: "32992082006521",
    accountType: "Cuenta de ahorro",
    currency: "GTQ"
  },
  {
    key: "banrural",
    bank: "Banrural",
    accountHolder: "César Mátzar",
    accountNumber: "4156174501",
    accountType: "Cuenta de ahorro",
    currency: "GTQ"
  }
];

const STORE_DEFAULT_GUIDE = {
  title: "Guía de compra y envío",
  intro: "Revisa esta información antes de confirmar tu pedido.",
  paymentText: "Contra entrega con Cargo Expreso tiene 7% de recargo. Transferencia bancaria, PayPal, tarjeta débito/crédito y cripto incluyen Q40 de envío nacional. PayPal y tarjeta se procesan mediante el checkout seguro de PayPal; cripto se procesa con Binance Pay en USDT y queda en revisión. La entrega personal en Panajachel no tiene costo adicional. Visacuotas se procesa por separado en Recurrente y aplica el recargo mostrado antes de confirmar el financiamiento.",
  shippingText: "Realizamos envíos únicamente de lunes a viernes. Si realizas tu pedido sábado o domingo, se prepara para enviarse el lunes a las 10:00 a. m. En condiciones normales, el paquete se recibe al día siguiente del despacho. Si existen paros nacionales, bloqueos, cierres de carretera, interrupciones de la paquetería u otras situaciones fuera de nuestro control, la entrega puede tardar hasta 3 días hábiles.",
  damageText: "Al recibir el paquete, revisa el estado exterior del empaque y del producto lo antes posible y, cuando el servicio de la paquetería lo permita, solicita que la revisión quede documentada al momento de la entrega. Evolution Design mantiene relación comercial con las paqueterías utilizadas y puede gestionar la revisión de incidencias por daños de transporte. Aunque estos casos son poco frecuentes, si el producto llega con daño físico atribuible al traslado debes reportarlo a Evolution Design dentro de las 10 horas siguientes a la recepción, adjuntando fotografías o video del empaque, del producto, la guía de envío y cualquier evidencia disponible. Después de ese plazo no podremos iniciar ni garantizar un reclamo por daños de transporte ante la paquetería. Cada reporte está sujeto a revisión y validación.",
  customerDamageText: "Una vez que el producto ha sido entregado y recibido sin una incidencia atribuible al transporte, Evolution Design no responde por daños ocasionados posteriormente por el uso, manejo o intervención del comprador o de terceros. Esto incluye, entre otros, golpes, caídas, presión o torsión, contacto con agua u otros líquidos, humedad, exposición excesiva al calor, uso de cargadores, cables o accesorios inadecuados, apertura o manipulación interna, reparación por talleres o personas ajenas a Evolution Design, sustitución de piezas, modificaciones de hardware o software, jailbreak, alteraciones del sistema, uso indebido o cualquier otra causa posterior a la entrega atribuible al usuario. Si se reporta una falla, Evolution Design podrá solicitar fotografías, videos, comprobantes, diagnóstico o revisión técnica para determinar si corresponde a una condición preexistente, daño de transporte o daño posterior al uso. Esta política no limita los derechos irrenunciables que la legislación aplicable reconoce al consumidor.",
  updatedAt: null
};

const STORE_ORDER_STATUSES = new Set([
  "received",
  "confirmed",
  "preparing",
  "shipped",
  "delivered",
  "cancelled"
]);
const STORE_PAYMENT_METHODS = new Set([
  "cod_forza",
  "cod_cargo",
  "transfer_shipping",
  "paypal_shipping",
  "card_shipping",
  "crypto_binance",
  "visacuotas",
  "pickup_pana"
]);
const STORE_BLOCKING_STATUSES = new Set([
  "confirmed",
  "preparing",
  "shipped",
  "delivered"
]);

function gtqFromCents(cents) {
  return Math.round(Number(cents || 0)) / 100;
}

function gtqLabel(value) {
  return `Q${Number(value || 0).toFixed(2)}`;
}

function storeMethodLabel(method) {
  return ({
    cod_forza: "Contra entrega · Forza",
    cod_cargo: "Contra entrega · Cargo Expreso",
    transfer_shipping: "Transferencia bancaria · Envío nacional",
    paypal_shipping: "PayPal · Envío nacional",
    card_shipping: "Tarjeta débito/crédito · Envío nacional",
    crypto_binance: "Cripto · Binance Pay",
    visacuotas: "Visacuotas · Recurrente",
    pickup_pana: "Entrega personal · Callejón Las Armonías"
  })[method] || method || "—";
}

function storeCarrierForMethod(method) {
  return method === "cod_forza"
    ? "Forza"
    : method === "cod_cargo"
      ? "Cargo Expreso"
      : method === "pickup_pana"
        ? "Entrega personal"
        : method === "visacuotas"
          ? "Entrega por coordinar"
          : "Envío nacional";
}

function storeStatusLabel(status, method = "") {
  if (status === "shipped" && method === "pickup_pana") return "Listo para entregar";
  return ({
    received: "Pedido recibido",
    confirmed: "Confirmado",
    preparing: "Preparando",
    shipped: "Enviado",
    delivered: "Entregado",
    cancelled: "Cancelado"
  })[status] || status || "Pedido recibido";
}

function canonicalStoreQuote(method) {
  const safeMethod = clean(method, 40).toLowerCase();
  if (!STORE_PAYMENT_METHODS.has(safeMethod)) throw new Error("STORE_METHOD_INVALID");

  const baseCents = STORE_IPHONE_BASE_CENTS;
  let surchargeCents = 0;
  let shippingCents = 0;

  if (safeMethod === "cod_forza" || safeMethod === "cod_cargo") {
    surchargeCents = Math.round(baseCents * STORE_COD_SURCHARGE_BPS / 10000);
  } else if (["transfer_shipping", "paypal_shipping", "card_shipping", "crypto_binance"].includes(safeMethod)) {
    shippingCents = STORE_TRANSFER_SHIPPING_CENTS;
  }

  const totalCents = baseCents + surchargeCents + shippingCents;
  return {
    sku: STORE_IPHONE_SKU,
    productTitle: STORE_IPHONE_TITLE,
    method: safeMethod,
    methodLabel: storeMethodLabel(safeMethod),
    carrier: storeCarrierForMethod(safeMethod),
    currency: "GTQ",
    basePriceGtq: gtqFromCents(baseCents),
    surchargeGtq: gtqFromCents(surchargeCents),
    shippingGtq: gtqFromCents(shippingCents),
    totalGtq: gtqFromCents(totalCents),
    externalSurcharge: safeMethod === "visacuotas",
    externalPaymentUrl: safeMethod === "visacuotas" ? STORE_VISACUOTAS_URL : "",
    externalFeeNote: safeMethod === "visacuotas"
      ? "Visacuotas aplica un recargo adicional. Recurrente muestra el total financiado antes de confirmar el pago."
      : "",
    onlinePayment: ["paypal_shipping", "card_shipping"].includes(safeMethod),
    manualReviewPayment: ["transfer_shipping", "crypto_binance"].includes(safeMethod),
    cryptoPayment: safeMethod === "crypto_binance"
  };
}

function storeOrderId() {
  const date = new Date().toISOString().slice(2, 10).replace(/-/g, "");
  let value = 0;
  try {
    const a = new Uint32Array(1);
    crypto.getRandomValues(a);
    value = a[0] % 10000;
  } catch (_) {
    value = Math.floor(Math.random() * 10000);
  }
  return `EV-IP8-${date}-${String(value).padStart(4, "0")}`;
}

function sanitizeStorePhone(value) {
  const phone = clean(value, 40);
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 18) throw new Error("STORE_PHONE_INVALID");
  return phone;
}

function sanitizeStoreIdentity(value) {
  const raw = clean(value, 40);
  if (!raw) return "";
  return raw.replace(/[^\p{L}\p{N}\-\/\s.]/gu, "").slice(0, 40);
}

function sanitizeStorePaymentReference(value) {
  return clean(value, 160).replace(/[^\p{L}\p{N}\-_/.:#\s]/gu, "").slice(0, 160);
}
function sanitizeStoreDraft(source = {}, user = {}, method = "") {
  const customerName=clean(source.customerName||user.displayName||"",120),recipientName=clean(source.recipientName||customerName,120),phone=sanitizeStorePhone(source.phone),nitDpi=sanitizeStoreIdentity(source.nitDpi),department=clean(source.department,80),municipality=clean(source.municipality,100),poblado=clean(source.poblado,120),address=clean(source.address,240),reference=clean(source.reference,240),notes=clean(source.notes,500),termsAccepted=source.termsAccepted===true;
  if(customerName.length<2)throw new Error("STORE_NAME_INVALID");
  if(recipientName.length<2)throw new Error("STORE_RECIPIENT_INVALID");
  if(!termsAccepted)throw new Error("STORE_TERMS_REQUIRED");
  if(method!=="pickup_pana"&&(!department||!municipality||!poblado||address.length<5||reference.length<3))throw new Error("STORE_ADDRESS_INCOMPLETE");
  return {customerName,recipientName,phone,nitDpi,department:method==="pickup_pana"?"":department,municipality:method==="pickup_pana"?"Panajachel":municipality,poblado:method==="pickup_pana"?"Panajachel":poblado,address:method==="pickup_pana"?"Callejón Las Armonías, Panajachel":address,reference:method==="pickup_pana"?"Punto de encuentro Evolution Design · cita asignada automáticamente":reference,notes,termsAccepted,destinationLat:Number(source.destinationLat||0)||null,destinationLng:Number(source.destinationLng||0)||null};
}
async function storeQuoteWithFx(method){const quote=canonicalStoreQuote(method);if(quote.method!=="crypto_binance")return quote;const fxRate=await usdGtqRate(),usdtAmount=Math.max(1,Math.round(Number(quote.totalGtq||0)/fxRate));return{...quote,fxRate,usdtAmount}}
function storeOrderFromDraft({user,draft,quote,orderId,now,paymentStatus="pending",paymentReviewStatus="",status="received",paymentProvider="",transactionId="",paypalOrderId="",paidUsd=0,paymentReference=""}){return{orderId,sku:STORE_IPHONE_SKU,productTitle:STORE_IPHONE_TITLE,ownerUid:user.uid,ownerEmail:user.email||"",customerName:draft.customerName,recipientName:draft.recipientName,phone:draft.phone,nitDpi:draft.nitDpi,paymentMethod:quote.method,paymentMethodLabel:quote.methodLabel,paymentStatus,paymentReviewStatus,paymentProvider,paymentReference,transactionId,paypalTransactionId:transactionId,paypalOrderId,carrier:quote.carrier,department:draft.department,municipality:draft.municipality,poblado:draft.poblado,address:draft.address,reference:draft.reference,notes:draft.notes,destinationLat:draft.destinationLat||null,destinationLng:draft.destinationLng||null,currency:"GTQ",basePriceGtq:quote.basePriceGtq,surchargeGtq:quote.surchargeGtq,shippingGtq:quote.shippingGtq,totalGtq:quote.totalGtq,fxRate:Number(quote.fxRate||0),paidUsd:Number(paidUsd||0),expectedUsdt:Number(quote.usdtAmount||0),externalSurcharge:quote.externalSurcharge===true,externalPaymentUrl:quote.externalPaymentUrl||"",externalFeeNote:quote.externalFeeNote||"",policiesAccepted:draft.termsAccepted===true,policiesAcceptedAt:now,acceptedPolicyVersion:"iphone-store-v3.4-shipping-damage-use",status,statusLabel:storeStatusLabel(status,quote.method),source:"iphone-8-plus-temp-page",createdAt:now,updatedAt:now,paidAt:paymentStatus==="paid"?now:null,paymentVerifiedAt:paymentStatus==="paid"?now:null,statusHistory:[{status:"received",label:storeStatusLabel("received",quote.method),at:now,by:"client"},...(status==="confirmed"?[{status:"confirmed",label:storeStatusLabel("confirmed",quote.method),at:now,by:"payment"}]:[])],adminNotificationStatus:"pending",clientNotificationStatus:"pending"}}

function normalizeStoreOrder(row) {
  return {
    id: row.id || row.data?.orderId || "",
    ...(row.data || row)
  };
}

async function listStoreOrders(env, limit = 200) {
  const rows = await adminRunQuery(env, {
    from: [{ collectionId: "storeOrders" }],
    limit: Math.max(1, Math.min(300, Number(limit) || 200))
  });
  return rows
    .map(normalizeStoreOrder)
    .sort((a, b) => {
      const ad = new Date(a.createdAt || 0).getTime() || 0;
      const bd = new Date(b.createdAt || 0).getTime() || 0;
      return bd - ad;
    });
}

async function storeAvailability(env, ignoreOrderId = "") {
  const orders = await listStoreOrders(env, 120);
  const blocking = orders.find(order =>
    order.id !== ignoreOrderId &&
    order.sku === STORE_IPHONE_SKU &&
    STORE_BLOCKING_STATUSES.has(String(order.status || "").toLowerCase())
  );
  return {
    available: !blocking,
    blockingOrderId: blocking?.id || "",
    blockingStatus: blocking?.status || ""
  };
}


function sanitizeStoreGuidePayload(source = {}) {
  return {
    title: clean(source.title || STORE_DEFAULT_GUIDE.title, 120) || STORE_DEFAULT_GUIDE.title,
    intro: clean(source.intro || STORE_DEFAULT_GUIDE.intro, 500) || STORE_DEFAULT_GUIDE.intro,
    paymentText: clean(source.paymentText || STORE_DEFAULT_GUIDE.paymentText, 1800) || STORE_DEFAULT_GUIDE.paymentText,
    shippingText: clean(source.shippingText || STORE_DEFAULT_GUIDE.shippingText, 2200) || STORE_DEFAULT_GUIDE.shippingText,
    damageText: clean(source.damageText || STORE_DEFAULT_GUIDE.damageText, 2600) || STORE_DEFAULT_GUIDE.damageText,
    customerDamageText: clean(source.customerDamageText || STORE_DEFAULT_GUIDE.customerDamageText, 3200) || STORE_DEFAULT_GUIDE.customerDamageText
  };
}

async function loadStoreGuideConfig(env) {
  try {
    const snap = await adminGetDocument(env, ["storeConfig", STORE_IPHONE_SKU], true);
    if (!snap.exists || !snap.data) return { ...STORE_DEFAULT_GUIDE };
    return {
      ...STORE_DEFAULT_GUIDE,
      ...sanitizeStoreGuidePayload(snap.data),
      updatedAt: snap.data.updatedAt || null,
      updatedByAdminEmail: snap.data.updatedByAdminEmail || ""
    };
  } catch (error) {
    console.warn("store/guide config fallback", error?.message || error);
    return { ...STORE_DEFAULT_GUIDE };
  }
}

async function adminStoreGuideConfigRoute(request, env, origin) {
  try {
    const adminUser = await requireFirebaseAdmin(bearerToken(request));

    if (request.method === "GET") {
      const guide = await loadStoreGuideConfig(env);
      return json({
        ok: true,
        guide,
        visacuotasUrl: STORE_VISACUOTAS_URL,
        bankAccounts: STORE_BANK_ACCOUNTS,
        binancePayment: { alias: "Evolution Desing", asset: "USDT", qrImage: "img/binance-pay.jpeg" }
      }, 200, origin);
    }

    const payload = await request.json().catch(() => ({}));
    const guide = sanitizeStoreGuidePayload(payload.guide || payload);
    const now = new Date();
    const stored = {
      ...guide,
      updatedAt: now,
      updatedByAdminEmail: adminUser.email
    };

    await adminSetDocument(env, ["storeConfig", STORE_IPHONE_SKU], stored);

    return json({
      ok: true,
      guide: {
        ...stored,
        updatedAt: now.toISOString()
      }
    }, 200, origin);
  } catch (error) {
    const code = String(error?.message || "");
    return json({
      ok: false,
      code,
      error: code === "ADMIN_ONLY"
        ? "Solo Administración puede modificar la guía."
        : code === "AUTH_MISSING" || code === "AUTH_INVALID"
          ? "Tu sesión administrativa no es válida."
          : "No se pudo guardar la guía pública."
    }, code === "ADMIN_ONLY" ? 403 : (code === "AUTH_MISSING" || code === "AUTH_INVALID" ? 401 : 500), origin);
  }
}

async function storeConfigPayload(availability, guide) {
  const fxRate=await usdGtqRate();
  const enrich=method=>{const q=canonicalStoreQuote(method);if(method==="crypto_binance"){const usdtAmount=Math.max(1,Math.round(Number(q.totalGtq||0)/fxRate));return{...q,fxRate,usdtAmount}}if(["paypal_shipping","card_shipping"].includes(method)){const usdAmount=moneyNumber(Number(q.totalGtq||0)/fxRate);return{...q,fxRate,usdAmount}}return q};
  return{ok:true,sku:STORE_IPHONE_SKU,title:STORE_IPHONE_TITLE,currency:"GTQ",basePriceGtq:950,available:availability.available,guide:guide||{...STORE_DEFAULT_GUIDE},bankAccounts:STORE_BANK_ACCOUNTS,visacuotasUrl:STORE_VISACUOTAS_URL,binancePayment:{alias:"Evolution Desing",asset:"USDT",qrImage:"img/binance-pay.jpeg"},paymentFxRate:fxRate,binanceFxRate:fxRate,methods:[enrich("cod_cargo"),enrich("transfer_shipping"),enrich("paypal_shipping"),enrich("card_shipping"),enrich("crypto_binance"),enrich("pickup_pana"),enrich("visacuotas")]};
}
async function storeIphoneConfigRoute(env, origin) {
  try{const [availability,guide]=await Promise.all([storeAvailability(env),loadStoreGuideConfig(env)]);return json(await storeConfigPayload(availability,guide),200,origin)}catch(error){console.error("store/config",error?.message||error);const guide=await loadStoreGuideConfig(env).catch(()=>({...STORE_DEFAULT_GUIDE}));return json(await storeConfigPayload({available:true},guide),200,origin)}
}


/* ==========================================================================
   TEMPORARY SALES
   A single reusable venta.html renders configs from Firestore.
   ========================================================================== */

const TEMP_SALE_METHODS = [
  "cod_cargo", "transfer_shipping", "paypal_shipping",
  "card_shipping", "crypto_binance", "pickup_pana", "visacuotas"
];

function temporarySaleSlug(value) {
  const slug = clean(value, 80)
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  if (!/^[a-z0-9][a-z0-9-]{1,59}$/.test(slug)) throw new Error("SALE_SLUG_INVALID");
  return slug;
}

function temporarySaleImage(value) {
  const raw = clean(value, 500);
  if (!raw) return "img/product.png";
  if (/^(?:img\/|\/img\/)[A-Za-z0-9_./-]+\.(?:png|jpe?g|webp)$/i.test(raw)) return raw.replace(/^\//, "");
  try {
    const u = new URL(raw);
    if (u.protocol === "https:") return u.href.slice(0, 500);
  } catch {}
  throw new Error("SALE_IMAGE_INVALID");
}

function normalizeImportStatus(value,originMarket="guatemala"){const raw=clean(value,40).toLowerCase();return new Set(["available_gt","usa_stock","in_transit","customs","released"]).has(raw)?raw:(originMarket==="usa"?"usa_stock":"available_gt")}
const STORE_IMPORT_USA_STATUSES=new Set(["usa_stock","in_transit","customs","released"]);
function temporarySaleIsImported(sale={}){
  const i=sale.importInfo||{};
  const status=clean(i.status,40).toLowerCase();
  return i.originMarket==="usa"||i.requiresCustoms===true||STORE_IMPORT_USA_STATUSES.has(status);
}
function temporarySalePublicImportInfo(sale={}){
  const i=sale.importInfo||{};
  const rawStatus=clean(i.status,40).toLowerCase();
  const imported=temporarySaleIsImported(sale);
  const status=normalizeImportStatus(rawStatus,imported?"usa":"guatemala");
  let locationLabel=clean(i.locationLabel,120);
  if(imported){
    if(status==="usa_stock")locationLabel="Estados Unidos";
    else if(status==="in_transit")locationLabel="En tránsito hacia Guatemala";
    else if(status==="customs")locationLabel="Aduana · Guatemala";
    else if(status==="released")locationLabel="Guatemala · importación liberada";
    else locationLabel=locationLabel||"Guatemala";
  }else{
    locationLabel="Panajachel, Guatemala";
  }
  return {
    ...i,
    originMarket:imported?"usa":"guatemala",
    requiresCustoms:imported,
    customsIncluded:true,
    status,
    statusLabel:storeImportStatusLabel(status),
    locationLabel
  };
}
function temporarySaleImportEstimate(sale={},fxRate=0){
  if(!temporarySaleIsImported(sale))return null;
  const i=temporarySalePublicImportInfo(sale);
  const manualBase=Math.max(0,Number(i.customsBaseTotalGtq||0));
  const declaredValueGtq=Math.max(0,Number(i.declaredValueGtq||0));
  const fxAdjustmentPct=Math.max(0,Math.min(10,Number(i.customsFxAdjustmentPct??1.12)||1.12));
  const ivaEnabled=i.customsIvaEnabled!==false;
  const customsValuationGtq=moneyNumber(declaredValueGtq*(1+fxAdjustmentPct/100));
  const iva=ivaEnabled?moneyNumber(customsValuationGtq*.12):0;

  const weightKg=Math.max(.01,Number(sale.package?.weight||1));
  const billableWeightLb=Math.max(1,Math.ceil(weightKg*2.2046226218));

  // FX is internal only. Public import amounts remain in GTQ.
  const rate=Math.max(.01,Number(fxRate||0));
  const freightUsd=moneyNumber(billableWeightLb*3.30);
  const airportUsd=billableWeightLb<=1?1.50:billableWeightLb===2?3:6;
  const freight=moneyNumber(freightUsd*rate);
  const airport=moneyNumber(airportUsd*rate);
  const admin=moneyNumber((freight+airport)*0.034);

  const logisticsBase=manualBase>0?manualBase:moneyNumber(freight+airport+admin);
  const safetyPct=Math.max(0,Math.min(25,Number(i.safetyPct||5)));
  const safety=moneyNumber((logisticsBase+iva)*safetyPct/100);
  const importDelivery=String(i.quickboxDeliveryMode||"delivery")==="branch"?0:55;
  const totalGtq=moneyNumber(logisticsBase+iva+safety+importDelivery);

  return {
    approximate:true,
    source:manualBase>0?"admin":"automatic",
    label:manualBase>0?"Estimación registrada":"Aproximado automático",
    weightKg:moneyNumber(weightKg),
    billableWeightLb,
    safetyPct,
    declaredValueGtq:moneyNumber(declaredValueGtq),
    customsFxAdjustmentPct:moneyNumber(fxAdjustmentPct),
    customsValuationGtq,
    ivaEnabled,
    ivaGtq:iva,
    baseTotalGtq:moneyNumber(logisticsBase),
    totalGtq,
    breakdown:{freight:manualBase>0?Number(i.customsBreakdown?.freight||0):freight,airport:manualBase>0?Number(i.customsBreakdown?.airport||0):airport,admin:manualBase>0?Number(i.customsBreakdown?.admin||0):admin,iva,safety,importDelivery},
    publicCurrency:"GTQ"
  };
}

function storeImportStatusLabel(value){return ({available_gt:"Disponible en Guatemala",usa_stock:"En Estados Unidos",in_transit:"En tránsito a Guatemala",customs:"En aduana",released:"Liberado de aduana"})[value]||"Disponible en Guatemala"}
function saleImportPending(sale={}){const i=sale.importInfo||{};return i.originMarket==="usa"&&!new Set(["released","available_gt"]).has(i.status)}
function customsBreakdown(logisticsGtq,fuelSurchargeGtq,customsValuationGtq,safetyPct=5,deliveryMode="delivery"){
  const logistics=Math.max(0,Number(logisticsGtq||0));
  const fuel=Math.max(0,Number(fuelSurchargeGtq||0));
  const valuation=Math.max(0,Number(customsValuationGtq||0));
  const ivaRatePct=12; // Fijo por decisión comercial del sistema.
  const iva=moneyNumber(valuation*ivaRatePct/100);
  const safety=Math.max(0,Math.min(25,Number(safetyPct||5)));
  const reserve=moneyNumber((logistics+fuel+iva)*safety/100);
  const mode=String(deliveryMode||"delivery").toLowerCase()==="branch"?"branch":"delivery";
  const importDelivery=mode==="delivery"?55:0;
  const total=moneyNumber(logistics+fuel+iva+reserve+importDelivery);
  return {
    ivaRatePct,
    logisticsGtq:moneyNumber(logistics),
    fuelSurchargeGtq:moneyNumber(fuel),
    customsValuationGtq:moneyNumber(valuation),
    ivaGtq:iva,
    safetyPct:moneyNumber(safety),
    safetyGtq:reserve,
    deliveryMode:mode,
    importDeliveryGtq:importDelivery,
    totalGtq:total,
    amounts:{logistics:moneyNumber(logistics),fuel:moneyNumber(fuel),iva,safety:reserve,importDelivery}
  };
}

function customsBreakdownUsd(basePriceUsd,taxRatePct=8,customsRatePct=12,freightRatePct=15,fxRateGtq=7.65){
  const baseUsd=Math.max(0,Number(basePriceUsd||0));
  const fx=Math.max(.01,Math.min(100,Number(fxRateGtq||7.65)||7.65));
  const taxPct=Math.max(0,Math.min(100,Number(taxRatePct??8)||0));
  const customsPct=Math.max(0,Math.min(100,Number(customsRatePct??12)||0));
  const freightPct=Math.max(0,Math.min(100,Number(freightRatePct??15)||0));
  const taxUsd=moneyNumber(baseUsd*taxPct/100);
  const customsUsd=moneyNumber(baseUsd*customsPct/100);
  const freightUsd=moneyNumber(baseUsd*freightPct/100);
  const importTotalUsd=moneyNumber(taxUsd+customsUsd+freightUsd);
  const finalPriceUsd=moneyNumber(baseUsd+importTotalUsd);
  const basePriceGtq=moneyNumber(baseUsd*fx);
  const taxGtq=moneyNumber(taxUsd*fx);
  const customsGtq=moneyNumber(customsUsd*fx);
  const freightGtq=moneyNumber(freightUsd*fx);
  const importTotalGtq=moneyNumber(importTotalUsd*fx);
  const finalPriceGtq=moneyNumber(finalPriceUsd*fx);
  return {baseUsd,fxRateGtq:moneyNumber(fx),taxRatePct:moneyNumber(taxPct),customsRatePct:moneyNumber(customsPct),freightRatePct:moneyNumber(freightPct),taxUsd,customsUsd,freightUsd,importTotalUsd,finalPriceUsd,basePriceGtq,taxGtq,customsGtq,freightGtq,importTotalGtq,finalPriceGtq};
}

function temporarySaleOptionalGroup(value){
  const raw=clean(value,80);
  if(!raw)return "";
  return temporarySaleSlug(raw);
}
function temporarySaleSourceUrl(value){
  const raw=clean(value,900);
  if(!raw)return "";
  try{
    const u=new URL(raw);
    const host=u.hostname.toLowerCase();
    if(u.protocol!=="https:"||!(host==="swappa.com"||host.endsWith(".swappa.com")))throw new Error();
    u.hash="";
    return u.href.slice(0,900);
  }catch(_){throw new Error("SALE_SOURCE_URL_INVALID")}
}
function temporarySaleSourceStatus(value){
  const v=clean(value,30).toLowerCase();
  return ["unverified","available","unavailable"].includes(v)?v:"unverified";
}
function temporarySaleOptionLabel(sale){
  return clean(sale?.optionLabel,100)||[sale?.storage,sale?.color,sale?.condition].map(v=>clean(v,80)).filter(Boolean).join(" · ")||clean(sale?.title,120)||"Opción";
}
function temporarySaleAvailabilityFromOrders(sale,orders=[],ignoreOrderId=""){
  const used=(orders||[]).filter(order=>order.id!==ignoreOrderId&&(order.saleSlug===sale.slug||order.sku===sale.sku)&&STORE_BLOCKING_STATUSES.has(String(order.status||"").toLowerCase())).length;
  const stock=Math.max(0,Math.floor(Number(sale.stock??0)||0));
  return {available:sale.active!==false&&stock>0&&used<stock,stock,used,remaining:Math.max(0,stock-used)};
}

function sanitizeTemporarySale(source = {}, existing = {}) {
  const slug = temporarySaleSlug(source.slug || existing.slug || source.title);
  const title = clean(source.title || existing.title, 120);
  if (title.length < 2) throw new Error("SALE_TITLE_INVALID");

  const groupKey=temporarySaleOptionalGroup(source.groupKey??existing.groupKey??"");
  const optionLabel=clean(source.optionLabel??existing.optionLabel,100);
  const sourceInput=source.sourceInfo||{},sourceExisting=existing.sourceInfo||{};
  const sourceUrl=temporarySaleSourceUrl(sourceInput.url??sourceExisting.url??"");
  const sourceStatus=temporarySaleSourceStatus(sourceInput.status??sourceExisting.status??"unverified");
  const sourceInfo=sourceUrl?{
    provider:"swappa",
    url:sourceUrl,
    status:sourceStatus,
    checkedAt:new Date().toISOString()
  }:{provider:"",url:"",status:"unverified",checkedAt:""};

  let priceGtq = Number(source.priceGtq ?? existing.priceGtq);
  if (!Number.isFinite(priceGtq) || priceGtq <= 0 || priceGtq > 1000000) throw new Error("SALE_PRICE_INVALID");

  const referenceRaw = source.referencePriceGtq ?? existing.referencePriceGtq ?? 0;
  let referencePriceGtq = Number(referenceRaw || 0);
  if (!Number.isFinite(referencePriceGtq) || referencePriceGtq < 0 || referencePriceGtq > 1000000) {
    throw new Error("SALE_REFERENCE_PRICE_INVALID");
  }

  const requestedStock = Math.max(0, Math.min(999, Math.floor(Number(source.stock ?? existing.stock ?? 1) || 0)));
  const stock = sourceInfo.status==="unavailable"?0:requestedStock;
  const methodsRaw = Array.isArray(source.methods) ? source.methods : Array.isArray(existing.methods) ? existing.methods : TEMP_SALE_METHODS;
  const methods = [...new Set(methodsRaw.map(x => clean(x, 40).toLowerCase()).filter(x => STORE_PAYMENT_METHODS.has(x) && x !== "cod_forza"))];
  if (!methods.length) throw new Error("SALE_METHODS_INVALID");

  const specsInput = Array.isArray(source.specs) ? source.specs : Array.isArray(existing.specs) ? existing.specs : [];
  const specs = specsInput.slice(0, 24).map(row => ({
    label: clean(row?.label, 50),
    value: clean(row?.value, 140)
  })).filter(row => row.label && row.value);

  const categoryRaw = clean(source.category ?? existing.category ?? "other", 40).toLowerCase();
  const category = ["phone","tablet","computer","accessory","other"].includes(categoryRaw) ? categoryRaw : "other";

  const pricingSource = source.pricing || {};
  const pricingExisting = existing.pricing || {};
  const codSurchargePct = Math.max(0, Math.min(30, Number(pricingSource.codSurchargePct ?? pricingExisting.codSurchargePct ?? (STORE_COD_SURCHARGE_BPS / 100)) || 0));
  const paypalSurchargePct = Math.max(0, Math.min(30, Number(pricingSource.paypalSurchargePct ?? pricingExisting.paypalSurchargePct ?? 0) || 0));
  const shippingGtq = Math.max(0, Math.min(5000, Number(pricingSource.shippingGtq ?? pricingExisting.shippingGtq ?? (STORE_TRANSFER_SHIPPING_CENTS / 100)) || 0));

  const importSource=source.importInfo||{},importExisting=existing.importInfo||{};
  const requestedOrigin=clean(importSource.originMarket??importExisting.originMarket??"guatemala",30).toLowerCase()==="usa"?"usa":"guatemala";
  const rawImportStatus=clean(importSource.status??importExisting.status,40).toLowerCase();
  const statusImpliesUsa=STORE_IMPORT_USA_STATUSES.has(rawImportStatus);
  const existingImported=importExisting.originMarket==="usa"||importExisting.requiresCustoms===true||STORE_IMPORT_USA_STATUSES.has(clean(importExisting.status,40).toLowerCase());
  const originWasExplicit=Object.prototype.hasOwnProperty.call(importSource,"originMarket");
  const originMarket=originWasExplicit
    ?((requestedOrigin==="usa"||statusImpliesUsa)?"usa":"guatemala")
    :((statusImpliesUsa||existingImported)?"usa":"guatemala");
  const importStatus=normalizeImportStatus(rawImportStatus,originMarket);
  let locationLabel=clean(importSource.locationLabel??importExisting.locationLabel??(originMarket==="usa"?"Estados Unidos":"Panajachel, Guatemala"),120);
  if(originMarket==="usa"){
    if(importStatus==="usa_stock")locationLabel="Estados Unidos";
    else if(importStatus==="in_transit"&&/panajachel|guatemala/i.test(locationLabel))locationLabel="En tránsito hacia Guatemala";
    else if(importStatus==="customs"&&/panajachel/i.test(locationLabel))locationLabel="Aduana · Guatemala";
    else if(importStatus==="released"&&/panajachel/i.test(locationLabel))locationLabel="Guatemala · importación liberada";
  }else{
    locationLabel="Panajachel, Guatemala";
  }
  const usaBlockedMethods=new Set(["cod_cargo","cod_forza","pickup_pana"]);
  const finalMethods=originMarket==="usa"?methods.filter(method=>!usaBlockedMethods.has(method)):methods;
  if(!finalMethods.length)throw new Error("SALE_METHODS_INVALID");
  const customsReference=clean(importSource.customsReference??importExisting.customsReference,120);
  const importCostLocked=importSource.importCostLocked!==undefined?importSource.importCostLocked===true:importExisting.importCostLocked!==false;
  const fxRateGtq=Math.max(.01,Math.min(100,Number(importSource.fxRateGtq??importExisting.fxRateGtq??7.65)||7.65));
  const legacyBaseUsd=originMarket==="usa"&&fxRateGtq>0?Math.max(0,Number(priceGtq||0)/fxRateGtq):0;
  const basePriceUsd=Math.max(0,Math.min(1000000,Number(importSource.basePriceUsd??source.priceUsd??importExisting.basePriceUsd??legacyBaseUsd)||0));
  const legacyReferenceUsd=originMarket==="usa"&&fxRateGtq>0?Math.max(0,Number(referencePriceGtq||0)/fxRateGtq):0;
  const referencePriceUsd=Math.max(0,Math.min(1000000,Number(importSource.referencePriceUsd??source.referencePriceUsd??importExisting.referencePriceUsd??legacyReferenceUsd)||0));
  const taxRatePct=Math.max(0,Math.min(100,Number(importSource.taxRatePct??importExisting.taxRatePct??8)||0));
  const customsRatePct=Math.max(0,Math.min(100,Number(importSource.customsRatePct??importExisting.customsRatePct??12)||0));
  const freightRatePct=Math.max(0,Math.min(100,Number(importSource.freightRatePct??importExisting.freightRatePct??15)||0));
  const usdBreakdown=customsBreakdownUsd(basePriceUsd,taxRatePct,customsRatePct,freightRatePct,fxRateGtq);
  if(originMarket==="usa"&&basePriceUsd>0)priceGtq=usdBreakdown.basePriceGtq;
  if(originMarket==="usa"&&referencePriceUsd>0)referencePriceGtq=moneyNumber(referencePriceUsd*fxRateGtq);

  const galleryImages = Array.isArray(existing.galleryImages)
    ? existing.galleryImages.slice(0, 12).map(item => ({
        r2Key: clean(item?.r2Key, 900),
        name: clean(item?.name, 160),
        type: clean(item?.type, 120),
        size: Number(item?.size || 0),
        createdAt: item?.createdAt || null
      })).filter(item => item.r2Key)
    : [];

  return {
    slug,
    sku: `sale:${slug}`,
    title,
    groupKey,
    optionLabel,
    sourceInfo,
    subtitle: clean(source.subtitle ?? existing.subtitle, 500),
    imagePath: temporarySaleImage(source.imagePath ?? existing.imagePath ?? "img/product.png"),

    // IMPORTANT:
    // Product edits replace the Firestore document. Preserve the main R2 metadata
    // that was written by /store/sales/admin/image so a normal edit never breaks
    // the public image endpoint.
    imageR2Key: clean(existing.imageR2Key, 900),
    imageName: clean(existing.imageName, 160),
    imageContentType: clean(existing.imageContentType, 120),
    imageSize: Math.max(0, Number(existing.imageSize || 0)),
    imageUpdatedAt: existing.imageUpdatedAt || null,

    priceGtq: Math.round(priceGtq * 100) / 100,
    referencePriceGtq: Math.round(referencePriceGtq * 100) / 100,
    stock,
    active: source.active !== undefined ? source.active === true : existing.active !== false,
    featured: sourceInfo.status==="unavailable"?false:(source.featured !== undefined ? source.featured === true : existing.featured === true),
    sortOrder: Math.max(-999, Math.min(9999, Math.floor(Number(source.sortOrder ?? existing.sortOrder ?? 100) || 100))),
    category,
    brand: clean(source.brand ?? existing.brand, 80),
    condition: clean(source.condition ?? existing.condition, 120),
    color: clean(source.color ?? existing.color, 80),
    storage: clean(source.storage ?? existing.storage, 80),
    battery: clean(source.battery ?? existing.battery, 80),
    badge: sourceInfo.status==="unavailable"?"Vendido":clean(source.badge ?? existing.badge ?? "Disponible", 80),
    importInfo:{originMarket,locationLabel,status:importStatus,statusLabel:storeImportStatusLabel(importStatus),requiresCustoms:originMarket==="usa",customsIncluded:originMarket==="usa",currency:originMarket==="usa"?"USD":"GTQ",publicCurrency:"GTQ",basePriceUsd:originMarket==="usa"?moneyNumber(basePriceUsd):0,referencePriceUsd:originMarket==="usa"?moneyNumber(referencePriceUsd):0,fxRateGtq:originMarket==="usa"?usdBreakdown.fxRateGtq:0,taxRatePct:originMarket==="usa"?usdBreakdown.taxRatePct:0,customsRatePct:originMarket==="usa"?usdBreakdown.customsRatePct:0,freightRatePct:originMarket==="usa"?usdBreakdown.freightRatePct:0,taxUsd:originMarket==="usa"?usdBreakdown.taxUsd:0,customsUsd:originMarket==="usa"?usdBreakdown.customsUsd:0,freightUsd:originMarket==="usa"?usdBreakdown.freightUsd:0,importTotalUsd:originMarket==="usa"?usdBreakdown.importTotalUsd:0,finalPriceUsd:originMarket==="usa"?usdBreakdown.finalPriceUsd:0,declaredValueGtq:originMarket==="usa"?usdBreakdown.basePriceGtq:0,customsValuationGtq:originMarket==="usa"?usdBreakdown.basePriceGtq:0,customsIvaRatePct:originMarket==="usa"?usdBreakdown.customsRatePct:0,customsIvaEnabled:originMarket==="usa",customsIvaGtq:originMarket==="usa"?usdBreakdown.customsGtq:0,logisticsGtq:originMarket==="usa"?usdBreakdown.freightGtq:0,customsBaseTotalGtq:originMarket==="usa"?usdBreakdown.freightGtq:0,fuelSurchargeGtq:0,customsTotalGtq:originMarket==="usa"?usdBreakdown.importTotalGtq:0,importIncludedGtq:originMarket==="usa"?usdBreakdown.importTotalGtq:0,customsReference,safetyPct:0,safetyGtq:0,quickboxDeliveryMode:"branch",quickboxDeliveryGtq:0,importCostLocked,customsBreakdown:originMarket==="usa"?{tax:usdBreakdown.taxGtq,customs:usdBreakdown.customsGtq,freight:usdBreakdown.freightGtq,admin:usdBreakdown.taxGtq,iva:usdBreakdown.customsGtq,airport:0,safety:0,importDelivery:0}:{},customsModel:originMarket==="usa"?"USD percentage import pricing: editable Tax + Aduana + Flete, public total converted to GTQ":"Guatemala local GTQ pricing",customsDisclaimer:"La gestión de importación está incluida en el precio final del pedido. No se cobra por separado al cliente."},
    specs,
    methods: finalMethods,
    visacuotasUrl: clean(source.visacuotasUrl ?? existing.visacuotasUrl, 900),
    pricing: {
      codSurchargePct: Math.round(codSurchargePct * 100) / 100,
      paypalSurchargePct: Math.round(paypalSurchargePct * 100) / 100,
      shippingGtq: originMarket==="usa" ? 0 : Math.round(shippingGtq * 100) / 100
    },
    galleryImages,
    package: {
      weight: boxfulNumber(source?.package?.weight ?? existing?.package?.weight, 1, 0.01, 100),
      length: boxfulNumber(source?.package?.length ?? existing?.package?.length, 20, 1, 300),
      width: boxfulNumber(source?.package?.width ?? existing?.package?.width, 15, 1, 300),
      height: boxfulNumber(source?.package?.height ?? existing?.package?.height, 8, 1, 300)
    }
  };
}

async function loadTemporarySale(env, slugValue, requireActive = true) {
  const slug = temporarySaleSlug(slugValue);
  const snap = await adminGetDocument(env, ["temporarySales", slug], true);
  if (!snap.exists || !snap.data) throw new Error("SALE_NOT_FOUND");
  const sale = { slug, ...(snap.data || {}) };
  if (requireActive && sale.active === false) throw new Error("SALE_NOT_ACTIVE");
  return sale;
}

async function listTemporarySales(env) {
  const rows = await adminRunQuery(env, {
    from: [{ collectionId: "temporarySales" }],
    limit: 200
  });
  return rows.map(row => ({ slug: row.id, ...(row.data || {}) }))
    .sort((a, b) => (Number(a.sortOrder ?? 100) - Number(b.sortOrder ?? 100)) || String(a.title || "").localeCompare(String(b.title || ""), "es"));
}

async function temporarySaleAvailability(env, sale, ignoreOrderId = "") {
  const orders=await listStoreOrders(env,300);
  return temporarySaleAvailabilityFromOrders(sale,orders,ignoreOrderId);
}

function temporarySaleIncludedImportGtq(sale={}){
  if(!temporarySaleIsImported(sale))return 0;
  const i=sale.importInfo||{};
  return moneyNumber(Math.max(0,Number(i.importIncludedGtq??i.customsTotalGtq??0)||0));
}
function temporarySaleFinalPriceGtq(sale={}){
  return moneyNumber(Math.max(0,Number(sale.priceGtq||0))+temporarySaleIncludedImportGtq(sale));
}
function temporarySaleQuote(sale, method) {
  const safeMethod=clean(method,40).toLowerCase();
  if(!STORE_PAYMENT_METHODS.has(safeMethod)||!sale.methods?.includes(safeMethod))throw new Error("STORE_METHOD_INVALID");
  if(temporarySaleIsImported(sale)&&["cod_cargo","cod_forza","pickup_pana"].includes(safeMethod))throw new Error("STORE_METHOD_NOT_AVAILABLE_FOR_IMPORT");

  const productCents=Math.round(Number(sale.priceGtq||0)*100);
  const importCents=Math.round(temporarySaleIncludedImportGtq(sale)*100);
  const chargeableCents=productCents+importCents;

  const codPct=Math.max(0,Math.min(30,Number(sale?.pricing?.codSurchargePct??(STORE_COD_SURCHARGE_BPS/100))||0));
  const paypalPct=Math.max(0,Math.min(30,Number(sale?.pricing?.paypalSurchargePct??0)||0));
  const imported=temporarySaleIsImported(sale);
  // USA/importados: este Q40 ya está absorbido dentro de importIncludedGtq.
  // Nunca volver a sumarlo en transferencia, PayPal, tarjeta o Binance.
  const configuredShippingCents=imported
    ?0
    :Math.round(Math.max(0,Number(sale?.pricing?.shippingGtq??(STORE_TRANSFER_SHIPPING_CENTS/100))||0)*100);

  let surchargeCents=0,shippingCents=0;
  if(safeMethod==="cod_forza"||safeMethod==="cod_cargo"){
    surchargeCents=Math.round(chargeableCents*codPct/100);
  }else if(["paypal_shipping","card_shipping"].includes(safeMethod)){
    surchargeCents=Math.round(chargeableCents*paypalPct/100);
    shippingCents=configuredShippingCents;
  }else if(["transfer_shipping","crypto_binance"].includes(safeMethod)){
    shippingCents=configuredShippingCents;
  }

  return{
    sku:sale.sku,
    saleSlug:sale.slug,
    productTitle:sale.title,
    method:safeMethod,
    methodLabel:storeMethodLabel(safeMethod),
    carrier:storeCarrierForMethod(safeMethod),
    currency:"GTQ",
    basePriceGtq:gtqFromCents(productCents),
    importIncludedGtq:gtqFromCents(importCents),
    subtotalGtq:gtqFromCents(chargeableCents),
    surchargeGtq:gtqFromCents(surchargeCents),
    shippingGtq:gtqFromCents(shippingCents),
    totalGtq:gtqFromCents(chargeableCents+surchargeCents+shippingCents),
    externalSurcharge:safeMethod==="visacuotas",
    externalPaymentUrl:safeMethod==="visacuotas"?clean(sale.visacuotasUrl,900):"",
    externalFeeNote:safeMethod==="visacuotas"
      ?"Visacuotas aplica un recargo adicional. Recurrente muestra el total financiado antes de confirmar."
      :"",
    onlinePayment:["paypal_shipping","card_shipping"].includes(safeMethod),
    manualReviewPayment:["transfer_shipping","crypto_binance"].includes(safeMethod),
    cryptoPayment:safeMethod==="crypto_binance"
  };
}

async function temporarySaleQuoteWithFx(sale, method) {
  const quote = temporarySaleQuote(sale, method);
  if (!["paypal_shipping","card_shipping","crypto_binance"].includes(quote.method)) return quote;
  const fxRate = await usdGtqRate();
  if (quote.method === "crypto_binance") {
    const usdtAmount = Math.max(1, Math.round(Number(quote.totalGtq || 0) / fxRate));
    return { ...quote, fxRate, usdtAmount };
  }
  const usdAmount = moneyNumber(Number(quote.totalGtq || 0) / fxRate);
  return { ...quote, fxRate, usdAmount };
}


const STORE_PICKUP_LOCATION="Callejón Las Armonías, Panajachel";
const STORE_PICKUP_WINDOW="Lunes a sábado · 2:00 p. m. a 5:00 p. m.";

function secureRandomInt(maxExclusive){
  const max=Math.max(1,Math.floor(Number(maxExclusive)||1));
  try{
    const a=new Uint32Array(1);crypto.getRandomValues(a);
    return a[0]%max;
  }catch(_){return Math.floor(Math.random()*max)}
}
function guatemalaLocalParts(date=new Date()){
  const parts=new Intl.DateTimeFormat("en-CA",{
    timeZone:"America/Guatemala",year:"numeric",month:"2-digit",day:"2-digit",
    hour:"2-digit",minute:"2-digit",hourCycle:"h23"
  }).formatToParts(date);
  const get=k=>Number(parts.find(x=>x.type===k)?.value||0);
  return {year:get("year"),month:get("month"),day:get("day"),hour:get("hour"),minute:get("minute")};
}
function panajachelPickupAppointment(now=new Date()){
  const local=guatemalaLocalParts(now);
  const calendar=new Date(Date.UTC(local.year,local.month-1,local.day));
  const currentMinutes=local.hour*60+local.minute;
  const open=14*60, lastSlot=16*60+50; // 2:00 p.m. - 4:50 p.m., 10-minute slots.
  for(let offset=0;offset<8;offset++){
    const d=new Date(calendar);d.setUTCDate(calendar.getUTCDate()+offset);
    if(d.getUTCDay()===0)continue; // domingo cerrado
    let earliest=open;
    if(offset===0){
      // Cita con por lo menos 60 minutos de preparación.
      const prepared=Math.ceil((currentMinutes+60)/10)*10;
      earliest=Math.max(open,prepared);
    }
    if(earliest>lastSlot)continue;
    const slots=Math.floor((lastSlot-earliest)/10)+1;
    const minuteOfDay=earliest+secureRandomInt(slots)*10;
    const hour=Math.floor(minuteOfDay/60),minute=minuteOfDay%60;
    // Guatemala permanece UTC-6: hora local + 6 = UTC.
    const at=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate(),hour+6,minute,0,0));
    const label=new Intl.DateTimeFormat("es-GT",{
      timeZone:"America/Guatemala",weekday:"long",day:"numeric",month:"long",
      hour:"numeric",minute:"2-digit",hour12:true
    }).format(at);
    return {
      location:STORE_PICKUP_LOCATION,
      window:STORE_PICKUP_WINDOW,
      appointmentAt:at.toISOString(),
      appointmentLabel:label.charAt(0).toUpperCase()+label.slice(1)
    };
  }
  throw new Error("STORE_PICKUP_SCHEDULE_FAILED");
}

function genericStoreOrderId() {
  const date = new Date().toISOString().slice(2, 10).replace(/-/g, "");
  const rand = Math.floor(Math.random() * 10000).toString().padStart(4, "0");
  return `EV-SALE-${date}-${rand}`;
}

function temporarySaleOrderFromDraft({ user, sale, draft, quote, orderId, now, paymentStatus = "pending", paymentReviewStatus = "", status = "received", paymentProvider = "", transactionId = "", paypalOrderId = "", paidUsd = 0, paymentReference = "" }) {
  return {
    orderId,
    saleSlug: sale.slug,
    sku: sale.sku,
    productTitle: sale.title,
    ownerUid: user.uid,
    ownerEmail: user.email || "",
    customerName: draft.customerName,
    recipientName: draft.recipientName,
    phone: draft.phone,
    nitDpi: draft.nitDpi,
    paymentMethod: quote.method,
    paymentMethodLabel: quote.methodLabel,
    paymentStatus,
    paymentReviewStatus,
    paymentProvider,
    paymentReference,
    transactionId,
    paypalTransactionId: transactionId,
    paypalOrderId,
    carrier: quote.carrier,
    department: draft.department,
    municipality: draft.municipality,
    poblado: draft.poblado,
    address: draft.address,
    reference: draft.reference,
    notes: draft.notes,
    destinationLat: Number(draft.destinationLat || 0) || null,
    destinationLng: Number(draft.destinationLng || 0) || null,
    currency: "GTQ",
    basePriceGtq: quote.basePriceGtq,
    importIncludedGtq: quote.importIncludedGtq,
    subtotalGtq: quote.subtotalGtq,
    surchargeGtq: quote.surchargeGtq,
    shippingGtq: quote.shippingGtq,
    totalGtq: quote.totalGtq,
    importInfo: sale.importInfo || {},
    customsRequired: temporarySaleIsImported(sale), customsIncluded:temporarySaleIsImported(sale), customsTotalGtq:Number(quote.importIncludedGtq||0), customsStatus:sale.importInfo?.status||"available_gt", customsLocation:sale.importInfo?.locationLabel||"Guatemala",
    importEstimatedDaysMin: temporarySaleIsImported(sale)?3:0,
    importEstimatedDaysMax: temporarySaleIsImported(sale)?25:0,
    importEstimatedDeliveryText: temporarySaleIsImported(sale)?"3 a 25 días":"",
    fxRate: Number(quote.fxRate || 0),
    paidUsd: Number(paidUsd || 0),
    expectedUsdt: Number(quote.usdtAmount || 0),
    externalSurcharge: quote.externalSurcharge === true,
    externalPaymentUrl: quote.externalPaymentUrl || "",
    externalFeeNote: quote.externalFeeNote || "",
    policiesAccepted: draft.termsAccepted === true,
    policiesAcceptedAt: now,
    acceptedPolicyVersion: "temporary-sale-v1",
    status,
    statusLabel: storeStatusLabel(status, quote.method),
    source: "temporary-sale-page",
    createdAt: now,
    updatedAt: now,
    paidAt: paymentStatus === "paid" ? now : null,
    paymentVerifiedAt: paymentStatus === "paid" ? now : null,
    statusHistory: [
      { status: "received", label: storeStatusLabel("received", quote.method), at: now, by: "client" },
      ...(status === "confirmed" ? [{ status: "confirmed", label: storeStatusLabel("confirmed", quote.method), at: now, by: "payment" }] : [])
    ],
    adminNotificationStatus: "pending",
    clientNotificationStatus: "pending"
  };
}


async function temporarySaleAdminImageUploadRoute(request, env, origin) {
  try {
    const admin = await requireFirebaseAdmin(bearerToken(request));
    if (!env.PROFILE_R2) throw new Error("R2_BINDING_MISSING");

    const form = await request.formData();
    const slug = temporarySaleSlug(form.get("slug"));
    const kind = clean(form.get("kind") || "main", 20).toLowerCase() === "gallery" ? "gallery" : "main";
    const file = form.get("file");
    if (!file || typeof file.arrayBuffer !== "function") throw new Error("SALE_IMAGE_REQUIRED");

    const sale = await loadTemporarySale(env, slug, false);
    const size = Number(file.size || 0);
    const type = clean(file.type || "", 120).toLowerCase();
    if (size <= 0 || size > 12 * 1024 * 1024) throw new Error("SALE_IMAGE_TOO_LARGE");
    if (!/^image\/(?:png|jpe?g|webp)$/i.test(type)) throw new Error("SALE_IMAGE_TYPE_INVALID");

    const safeName = clean(file.name || "producto", 160)
      .replace(/[\\/\u0000-\u001f\u007f]+/g, "_")
      .replace(/\s+/g, " ")
      .trim() || "producto";
    const key = `temporary-sales/${slug}/${kind}/${crypto.randomUUID().replace(/-/g,"")}/${safeName}`;
    const bytes = await file.arrayBuffer();

    await env.PROFILE_R2.put(key, bytes, {
      httpMetadata: { contentType: type },
      customMetadata: {
        saleSlug: slug,
        imageKind: kind,
        uploadedBy: admin.email || "",
        originalName: safeName
      }
    });

    const now = new Date();

    if (kind === "gallery") {
      const gallery = Array.isArray(sale.galleryImages) ? sale.galleryImages.slice(0, 12) : [];
      if (gallery.length >= 12) throw new Error("SALE_GALLERY_LIMIT");
      const entry = { r2Key:key, name:safeName, type, size, createdAt:now };
      const nextGallery = [...gallery, entry];
      await adminPatchDocument(env, ["temporarySales", slug], {
        galleryImages: nextGallery,
        updatedAt: now,
        updatedByAdminEmail: admin.email
      });
      const index = nextGallery.length - 1;
      const publicUrl = `${new URL(request.url).origin}/store/sales/image?slug=${encodeURIComponent(slug)}&index=${index}`;
      return json({ ok:true, kind, index, imagePath:publicUrl, imageName:safeName }, 200, origin);
    }

    const publicUrl = `${new URL(request.url).origin}/store/sales/image?slug=${encodeURIComponent(slug)}`;
    await adminPatchDocument(env, ["temporarySales", slug], {
      imageR2Key: key,
      imagePath: publicUrl,
      imageName: safeName,
      imageContentType: type,
      imageSize: size,
      imageUpdatedAt: now,
      updatedAt: now,
      updatedByAdminEmail: admin.email
    });

    return json({
      ok: true,
      kind,
      imagePath: publicUrl,
      imageName: safeName,
      sale: { ...sale, imageR2Key: key, imagePath: publicUrl }
    }, 200, origin);
  } catch (error) {
    const code = String(error?.message || "");
    const messages = {
      ADMIN_ONLY: "Solo Administración puede subir imágenes.",
      SALE_NOT_FOUND: "Guarda primero el producto.",
      SALE_IMAGE_REQUIRED: "Selecciona una imagen.",
      SALE_IMAGE_TOO_LARGE: "La imagen no puede superar 12 MB.",
      SALE_IMAGE_TYPE_INVALID: "Usa PNG, JPG, JPEG o WEBP.",
      SALE_GALLERY_LIMIT: "La galería admite hasta 12 imágenes.",
      R2_BINDING_MISSING: "El almacenamiento R2 no está disponible."
    };
    return json({ ok: false, code, error: messages[code] || "No se pudo subir la imagen." },
      code === "ADMIN_ONLY" ? 403 : 400, origin);
  }
}

async function temporarySaleAdminImageDeleteRoute(request, env, origin) {
  try {
    const admin = await requireFirebaseAdmin(bearerToken(request));
    const payload = await request.json().catch(() => ({}));
    const slug = temporarySaleSlug(payload.slug);
    const index = Math.floor(Number(payload.index));
    const sale = await loadTemporarySale(env, slug, false);
    const gallery = Array.isArray(sale.galleryImages) ? [...sale.galleryImages] : [];
    if (!Number.isInteger(index) || index < 0 || index >= gallery.length) throw new Error("SALE_GALLERY_INDEX_INVALID");

    const [removed] = gallery.splice(index, 1);
    if (removed?.r2Key && env.PROFILE_R2) {
      await env.PROFILE_R2.delete(removed.r2Key).catch(() => {});
    }

    const now = new Date();
    await adminPatchDocument(env, ["temporarySales", slug], {
      galleryImages: gallery,
      updatedAt: now,
      updatedByAdminEmail: admin.email
    });
    return json({ ok:true, galleryCount:gallery.length }, 200, origin);
  } catch (error) {
    const code = String(error?.message || "");
    return json({ ok:false, code, error: code === "ADMIN_ONLY" ? "Solo Administración puede eliminar imágenes." : "No se pudo eliminar la imagen." },
      code === "ADMIN_ONLY" ? 403 : 400, origin);
  }
}

async function temporarySaleRecoverMainR2Image(env, sale){
  if(!env.PROFILE_R2 || !sale?.slug) return null;
  try{
    const prefix=`temporary-sales/${temporarySaleSlug(sale.slug)}/main/`;
    const listed=await env.PROFILE_R2.list({prefix,limit:100});
    const objects=Array.isArray(listed?.objects)?listed.objects.filter(o=>o?.key):[];
    if(!objects.length)return null;

    objects.sort((a,b)=>{
      const ta=new Date(a?.uploaded||0).getTime()||0;
      const tb=new Date(b?.uploaded||0).getTime()||0;
      return tb-ta;
    });

    for(const candidate of objects){
      const object=await env.PROFILE_R2.get(candidate.key);
      if(!object)continue;

      // Self-heal Firestore so the next request does not need an R2 listing.
      await adminPatchDocument(env,["temporarySales",sale.slug],{
        imageR2Key:candidate.key,
        imagePath:`/store/sales/image?slug=${encodeURIComponent(sale.slug)}`,
        imageContentType:clean(object.httpMetadata?.contentType||"",120),
        imageSize:Number(object.size||candidate.size||0),
        imageUpdatedAt:new Date(),
        updatedAt:new Date()
      }).catch(()=>{});

      return {key:candidate.key,object};
    }
  }catch(_){}
  return null;
}

function temporarySalePublicImagePath(request,sale){
  const stored=clean(sale?.imagePath||"",500);
  const hasR2=Boolean(clean(sale?.imageR2Key,900));
  const looksLikeStoreImage=/\/store\/sales\/image(?:\?|$)/i.test(stored);

  // If this product was ever backed by the store image endpoint, always emit
  // the CURRENT Worker origin instead of trusting a stale absolute URL.
  if(hasR2||looksLikeStoreImage){
    const base=new URL(request.url).origin;
    return `${base}/store/sales/image?slug=${encodeURIComponent(sale.slug)}&v=26`;
  }
  return stored||"img/product.png";
}

async function temporarySalePublicImageRoute(request, env, origin, url) {
  try {
    if (!env.PROFILE_R2) throw new Error("R2_BINDING_MISSING");
    const sale = await loadTemporarySale(env, url.searchParams.get("slug"), false);
    const indexParam = url.searchParams.get("index");
    let key = "";
    let contentType = "";
    let object = null;

    if (indexParam !== null && indexParam !== "") {
      const index = Math.floor(Number(indexParam));
      const gallery = Array.isArray(sale.galleryImages) ? sale.galleryImages : [];
      if (!Number.isInteger(index) || index < 0 || index >= gallery.length) throw new Error("SALE_IMAGE_NOT_FOUND");
      key = clean(gallery[index]?.r2Key, 900);
      contentType = clean(gallery[index]?.type, 120);
      if (key) object = await env.PROFILE_R2.get(key);
    } else {
      key = clean(sale.imageR2Key, 900);
      contentType = clean(sale.imageContentType, 120);

      if (key) object = await env.PROFILE_R2.get(key);

      // Old versions could erase imageR2Key on a normal product edit.
      // If the object still exists in R2, recover the newest main image.
      if (!object) {
        const recovered = await temporarySaleRecoverMainR2Image(env, sale);
        if (recovered) {
          key = recovered.key;
          object = recovered.object;
          contentType = clean(object.httpMetadata?.contentType || contentType, 120);
        }
      }
    }

    if (!key || !object) throw new Error("SALE_IMAGE_NOT_FOUND");

    return new Response(object.body, {
      status: 200,
      headers: {
        ...corsHeaders(origin),
        "content-type": clean(contentType || object.httpMetadata?.contentType || "image/jpeg", 120),
        "cache-control": "public, max-age=3600, stale-while-revalidate=86400",
        "x-content-type-options": "nosniff"
      }
    });
  } catch {
    return new Response("", {
      status: 404,
      headers: {
        ...corsHeaders(origin),
        "cache-control": "no-store"
      }
    });
  }
}

function temporarySalePublicShape(request, sale, availability) {
  const base = new URL(request.url).origin;
  const gallery = Array.isArray(sale.galleryImages) ? sale.galleryImages : [];
  return {
    slug: sale.slug,
    title: sale.title,
    subtitle: sale.subtitle || "",
    groupKey: sale.groupKey || "",
    optionLabel: sale.optionLabel || "",
    imagePath: temporarySalePublicImagePath(request,sale),
    gallery: gallery.map((_, index) => `${base}/store/sales/image?slug=${encodeURIComponent(sale.slug)}&index=${index}&v=26`),
    priceGtq: Number(sale.priceGtq || 0),
    importIncludedGtq: temporarySaleIncludedImportGtq(sale),
    finalPriceGtq: temporarySaleFinalPriceGtq(sale),
    referencePriceGtq: Number(sale.referencePriceGtq || 0),
    finalReferencePriceGtq: Number(sale.referencePriceGtq||0)>Number(sale.priceGtq||0)?moneyNumber(Number(sale.referencePriceGtq||0)+temporarySaleIncludedImportGtq(sale)):0,
    stock: Number(sale.stock || 0),
    remaining: availability.remaining,
    available: availability.available,
    category: sale.category || "other",
    brand: sale.brand || "",
    condition: sale.condition || "",
    featured: sale.featured === true,
    sortOrder: Number(sale.sortOrder ?? 100),
    color: sale.color || "",
    storage: sale.storage || "",
    battery: sale.battery || "",
    badge: sale.badge || "Disponible",
    specs: Array.isArray(sale.specs) ? sale.specs : [],
    methods: Array.isArray(sale.methods) ? sale.methods : [],
    visacuotasUrl: sale.visacuotasUrl || "",
    pricing: sale.pricing || {},
    importInfo: temporarySalePublicImportInfo(sale)
  };
}

async function temporarySalePublicRoute(request, env, origin, url) {
  try {
    const requestedSlug = clean(url.searchParams.get("slug"), 80);

    if (!requestedSlug) {
      const all = (await listTemporarySales(env)).filter(sale => sale.active !== false);
      const orders = await listStoreOrders(env, 500);
      const blocking = new Map();

      for (const order of orders) {
        if (!STORE_BLOCKING_STATUSES.has(String(order.status || "").toLowerCase())) continue;
        const key = clean(order.saleSlug || "", 80);
        if (!key) continue;
        blocking.set(key, (blocking.get(key) || 0) + 1);
      }

      const sales = all.map(sale => {
        const used = blocking.get(sale.slug) || 0;
        const stock = Math.max(0, Number(sale.stock || 0));
        const availability = {
          available: sale.active !== false && stock > 0 && used < stock,
          stock, used, remaining: Math.max(0, stock - used)
        };
        return temporarySalePublicShape(request, sale, availability);
      });

      // Calculate the "Desde" price using ONLY currently purchasable options.
      // Sold/reserved/unavailable options never lower the public starting price.
      const groupStats = new Map();
      for (const item of sales) {
        const key = clean(item.groupKey || "", 80);
        if (!key) continue;
        const stat = groupStats.get(key) || { total:0, available:0, min:Infinity };
        stat.total++;
        if (item.available === true && Number(item.remaining || 0) > 0 && Number(item.finalPriceGtq || item.priceGtq || 0) > 0) {
          stat.available++;
          stat.min = Math.min(stat.min, Number(item.finalPriceGtq||item.priceGtq));
        }
        groupStats.set(key, stat);
      }

      for (const item of sales) {
        const key = clean(item.groupKey || "", 80);
        if (!key) continue;
        const stat = groupStats.get(key);
        item.groupOptionCount = Number(stat?.total || 0);
        item.groupAvailableCount = Number(stat?.available || 0);
        item.groupMinPriceGtq = Number.isFinite(stat?.min) ? moneyNumber(stat.min) : 0;
      }

      return json({ ok:true, sales }, 200, origin);
    }

    const sale = await loadTemporarySale(env, requestedSlug, true);
    const availability = await temporarySaleAvailability(env, sale);
    return json({ ok:true, sale:temporarySalePublicShape(request, sale, availability) }, 200, origin);
  } catch (error) {
    const code = String(error?.message || "");
    return json({
      ok: false,
      code,
      error: code === "SALE_NOT_ACTIVE" ? "Este producto ya no está disponible." : "No encontramos este producto."
    }, 404, origin);
  }
}

async function temporarySaleGroupOptions(request,env,sale){
  const groupKey=clean(sale?.groupKey,80);
  if(!groupKey)return [];
  const [sales,orders]=await Promise.all([listTemporarySales(env),listStoreOrders(env,300)]);
  const grouped=sales.filter(item=>item.active!==false&&clean(item.groupKey,80)===groupKey).slice(0,16);
  return grouped.map(item=>{
    const availability=temporarySaleAvailabilityFromOrders(item,orders);
    return {
      slug:item.slug,
      title:item.title||"Producto Evolution",
      optionLabel:temporarySaleOptionLabel(item),
      imagePath:temporarySalePublicImagePath(request,item),
      priceGtq:Number(item.priceGtq||0),
      importIncludedGtq:temporarySaleIncludedImportGtq(item),
      finalPriceGtq:temporarySaleFinalPriceGtq(item),
      referencePriceGtq:Number(item.referencePriceGtq||0),
      available:availability.available,
      remaining:availability.remaining,
      stock:availability.stock,
      condition:item.condition||"",
      color:item.color||"",
      storage:item.storage||"",
      battery:item.battery||"",
      badge:item.badge||"Disponible",
      photoCount:1+(Array.isArray(item.galleryImages)?item.galleryImages.length:0),
      sortOrder:Number(item.sortOrder??100)
    };
  }).sort((a,b)=>(a.sortOrder-b.sortOrder)||(Number(b.available)-Number(a.available))||(a.priceGtq-b.priceGtq));
}

async function temporarySaleConfigRoute(request, env, origin, url) {
  try {
    const sale = await loadTemporarySale(env, url.searchParams.get("slug"), true);
    const [availability, guide, options] = await Promise.all([
      temporarySaleAvailability(env, sale),
      loadStoreGuideConfig(env),
      temporarySaleGroupOptions(request,env,sale)
    ]);
    const needsFx=(sale.methods||[]).some(method=>["paypal_shipping","card_shipping","crypto_binance"].includes(method))||temporarySaleIsImported(sale);
    const fxRate=needsFx?await usdGtqRate():0;
    const importEstimate=null;
    const methods = [];
    const configImported=temporarySaleIsImported(sale);
    const configBlocked=new Set(["cod_cargo","cod_forza","pickup_pana"]);
    for (const method of (sale.methods || []).filter(method => method !== "cod_forza" && !(configImported&&configBlocked.has(method)))) {
      const q = temporarySaleQuote(sale, method);
      if (method === "crypto_binance") {
        const usdtAmount = Math.max(1, Math.round(Number(q.totalGtq || 0) / fxRate));
        methods.push({ ...q, fxRate, usdtAmount });
      } else if (["paypal_shipping","card_shipping"].includes(method)) {
        const usdAmount = moneyNumber(Number(q.totalGtq || 0) / fxRate);
        methods.push({ ...q, fxRate, usdAmount });
      } else {
        methods.push(q);
      }
    }
    return json({
      ok: true,
      sale: temporarySalePublicShape(request, sale, availability),
      sku: sale.sku,
      title: sale.title,
      currency: "GTQ",
      basePriceGtq: sale.priceGtq,
      importIncludedGtq: temporarySaleIncludedImportGtq(sale),
      finalPriceGtq: temporarySaleFinalPriceGtq(sale),
      available: availability.available,
      remaining: availability.remaining,
      guide,
      bankAccounts: STORE_BANK_ACCOUNTS,
      visacuotasUrl: sale.visacuotasUrl || "",
      binancePayment: { alias: "Evolution Desing", asset: "USDT", qrImage: "img/binance-pay.jpeg" },
      paymentFxRate: fxRate || 0,
      binanceFxRate: fxRate || 0,
      options,
      importEstimate,
      methods
    }, 200, origin);
  } catch (error) {
    return json({ ok: false, error: "Esta venta temporal no está disponible." }, 404, origin);
  }
}

async function temporarySaleMarkSoldRoute(request, env, origin) {
  try {
    const admin = await requireFirebaseAdmin(bearerToken(request));
    const payload = await request.json().catch(() => ({}));
    const sale = await loadTemporarySale(env, payload.slug, false);
    const now = new Date();
    const oldSource = sale?.sourceInfo && typeof sale.sourceInfo === "object" && !Array.isArray(sale.sourceInfo)
      ? sale.sourceInfo
      : {};
    const patch = {
      stock: 0,
      badge: "Vendido",
      featured: false,
      active: true,
      sourceInfo: {
        provider: clean(oldSource.provider || "", 40),
        url: clean(oldSource.url || "", 900),
        status: "unavailable",
        checkedAt: now.toISOString()
      },
      updatedAt: now,
      updatedByAdminEmail: admin.email
    };
    // PATCH deliberadamente pequeño: marcar vendido no debe volver a validar
    // precio, métodos, importación o metadatos legacy de un producto antiguo.
    await adminPatchDocument(env, ["temporarySales", sale.slug], patch);
    return json({ ok: true, sale: { ...sale, ...patch, updatedAt: now.toISOString() } }, 200, origin);
  } catch (error) {
    const code = String(error?.message || "");
    const messages = {
      ADMIN_ONLY: "Solo Administración puede marcar productos como vendidos.",
      SALE_SLUG_INVALID: "El producto seleccionado no es válido.",
      SALE_NOT_FOUND: "No encontramos ese producto."
    };
    return json({ ok: false, code, error: messages[code] || "No se pudo marcar el producto como vendido." },
      code === "ADMIN_ONLY" ? 403 : code === "SALE_NOT_FOUND" ? 404 : 400, origin);
  }
}

async function temporarySalesAdminRoute(request, env, origin) {
  try {
    const admin = await requireFirebaseAdmin(bearerToken(request));
    if (request.method === "GET") {
      return json({ ok: true, sales: await listTemporarySales(env) }, 200, origin);
    }

    const payload = await request.json().catch(() => ({}));
    let existing = {};
    try { existing = await loadTemporarySale(env, payload.slug || payload.title, false); }
    catch {}
    const sale = sanitizeTemporarySale(payload.sale || payload, existing);
    const now = new Date();
    const stored = {
      ...sale,
      updatedAt: now,
      updatedByAdminEmail: admin.email,
      createdAt: existing.createdAt || now,
      createdByAdminEmail: existing.createdByAdminEmail || admin.email
    };
    await adminSetDocument(env, ["temporarySales", sale.slug], stored);
    let customsNotifications=0;const previousStatus=existing?.importInfo?.status||"";
    if(previousStatus!==sale.importInfo?.status)await syncSaleImportStateToOrders(env,stored).catch(()=>0);
    if(previousStatus!=="customs"&&sale.importInfo?.status==="customs")customsNotifications=await notifySaleCustomsArrival(env,stored).catch(()=>0);
    return json({ ok: true, sale: { ...stored, updatedAt: now.toISOString() }, customsNotifications }, 200, origin);
  } catch (error) {
    const code = String(error?.message || "");
    const messages = {
      ADMIN_ONLY: "Solo Administración puede crear ventas temporales.",
      SALE_SLUG_INVALID: "El slug no es válido.",
      SALE_TITLE_INVALID: "Escribe el nombre del producto.",
      SALE_PRICE_INVALID: "Escribe un precio válido.",
      SALE_REFERENCE_PRICE_INVALID: "El precio de referencia no es válido.",
      SALE_IMAGE_INVALID: "Usa una ruta img/... o una URL https:// válida.",
      SALE_SOURCE_URL_INVALID: "Pega una URL https:// válida de Swappa.",
      SALE_METHODS_INVALID: "Activa al menos un método de pago."
    };
    return json({ ok: false, code, error: messages[code] || "No se pudo guardar la venta temporal." },
      code === "ADMIN_ONLY" ? 403 : 400, origin);
  }
}


async function temporarySalesSeedRoute(request, env, origin) {
  try {
    const admin = await requireFirebaseAdmin(bearerToken(request));
    const defaults = [
      {
        slug:"iphone-8-plus",
        title:"iPhone 8 Plus",
        subtitle:"Gris espacial · 64 GB · salud de batería 95%. Unidad verificada para venta en Guatemala.",
        imagePath:"img/iphone.png",
        priceGtq:950,
        referencePriceGtq:1100,
        stock:1,
        active:true,
        featured:true,
        sortOrder:10,
        category:"phone",
        brand:"Apple",
        condition:"Como nuevo",
        color:"Gris espacial",
        storage:"64 GB",
        battery:"95%",
        badge:"Ganga · última unidad",
        specs:[
          {label:"Pantalla",value:"Retina HD · 5.5 pulgadas"},
          {label:"Versión",value:"Americana · GSM"},
          {label:"Seguridad",value:"Touch ID"}
        ],
        methods:["cod_cargo","transfer_shipping","paypal_shipping","card_shipping","crypto_binance","pickup_pana","visacuotas"],
        pricing:{codSurchargePct:7,paypalSurchargePct:0,shippingGtq:40},
        package:{weight:0.25,length:20,width:15,height:8}
      },
      {
        slug:"macbook-pro-2019",
        title:"MacBook Pro 2019",
        subtitle:"MacBook Pro de 13 pulgadas con Touch Bar y Touch ID. Equipo publicado para venta en Guatemala.",
        imagePath:"img/pro2019.png",
        priceGtq:3900,
        referencePriceGtq:0,
        stock:1,
        active:true,
        featured:true,
        sortOrder:20,
        category:"computer",
        brand:"Apple",
        condition:"Unidad verificada",
        color:"",
        storage:"",
        battery:"",
        badge:"MacBook Pro · última unidad",
        specs:[
          {label:"Pantalla",value:"13.3 pulgadas Retina"},
          {label:"Control",value:"Touch Bar + Touch ID"},
          {label:"Año",value:"2019"}
        ],
        methods:["cod_cargo","transfer_shipping","paypal_shipping","card_shipping","crypto_binance","pickup_pana","visacuotas"],
        pricing:{codSurchargePct:10,paypalSurchargePct:5,shippingGtq:40},
        package:{weight:2.0,length:38,width:28,height:10}
      }
    ];

    const created = [];
    const skipped = [];

    for (const item of defaults) {
      try {
        await loadTemporarySale(env, item.slug, false);
        skipped.push(item.slug);
        continue;
      } catch {}
      const sale = sanitizeTemporarySale(item, {});
      const now = new Date();
      await adminSetDocument(env, ["temporarySales", sale.slug], {
        ...sale,
        createdAt:now,
        updatedAt:now,
        createdByAdminEmail:admin.email,
        updatedByAdminEmail:admin.email
      });
      created.push(sale.slug);
    }

    return json({ok:true,created,skipped},200,origin);
  } catch (error) {
    const code=String(error?.message||"");
    return json({ok:false,code,error:code==="ADMIN_ONLY"?"Solo Administración puede importar productos.":"No se pudieron importar los productos."},
      code==="ADMIN_ONLY"?403:400,origin);
  }
}

async function temporarySaleEmailTestRoute(request, env, origin) {
  try {
    const admin = await requireFirebaseAdmin(bearerToken(request));
    const payload = await request.json().catch(()=>({}));
    const toAddress = validEmail(payload.toAddress) || admin.email;
    if (!toAddress) throw new Error("EMAIL_INVALID");

    const html = storeMailShell({
      badge:"Evolution Store",
      title:"Correo de tienda listo",
      subtitle:"La automatización de correos para pedidos físicos está configurada.",
      rows:[
        ["Administrador",admin.email],
        ["Destino de prueba",toAddress],
        ["Estado","Zoho conectado al Worker"],
        ["Tienda","Evolution Devices · Guatemala"]
      ],
      footer:"Los pedidos creados desde venta.html envían notificación al administrador y al cliente automáticamente.",
      micro:"Sistema de correo",
      microText:"Zoho Mail está conectado al Worker de Evolution Design.",
      greeting:`Hola ${admin.email || "Administración"},`,
      message:"Esta prueba confirma que Evolution Store puede enviar correos transaccionales usando la plantilla oficial de Evolution Design.",
      cta:"Abrir Administración",
      ctaUrl:"https://www.evolutiondesing.com/admin.html",
      noticeTitle:"Prueba completada",
      noticeText:"Si recibiste este mensaje, la salida de correo del Worker está funcionando correctamente."
    });
    const sent = await sendZohoHtmlMail(env,{
      toAddress,
      subject:"Evolution Store · Correo de prueba",
      content:html
    });
    return json({ok:true,messageId:sent.messageId||"",toAddress},200,origin);
  } catch (error) {
    const code=String(error?.message||"");
    return json({ok:false,code,error:code==="ADMIN_ONLY"?"Solo Administración puede probar correos.":"No se pudo enviar el correo de prueba."},
      code==="ADMIN_ONLY"?403:400,origin);
  }
}

async function temporarySaleDeleteRoute(request, env, origin) {
  try {
    const admin = await requireFirebaseAdmin(bearerToken(request));
    const payload = await request.json().catch(() => ({}));
    const sale = await loadTemporarySale(env, payload.slug, false);
    const now = new Date();
    await adminPatchDocument(env, ["temporarySales", sale.slug], {
      active: false,
      updatedAt: now,
      updatedByAdminEmail: admin.email
    });
    return json({ ok: true }, 200, origin);
  } catch (error) {
    return json({ ok: false, error: "No se pudo desactivar la venta." }, 400, origin);
  }
}

async function createTemporarySaleOrderRoute(request, env, origin) {
  try {
    const user = await requireFirebaseUser(bearerToken(request));
    const payload = await request.json().catch(() => ({}));

    await requireRecaptcha(request, env, {
      token: clean(payload.recaptchaToken, 7000),
      expectedAction: "STORE_ORDER",
      requestedUri: clean(payload.requestedUri || "", 700)
    });

    const sale = await loadTemporarySale(env, payload.saleSlug, true);
    const method = clean(payload.paymentMethod, 40).toLowerCase();
    if (method === "cod_forza") throw new Error("STORE_METHOD_INVALID");
    if (["paypal_shipping", "card_shipping"].includes(method)) throw new Error("STORE_ONLINE_PAYMENT_REQUIRED");

    const quote = await temporarySaleQuoteWithFx(sale, method);
    const availability = await temporarySaleAvailability(env, sale);
    if (!availability.available) throw new Error("STORE_PRODUCT_UNAVAILABLE");

    const draft = sanitizeStoreDraft(payload, user, method);
    draft.customsAccepted=true;
    draft.destinationLat = Number(payload.destinationLat || 0) || null;
    draft.destinationLng = Number(payload.destinationLng || 0) || null;

    const paymentReference = sanitizeStorePaymentReference(payload.paymentReference || "");
    if (["transfer_shipping", "crypto_binance"].includes(method) && paymentReference.length < 3) throw new Error("STORE_PAYMENT_REFERENCE_REQUIRED");

    const paymentProofId = clean(payload.paymentProofId || "", 90);
    let paymentProof = null;
    if (paymentProofId) paymentProof = await ownedStorePaymentProof(env, user, paymentProofId, false);
    if (["transfer_shipping", "crypto_binance"].includes(method) && !paymentProof) throw new Error("STORE_PAYMENT_RECEIPT_REQUIRED");

    const orderId = genericStoreOrderId();
    const now = new Date();
    const manualReview = ["transfer_shipping", "crypto_binance"].includes(method);
    const paymentStatus = manualReview ? "pending_review" : method === "visacuotas" ? "pending_external" : "pending";
    const paymentProvider = method === "transfer_shipping" ? "bank_transfer"
      : method === "crypto_binance" ? "binance_pay"
      : method === "visacuotas" ? "recurrente"
      : method.startsWith("cod_") ? "cash_on_delivery"
      : method === "pickup_pana" ? "in_person" : "";

    let order = temporarySaleOrderFromDraft({
      user, sale, draft, quote, orderId, now, paymentStatus,
      paymentReviewStatus: manualReview ? "pending" : "",
      status: "received", paymentProvider, paymentReference
    });
    if(method==="pickup_pana"){
      const pickup=panajachelPickupAppointment(now);
      Object.assign(order,{
        pickupLocation:pickup.location,
        pickupWindow:pickup.window,
        pickupAppointmentAt:pickup.appointmentAt,
        pickupAppointmentLabel:pickup.appointmentLabel
      });
    }

    if (paymentProof) {
      Object.assign(order, {
        paymentProofId: paymentProof.proofId,
        receiptProofId: paymentProof.proofId,
        receiptStoragePath: paymentProof.r2Key,
        receiptName: paymentProof.name,
        receiptSize: paymentProof.size,
        receiptContentType: paymentProof.type,
        paymentSubmittedAt: now
      });
    }

    if(!saleImportPending(sale)){const estimate=await boxfulEstimateForOrderLike(env,order,sale);Object.assign(order,{estimatedDispatchDate:estimate.dispatchDate,estimatedDeliveryDate:estimate.earliestDeliveryDate,estimatedDeliveryLatestDate:estimate.latestDeliveryDate})}else Object.assign(order,{estimatedDispatchDate:null,estimatedDeliveryDate:null,estimatedDeliveryLatestDate:null,importPending:true,importEstimatedDeliveryText:"3 a 25 días",importEstimatedDaysMin:3,importEstimatedDaysMax:25});

    await adminSetDocument(env, ["storeOrders", orderId], order);
    if (paymentProof) {
      await adminPatchDocument(env, ["storePaymentProofs", paymentProof.proofId], {
        attached: true, orderId, attachedAt: now, updatedAt: now
      }).catch(() => {});
    }

    if (boxfulShouldAutoCreate(order) && !saleImportPending(sale)) {
      order = await boxfulCreateShipmentSafely(env, order, { saleConfig: sale });
    }

    await adminPatchDocument(env, ["users", user.uid], {
      uid: user.uid,
      email: user.email || "",
      displayName: draft.customerName,
      lastStoreOrderId: orderId,
      lastStoreOrderAt: now,
      updatedAt: now
    }).catch(() => {});

    const adminAddress =
      validEmail(env.ORDER_NOTIFICATION_EMAIL) ||
      validEmail(env.ZOHO_ORDER_NOTIFICATION_EMAIL) ||
      "evolutiongt01@gmail.com";
    let adminMailStatus="sent",clientMailStatus="sent",adminMessageId="",clientMessageId="";
    try{
      const sent=await sendStoreOrderMail(env,adminAddress,buildStoreOrderAdminMail(order));
      adminMessageId=sent.messageId||"";
    }catch(mailError){
      adminMailStatus="failed";
      console.error("temporary sale admin mail",mailError?.message||mailError);
    }
    if(user.email){
      try{
        const sent=await sendStoreOrderMail(env,user.email,buildStoreOrderClientMail(order,false));
        clientMessageId=sent.messageId||"";
      }catch(mailError){
        clientMailStatus="failed";
        console.error("temporary sale client mail",mailError?.message||mailError);
      }
    }else{
      clientMailStatus="skipped";
    }
    Object.assign(order,{
      adminNotificationStatus:adminMailStatus,
      adminNotificationMessageId:adminMessageId,
      clientNotificationStatus:clientMailStatus,
      clientNotificationMessageId:clientMessageId
    });
    await adminPatchDocument(env,["storeOrders",orderId],{
      adminNotificationStatus:adminMailStatus,
      adminNotificationMessageId:adminMessageId,
      clientNotificationStatus:clientMailStatus,
      clientNotificationMessageId:clientMessageId,
      updatedAt:new Date()
    }).catch(()=>{});

    return json({
      ok: true,
      order: normalizeStoreOrder(order)
    }, 201, origin);
  } catch (error) {
    const code = String(error?.message || "");
    const messages = {
      STORE_PRODUCT_UNAVAILABLE: "Este producto ya no tiene unidades disponibles.",
      STORE_METHOD_INVALID: "Selecciona un método válido.",
      STORE_PAYMENT_REFERENCE_REQUIRED: "Ingresa la referencia del pago.",
      STORE_PAYMENT_RECEIPT_REQUIRED: "Adjunta el comprobante del pago.",
      STORE_ONLINE_PAYMENT_REQUIRED: "Completa el pago con PayPal o tarjeta.",
      SALE_NOT_FOUND: "No encontramos esta venta.",
      SALE_NOT_ACTIVE: "Esta venta ya terminó.",
      STORE_CUSTOMS_TERMS_REQUIRED: "Debes aceptar que los cargos de aduana se pagan por separado."
    };
    return json({ ok: false, code, error: messages[code] || "No se pudo registrar el pedido." }, 400, origin);
  }
}

function storeMailShell({
  badge,
  title,
  title2 = "",
  subtitle,
  rows = [],
  footer = "",
  micro = "Evolution Design · Notificación",
  microText = "Actualización registrada correctamente.",
  greeting = "Hola,",
  message = "Consulta los detalles de esta notificación a continuación.",
  cta = "Abrir Evolution",
  ctaUrl = "https://www.evolutiondesing.com/proyectos.html",
  noticeTitle = "Información importante",
  noticeText = "Consulta siempre los detalles desde los canales oficiales de Evolution Design."
}) {
  const currentYear = new Date().getFullYear();
  const safeBadge = htmlEscape(clean(badge || "Evolution Design", 90));
  const safeTitle = htmlEscape(clean(title || "Notificación Evolution", 180));
  const safeTitle2 = htmlEscape(clean(title2 || "", 180));
  const safeSubtitle = htmlEscape(clean(subtitle || "", 600));
  const safeMicro = htmlEscape(clean(micro || "Evolution Design · Notificación", 120));
  const safeMicroText = htmlEscape(clean(microText || subtitle || "Actualización registrada correctamente.", 300));
  const safeGreeting = htmlEscape(clean(greeting || "Hola,", 220));
  const safeMessage = htmlEscape(clean(message || subtitle || "Consulta los detalles de esta notificación a continuación.", 900));
  const safeCta = htmlEscape(clean(cta || "Abrir Evolution", 90));
  const safeCtaUrl = htmlEscape(clean(ctaUrl || "https://www.evolutiondesing.com/proyectos.html", 700));
  const safeNoticeTitle = htmlEscape(clean(noticeTitle || "Información importante", 130));
  const safeNoticeText = htmlEscape(clean(noticeText || footer || "Consulta siempre los detalles desde los canales oficiales de Evolution Design.", 1800));

  const detailRows = rows.map(([label, value], index) => `
    <tr>
      <td style="padding:${index === 0 ? "15px 17px 11px" : "0 17px"};">
        ${index === 0 ? "" : '<div style="height:1px;background-color:rgba(212,184,149,.10);background-image:linear-gradient(90deg,transparent,rgba(212,184,149,.30),transparent);"></div>'}
      </td>
    </tr>
    <tr>
      <td style="padding:${index === 0 ? "0 17px 15px" : "12px 17px 14px"};">
        <div style="color:#7f7f89;font-size:8px;font-weight:800;text-transform:uppercase;letter-spacing:1.2px;margin-bottom:5px;">${htmlEscape(clean(label, 100))}</div>
        <div class="gmail-screen"><div class="gmail-difference"><div style="color:#ffffff;font-size:13px;line-height:1.45;font-weight:650;">${htmlEscape(clean(value || "—", 1200))}</div></div></div>
      </td>
    </tr>`).join("");

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<style>
  body,table,td,p,a,span,div{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif}a{text-decoration:none}
  .bg-black{background-color:#000000!important;background-image:linear-gradient(180deg,#000000 0%,#000000 100%)!important}
  .glass-panel{background-color:#101014!important;background-image:linear-gradient(135deg,rgba(255,255,255,.075) 0%,rgba(255,255,255,.018) 48%,rgba(212,184,149,.035) 100%),linear-gradient(180deg,#15151b 0%,#0b0b0f 100%)!important;border:1px solid rgba(212,184,149,.22)!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.04),0 10px 30px rgba(0,0,0,.3)}
  .glass-soft{background-color:#0d0d11!important;background-image:linear-gradient(135deg,rgba(255,255,255,.055) 0%,rgba(255,255,255,.01) 55%),linear-gradient(180deg,#101014 0%,#08080b 100%)!important;border:1px solid rgba(212,184,149,.12)!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.02)}
  .gold-glass{background-color:#b99a74!important;background-image:linear-gradient(180deg,rgba(255,255,255,.22) 0%,rgba(255,255,255,.04) 48%,rgba(0,0,0,.09) 100%),linear-gradient(180deg,#d8bf9c 0%,#b49570 100%)!important}
  .gmail-screen{background:#000000;mix-blend-mode:screen}.gmail-difference{background:#000000;mix-blend-mode:difference}
  @media screen and (max-width:600px){.container{width:100%!important;padding:14px 8px!important}.card{width:100%!important;border-radius:17px!important}.glass-header{padding:22px 18px!important}.body-pad{padding:22px 18px 24px!important}.hero-title{font-size:29px!important;line-height:1.08!important}.btn{width:100%!important;display:block!important;box-sizing:border-box!important;padding:16px 18px!important}.brand-badge{font-size:8px!important;padding:7px 9px!important}}
</style>
</head>
<body class="bg-black" bgcolor="#000000" style="margin:0;padding:0;-webkit-font-smoothing:antialiased;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;color:#000000;">${safeMicroText}</div>
<table width="100%" border="0" cellpadding="0" cellspacing="0" class="bg-black" role="presentation"><tr><td align="center" valign="top" class="container bg-black" style="padding:38px 15px;">
<table width="600" class="card" border="0" cellpadding="0" cellspacing="0" role="presentation" style="width:600px;max-width:600px;border-radius:22px;overflow:hidden;border:1px solid rgba(212,184,149,.25);background-color:#050507;background-image:linear-gradient(180deg,#09090c 0%,#030304 100%);box-shadow:0 24px 70px rgba(0,0,0,.42);">
<tr><td class="glass-header" style="padding:28px 32px 25px;background-color:#17171c;background-image:linear-gradient(145deg,rgba(255,255,255,.09) 0%,rgba(255,255,255,.018) 52%,rgba(212,184,149,.05) 100%),linear-gradient(180deg,#1d1d24 0%,#111115 100%);border-bottom:1px solid rgba(212,184,149,.25);box-shadow:inset 0 1px 0 rgba(255,255,255,.05);">
<table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation"><tr><td valign="middle" align="left"><a href="https://www.evolutiondesing.com" target="_blank"><img src="https://www.evolutiondesing.com/img/logo.png" alt="Evolution Design" width="140" style="display:block;width:140px;max-width:140px;height:auto;border:0;outline:none;"></a></td><td valign="middle" align="right" style="padding-left:12px;"><span class="brand-badge" style="display:inline-block;padding:7px 12px;background-color:#2a241e;background-image:linear-gradient(180deg,rgba(212,184,149,.24) 0%,rgba(212,184,149,.07) 100%);border:1px solid rgba(212,184,149,.40);border-radius:999px;color:#ead8c1;font-size:9px;font-weight:700;letter-spacing:1.1px;text-transform:uppercase;box-shadow:inset 0 1px 0 rgba(255,255,255,.10);white-space:nowrap;">${safeBadge}</span></td></tr></table>
</td></tr>
<tr><td class="body-pad" style="padding:30px 34px 32px;background-color:#070709;background-image:linear-gradient(180deg,#0c0c10 0%,#050507 100%);">
<table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" class="glass-soft" style="width:100%;border-radius:14px;margin-bottom:22px;overflow:hidden;"><tr><td width="44" align="center" valign="middle" style="padding:12px 0 12px 14px;"><div style="width:28px;height:28px;line-height:28px;border-radius:999px;text-align:center;background-color:#241e18;background-image:linear-gradient(180deg,rgba(212,184,149,.25),rgba(212,184,149,.06));border:1px solid rgba(212,184,149,.32);color:#d4b895;font-size:13px;font-weight:800;">✓</div></td><td valign="middle" style="padding:11px 12px 11px 10px;"><div style="color:#d4b895;font-size:9px;font-weight:800;letter-spacing:1.35px;text-transform:uppercase;margin-bottom:3px;">${safeMicro}</div><div class="gmail-screen"><div class="gmail-difference"><div style="color:#ffffff;font-size:11px;line-height:1.4;font-weight:600;">${safeMicroText}</div></div></div></td><td width="58" align="right" valign="middle" style="padding:10px 14px 10px 4px;"><span style="display:inline-block;width:7px;height:7px;border-radius:999px;background-color:#d4b895;box-shadow:0 0 0 5px rgba(212,184,149,.08),0 0 18px rgba(212,184,149,.35);"></span></td></tr></table>
<div style="width:42px;height:2px;background-color:rgba(212,184,149,.5);background-image:linear-gradient(90deg,#d4b895,#8f7659);border-radius:999px;margin:0 0 15px;"></div>
<div class="gmail-screen"><div class="gmail-difference"><div class="hero-title" style="margin:0;color:#ffffff;font-size:34px;font-weight:720;letter-spacing:-1.05px;line-height:1.06;">${safeTitle}</div></div></div>${safeTitle2 ? `<div class="hero-title" style="margin:2px 0 0;color:#d4b895;font-size:34px;font-weight:720;letter-spacing:-1.05px;line-height:1.06;">${safeTitle2}</div>` : ""}
${safeSubtitle ? `<div style="font-size:11px;line-height:1.65;color:#8c8c95;margin:10px 0 18px;">${safeSubtitle}</div>` : '<div style="height:16px;line-height:16px;">&nbsp;</div>'}
<table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" class="glass-panel" style="width:100%;border-radius:17px;margin-bottom:20px;overflow:hidden;"><tr><td style="padding:18px 18px 17px;border-left:2px solid #b89a76;"><div class="gmail-screen"><div class="gmail-difference"><div style="color:#ffffff;font-size:14px;line-height:1.55;margin-bottom:8px;">${safeGreeting}</div><div style="color:#ffffff;font-size:12px;line-height:1.72;opacity:.86;">${safeMessage}</div></div></div></td></tr></table>
<table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" class="glass-panel" style="width:100%;border-radius:17px;overflow:hidden;margin-bottom:20px;"><tr><td style="padding:14px 17px 11px;border-bottom:1px solid rgba(212,184,149,.15);"><table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation"><tr><td><div style="color:#8f8f98;font-size:8px;font-weight:800;letter-spacing:1.45px;text-transform:uppercase;">Evolution Design · Notificación</div></td><td align="right"><span style="color:#d4b895;font-size:8px;font-weight:800;letter-spacing:1.15px;text-transform:uppercase;">● Confirmado</span></td></tr></table></td></tr>${detailRows}</table>
<table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="width:100%;margin-bottom:20px;"><tr><td align="center" class="gold-glass" style="border-radius:12px;border:1px solid #d4b895;box-shadow:inset 0 1px 0 rgba(255,255,255,.32),0 8px 22px rgba(180,149,112,.16);"><a href="${safeCtaUrl}" class="btn" target="_blank" style="display:block;padding:16px 22px;color:#17120d;font-size:13px;font-weight:850;letter-spacing:.55px;text-transform:uppercase;">${safeCta}&nbsp;&nbsp;→</a></td></tr></table>
<table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" class="glass-soft" style="width:100%;border-radius:14px;overflow:hidden;margin-bottom:20px;"><tr><td width="38" valign="top" align="center" style="padding:14px 0 14px 13px;"><div style="width:25px;height:25px;line-height:25px;text-align:center;border-radius:8px;background-color:#211c17;background-image:linear-gradient(180deg,rgba(212,184,149,.18),rgba(212,184,149,.03));border:1px solid rgba(212,184,149,.22);font-size:12px;">◆</div></td><td style="padding:13px 14px 13px 9px;"><div style="color:#d4b895;font-size:9px;font-weight:800;letter-spacing:.8px;text-transform:uppercase;margin-bottom:4px;">${safeNoticeTitle}</div><div class="gmail-screen"><div class="gmail-difference"><div style="color:#ffffff;font-size:10px;line-height:1.62;opacity:.76;">${safeNoticeText}</div></div></div></td></tr></table>
<table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="width:100%;border-top:1px solid rgba(212,184,149,.15);border-bottom:1px solid rgba(212,184,149,.15);"><tr><td width="50%" valign="top" style="padding:14px 12px 14px 0;"><div style="color:#d4b895;font-size:9px;font-weight:800;margin-bottom:4px;">Evolution Design</div><a href="https://www.evolutiondesing.com" style="color:#9c9ca5;font-size:9px;">www.evolutiondesing.com</a><div class="gmail-screen"><div class="gmail-difference"><div style="color:#ffffff;font-size:8px;margin-top:5px;line-height:1.4;opacity:.55;">Arquitectura · Diseño · Desarrollo</div></div></div></td><td width="50%" valign="top" style="padding:14px 0 14px 15px;border-left:1px solid rgba(212,184,149,.15);"><div class="gmail-screen"><div class="gmail-difference"><div style="color:#ffffff;font-size:9px;font-weight:800;margin-bottom:4px;">Dingloft</div></div></div><a href="https://www.dingloft.com" style="color:#9c9ca5;font-size:9px;">www.dingloft.com</a><div class="gmail-screen"><div class="gmail-difference"><div style="color:#ffffff;font-size:8px;margin-top:5px;line-height:1.4;opacity:.55;">Música · Tecnología · Recursos Digitales</div></div></div></td></tr></table>
<div style="padding:17px 0 0;"><div style="color:#d4b895;font-size:8px;font-weight:800;letter-spacing:1.05px;text-transform:uppercase;margin-bottom:6px;">Mensaje generado automáticamente</div><div class="gmail-screen"><div class="gmail-difference"><div style="color:#ffffff;font-size:9px;line-height:1.65;opacity:.55;">Este correo fue generado automáticamente por Evolution Design como resultado de una acción registrada en tu cuenta.<br><br><strong>Por favor, no respondas directamente a este mensaje.</strong> Para asistencia utiliza tu panel o escribe a support@evolutiondesing.com.</div></div></div></div>
</td></tr>
<tr><td style="padding:23px 32px 25px;text-align:center;background-color:#0c0c10;background-image:linear-gradient(145deg,rgba(255,255,255,.045) 0%,rgba(255,255,255,.008) 60%),linear-gradient(180deg,#101014 0%,#08080a 100%);border-top:1px solid rgba(212,184,149,.15);box-shadow:inset 0 1px 0 rgba(255,255,255,.02);"><div style="color:#d4b895;font-size:9px;font-weight:800;letter-spacing:2px;margin-bottom:8px;">EVOLUTION GROUP</div><div class="gmail-screen"><div class="gmail-difference"><div style="color:#ffffff;font-size:9px;line-height:1.6;opacity:.48;">© ${currentYear} Evolution Group · Todos los derechos reservados.<br>Evolution Design y Dingloft forman parte del ecosistema Evolution Group.</div></div></div></td></tr>
</table></td></tr></table>
</body></html>`;
}

function buildStoreOrderAdminMail(order) {
  const shipping = order.paymentMethod === "pickup_pana"
    ? `${order.pickupLocation||STORE_PICKUP_LOCATION} · ${order.pickupAppointmentLabel||STORE_PICKUP_WINDOW}`
    : [
        order.department,
        order.municipality,
        order.poblado,
        order.address,
        order.reference ? `Ref: ${order.reference}` : ""
      ].filter(Boolean).join(" · ");

  return {
    subject: `Nuevo pedido · ${clean(order.productTitle || STORE_IPHONE_TITLE,120)} · ${order.orderId}`.slice(0, 220),
    content: storeMailShell({
      badge: "Nuevo pedido",
      title: "Nuevo pedido recibido",
      subtitle: `Un cliente autenticado registró una compra de ${clean(order.productTitle || STORE_IPHONE_TITLE,120)}.`,
      rows: [
        ["Orden", order.orderId],
        ["Cliente", order.customerName || order.ownerEmail],
        ["Correo", order.ownerEmail],
        ["Teléfono", order.phone],
        ["NIT / DPI", order.nitDpi || "No indicado"],
        ["Método", storeMethodLabel(order.paymentMethod)],
        ["Pago", order.paymentStatus === "paid" ? "Confirmado" : order.paymentStatus === "pending_review" ? "En revisión" : "Pendiente"],
        ...(order.paymentReference ? [["Referencia de pago", order.paymentReference]] : []),
        ["Total", gtqLabel(order.totalGtq)],
        ...(order.customsRequired?[["Importación","Incluida en el total"],["Entrega estimada","3 a 25 días"]]:[]),
        ["Entrega", shipping]
      ],
      footer: "Confirma disponibilidad y cambia el estado desde Administración. Los envíos se realizan de lunes a viernes; pedidos de fin de semana se despachan el lunes a las 10:00 a. m. Daños atribuibles al transporte deben reportarse dentro de las 10 horas posteriores a la recepción con evidencia. Daños causados después de la entrega por golpes, líquidos, manipulación, reparaciones de terceros u otro mal uso no se consideran daños de transporte.",
      micro: "Pedido registrado",
      microText: `${clean(order.productTitle || STORE_IPHONE_TITLE,120)} · ${order.orderId}`,
      greeting: "Administración Evolution,",
      message: `Se registró una nueva compra de ${clean(order.productTitle || STORE_IPHONE_TITLE,120)}. Revisa los datos del cliente, el método de pago y la entrega antes de procesarla.`,
      cta: "Abrir Administración",
      ctaUrl: "https://www.evolutiondesing.com/admin.html",
      noticeTitle: "Revisión administrativa",
      noticeText: "Verifica el pago cuando corresponda y gestiona el estado del pedido únicamente desde Administración."
    })
  };
}

function buildStoreOrderClientMail(order, statusOnly = false) {
  const statusText = storeStatusLabel(order.status, order.paymentMethod);
  return {
    subject: `${statusOnly ? "Actualización de pedido" : "Pedido recibido"} · ${order.orderId} | Evolution Design`.slice(0, 220),
    content: storeMailShell({
      badge: statusText,
      title: statusOnly ? "Tu pedido fue actualizado" : "Recibimos tu pedido",
      subtitle: statusOnly
        ? `El estado de tu ${clean(order.productTitle || STORE_IPHONE_TITLE,120)} ahora es: ${statusText}.`
        : "Tu solicitud de compra quedó registrada correctamente en tu cuenta Evolution Design.",
      rows: [
        ["Orden", order.orderId],
        ["Producto", order.productTitle || STORE_IPHONE_TITLE],
        ["Método", storeMethodLabel(order.paymentMethod)],
        ["Pago", order.paymentStatus === "paid" ? "CONFIRMADO" : order.paymentStatus === "pending_review" ? "EN REVISIÓN" : "PENDIENTE"],
        ["Total", gtqLabel(order.totalGtq)],
        ["Estado", statusText],
        ...(order.paymentMethod==="pickup_pana"?[["Punto de encuentro",order.pickupLocation||STORE_PICKUP_LOCATION],["Cita asignada",order.pickupAppointmentLabel||STORE_PICKUP_WINDOW]]:[]),
        ...(order.customsRequired?[["Importación",storeImportStatusLabel(order.customsStatus||order.importInfo?.status||"usa_stock")],["Gestión de importación","INCLUIDA EN EL TOTAL"],["Entrega estimada",order.importEstimatedDeliveryText||"3 a 25 días"]]:[]),
        ...(order.trackingNumber ? [["Guía / tracking", order.trackingNumber]] : []),
        ...(order.estimatedDeliveryDate ? [["Entrega aproximada", order.estimatedDeliveryLatestDate && order.estimatedDeliveryLatestDate !== order.estimatedDeliveryDate ? `${order.estimatedDeliveryDate} a ${order.estimatedDeliveryLatestDate}` : order.estimatedDeliveryDate]] : []),
        ...(order.boxfulTrackingStatus ? [["Estado del envío", order.boxfulTrackingStatus]] : []),
        ...(order.trackingUrl ? [["Seguimiento", order.trackingUrl]] : [])
      ],
      footer: "Puedes revisar el seguimiento desde Mis Proyectos → Pedidos. Los envíos se realizan de lunes a viernes; pedidos de sábado o domingo se despachan el lunes a las 10:00 a. m. En condiciones normales se recibe al día siguiente; por bloqueos, paros u otras incidencias puede tardar hasta 3 días hábiles. Al recibir, revisa el producto: cualquier daño atribuible al transporte debe reportarse dentro de 10 horas con fotografías o video y evidencia del paquete. Los daños causados posteriormente por golpes, líquidos, manipulación, modificaciones o reparaciones de terceros quedan sujetos a revisión y no se consideran daños de transporte.",
      micro: statusOnly ? "Estado actualizado" : "Pedido registrado",
      microText: statusOnly ? `Tu pedido ${order.orderId} cambió de estado.` : `Tu pedido ${order.orderId} quedó registrado en Evolution Design.`,
      greeting: `Hola ${clean(order.customerName || order.ownerEmail || "Cliente",160)},`,
      message: statusOnly
        ? `Actualizamos el estado de tu pedido de ${clean(order.productTitle || STORE_IPHONE_TITLE,120)}. Consulta los detalles y seguimiento desde tu cuenta.`
        : `Recibimos tu pedido de ${clean(order.productTitle || STORE_IPHONE_TITLE,120)}. Puedes consultar su estado desde tu cuenta Evolution.`,
      cta: "Ver mi pedido",
      ctaUrl: "https://www.evolutiondesing.com/proyectos.html",
      noticeTitle: order.paymentMethod==="pickup_pana"?"Tu cita de entrega":"Seguimiento desde tu cuenta",
      noticeText: order.paymentMethod==="pickup_pana"?`Te esperamos en ${order.pickupLocation||STORE_PICKUP_LOCATION}. La cita asignada es ${order.pickupAppointmentLabel||STORE_PICKUP_WINDOW}. Si necesitas coordinar un cambio, contacta a Evolution Design.`:"Por seguridad, los cambios del pedido, comprobantes y seguimiento se gestionan desde tu cuenta Evolution Design."
    })
  };
}

function buildStoreShipmentOnWayMail(order){
  const carrier=clean(order.carrier||"Paquetería nacional",100),tracking=clean(order.trackingNumber||"",120);
  const ctaUrl=order.trackingUrl||"https://www.evolutiondesing.com/proyectos.html";
  return {
    subject:`Tu ${clean(order.productTitle||"paquete",120)} ya va en camino | Evolution Design`.slice(0,220),
    content:storeMailShell({
      badge:"En camino",
      title:"Tu paquete ya va",
      title2:"en camino.",
      subtitle:`La entrega nacional de tu ${clean(order.productTitle||"producto",120)} ya fue despachada.`,
      rows:[["Producto",order.productTitle||"Producto"],["Orden",order.orderId],["Paquetería",carrier],["Número de guía",tracking||"—"],["Estado","EN CAMINO"]],
      micro:"Envío nacional despachado",
      microText:`${carrier} · Guía ${tracking||"registrada"}`,
      greeting:`Hola ${clean(order.customerName||order.ownerEmail||"Cliente",160)},`,
      message:`Tu ${clean(order.productTitle||"producto",120)} ya salió para entrega nacional. La paquetería asignada es ${carrier} y tu número de guía es ${tracking||"el registrado en tu cuenta"}.`,
      cta:order.trackingUrl?"Abrir seguimiento":"Ver mi pedido",
      ctaUrl,
      noticeTitle:"Conserva tu número de guía",
      noticeText:"Puedes consultar esta información desde tu cuenta Evolution. Los tiempos finales dependen de la cobertura y operación de la paquetería seleccionada."
    })
  };
}

function buildStoreCustomsArrivalMail(order,sale){
  return{
    subject:`Tu ${clean(sale.title||order.productTitle||"producto",120)} ya está en aduana | Evolution Design`.slice(0,220),
    content:storeMailShell({
      badge:"En aduana",
      title:"Tu equipo ya llegó",
      title2:"a Guatemala.",
      subtitle:"La importación avanzó a la etapa de revisión aduanal.",
      rows:[
        ["Producto",sale.title||order.productTitle],
        ["Orden",order.orderId],
        ["Estado","EN ADUANA"],
        ["Importación","INCLUIDA EN TU COMPRA"],
        ["Entrega estimada",order.importEstimatedDeliveryText||"3 a 25 días"]
      ],
      micro:"Actualización de importación",
      microText:"Tu producto ya se encuentra en aduana.",
      greeting:`Hola ${clean(order.customerName||order.ownerEmail||"Cliente",160)},`,
      message:`Tu ${clean(sale.title||order.productTitle||"producto",120)} ya se encuentra en el proceso de importación en Guatemala. Evolution continúa gestionando el proceso por ti.`,
      cta:"Ver mi pedido",
      ctaUrl:"https://www.evolutiondesing.com/proyectos.html",
      noticeTitle:"No necesitas pagar aduana aparte",
      noticeText:"La gestión de importación ya está incluida en el total de tu pedido con Evolution Design. Continuaremos actualizando el seguimiento hasta la entrega."
    })
  };
}
async function notifySaleCustomsArrival(env,sale){const orders=await listStoreOrders(env,300);let sent=0;for(const o of orders.filter(x=>x.saleSlug===sale.slug&&String(x.status||"").toLowerCase()!=="cancelled"&&validEmail(x.ownerEmail))){const id=o.orderId||o.id;await adminPatchDocument(env,["storeOrders",id],{importInfo:sale.importInfo||{},customsRequired:true,customsIncluded:true,customsStatus:"customs",customsLocation:sale.importInfo?.locationLabel||"Aduana Guatemala",customsTotalGtq:Number(sale.importInfo?.importIncludedGtq??sale.importInfo?.customsTotalGtq??0),customsBreakdown:sale.importInfo?.customsBreakdown||{},updatedAt:new Date()}).catch(()=>{});try{const m=await sendStoreOrderMail(env,o.ownerEmail,buildStoreCustomsArrivalMail(o,sale));sent++;await adminPatchDocument(env,["storeOrders",id],{lastCustomsMailStatus:"sent",lastCustomsMailMessageId:m.messageId||"",lastCustomsMailAt:new Date()}).catch(()=>{})}catch(e){console.error("customs arrival mail",e?.message||e)}}return sent}

async function syncSaleImportStateToOrders(env,sale){
  const orders=await listStoreOrders(env,300);let updated=0;
  for(const o of orders.filter(x=>x.saleSlug===sale.slug&&String(x.status||"").toLowerCase()!=="cancelled")){
    const id=o.orderId||o.id;if(!id)continue;
    await adminPatchDocument(env,["storeOrders",id],{
      importInfo:sale.importInfo||{},
      customsRequired:sale.importInfo?.requiresCustoms===true,
      customsIncluded:true,
      customsStatus:sale.importInfo?.status||"available_gt",
      customsLocation:sale.importInfo?.locationLabel||"Guatemala",
      customsTotalGtq:Number(sale.importInfo?.importIncludedGtq??sale.importInfo?.customsTotalGtq??0),
      quickboxDeliveryMode:sale.importInfo?.quickboxDeliveryMode||"delivery",
      quickboxDeliveryGtq:Number(sale.importInfo?.quickboxDeliveryGtq||0),
      customsBreakdown:sale.importInfo?.customsBreakdown||{},
      customsReleasedAt:["released","available_gt"].includes(sale.importInfo?.status||"")?(o.customsReleasedAt||new Date()):null,
      updatedAt:new Date()
    }).catch(()=>{});updated++;
  }
  return updated;
}

async function sendStoreOrderMail(env, toAddress, rendered) {
  const email = validEmail(toAddress);
  if (!email) throw new Error("MAIL_RECIPIENT_INVALID");
  return sendZohoHtmlMail(env, {
    toAddress: email,
    subject: rendered.subject,
    content: rendered.content
  });
}


function safeStoreProofId(value) {
  const id = clean(value, 90).replace(/[^A-Za-z0-9_-]/g, "");
  if (!/^[A-Za-z0-9_-]{16,90}$/.test(id)) throw new Error("STORE_PROOF_INVALID");
  return id;
}

function safeStoreProofFilename(value) {
  const raw = clean(value || "comprobante", 180)
    .replace(/[\\/\u0000-\u001f\u007f]+/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  return raw || "comprobante";
}

async function ownedStorePaymentProof(env, user, proofId, allowAttached = false) {
  const id = safeStoreProofId(proofId);
  const snap = await adminGetDocument(env, ["storePaymentProofs", id], true);
  if (!snap.exists || !snap.data) throw new Error("STORE_PROOF_NOT_FOUND");
  const proof = { proofId: id, ...(snap.data || {}) };
  if (String(proof.ownerUid || "") !== String(user.uid || "")) throw new Error("STORE_PROOF_NOT_FOUND");
  if (!allowAttached && proof.attached === true) throw new Error("STORE_PROOF_ALREADY_USED");
  if (!proof.r2Key) throw new Error("STORE_PROOF_NOT_FOUND");
  return proof;
}

async function storePaymentProofUploadRoute(request, env, origin) {
  try {
    const user = await requireFirebaseUser(bearerToken(request));
    if (!env.PROFILE_R2) throw new Error("R2_BINDING_MISSING");

    const form = await request.formData();
    const file = form.get("file");

    if (!file || typeof file.arrayBuffer !== "function") throw new Error("STORE_PROOF_REQUIRED");

    const size = Number(file.size || 0);
    const type = clean(file.type || "application/octet-stream", 120).toLowerCase();
    const name = safeStoreProofFilename(file.name || "comprobante");

    if (size <= 0 || size > 12 * 1024 * 1024) throw new Error("STORE_PROOF_TOO_LARGE");
    if (!(type.startsWith("image/") || type === "application/pdf")) throw new Error("STORE_PROOF_TYPE_INVALID");

    const proofId = crypto.randomUUID().replace(/-/g, "");
    const r2Key = `store-payment-proofs/${user.uid}/${proofId}/${name}`;
    const bytes = await file.arrayBuffer();
    const now = new Date();

    await env.PROFILE_R2.put(r2Key, bytes, {
      httpMetadata: { contentType: type },
      customMetadata: {
        ownerUid: user.uid,
        proofId,
        originalName: name
      }
    });

    await adminSetDocument(env, ["storePaymentProofs", proofId], {
      proofId,
      ownerUid: user.uid,
      ownerEmail: user.email || "",
      r2Key,
      name,
      type,
      size,
      attached: false,
      createdAt: now,
      updatedAt: now
    });

    return json({
      ok: true,
      proof: { proofId, name, type, size }
    }, 201, origin);
  } catch (error) {
    const code = String(error?.message || "");
    const map = {
      AUTH_MISSING: "Inicia sesión antes de subir el comprobante.",
      AUTH_INVALID: "Tu sesión ya no es válida.",
      R2_BINDING_MISSING: "El almacenamiento de comprobantes no está disponible.",
      STORE_PROOF_REQUIRED: "Adjunta una captura, fotografía o PDF del comprobante.",
      STORE_PROOF_TOO_LARGE: "El comprobante no puede superar 12 MB.",
      STORE_PROOF_TYPE_INVALID: "El comprobante debe ser una imagen o un archivo PDF."
    };
    return json({ ok: false, code, error: map[code] || "No se pudo guardar el comprobante." },
      ["AUTH_MISSING", "AUTH_INVALID"].includes(code) ? 401 : 400, origin);
  }
}

async function attachStoreProofToOrderRoute(request, env, origin) {
  try {
    const user = await requireFirebaseUser(bearerToken(request));
    const payload = await request.json().catch(() => ({}));
    const orderId = clean(payload.orderId, 100);
    const proofId = clean(payload.paymentProofId, 90);

    if (!/^EV-(?:IP8|SALE)-[A-Za-z0-9-]{6,80}$/.test(orderId)) throw new Error("STORE_ORDER_ID_INVALID");

    const orderSnap = await adminGetDocument(env, ["storeOrders", orderId], true);
    if (!orderSnap.exists) throw new Error("STORE_ORDER_NOT_FOUND");
    const order = { orderId, ...(orderSnap.data || {}) };
    if (String(order.ownerUid || "") !== String(user.uid || "")) throw new Error("STORE_ORDER_NOT_FOUND");

    const proof = await ownedStorePaymentProof(env, user, proofId, false);
    const now = new Date();

    const patch = {
      paymentProofId: proof.proofId,
      receiptProofId: proof.proofId,
      receiptStoragePath: proof.r2Key,
      receiptName: proof.name,
      receiptSize: proof.size,
      receiptContentType: proof.type,
      paymentStatus: "pending_review",
      paymentReviewStatus: "pending",
      paymentSubmittedAt: now,
      updatedAt: now
    };

    await adminPatchDocument(env, ["storeOrders", orderId], patch);
    await adminPatchDocument(env, ["storePaymentProofs", proof.proofId], {
      attached: true,
      orderId,
      attachedAt: now,
      updatedAt: now
    });

    const updated = { ...order, ...patch };
    const adminAddress =
      validEmail(env.ORDER_NOTIFICATION_EMAIL) ||
      validEmail(env.ZOHO_ORDER_NOTIFICATION_EMAIL) ||
      "evolutiongt01@gmail.com";

    try {
      await sendStoreOrderMail(env, adminAddress, {
        subject: `Comprobante recibido · ${clean(updated.productTitle || STORE_IPHONE_TITLE,120)} · ${orderId}`.slice(0, 220),
        content: storeMailShell({
          badge: "Comprobante",
          title: "Nuevo comprobante recibido",
          subtitle: "El cliente adjuntó evidencia de pago para revisión administrativa.",
          rows: [
            ["Orden", orderId],
            ["Cliente", updated.customerName || updated.ownerEmail],
            ["Método", storeMethodLabel(updated.paymentMethod)],
            ["Referencia", updated.paymentReference || "No indicada"],
            ["Archivo", proof.name],
            ["Estado", "Pago en revisión"]
          ],
          footer: "Abre el pedido desde Administración para revisar el comprobante y confirmar el pago.",
          micro: "Comprobante recibido",
          microText: `${clean(updated.productTitle || STORE_IPHONE_TITLE,120)} · ${orderId}`,
          greeting: "Administración Evolution,",
          message: `El cliente adjuntó un comprobante para ${clean(updated.productTitle || STORE_IPHONE_TITLE,120)}. Revisa la evidencia antes de marcar el pago como confirmado.`,
          cta: "Revisar en Administración",
          ctaUrl: "https://www.evolutiondesing.com/admin.html",
          noticeTitle: "Pago pendiente de revisión",
          noticeText: "No confirmes el pedido hasta verificar que el pago recibido coincida con el monto y la referencia registrados."
        })
      });
    } catch (mailError) {
      console.warn("store proof mail", mailError?.message || mailError);
    }

    return json({ ok: true, order: normalizeStoreOrder({ id: orderId, data: updated }) }, 200, origin);
  } catch (error) {
    const code = String(error?.message || "");
    const map = {
      AUTH_MISSING: "Inicia sesión nuevamente.",
      AUTH_INVALID: "Tu sesión ya no es válida.",
      STORE_ORDER_ID_INVALID: "El pedido no es válido.",
      STORE_ORDER_NOT_FOUND: "No encontramos ese pedido.",
      STORE_PROOF_INVALID: "El comprobante no es válido.",
      STORE_PROOF_NOT_FOUND: "No encontramos el comprobante.",
      STORE_PROOF_ALREADY_USED: "Ese comprobante ya está asociado a otro pedido."
    };
    return json({ ok: false, code, error: map[code] || "No se pudo adjuntar el comprobante." },
      ["AUTH_MISSING", "AUTH_INVALID"].includes(code) ? 401 : code === "STORE_ORDER_NOT_FOUND" ? 404 : 400, origin);
  }
}

async function adminStoreOrderProofRoute(request, env, origin, url) {
  try {
    await requireFirebaseAdmin(bearerToken(request));
    if (!env.PROFILE_R2) throw new Error("R2_BINDING_MISSING");

    const orderId = clean(url.searchParams.get("orderId"), 100);
    if (!/^EV-(?:IP8|SALE)-[A-Za-z0-9-]{6,80}$/.test(orderId)) throw new Error("STORE_ORDER_ID_INVALID");

    const snap = await adminGetDocument(env, ["storeOrders", orderId], true);
    if (!snap.exists) throw new Error("STORE_ORDER_NOT_FOUND");
    const order = snap.data || {};
    const key = clean(order.receiptStoragePath, 900);
    if (!key) throw new Error("STORE_PROOF_NOT_FOUND");

    const object = await env.PROFILE_R2.get(key);
    if (!object) throw new Error("STORE_PROOF_NOT_FOUND");

    const filename = safeStoreProofFilename(order.receiptName || "comprobante");
    const headers = {
      ...corsHeaders(origin),
      "content-type": clean(order.receiptContentType || object.httpMetadata?.contentType || "application/octet-stream", 120),
      "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "cache-control": "private, no-store"
    };
    return new Response(object.body, { status: 200, headers });
  } catch (error) {
    const code = String(error?.message || "");
    return json({
      ok: false,
      code,
      error: code === "STORE_PROOF_NOT_FOUND"
        ? "Este pedido no tiene un comprobante disponible."
        : code === "ADMIN_ONLY"
          ? "Solo Administración puede revisar comprobantes."
          : "No se pudo abrir el comprobante."
    }, code === "STORE_PROOF_NOT_FOUND" ? 404 : code === "ADMIN_ONLY" ? 403 : 400, origin);
  }
}

async function createStoreOrderRoute(request, env, origin) {
  try {
    const user = await requireFirebaseUser(bearerToken(request));
    const payload = await request.json().catch(() => ({}));

    await requireRecaptcha(request, env, {
      token: clean(payload.recaptchaToken, 7000),
      expectedAction: "STORE_ORDER",
      requestedUri: clean(payload.requestedUri || "", 700)
    });

    const method=clean(payload.paymentMethod,40).toLowerCase();
    if(method==="cod_forza")throw new Error("STORE_METHOD_INVALID");
    if(["paypal_shipping","card_shipping"].includes(method))throw new Error("STORE_ONLINE_PAYMENT_REQUIRED");
    const quote=await storeQuoteWithFx(method),availability=await storeAvailability(env);
    if(!availability.available)throw new Error("STORE_PRODUCT_UNAVAILABLE");

    const draft=sanitizeStoreDraft(payload,user,method);
    const paymentReference=sanitizeStorePaymentReference(payload.paymentReference||"");
    if(["transfer_shipping","crypto_binance"].includes(method)&&paymentReference.length<3)throw new Error("STORE_PAYMENT_REFERENCE_REQUIRED");

    const paymentProofId=clean(payload.paymentProofId||"",90);
    let paymentProof=null;
    if(paymentProofId)paymentProof=await ownedStorePaymentProof(env,user,paymentProofId,false);
    if(["transfer_shipping","crypto_binance"].includes(method)&&!paymentProof)throw new Error("STORE_PAYMENT_RECEIPT_REQUIRED");

    // Soft duplicate protection: same user cannot create the same request repeatedly in seconds.
    const mine = await adminRunQuery(env, {
      from: [{ collectionId: "storeOrders" }],
      where: {
        fieldFilter: {
          field: { fieldPath: "ownerUid" },
          op: "EQUAL",
          value: { stringValue: user.uid }
        }
      },
      limit: 30
    });
    const nowMs = Date.now();
    const duplicate = mine
      .map(normalizeStoreOrder)
      .find(order =>
        order.sku === STORE_IPHONE_SKU &&
        order.paymentMethod === method &&
        String(order.status || "") !== "cancelled" &&
        (nowMs - (new Date(order.createdAt || 0).getTime() || 0)) < 90 * 1000
      );
    if (duplicate) {
      return json({ ok: true, duplicate: true, order: duplicate }, 200, origin);
    }

    const orderId=storeOrderId(),now=new Date();
    const manualReview=["transfer_shipping","crypto_binance"].includes(method)||(method==="visacuotas"&&Boolean(paymentProof));
    const paymentStatus=manualReview?"pending_review":method==="visacuotas"?"pending_external":"pending";
    const paymentProvider=method==="transfer_shipping"?"bank_transfer":method==="crypto_binance"?"binance_pay":method==="visacuotas"?"recurrente":method.startsWith("cod_")?"cash_on_delivery":method==="pickup_pana"?"in_person":"";
    let order=storeOrderFromDraft({user,draft,quote,orderId,now,paymentStatus,paymentReviewStatus:manualReview?"pending":"",status:"received",paymentProvider,paymentReference});
    const deliveryEstimate=await boxfulEstimateForOrderLike(env,order);
    Object.assign(order,{
      estimatedDispatchDate:deliveryEstimate.dispatchDate,
      estimatedDeliveryDate:deliveryEstimate.earliestDeliveryDate,
      estimatedDeliveryLatestDate:deliveryEstimate.latestDeliveryDate
    });

    if(paymentProof){
      Object.assign(order,{
        paymentProofId:paymentProof.proofId,
        receiptProofId:paymentProof.proofId,
        receiptStoragePath:paymentProof.r2Key,
        receiptName:paymentProof.name,
        receiptSize:paymentProof.size,
        receiptContentType:paymentProof.type,
        paymentSubmittedAt:now
      });
    }

    await adminSetDocument(env, ["storeOrders", orderId], order);
    if(paymentProof){
      await adminPatchDocument(env,["storePaymentProofs",paymentProof.proofId],{
        attached:true,
        orderId,
        attachedAt:now,
        updatedAt:now
      }).catch(()=>{});
    }
    await adminPatchDocument(env, ["users", user.uid], {
      uid: user.uid,
      email: user.email || "",
      displayName: draft.customerName,
      lastStoreOrderId: orderId,
      lastStoreOrderAt: now,
      updatedAt: now
    });

    let adminMailStatus = "sent";
    let clientMailStatus = "sent";
    let adminMessageId = "";
    let clientMessageId = "";

    const adminAddress =
      validEmail(env.ORDER_NOTIFICATION_EMAIL) ||
      validEmail(env.ZOHO_ORDER_NOTIFICATION_EMAIL) ||
      "evolutiongt01@gmail.com";

    try {
      const sent = await sendStoreOrderMail(env, adminAddress, buildStoreOrderAdminMail(order));
      adminMessageId = sent.messageId || "";
    } catch (error) {
      adminMailStatus = "failed";
      console.error("store/order admin mail", error?.message || error);
    }

    if (user.email) {
      try {
        const sent = await sendStoreOrderMail(env, user.email, buildStoreOrderClientMail(order, false));
        clientMessageId = sent.messageId || "";
      } catch (error) {
        clientMailStatus = "failed";
        console.error("store/order client mail", error?.message || error);
      }
    } else {
      clientMailStatus = "skipped";
    }

    await adminPatchDocument(env, ["storeOrders", orderId], {
      adminNotificationStatus: adminMailStatus,
      adminNotificationMessageId: adminMessageId,
      clientNotificationStatus: clientMailStatus,
      clientNotificationMessageId: clientMessageId,
      updatedAt: new Date()
    }).catch(() => {});

    return json({
      ok: true,
      order: {
        ...order,
        createdAt: new Date(order.createdAt||now).toISOString(),
        updatedAt: new Date(order.updatedAt||now).toISOString()
      },
      adminEmailSent: adminMailStatus === "sent",
      clientEmailSent: clientMailStatus === "sent"
    }, 201, origin);
  } catch (error) {
    const code = String(error?.message || "STORE_ORDER_FAILED");
    const statusMap = {
      AUTH_MISSING: 401,
      AUTH_INVALID: 401,
      RECAPTCHA_TOKEN_MISSING: 400,
      RECAPTCHA_TOKEN_INVALID: 403,
      RECAPTCHA_ACTION_MISMATCH: 403,
      RECAPTCHA_HOSTNAME_INVALID: 403,
      RECAPTCHA_RISK_TOO_HIGH: 403,
      STORE_PRODUCT_UNAVAILABLE: 409,
      STORE_METHOD_INVALID: 400,
      STORE_PHONE_INVALID: 400,
      STORE_NAME_INVALID: 400,
      STORE_RECIPIENT_INVALID: 400,
      STORE_TERMS_REQUIRED: 400,
      STORE_ADDRESS_INCOMPLETE: 400,
      STORE_PAYMENT_REFERENCE_REQUIRED: 400,
      STORE_PAYMENT_RECEIPT_REQUIRED: 400,
      STORE_PROOF_INVALID: 400,
      STORE_PROOF_NOT_FOUND: 400,
      STORE_PROOF_ALREADY_USED: 409,
      STORE_ONLINE_PAYMENT_REQUIRED: 400
    };
    const messages = {
      AUTH_MISSING: "Debes iniciar sesión para realizar el pedido.",
      AUTH_INVALID: "Tu sesión ya no es válida. Inicia sesión nuevamente.",
      RECAPTCHA_TOKEN_MISSING: "No se pudo validar la seguridad del formulario.",
      RECAPTCHA_TOKEN_INVALID: "No se pudo validar la seguridad del formulario.",
      RECAPTCHA_ACTION_MISMATCH: "La validación de seguridad no coincide con esta compra.",
      RECAPTCHA_HOSTNAME_INVALID: "La solicitud no proviene del sitio autorizado.",
      RECAPTCHA_RISK_TOO_HIGH: "No pudimos validar esta solicitud. Intenta nuevamente.",
      STORE_PRODUCT_UNAVAILABLE: "Esta unidad ya fue confirmada para otro pedido.",
      STORE_METHOD_INVALID: "Selecciona un método de pago y entrega válido.",
      STORE_PHONE_INVALID: "Escribe un número de teléfono válido.",
      STORE_NAME_INVALID: "Escribe tu nombre completo.",
      STORE_RECIPIENT_INVALID: "Escribe el nombre de quien recibirá el paquete.",
      STORE_TERMS_REQUIRED: "Confirma que tus datos y el método seleccionado son correctos.",
      STORE_ADDRESS_INCOMPLETE: "Completa Departamento, Municipio/Ciudad, Poblado, dirección y referencia.",
      STORE_PAYMENT_REFERENCE_REQUIRED: "Ingresa la referencia de la transferencia o del pago cripto.",
      STORE_PAYMENT_RECEIPT_REQUIRED: "Adjunta una captura, fotografía o PDF del comprobante.",
      STORE_PROOF_INVALID: "El comprobante enviado no es válido.",
      STORE_PROOF_NOT_FOUND: "No encontramos el comprobante enviado. Vuelve a adjuntarlo.",
      STORE_PROOF_ALREADY_USED: "Ese comprobante ya fue utilizado.",
      STORE_ONLINE_PAYMENT_REQUIRED: "Completa el pago con el botón seguro de PayPal o tarjeta."
    };
    console.error("store/order create", code);
    return json({
      ok: false,
      code,
      error: messages[code] || "No se pudo registrar el pedido."
    }, statusMap[code] || 500, origin);
  }
}

async function mineStoreOrdersRoute(request, env, origin) {
  try {
    const user = await requireFirebaseUser(bearerToken(request));
    const rows = await adminRunQuery(env, {
      from: [{ collectionId: "storeOrders" }],
      where: {
        fieldFilter: {
          field: { fieldPath: "ownerUid" },
          op: "EQUAL",
          value: { stringValue: user.uid }
        }
      },
      limit: 100
    });

    let orders = rows
      .map(normalizeStoreOrder)
      .sort((a, b) => (new Date(b.createdAt || 0).getTime() || 0) - (new Date(a.createdAt || 0).getTime() || 0));

    const nowMs=Date.now();
    const refreshed=[];
    for(const order of orders){
      const last=new Date(order.boxfulLastTrackingAt||0).getTime()||0;
      if(order.boxfulShipmentNumber && nowMs-last>30*60*1000 && refreshed.length<4){
        refreshed.push(order.orderId);
        await boxfulRefreshOrderTracking(env,order).catch(()=>order);
      }
    }
    if(refreshed.length){
      const freshRows=await adminRunQuery(env,{
        from:[{collectionId:"storeOrders"}],
        where:{fieldFilter:{field:{fieldPath:"ownerUid"},op:"EQUAL",value:{stringValue:user.uid}}},
        limit:100
      });
      orders=freshRows.map(normalizeStoreOrder).sort((a,b)=>(new Date(b.createdAt||0).getTime()||0)-(new Date(a.createdAt||0).getTime()||0));
    }

    return json({ ok: true, orders }, 200, origin);
  } catch (error) {
    const code = String(error?.message || "");
    return json({
      ok: false,
      code,
      error: code === "AUTH_MISSING" || code === "AUTH_INVALID"
        ? "Inicia sesión para ver tus pedidos."
        : "No se pudieron cargar tus pedidos."
    }, code === "AUTH_MISSING" || code === "AUTH_INVALID" ? 401 : 500, origin);
  }
}

async function adminStoreOrdersRoute(request, env, origin) {
  try {
    await requireFirebaseAdmin(bearerToken(request));
    const orders = await listStoreOrders(env, 250);
    return json({ ok: true, orders }, 200, origin);
  } catch (error) {
    const code = String(error?.message || "");
    return json({
      ok: false,
      code,
      error: code === "ADMIN_ONLY"
        ? "Solo Administración puede ver todos los pedidos."
        : "Tu sesión administrativa no es válida."
    }, code === "ADMIN_ONLY" ? 403 : 401, origin);
  }
}


const STORE_IMPORT_CARRIERS=new Set(["Cargo Expreso","Forza","Guatex"]);
function normalizeImportCarrier(value){
  const raw=clean(value,100).trim().toLowerCase();
  if(raw==="cargo expreso"||raw==="cargoexpress"||raw==="cargo")return "Cargo Expreso";
  if(raw==="forza")return "Forza";
  if(raw==="guatex")return "Guatex";
  return clean(value,100);
}

function safeStoreTrackingUrl(value) {
  const raw = clean(value, 900);
  if (!raw) return "";
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("STORE_TRACKING_URL_INVALID");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("STORE_TRACKING_URL_INVALID");
  }
  return url.href.slice(0, 900);
}

async function adminUpdateStoreOrderRoute(request, env, origin) {
  try {
    const admin = await requireFirebaseAdmin(bearerToken(request));
    const payload = await request.json().catch(() => ({}));
    const orderId = clean(payload.orderId, 100);
    const status = clean(payload.status, 40).toLowerCase();
    const trackingNumber = clean(payload.trackingNumber, 120);
    const trackingUrl = safeStoreTrackingUrl(payload.trackingUrl || "");
    const carrier = normalizeImportCarrier(payload.carrier);
    const shipmentNotify = payload.shipmentNotify === true;
    const adminNote = clean(payload.adminNote, 600);

    if (!/^EV-(?:IP8|SALE)-[A-Za-z0-9-]{6,80}$/.test(orderId)) throw new Error("STORE_ORDER_ID_INVALID");
    if (!STORE_ORDER_STATUSES.has(status)) throw new Error("STORE_STATUS_INVALID");

    const snap = await adminGetDocument(env, ["storeOrders", orderId], true);
    if (!snap.exists) throw new Error("STORE_ORDER_NOT_FOUND");
    const current = { orderId, ...(snap.data || {}) };

    const imported=current.customsRequired===true||current.importInfo?.originMarket==="usa";
    const importStatus=current.customsStatus||current.importInfo?.status||"available_gt";
    const customsReleased=!imported||["released","available_gt"].includes(importStatus);
    if(imported&&status==="shipped"&&!customsReleased)throw new Error("STORE_CUSTOMS_NOT_RELEASED");
    if(imported&&status==="shipped"){
      if(!STORE_IMPORT_CARRIERS.has(carrier))throw new Error("STORE_IMPORT_CARRIER_INVALID");
      if(trackingNumber.length<3)throw new Error("STORE_TRACKING_REQUIRED");
    }

    if (STORE_BLOCKING_STATUSES.has(status)) {
      let availability;
      if (current.saleSlug) {
        const sale = await loadTemporarySale(env, current.saleSlug, false);
        availability = await temporarySaleAvailability(env, sale, orderId);
      } else {
        availability = await storeAvailability(env, orderId);
      }
      if (!availability.available) throw new Error("STORE_PRODUCT_ALREADY_CONFIRMED");
    }

    const now = new Date();
    const history = Array.isArray(current.statusHistory) ? current.statusHistory.slice(-20) : [];
    const statusChanged = String(current.status || "") !== status;
    const shipmentChanged=imported&&status==="shipped"&&Boolean(trackingNumber)&&((current.trackingNumber||"")!==trackingNumber||(current.carrier||"")!==carrier||String(current.status||"")!=="shipped");
    if (statusChanged) {
      history.push({
        status,
        label: storeStatusLabel(status, current.paymentMethod),
        at: now,
        by: "admin",
        adminEmail: admin.email
      });
    }

    const patch = {
      status,
      statusLabel: storeStatusLabel(status, current.paymentMethod),
      trackingNumber,
      trackingUrl,
      carrier: carrier || current.carrier || storeCarrierForMethod(current.paymentMethod),
      adminNote,
      statusHistory: history,
      updatedAt: now,
      updatedByAdminEmail: admin.email
    };

    if (status === "confirmed" && !current.confirmedAt) patch.confirmedAt = now;
    if(status==="confirmed"&&["transfer_shipping","crypto_binance"].includes(current.paymentMethod)&&String(current.paymentStatus||"")==="pending_review"){patch.paymentStatus="paid";patch.paymentReviewStatus="approved";patch.paymentVerifiedByAdmin=true;patch.paymentVerifiedByAdminEmail=admin.email;patch.paymentVerifiedAt=now;patch.paidAt=now}
    if(status==="cancelled"&&["transfer_shipping","crypto_binance"].includes(current.paymentMethod)&&String(current.paymentStatus||"")==="pending_review"){patch.paymentStatus="rejected";patch.paymentReviewStatus="rejected"}
    if (status === "preparing" && !current.preparingAt) patch.preparingAt = now;
    if (status === "shipped" && !current.shippedAt) patch.shippedAt = now;
    if (status === "delivered" && !current.deliveredAt) patch.deliveredAt = now;
    if (status === "cancelled" && !current.cancelledAt) patch.cancelledAt = now;

    await adminPatchDocument(env, ["storeOrders", orderId], patch);

    let updated = { ...current, ...patch };

    if(status==="confirmed" && !imported && current.paymentMethod==="transfer_shipping" && !current.boxfulShipmentNumber){
      let saleConfig=null;
      if(current.saleSlug) saleConfig=await loadTemporarySale(env,current.saleSlug,false).catch(()=>null);
      updated=await boxfulCreateShipmentSafely(env,updated,{force:true,saleConfig});
    }

    let mailSent=false,shipmentMailSent=false;
    if(shipmentNotify&&shipmentChanged&&current.ownerEmail){
      try{
        const sent=await sendStoreOrderMail(env,current.ownerEmail,buildStoreShipmentOnWayMail(updated));
        shipmentMailSent=true;mailSent=true;
        const mailedAt=new Date();
        await adminPatchDocument(env,["storeOrders",orderId],{lastShipmentMailStatus:"sent",lastShipmentMailMessageId:sent.messageId||"",lastShipmentMailAt:mailedAt,shipmentNotifiedAt:mailedAt});
        updated={...updated,lastShipmentMailStatus:"sent",lastShipmentMailAt:mailedAt,shipmentNotifiedAt:mailedAt};
      }catch(mailError){
        console.error("store/order shipment mail",mailError?.message||mailError);
        await adminPatchDocument(env,["storeOrders",orderId],{lastShipmentMailStatus:"failed",lastShipmentMailAt:new Date()}).catch(()=>{});
      }
    }else if(statusChanged&&current.ownerEmail){
      try{
        const sent=await sendStoreOrderMail(env,current.ownerEmail,buildStoreOrderClientMail(updated,true));
        mailSent=true;
        await adminPatchDocument(env,["storeOrders",orderId],{lastStatusMailStatus:"sent",lastStatusMailMessageId:sent.messageId||"",lastStatusMailAt:new Date()});
      }catch(mailError){
        console.error("store/order status mail",mailError?.message||mailError);
        await adminPatchDocument(env,["storeOrders",orderId],{lastStatusMailStatus:"failed",lastStatusMailAt:new Date()}).catch(()=>{});
      }
    }

    return json({ok:true,order:updated,mailSent,shipmentMailSent},200,origin);
  } catch (error) {
    const code = String(error?.message || "STORE_UPDATE_FAILED");
    const statusMap = {
      AUTH_MISSING: 401,
      AUTH_INVALID: 401,
      ADMIN_ONLY: 403,
      STORE_ORDER_ID_INVALID: 400,
      STORE_STATUS_INVALID: 400,
      STORE_ORDER_NOT_FOUND: 404,
      STORE_PRODUCT_ALREADY_CONFIRMED: 409,
      STORE_TRACKING_URL_INVALID: 400,
      STORE_CUSTOMS_NOT_RELEASED: 409,
      STORE_IMPORT_CARRIER_INVALID: 400,
      STORE_TRACKING_REQUIRED: 400
    };
    const messages = {
      ADMIN_ONLY: "Solo Administración puede actualizar pedidos.",
      STORE_ORDER_ID_INVALID: "El ID del pedido no es válido.",
      STORE_STATUS_INVALID: "Selecciona un estado válido.",
      STORE_ORDER_NOT_FOUND: "No encontramos ese pedido.",
      STORE_PRODUCT_ALREADY_CONFIRMED: "Ya no hay disponibilidad para confirmar este pedido.",
      STORE_TRACKING_URL_INVALID: "El enlace de seguimiento no es válido. Pega una URL completa que empiece con https:// o http://."
    };
    return json({
      ok: false,
      code,
      error: messages[code] || (statusMap[code] === 401 ? "Tu sesión administrativa no es válida." : "No se pudo actualizar el pedido.")
    }, statusMap[code] || 500, origin);
  }
}


// ============================================================================
// PROFILE DATA · FIREBASE USER -> WORKER -> FIRESTORE ADMIN
// Mantiene Firestore Rules cerradas para escritura desde el navegador.
// ============================================================================

function validProfileBirthDate(value) {
  const text = clean(value, 20);
  if (!text) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error("PROFILE_BIRTHDATE_INVALID");

  const [year, month, day] = text.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error("PROFILE_BIRTHDATE_INVALID");
  }

  const now = new Date();
  if (year < 1900 || date > now) throw new Error("PROFILE_BIRTHDATE_INVALID");

  return text;
}

function validProfilePhotoForUser(value, uid, request) {
  const raw = clean(value, 1200);
  if (!raw) return "";

  let url;
  try {
    url = new URL(raw);
  } catch (_) {
    throw new Error("PROFILE_PHOTO_URL_INVALID");
  }

  if (url.protocol !== "https:") throw new Error("PROFILE_PHOTO_URL_INVALID");

  const workerOrigin = new URL(request.url).origin;
  const expectedPath = `/profile/photo/${encodeURIComponent(uid)}`;

  // Las fotos subidas por Evolution deben pertenecer al UID autenticado.
  if (url.origin === workerOrigin) {
    if (url.pathname !== expectedPath) throw new Error("PROFILE_PHOTO_OWNER_MISMATCH");
    return url.toString();
  }

  // Compatibilidad con una foto previa proveniente de Google Auth.
  if (url.hostname === "lh3.googleusercontent.com") {
    return url.toString();
  }

  throw new Error("PROFILE_PHOTO_URL_INVALID");
}

async function updateProfileDataRoute(request, env, origin) {
  try {
    const user = await requireFirebaseUser(bearerToken(request));
    const payload = await request.json().catch(() => ({}));

    const displayName = clean(payload.displayName, 160);
    if (displayName.length < 2) throw new Error("PROFILE_NAME_INVALID");

    const birthDate = validProfileBirthDate(payload.birthDate || "");

    const patch = {
      displayName,
      birthDate,
      profileCompleted: true,
      updatedAt: new Date()
    };

    // Los campos de fotografía solo se aceptan cuando el cliente realmente
    // acaba de subir una nueva foto o necesita conservar una foto Google válida.
    if (payload.photoURL !== undefined) {
      const photoURL = validProfilePhotoForUser(payload.photoURL, user.uid, request);
      patch.photoURL = photoURL;
    }

    if (payload.profilePhotoPath !== undefined) {
      const path = clean(payload.profilePhotoPath, 500);
      const expected = profilePhotoKey(user.uid);
      if (path && path !== expected) throw new Error("PROFILE_PHOTO_PATH_INVALID");
      patch.profilePhotoPath = path;
    }

    if (payload.profilePhotoProvider !== undefined) {
      const provider = clean(payload.profilePhotoProvider, 80);
      if (provider && provider !== "cloudflare-r2-worker") {
        throw new Error("PROFILE_PHOTO_PROVIDER_INVALID");
      }
      patch.profilePhotoProvider = provider;
    }

    const existing = await adminGetDocument(
      env,
      ["users", user.uid],
      true
    );

    if (existing.exists) {
      await adminPatchDocument(
        env,
        ["users", user.uid],
        patch
      );
    } else {
      await adminSetDocument(
        env,
        ["users", user.uid],
        {
          uid: user.uid,
          email: user.email || "",
          ...patch,
          createdAt: new Date()
        }
      );
    }

    return json({
      ok: true,
      uid: user.uid,
      profile: {
        displayName,
        birthDate,
        photoURL: patch.photoURL,
        profilePhotoPath: patch.profilePhotoPath,
        profilePhotoProvider: patch.profilePhotoProvider,
        profileCompleted: true
      }
    }, 200, origin);

  } catch (error) {
    const code = String(error?.message || "PROFILE_UPDATE_FAILED");

    const statusMap = {
      AUTH_MISSING: 401,
      AUTH_INVALID: 401,
      PROFILE_NAME_INVALID: 400,
      PROFILE_BIRTHDATE_INVALID: 400,
      PROFILE_PHOTO_URL_INVALID: 400,
      PROFILE_PHOTO_OWNER_MISMATCH: 403,
      PROFILE_PHOTO_PATH_INVALID: 400,
      PROFILE_PHOTO_PROVIDER_INVALID: 400,
      FIREBASE_SERVICE_ACCOUNT_INCOMPLETE: 503,
      FIREBASE_SERVICE_ACCOUNT_JSON_INVALID: 503,
      FIREBASE_SERVICE_ACCOUNT_PROJECT_MISMATCH: 503,
      FIREBASE_ADMIN_OAUTH_FAILED: 502,
      FIRESTORE_ADMIN_READ_FAILED: 502,
      FIRESTORE_ADMIN_WRITE_FAILED: 502
    };

    const publicMessages = {
      AUTH_MISSING: "Debes iniciar sesión.",
      AUTH_INVALID: "Tu sesión ya no es válida. Inicia sesión nuevamente.",
      PROFILE_NAME_INVALID: "Escribe un nombre válido.",
      PROFILE_BIRTHDATE_INVALID: "La fecha de nacimiento no es válida.",
      PROFILE_PHOTO_URL_INVALID: "La URL de la fotografía no es válida.",
      PROFILE_PHOTO_OWNER_MISMATCH: "La fotografía no pertenece a esta cuenta.",
      PROFILE_PHOTO_PATH_INVALID: "La ruta de la fotografía no es válida.",
      PROFILE_PHOTO_PROVIDER_INVALID: "El proveedor de fotografía no es válido.",
      FIREBASE_SERVICE_ACCOUNT_INCOMPLETE: "Firestore Backend todavía no está configurado.",
      FIREBASE_SERVICE_ACCOUNT_JSON_INVALID: "La cuenta de servicio de Firebase no está configurada correctamente.",
      FIREBASE_SERVICE_ACCOUNT_PROJECT_MISMATCH: "La cuenta de servicio no corresponde a Evolution Design.",
      FIREBASE_ADMIN_OAUTH_FAILED: "No se pudo autenticar el backend con Firestore.",
      FIRESTORE_ADMIN_READ_FAILED: "No se pudo consultar el perfil.",
      FIRESTORE_ADMIN_WRITE_FAILED: "No se pudo guardar el perfil."
    };

    console.error("profile-update", code);

    return json({
      ok: false,
      code,
      error: publicMessages[code] || "No se pudo actualizar el perfil."
    }, statusMap[code] || 500, origin);
  }
}

// ============================================================================
// EVOLUTION ACADEMY · PUBLIC CATALOG + ADMINISTRABLE COURSE CONTENT
// ============================================================================

const ACADEMY_DEFAULT_COURSE = Object.freeze({
  slug: "autocad-intermedio-dibujo-tecnico",
  title: "AutoCAD Intermedio para Estudiantes de Dibujo Técnico",
  shortTitle: "AutoCAD Intermedio",
  description: "Domina herramientas intermedias de AutoCAD y desarrolla planos técnicos con orden, precisión y una metodología profesional.",
  priceUsd: 30,
  level: "Intermedio",
  audience: "Estudiantes de dibujo técnico",
  accessType: "lifetime",
  published: true,
  category: "Diseño técnico",
  instructor: "Evolution Design Academy",
  lessons: [{
    id: "lesson_autocad_01",
    module: "Módulo 1 · Fundamentos intermedios",
    title: "Clase 1 · AutoCAD Intermedio",
    description: "Primera clase del curso. Preparación del entorno y flujo de trabajo para dibujo técnico.",
    youtubeId: "WhYmkWFol2U",
    duration: "",
    freePreview: false,
    assignmentTitle: "Tarea 1 · Reproduce el ejercicio de la clase",
    assignmentInstructions: "Realiza en AutoCAD el mismo ejercicio desarrollado durante la primera clase y sube tu archivo DWG o un PDF con el resultado.",
    published: true,
    sortOrder: 10
  }]
});
const ACADEMY_TEST_COUPON = "EVOLUTION-ACADEMIA-TEST-100";
const ACADEMY_TEST_COUPON_EXPIRES = "2026-09-30T05:59:59.999Z";

function academyCourseSlug(value) {
  return clean(value, 100).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || ACADEMY_DEFAULT_COURSE.slug;
}

function academyYouTubeId(value) {
  const raw = clean(value, 500);
  const direct = raw.match(/^[A-Za-z0-9_-]{11}$/)?.[0];
  if (direct) return direct;
  try {
    const url = new URL(raw);
    const id = url.hostname.includes("youtu.be") ? url.pathname.split("/").filter(Boolean)[0] : url.searchParams.get("v") || url.pathname.match(/\/(?:embed|shorts)\/([A-Za-z0-9_-]{11})/)?.[1];
    return /^[A-Za-z0-9_-]{11}$/.test(String(id || "")) ? id : "";
  } catch (_) { return ""; }
}

function normalizeAcademyCourse(input = {}, existing = ACADEMY_DEFAULT_COURSE) {
  const lessons = (Array.isArray(input.lessons) ? input.lessons : existing.lessons || []).slice(0, 200).map((lesson, index) => ({
    id: clean(lesson?.id, 100).replace(/[^A-Za-z0-9_-]/g, "") || `lesson_${Date.now()}_${index}`,
    module: clean(lesson?.module || `Módulo ${index + 1}`, 180),
    title: clean(lesson?.title || `Clase ${index + 1}`, 220),
    description: clean(lesson?.description, 1200),
    youtubeId: academyYouTubeId(lesson?.youtubeId || lesson?.youtubeUrl),
    duration: clean(lesson?.duration, 40),
    freePreview: lesson?.freePreview === true,
    assignmentTitle: clean(lesson?.assignmentTitle || (index === 0 ? "Tarea 1 · Reproduce el ejercicio de la clase" : `Tarea ${index + 1}`), 220),
    assignmentInstructions: clean(lesson?.assignmentInstructions || (index === 0 ? "Realiza en AutoCAD el mismo ejercicio desarrollado durante la primera clase y sube tu archivo DWG o un PDF con el resultado." : "Completa el ejercicio indicado en la clase y sube tu archivo para revisión."), 1200),
    published: lesson?.published !== false,
    sortOrder: Number.isFinite(Number(lesson?.sortOrder)) ? Number(lesson.sortOrder) : (index + 1) * 10
  })).filter(lesson => lesson.youtubeId).sort((a, b) => a.sortOrder - b.sortOrder);
  return {
    slug: academyCourseSlug(input.slug || existing.slug),
    title: clean(input.title || existing.title, 240),
    shortTitle: clean(input.shortTitle || existing.shortTitle, 100),
    description: clean(input.description || existing.description, 1800),
    priceUsd: Math.max(0, Number(input.priceUsd ?? existing.priceUsd ?? 30)),
    level: clean(input.level || existing.level, 80),
    audience: clean(input.audience || existing.audience, 180),
    accessType: input.accessType === "limited" ? "limited" : "lifetime",
    published: input.published !== false,
    category: clean(input.category || existing.category, 100),
    instructor: clean(input.instructor || existing.instructor, 160),
    lessons
  };
}

async function academyCourseData(env, slug = ACADEMY_DEFAULT_COURSE.slug) {
  const safeSlug = academyCourseSlug(slug);
  const saved = await adminGetDocument(env, ["academyCourses", safeSlug], true);
  return normalizeAcademyCourse(saved.exists ? saved.data : { ...ACADEMY_DEFAULT_COURSE, slug: safeSlug });
}

async function academyPublicCourseRoute(env, origin, url) {
  try {
    const course = await academyCourseData(env, url.searchParams.get("slug"));
    if (!course.published) return json({ ok: false, error: "Curso no disponible." }, 404, origin);
    const lessons = course.lessons.filter(lesson => lesson.published).map(lesson => ({
      id: lesson.id, module: lesson.module, title: lesson.title,
      description: lesson.description, duration: lesson.duration,
      freePreview: lesson.freePreview, published: true, sortOrder: lesson.sortOrder,
      ...(lesson.freePreview ? { youtubeId: lesson.youtubeId } : {})
    }));
    return json({ ok: true, course: { ...course, lessons } }, 200, origin);
  } catch (error) {
    return json({ ok: false, error: "No se pudo cargar la Academia." }, 500, origin);
  }
}

async function academyAdminCourseRoute(request, env, origin, url) {
  try {
    const admin = await requireFirebaseAdmin(bearerToken(request));
    const slug = academyCourseSlug(url.searchParams.get("slug") || ACADEMY_DEFAULT_COURSE.slug);
    if (request.method === "GET") return json({ ok: true, course: await academyCourseData(env, slug) }, 200, origin);
    const payload = await request.json().catch(() => ({}));
    const existing = await academyCourseData(env, slug);
    const course = normalizeAcademyCourse(payload.course || payload, existing);
    await adminSetDocument(env, ["academyCourses", course.slug], { ...course, updatedAt: new Date().toISOString(), updatedBy: admin.email });
    return json({ ok: true, course }, 200, origin);
  } catch (error) {
    const code = String(error?.message || "ACADEMY_ADMIN_FAILED");
    const status = ["AUTH_MISSING", "AUTH_INVALID"].includes(code) ? 401 : code === "ADMIN_ONLY" ? 403 : 500;
    return json({ ok: false, code, error: status === 403 ? "Solo administración puede editar la Academia." : "No se pudo guardar el curso." }, status, origin);
  }
}

function academyEnrollmentId(slug, uid) { return `${academyCourseSlug(slug)}__${clean(uid, 160)}`; }
function academySubmissionId(slug, uid, lessonId) { return `${academyCourseSlug(slug)}__${clean(uid, 160)}__${clean(lessonId, 100)}`; }
async function academyActor(request) { const user = await requireFirebaseUser(bearerToken(request)); return projectFileActor(user); }
async function requireAcademyEnrollment(env, actor, slug) {
  if (actor.isAdmin) return { active: true, admin: true };
  const snap = await adminGetDocument(env, ["academyEnrollments", academyEnrollmentId(slug, actor.uid)], true);
  if (!snap.exists || !["active", "completed"].includes(String(snap.data?.status || ""))) throw new Error("ACADEMY_ENROLLMENT_REQUIRED");
  return snap.data;
}
async function academyProgress(env, uid, course) {
  const submissions = [];
  for (const lesson of course.lessons) {
    const snap = await adminGetDocument(env, ["users", uid, "academySubmissions", `${course.slug}__${lesson.id}`], true);
    submissions.push(snap.exists ? snap.data : null);
  }
  return submissions;
}
async function academyStudentCourseRoute(request, env, origin, url) {
  try {
    const actor = await academyActor(request), course = await academyCourseData(env, url.searchParams.get("slug"));
    await requireAcademyEnrollment(env, actor, course.slug);
    const submissions = actor.isAdmin ? [] : await academyProgress(env, actor.uid, course);
    const lessons = course.lessons.map((lesson, index) => {
      const previousApproved = index === 0 || actor.isAdmin || submissions[index - 1]?.status === "approved";
      const submission = submissions[index] || null;
      return { ...lesson, youtubeId: previousApproved ? lesson.youtubeId : "", unlocked: previousApproved, submission: submission ? { status: submission.status, feedback: submission.feedback || "", grade: submission.grade ?? null, submittedAt: submission.submittedAt || "", fileName: submission.fileName || "" } : null };
    });
    const diplomaEligible = actor.isAdmin || (lessons.length > 0 && submissions.length === lessons.length && submissions.every(item => item?.status === "approved"));
    return json({ ok: true, course: { ...course, lessons }, diplomaEligible, admin: actor.isAdmin }, 200, origin);
  } catch (error) {
    const code = String(error?.message || "ACADEMY_STUDENT_FAILED"), status = code.includes("AUTH") ? 401 : code === "ACADEMY_ENROLLMENT_REQUIRED" ? 403 : 500;
    return json({ ok: false, code, error: status === 403 ? "Necesitas una inscripción activa para acceder al curso." : "No se pudo cargar tu aula." }, status, origin);
  }
}
async function academySubmissionUploadRoute(request, env, origin, url) {
  try {
    if (!env.PROFILE_R2) throw new Error("R2_BINDING_MISSING");
    const actor = await academyActor(request), slug = academyCourseSlug(url.searchParams.get("slug")), lessonId = clean(url.searchParams.get("lessonId"), 100);
    await requireAcademyEnrollment(env, actor, slug);
    const course = await academyCourseData(env, slug), index = course.lessons.findIndex(item => item.id === lessonId);
    if (index < 0) throw new Error("ACADEMY_LESSON_INVALID");
    if (!actor.isAdmin && index > 0) { const prev = await adminGetDocument(env, ["users", actor.uid, "academySubmissions", `${slug}__${course.lessons[index - 1].id}`], true); if (!prev.exists || prev.data?.status !== "approved") throw new Error("ACADEMY_LESSON_LOCKED"); }
    const fileName = safeProjectFilePart(url.searchParams.get("fileName") || "tarea"), contentType = clean((request.headers.get("content-type") || "application/octet-stream").split(";")[0], 160).toLowerCase(), size = Number(request.headers.get("content-length") || 0);
    if (size > 100 * 1024 * 1024) throw new Error("R2_FILE_TOO_LARGE");
    if (["text/html", "application/xhtml+xml", "image/svg+xml"].includes(contentType)) throw new Error("R2_TYPE_INVALID");
    const key = `academy/${slug}/${actor.uid}/${lessonId}/${crypto.randomUUID()}-${fileName}`;
    await env.PROFILE_R2.put(key, request.body, { httpMetadata: { contentType, cacheControl: "private, no-store" }, customMetadata: { ownerUid: actor.uid, courseSlug: slug, lessonId, uploadedAt: new Date().toISOString() } });
    const now = new Date().toISOString(), record = { id: academySubmissionId(slug, actor.uid, lessonId), ownerUid: actor.uid, ownerEmail: actor.email || "", courseSlug: slug, courseTitle: course.title, lessonId, lessonTitle: course.lessons[index].title, fileKey: key, fileName, contentType, size: size || null, status: "pending_review", grade: null, feedback: "", submittedAt: now, updatedAt: now };
    await Promise.all([adminSetDocument(env, ["academySubmissions", record.id], record), adminSetDocument(env, ["users", actor.uid, "academySubmissions", `${slug}__${lessonId}`], record)]);
    return json({ ok: true, submission: { status: record.status, fileName, submittedAt: now } }, 200, origin);
  } catch (error) { return projectFileErrorResponse(error, origin); }
}
async function academySubmissionObjectRoute(request, env, origin, url) {
  try { if (!env.PROFILE_R2) throw new Error("R2_BINDING_MISSING"); const actor = await academyActor(request), key = clean(url.searchParams.get("key"), 1200); if (!key.startsWith("academy/") || key.includes("..")) throw new Error("R2_KEY_INVALID"); const parts = key.split("/"); if (!actor.isAdmin && parts[2] !== actor.uid) throw new Error("R2_OWNER_MISMATCH"); const object = await env.PROFILE_R2.get(key); if (!object) throw new Error("R2_OBJECT_NOT_FOUND"); const headers = new Headers(corsHeaders(origin)); object.writeHttpMetadata(headers); headers.set("cache-control", "private, no-store"); headers.set("content-disposition", `attachment; filename*=UTF-8''${encodeURIComponent(safeProjectFilePart(url.searchParams.get("fileName") || key.split("/").pop()))}`); return new Response(object.body, { status: 200, headers }); } catch (error) { return projectFileErrorResponse(error, origin); }
}
async function academyAdminSubmissionsRoute(request, env, origin) {
  try { await requireFirebaseAdmin(bearerToken(request)); const rows = await adminRunQuery(env, { from: [{ collectionId: "academySubmissions" }], orderBy: [{ field: { fieldPath: "submittedAt" }, direction: "DESCENDING" }], limit: 200 }); return json({ ok: true, submissions: rows.map(row => row.data) }, 200, origin); } catch (error) { return json({ ok: false, error: "No se pudieron cargar las tareas." }, 403, origin); }
}
async function academyGradeSubmissionRoute(request, env, origin) {
  try { const admin = await requireFirebaseAdmin(bearerToken(request)), payload = await request.json().catch(() => ({})), id = clean(payload.id, 500); const snap = await adminGetDocument(env, ["academySubmissions", id], true); if (!snap.exists) throw new Error("NOT_FOUND"); const record = snap.data, status = payload.status === "approved" ? "approved" : "changes_requested", patch = { status, grade: Math.max(0, Math.min(100, Number(payload.grade || 0))), feedback: clean(payload.feedback, 1200), gradedAt: new Date().toISOString(), gradedBy: admin.email || "admin", updatedAt: new Date().toISOString() }; await Promise.all([adminPatchDocument(env, ["academySubmissions", id], patch), adminPatchDocument(env, ["users", record.ownerUid, "academySubmissions", `${record.courseSlug}__${record.lessonId}`], patch)]); return json({ ok: true, status }); } catch (error) { return json({ ok: false, error: "No se pudo guardar la calificación." }, 400, origin); }
}
async function academyAdminEnrollmentsRoute(request, env, origin) {
  try {
    const admin = await requireFirebaseAdmin(bearerToken(request));
    if (request.method === "GET") { const rows = await adminRunQuery(env, { from: [{ collectionId: "academyEnrollments" }], orderBy: [{ field: { fieldPath: "createdAt" }, direction: "DESCENDING" }], limit: 300 }); return json({ ok: true, enrollments: rows.map(row => row.data) }, 200, origin); }
    const payload = await request.json().catch(() => ({})), email = validEmail(payload.email), slug = academyCourseSlug(payload.slug || ACADEMY_DEFAULT_COURSE.slug);
    let uid = clean(payload.uid, 160);
    if (!validFirebaseUid(uid) && email) { const matches = await adminRunQuery(env, { from: [{ collectionId: "users" }], where: { fieldFilter: { field: { fieldPath: "email" }, op: "EQUAL", value: { stringValue: email } } }, limit: 1 }); uid = clean(matches[0]?.id || matches[0]?.data?.uid, 160); }
    if (!validFirebaseUid(uid)) throw new Error("ACADEMY_STUDENT_NOT_FOUND");
    const now = new Date().toISOString(), record = { id: academyEnrollmentId(slug, uid), uid, email: email || "", courseSlug: slug, status: payload.status === "completed" ? "completed" : "active", source: "admin", createdAt: now, updatedAt: now, createdBy: admin.email || "admin" };
    await adminSetDocument(env, ["academyEnrollments", record.id], record);
    return json({ ok: true, enrollment: record }, 200, origin);
  } catch (error) { return json({ ok: false, code: String(error?.message || "ACADEMY_ENROLL_FAILED"), error: "No se pudo inscribir al alumno. Verifica que ya tenga una cuenta." }, 400, origin); }
}
async function academyCouponRedeemRoute(request, env, origin) {
  try {
    const user = await requireFirebaseUser(bearerToken(request)), payload = await request.json().catch(() => ({}));
    const code = clean(payload.code, 80).toUpperCase(), slug = academyCourseSlug(payload.slug || ACADEMY_DEFAULT_COURSE.slug);
    if (code !== ACADEMY_TEST_COUPON || Date.now() > Date.parse(ACADEMY_TEST_COUPON_EXPIRES)) throw new Error("ACADEMY_COUPON_INVALID");
    const already = await adminGetDocument(env, ["academyCouponRedemptions", user.uid], true);
    if (already.exists) throw new Error("ACADEMY_COUPON_ALREADY_USED");
    const used = await adminRunQuery(env, { from: [{ collectionId: "academyCouponRedemptions" }], where: { fieldFilter: { field: { fieldPath: "code" }, op: "EQUAL", value: { stringValue: ACADEMY_TEST_COUPON } } }, limit: 4 });
    if (used.length >= 3) throw new Error("ACADEMY_COUPON_LIMIT_REACHED");
    const now = new Date().toISOString(), enrollment = { id: academyEnrollmentId(slug, user.uid), uid: user.uid, email: user.email || "", courseSlug: slug, status: "active", source: "temporary_test_coupon", paidUsd: 0, createdAt: now, updatedAt: now };
    await Promise.all([adminSetDocument(env, ["academyEnrollments", enrollment.id], enrollment), adminSetDocument(env, ["academyCouponRedemptions", user.uid], { uid: user.uid, email: user.email || "", code: ACADEMY_TEST_COUPON, courseSlug: slug, redeemedAt: now })]);
    return json({ ok: true, enrollment, message: "Curso desbloqueado gratuitamente para pruebas." }, 200, origin);
  } catch (error) {
    const code = String(error?.message || "ACADEMY_COUPON_FAILED"), messages = { ACADEMY_COUPON_INVALID: "El cupón no es válido o ya venció.", ACADEMY_COUPON_ALREADY_USED: "Esta cuenta ya utilizó el cupón de prueba.", ACADEMY_COUPON_LIMIT_REACHED: "El cupón temporal alcanzó su límite de usos." };
    return json({ ok: false, code, error: messages[code] || "No se pudo aplicar el cupón." }, 400, origin);
  }
}

// ============================================================================
// PROJECT FILES · FIREBASE AUTH -> CLOUDFLARE WORKER -> R2
// Uses the existing PROFILE_R2 binding. No R2 credential reaches the browser.
// ============================================================================

const PROJECT_FILE_PREFIX = "projects/";
const PROJECT_FILE_USER_MAX_BYTES = 100 * 1024 * 1024;
const PROJECT_FILE_ADMIN_MAX_BYTES = 500 * 1024 * 1024;
const PROJECT_FILE_FOLDERS = new Set(["client", "delivery", "payment", "client-preview"]);

function safeProjectFilePart(value, max = 180) {
  return clean(value, max).replace(/[\\/]+/g, "_").replace(/[^A-Za-z0-9._() -]/g, "_").replace(/^\.+/, "") || "archivo";
}

function validProjectFileId(value) {
  return /^[A-Za-z0-9_-]{6,180}$/.test(String(value || ""));
}

function parseProjectFileKey(key) {
  const value = clean(key, 1200);
  if (!value.startsWith(PROJECT_FILE_PREFIX) || value.includes("..") || value.includes("\\")) return null;
  const parts = value.split("/");
  if (parts.length < 5 || parts[0] !== "projects") return null;
  const [, ownerUid, projectId, folder] = parts;
  if (!validFirebaseUid(ownerUid) || !validProjectFileId(projectId) || !PROJECT_FILE_FOLDERS.has(folder)) return null;
  return { key: value, ownerUid, projectId, folder };
}

function projectFileActor(user) {
  return { ...user, isAdmin: Boolean(user?.email && ADMIN_EMAILS.has(String(user.email).toLowerCase())) };
}

function requireProjectFileAccess(actor, parsed, { adminOnly = false } = {}) {
  if (!parsed) throw new Error("R2_KEY_INVALID");
  if (adminOnly && !actor.isAdmin) throw new Error("ADMIN_ONLY");
  if (!actor.isAdmin && parsed.ownerUid !== actor.uid) throw new Error("R2_OWNER_MISMATCH");
}

function projectFileErrorResponse(error, origin) {
  const code = String(error?.message || "R2_OPERATION_FAILED");
  const status = code === "AUTH_MISSING" || code === "AUTH_INVALID" ? 401
    : code === "ADMIN_ONLY" || code === "R2_OWNER_MISMATCH" ? 403
    : code === "R2_OBJECT_NOT_FOUND" ? 404
    : code === "R2_FILE_TOO_LARGE" ? 413
    : code === "R2_TYPE_INVALID" ? 415
    : code === "R2_BINDING_MISSING" ? 503
    : code === "R2_KEY_INVALID" || code === "R2_FILE_EMPTY" ? 400 : 500;
  const messages = {
    AUTH_MISSING: "Tu sesión ya no está activa.", AUTH_INVALID: "Tu sesión no es válida.",
    ADMIN_ONLY: "Esta operación requiere acceso administrativo.",
    R2_OWNER_MISMATCH: "No tienes permiso para acceder a este archivo.",
    R2_OBJECT_NOT_FOUND: "El archivo ya no está disponible.",
    R2_FILE_TOO_LARGE: "El archivo supera el tamaño permitido.",
    R2_TYPE_INVALID: "El tipo de archivo no está permitido.",
    R2_BINDING_MISSING: "R2 todavía no está conectado al Worker.",
    R2_KEY_INVALID: "La ruta del archivo no es válida.", R2_FILE_EMPTY: "El archivo está vacío."
  };
  console.error("project-file", code);
  return json({ ok: false, code, error: messages[code] || "No se pudo completar la operación de archivos." }, status, origin);
}

async function projectFileUploadRoute(request, env, origin, url) {
  try {
    if (!env.PROFILE_R2) throw new Error("R2_BINDING_MISSING");
    const actor = projectFileActor(await requireFirebaseUser(bearerToken(request)));
    const ownerUid = clean(url.searchParams.get("ownerUid") || actor.uid, 160);
    const projectId = clean(url.searchParams.get("projectId"), 180);
    const folder = clean(url.searchParams.get("folder"), 40);
    const fileId = clean(url.searchParams.get("fileId"), 180);
    const fileName = safeProjectFilePart(url.searchParams.get("fileName") || "archivo");
    if (!validFirebaseUid(ownerUid) || !validProjectFileId(projectId) || !validProjectFileId(fileId) || !PROJECT_FILE_FOLDERS.has(folder)) throw new Error("R2_KEY_INVALID");
    const key = `${PROJECT_FILE_PREFIX}${ownerUid}/${projectId}/${folder}/${fileId}/${fileName}`;
    const parsed = parseProjectFileKey(key);
    requireProjectFileAccess(actor, parsed);
    const contentType = clean((request.headers.get("content-type") || "application/octet-stream").split(";")[0], 160).toLowerCase();
    if (["text/html", "application/xhtml+xml", "image/svg+xml"].includes(contentType)) throw new Error("R2_TYPE_INVALID");
    const declaredLength = Number(request.headers.get("content-length") || 0);
    const maxBytes = actor.isAdmin ? PROJECT_FILE_ADMIN_MAX_BYTES : PROJECT_FILE_USER_MAX_BYTES;
    if (declaredLength > maxBytes) throw new Error("R2_FILE_TOO_LARGE");
    if (declaredLength === 0 && !request.body) throw new Error("R2_FILE_EMPTY");
    await env.PROFILE_R2.put(key, request.body, {
      httpMetadata: { contentType: contentType || "application/octet-stream", cacheControl: "private, no-store" },
      customMetadata: { ownerUid, projectId, folder, uploadedByUid: actor.uid, uploadedByEmail: actor.email || "", uploadedAt: new Date().toISOString() }
    });
    return json({ ok: true, storagePath: key, fileId, name: fileName, size: declaredLength || null, contentType }, 200, origin);
  } catch (error) { return projectFileErrorResponse(error, origin); }
}

async function projectFileGetRoute(request, env, origin, url) {
  try {
    if (!env.PROFILE_R2) throw new Error("R2_BINDING_MISSING");
    const actor = projectFileActor(await requireFirebaseUser(bearerToken(request)));
    const parsed = parseProjectFileKey(url.searchParams.get("key"));
    requireProjectFileAccess(actor, parsed);
    const object = await env.PROFILE_R2.get(parsed.key);
    if (!object) throw new Error("R2_OBJECT_NOT_FOUND");
    const headers = new Headers(corsHeaders(origin));
    object.writeHttpMetadata(headers);
    headers.set("cache-control", "private, no-store");
    headers.set("x-content-type-options", "nosniff");
    if (object.httpEtag || object.etag) headers.set("etag", object.httpEtag || object.etag);
    if (url.searchParams.get("download") === "1") {
      const name = safeProjectFilePart(url.searchParams.get("fileName") || parsed.key.split("/").pop() || "archivo");
      headers.set("content-disposition", `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
    }
    return new Response(object.body, { status: 200, headers });
  } catch (error) { return projectFileErrorResponse(error, origin); }
}

async function projectFileDeleteRoute(request, env, origin) {
  try {
    if (!env.PROFILE_R2) throw new Error("R2_BINDING_MISSING");
    const actor = projectFileActor(await requireFirebaseUser(bearerToken(request)));
    const payload = await request.json().catch(() => ({}));
    const parsed = parseProjectFileKey(payload.key);
    requireProjectFileAccess(actor, parsed);
    await env.PROFILE_R2.delete(parsed.key);
    return json({ ok: true, deleted: true, storagePath: parsed.key }, 200, origin);
  } catch (error) { return projectFileErrorResponse(error, origin); }
}

async function projectFileDeletePrefixRoute(request, env, origin) {
  try {
    if (!env.PROFILE_R2) throw new Error("R2_BINDING_MISSING");
    const actor = projectFileActor(await requireFirebaseUser(bearerToken(request)));
    if (!actor.isAdmin) throw new Error("ADMIN_ONLY");
    const payload = await request.json().catch(() => ({}));
    const ownerUid = clean(payload.ownerUid, 160), projectId = clean(payload.projectId, 180);
    if (!validFirebaseUid(ownerUid) || !validProjectFileId(projectId)) throw new Error("R2_KEY_INVALID");
    const prefix = `${PROJECT_FILE_PREFIX}${ownerUid}/${projectId}/`;
    let cursor, deleted = 0;
    do {
      const listed = await env.PROFILE_R2.list({ prefix, cursor, limit: 1000 });
      const keys = (listed.objects || []).map(object => object.key).filter(key => parseProjectFileKey(key));
      if (keys.length) await env.PROFILE_R2.delete(keys);
      deleted += keys.length;
      cursor = listed.truncated ? listed.cursor : undefined;
    } while (cursor);
    return json({ ok: true, deleted, prefix }, 200, origin);
  } catch (error) { return projectFileErrorResponse(error, origin); }
}

// ============================================================================
// PROFILE PHOTO · FIREBASE AUTH -> CLOUDFLARE WORKER -> R2
// Binding requerido en Cloudflare: PROFILE_R2
// ============================================================================

const PROFILE_PHOTO_MAX_BYTES = 2 * 1024 * 1024;
const PROFILE_PHOTO_PREFIX = "profilePhotos/";

function profilePhotoKey(uid) {
  return `${PROFILE_PHOTO_PREFIX}${uid}/avatar.jpg`;
}

function validFirebaseUid(uid) {
  return /^[A-Za-z0-9_-]{6,160}$/.test(String(uid || ""));
}

async function uploadProfilePhotoRoute(request, env, origin) {
  try {
    if (!env.PROFILE_R2) {
      return json({
        ok: false,
        code: "R2_BINDING_MISSING",
        error: "R2 todavía no está conectado al Worker."
      }, 503, origin);
    }

    const user = await requireFirebaseUser(bearerToken(request));

    const contentType = String(
      request.headers.get("content-type") || ""
    ).split(";")[0].trim().toLowerCase();

    if (contentType !== "image/jpeg") {
      return json({
        ok: false,
        code: "PHOTO_TYPE_INVALID",
        error: "La fotografía debe enviarse como JPEG."
      }, 415, origin);
    }

    const declaredLength = Number(
      request.headers.get("content-length") || 0
    );

    if (declaredLength && declaredLength > PROFILE_PHOTO_MAX_BYTES) {
      return json({
        ok: false,
        code: "PHOTO_TOO_LARGE",
        error: "La fotografía supera el máximo permitido."
      }, 413, origin);
    }

    const bytes = await request.arrayBuffer();

    if (!bytes.byteLength || bytes.byteLength > PROFILE_PHOTO_MAX_BYTES) {
      return json({
        ok: false,
        code: "PHOTO_TOO_LARGE",
        error: "La fotografía está vacía o supera el máximo permitido."
      }, 413, origin);
    }

    const key = profilePhotoKey(user.uid);
    const uploadedAt = new Date().toISOString();

    await env.PROFILE_R2.put(key, bytes, {
      httpMetadata: {
        contentType: "image/jpeg",
        cacheControl: "public, max-age=3600, stale-while-revalidate=86400"
      },
      customMetadata: {
        uid: user.uid,
        email: user.email || "",
        uploadedAt,
        provider: "evolution-profile"
      }
    });

    const publicPath =
      `/profile/photo/${encodeURIComponent(user.uid)}`;

    const photoURL =
      `${new URL(publicPath, request.url).toString()}?v=${Date.now()}`;

    return json({
      ok: true,
      provider: "cloudflare-r2-worker",
      path: key,
      photoURL,
      bytes: bytes.byteLength,
      contentType: "image/jpeg"
    }, 200, origin);

  } catch (error) {
    const code = String(error?.message || "PROFILE_PHOTO_UPLOAD_FAILED");

    const status =
      code === "AUTH_MISSING" || code === "AUTH_INVALID"
        ? 401
        : 500;

    console.error("profile-photo-upload", code);

    return json({
      ok: false,
      code,
      error:
        status === 401
          ? "Tu sesión no es válida. Inicia sesión nuevamente."
          : "No se pudo guardar la fotografía en R2."
    }, status, origin);
  }
}

async function getProfilePhotoRoute(request, env, uid) {
  if (!env.PROFILE_R2 || !validFirebaseUid(uid)) {
    return new Response("Not found", { status: 404 });
  }

  const key = profilePhotoKey(uid);
  const object = await env.PROFILE_R2.get(key);

  if (!object) {
    return new Response("Not found", { status: 404 });
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);

  if (object.httpEtag || object.etag) {
    headers.set("etag", object.httpEtag || object.etag);
  }

  headers.set(
    "cache-control",
    "public, max-age=3600, stale-while-revalidate=86400"
  );
  headers.set("x-content-type-options", "nosniff");
  headers.set("cross-origin-resource-policy", "cross-origin");

  return new Response(object.body, { headers });
}

// ============================================================================
// EVOLUTION PRESENCE · LIVE VISITORS + APPROXIMATE CLOUDFLARE GEO · v1
// Raw IP is NEVER stored. Only a salted SHA-256 hash is persisted.
// ============================================================================
function evolutionCountryName(code) {
  const cc = clean(code || "", 4).toUpperCase();
  if (!cc) return "";
  try { return new Intl.DisplayNames(["es"], { type: "region" }).of(cc) || cc; }
  catch (_) { return cc; }
}

function presenceGeo(request) {
  const cf = request?.cf || {};
  const countryCode = clean(cf.country || request.headers.get("cf-ipcountry") || "", 4).toUpperCase();
  const lat = Number(cf.latitude), lng = Number(cf.longitude);
  return {
    countryCode,
    country: evolutionCountryName(countryCode),
    city: clean(cf.city || "", 120),
    region: clean(cf.region || "", 120),
    regionCode: clean(cf.regionCode || "", 20),
    timezone: clean(cf.timezone || "", 80),
    latitude: Number.isFinite(lat) && lat >= -90 && lat <= 90 ? lat : null,
    longitude: Number.isFinite(lng) && lng >= -180 && lng <= 180 ? lng : null
  };
}

async function presenceIpHash(request, env) {
  const ip = clean(request.headers.get("cf-connecting-ip") || "", 120);
  if (!ip) return "";
  const salt = String(env.PRESENCE_HASH_SECRET || env.FIREBASE_SERVICE_ACCOUNT_EMAIL || "evolution-presence-v1");
  const bytes = new TextEncoder().encode(`${salt}|${ip}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 40);
}

function presenceVisitorId(value) {
  const id = clean(value, 100).replace(/[^A-Za-z0-9_-]/g, "");
  if (id.length < 12) throw new Error("PRESENCE_VISITOR_INVALID");
  return id;
}
function presenceSessionId(value) {
  const id = clean(value, 100).replace(/[^A-Za-z0-9_-]/g, "");
  if (id.length < 12) throw new Error("PRESENCE_SESSION_INVALID");
  return id;
}
function presenceDateMs(value) {
  const ms = new Date(value || 0).getTime();
  return Number.isFinite(ms) ? ms : 0;
}
function presenceJourney(source) {
  return (Array.isArray(source) ? source : []).slice(-50).map(item => ({
    path: clean(item?.path || "", 500),
    title: clean(item?.title || "Evolution Design", 180),
    enteredAt: item?.enteredAt || item?.firstSeenAt || null,
    lastSeenAt: item?.lastSeenAt || null,
    activeMs: Math.max(0, Math.min(24 * 60 * 60 * 1000, Number(item?.activeMs || 0))),
    visits: Math.max(1, Math.min(999, Number(item?.visits || 1)))
  })).filter(item => item.path);
}
function presenceGeoUseful(geo = {}) {
  return Boolean(geo.countryCode || geo.country || geo.city || Number.isFinite(Number(geo.latitude)));
}

async function presenceHeartbeatRoute(request, env, origin) {
  try {
    const body = await request.json().catch(() => ({}));
    const visitorId = presenceVisitorId(body.visitorId || "");
    const sessionId = presenceSessionId(body.sessionId || body.visitorId || "");
    let user = null;
    const token = bearerToken(request);
    if (token) user = await requireFirebaseUser(token).catch(() => null);

    const now = new Date(), nowMs = now.getTime();
    const path = clean(body.path || "", 500);
    const title = clean(body.title || "Evolution Design", 180);
    const reason = clean(body.reason || "heartbeat", 40);
    const docId = `session_${sessionId}`.slice(0, 180);
    const existingSnap = await adminGetDocument(env, ["presence", docId], true).catch(() => ({ exists:false, data:{} }));
    const prev = existingSnap.exists ? (existingSnap.data || {}) : {};
    const prevLastMs = presenceDateMs(prev.lastSeenAt || prev.updatedAt);
    const elapsed = prevLastMs && nowMs >= prevLastMs ? nowMs - prevLastMs : 0;
    const deltaMs = elapsed > 0 && elapsed <= 90_000 ? Math.min(elapsed, 45_000) : 0;

    const geoNow = presenceGeo(request);
    const geo = presenceGeoUseful(geoNow) ? geoNow : (prev.geo && typeof prev.geo === "object" ? prev.geo : geoNow);
    const isAdminNow = Boolean(user?.email && ADMIN_EMAILS.has(user.email));
    const authenticated = Boolean(user?.uid) || prev.authenticated === true;
    const isAdmin = isAdminNow || prev.isAdmin === true;
    const uid = user?.uid || clean(prev.uid || "", 180);
    const email = user?.email || validEmail(prev.email) || "";
    const displayName = user?.displayName || clean(prev.displayName || "", 160);

    const journey = presenceJourney(prev.journey);
    if (journey.length && deltaMs) {
      const last = journey[journey.length - 1];
      last.activeMs = Math.max(0, Number(last.activeMs || 0)) + deltaMs;
      last.lastSeenAt = now;
    }
    if (path) {
      const last = journey[journey.length - 1];
      if (!last || last.path !== path) {
        journey.push({ path, title, enteredAt: now, lastSeenAt: now, activeMs: 0, visits: 1 });
      } else {
        last.title = title || last.title;
        last.lastSeenAt = now;
        last.visits = Math.max(1, Number(last.visits || 1));
      }
    }
    while (journey.length > 50) journey.shift();

    const totalActiveMs = Math.max(0, Number(prev.totalActiveMs || 0)) + deltaMs;
    const uniquePages = [...new Set(journey.map(item => item.path).filter(Boolean))].length;
    const presence = {
      visitorId, sessionId, uid, email, displayName,
      authenticated,
      wasAnonymous: prev.wasAnonymous === true || !user?.uid,
      isAdmin,
      path, title,
      referrer: clean(prev.referrer || body.referrer || "", 500),
      lastReferrer: clean(body.referrer || prev.lastReferrer || "", 500),
      device: clean(body.device || prev.device || "Web", 50),
      browser: clean(body.browser || prev.browser || "", 80),
      os: clean(body.os || prev.os || "", 50),
      standalone: body.standalone === true || prev.standalone === true,
      language: clean(body.language || prev.language || "", 30),
      reason,
      visible: body.visible !== false,
      geo,
      ipHash: await presenceIpHash(request, env) || clean(prev.ipHash || "", 80),
      startedAt: prev.startedAt || prev.createdAt || now,
      lastSeenAt: now,
      totalActiveMs,
      pageViews: journey.length,
      uniquePages,
      journey,
      createdAt: prev.createdAt || now,
      updatedAt: now
    };
    await adminSetDocument(env, ["presence", docId], presence);

    if (user?.uid) {
      await adminPatchDocument(env, ["users", user.uid], {
        uid: user.uid,
        email: user.email || "",
        displayName: user.displayName || "",
        lastGeo: geo,
        lastSeenAt: now,
        lastPresencePath: path,
        lastPresenceDevice: presence.device,
        lastPresenceBrowser: presence.browser,
        lastPresenceOS: presence.os,
        lastPresenceSessionId: sessionId,
        updatedAt: now
      }).catch(() => {});
    }

    return json({ ok:true, tracked:true, sessionId, authenticated, ghost:!authenticated, totalActiveMs, pageViews:journey.length }, 200, origin);
  } catch (error) {
    const code = String(error?.message || "");
    const bad = code === "PRESENCE_VISITOR_INVALID" || code === "PRESENCE_SESSION_INVALID";
    console.error("Evolution presence heartbeat", code || error);
    return json({ ok:false, code, error:"Presence unavailable" }, bad ? 400 : 500, origin);
  }
}

async function adminPresenceRoute(request, env, origin) {
  try {
    await requireFirebaseAdmin(bearerToken(request));
    const rows = await adminRunQuery(env, { from:[{ collectionId:"presence" }], limit:700 }).catch(() => []);
    const now = Date.now();
    const sessions = rows.map(row => {
      const p = row.data || {};
      const last = presenceDateMs(p.lastSeenAt || p.updatedAt);
      const started = presenceDateMs(p.startedAt || p.createdAt);
      const journey = presenceJourney(p.journey);
      const authenticated = p.authenticated === true || Boolean(clean(p.uid || "", 180));
      return {
        id: row.id,
        visitorId: clean(p.visitorId || "", 100),
        sessionId: clean(p.sessionId || row.id.replace(/^session_/, ""), 100),
        uid: clean(p.uid || "", 180),
        email: validEmail(p.email) || "",
        displayName: clean(p.displayName || "", 160),
        authenticated,
        ghost: !authenticated,
        wasAnonymous: p.wasAnonymous === true,
        isAdmin: p.isAdmin === true,
        path: clean(p.path || journey[journey.length-1]?.path || "", 500),
        title: clean(p.title || journey[journey.length-1]?.title || "", 180),
        device: clean(p.device || "", 50),
        browser: clean(p.browser || "", 80),
        os: clean(p.os || "", 50),
        standalone: p.standalone === true,
        language: clean(p.language || "", 30),
        geo: p.geo && typeof p.geo === "object" ? p.geo : {},
        ipHash: clean(p.ipHash || "", 80),
        startedAt: p.startedAt || p.createdAt || null,
        lastSeenAt: p.lastSeenAt || p.updatedAt || null,
        durationMs: Math.max(0, Number(p.totalActiveMs || 0)),
        pageViews: Math.max(journey.length, Number(p.pageViews || 0)),
        uniquePages: Math.max(0, Number(p.uniquePages || 0)),
        journey,
        online: last > 0 && now - last <= 75_000,
        ageMs: last ? now - last : null,
        sessionAgeMs: started ? now - started : null
      };
    }).filter(p => {
      const last = presenceDateMs(p.lastSeenAt);
      return last && now - last <= 7 * 24 * 60 * 60 * 1000;
    }).sort((a,b) => presenceDateMs(b.lastSeenAt) - presenceDateMs(a.lastSeenAt)).slice(0, 350);

    const publicSessions = sessions.filter(x => !x.isAdmin);
    return json({
      ok:true,
      sessions:publicSessions,
      onlineCount:publicSessions.filter(x=>x.online).length,
      authenticatedOnlineCount:publicSessions.filter(x=>x.online&&x.authenticated).length,
      ghostOnlineCount:publicSessions.filter(x=>x.online&&x.ghost).length,
      ghostSessionCount:publicSessions.filter(x=>x.ghost).length
    }, 200, origin);
  } catch (error) {
    const code = String(error?.message || "");
    const status = ["AUTH_MISSING","AUTH_INVALID"].includes(code) ? 401 : code === "ADMIN_ONLY" ? 403 : 500;
    return json({ ok:false, code, error: status===403 ? "Solo administradores." : "No se pudo cargar la presencia." }, status, origin);
  }
}


export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("origin") || "";

    if (request.method === "OPTIONS") {
      if (!DEFAULT_ALLOWED_ORIGINS.includes(origin)) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (url.pathname === "/health" && request.method === "GET") {
      const firebaseAdminConfigured = Boolean(
        env.FIREBASE_SERVICE_ACCOUNT_JSON ||
        (env.FIREBASE_SERVICE_ACCOUNT_EMAIL && env.FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY)
      );
      return json({
        ok: true,
        service: "Evolution Design Cloudflare Backend",
        zohoConfigured: Boolean(env.ZOHO_CLIENT_ID && env.ZOHO_CLIENT_SECRET && env.ZOHO_REFRESH_TOKEN),
        paypalConfigured: Boolean(env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET),
        firebaseAdminConfigured,
        paypalWebhookConfigured: Boolean(env.PAYPAL_WEBHOOK_ID),
        recaptchaConfigured: Boolean(env.RECAPTCHA_API_KEY && env.RECAPTCHA_PROJECT_ID && env.RECAPTCHA_SITE_KEY),
        recaptchaEnterprise: true,
        profileR2Configured: Boolean(env.PROFILE_R2),
        secureProjectFiles: true,
        profileFirestoreBackend: true,
        recaptchaScoreEnforced: String(env.RECAPTCHA_ENFORCE_SCORE || "").toLowerCase() === "true",
        recaptchaMinScore: Number.isFinite(Number(env.RECAPTCHA_MIN_SCORE)) ? Number(env.RECAPTCHA_MIN_SCORE) : 0.5,
        paymentBackend: true,
        webDesignPayments: true,
        manualPaymentBackend: true,
        mailEngine: true,
        presenceAnalytics: true,
        storeOrders: true,
        storeProduct: STORE_IPHONE_SKU,
        mailTypes: [...EVOLUTION_MAIL_TYPES]
      }, 200, origin);
    }

    if (url.pathname.startsWith("/profile/photo/") && request.method === "GET") {
      const uid = decodeURIComponent(
        url.pathname.slice("/profile/photo/".length)
      );
      return getProfilePhotoRoute(request, env, uid);
    }

    // PayPal llama este endpoint servidor-a-servidor y no envía Origin de tu web.
    if (url.pathname === "/paypal/webhook" && request.method === "POST") {
      return paypalWebhookRoute(request, env);
    }

    // Las etiquetas <img> pueden pedir imágenes públicas sin enviar Origin.
    // Solo permitimos este GET público antes del filtro CORS; admin, pedidos y pagos
    // siguen protegidos por origen + autenticación como antes.
    if (url.pathname === "/store/sales/image" && request.method === "GET") {
      return temporarySalePublicImageRoute(request, env, origin, url);
    }

    if (!DEFAULT_ALLOWED_ORIGINS.includes(origin)) {
      return json({ ok: false, error: "Origen no permitido." }, 403, origin);
    }

    if (url.pathname === "/presence/heartbeat" && request.method === "POST") {
      return presenceHeartbeatRoute(request, env, origin);
    }
    if (url.pathname === "/academy/course" && request.method === "GET") {
      return academyPublicCourseRoute(env, origin, url);
    }
    if (url.pathname === "/academy/admin/course" && (request.method === "GET" || request.method === "POST")) {
      return academyAdminCourseRoute(request, env, origin, url);
    }
    if (url.pathname === "/academy/student/course" && request.method === "GET") return academyStudentCourseRoute(request, env, origin, url);
    if (url.pathname === "/academy/submissions/upload" && request.method === "POST") return academySubmissionUploadRoute(request, env, origin, url);
    if (url.pathname === "/academy/submissions/object" && request.method === "GET") return academySubmissionObjectRoute(request, env, origin, url);
    if (url.pathname === "/academy/admin/submissions" && request.method === "GET") return academyAdminSubmissionsRoute(request, env, origin);
    if (url.pathname === "/academy/admin/submissions/grade" && request.method === "POST") return academyGradeSubmissionRoute(request, env, origin);
    if (url.pathname === "/academy/admin/enrollments" && (request.method === "GET" || request.method === "POST")) return academyAdminEnrollmentsRoute(request, env, origin);
    if (url.pathname === "/academy/coupon/redeem" && request.method === "POST") return academyCouponRedeemRoute(request, env, origin);
    if (url.pathname === "/admin/presence" && request.method === "GET") {
      return adminPresenceRoute(request, env, origin);
    }

    if (url.pathname === "/store/iphone-8-plus/config" && request.method === "GET") {
      return storeIphoneConfigRoute(env, origin);
    }
    if (url.pathname === "/boxful/store/estimate" && request.method === "POST") {
      return boxfulEstimateRoute(request, env, origin);
    }
    if (url.pathname === "/boxful/admin/order/create" && request.method === "POST") {
      return boxfulAdminCreateShipmentRoute(request, env, origin);
    }
    if (url.pathname === "/store/sales/public" && request.method === "GET") {
      return temporarySalePublicRoute(request, env, origin, url);
    }
    if (url.pathname === "/store/sales/admin/image/upload" && request.method === "POST") {
      return temporarySaleAdminImageUploadRoute(request, env, origin);
    }
    if (url.pathname === "/store/sales/admin/image/delete" && request.method === "POST") {
      return temporarySaleAdminImageDeleteRoute(request, env, origin);
    }
    if (url.pathname === "/store/sales/config" && request.method === "GET") {
      return temporarySaleConfigRoute(request, env, origin, url);
    }
    if (url.pathname === "/store/sales/admin/sold" && request.method === "POST") {
      return temporarySaleMarkSoldRoute(request, env, origin);
    }
    if (url.pathname === "/store/sales/admin" && (request.method === "GET" || request.method === "POST")) {
      return temporarySalesAdminRoute(request, env, origin);
    }
    if (url.pathname === "/store/sales/admin/delete" && request.method === "POST") {
      return temporarySaleDeleteRoute(request, env, origin);
    }
    if (url.pathname === "/store/sales/admin/seed" && request.method === "POST") {
      return temporarySalesSeedRoute(request, env, origin);
    }
    if (url.pathname === "/store/sales/admin/email/test" && request.method === "POST") {
      return temporarySaleEmailTestRoute(request, env, origin);
    }
    if (url.pathname === "/store/sales/orders/create" && request.method === "POST") {
      return createTemporarySaleOrderRoute(request, env, origin);
    }
    if (url.pathname === "/store/orders/proof/upload" && request.method === "POST") {
      return storePaymentProofUploadRoute(request, env, origin);
    }
    if (url.pathname === "/store/orders/proof/attach" && request.method === "POST") {
      return attachStoreProofToOrderRoute(request, env, origin);
    }
    if (url.pathname === "/store/orders/create" && request.method === "POST") {
      return createStoreOrderRoute(request, env, origin);
    }
    if (url.pathname === "/store/orders/mine" && request.method === "GET") {
      return mineStoreOrdersRoute(request, env, origin);
    }
    if (url.pathname === "/store/orders/admin" && request.method === "GET") {
      return adminStoreOrdersRoute(request, env, origin);
    }
    if (url.pathname === "/store/orders/admin/update" && request.method === "POST") {
      return adminUpdateStoreOrderRoute(request, env, origin);
    }
    if (url.pathname === "/boxful/admin/status" && request.method === "GET") {
      return boxfulAdminStatusRoute(request, env, origin);
    }
    if (url.pathname === "/boxful/admin/courier-discovery" && request.method === "GET") {
      return boxfulAdminCourierDiscoveryRoute(request, env, origin);
    }
    if (url.pathname === "/boxful/admin/config" && (request.method === "GET" || request.method === "POST")) {
      return boxfulAdminConfigRoute(request, env, origin);
    }
    if (url.pathname === "/store/orders/admin/proof" && request.method === "GET") {
      return adminStoreOrderProofRoute(request, env, origin, url);
    }
    if (url.pathname === "/store/iphone-8-plus/admin/config" && (request.method === "GET" || request.method === "POST")) {
      return adminStoreGuideConfigRoute(request, env, origin);
    }

    if (url.pathname === "/profile/update" && request.method === "POST") {
      return updateProfileDataRoute(request, env, origin);
    }

    if (url.pathname === "/profile/photo" && request.method === "POST") {
      return uploadProfilePhotoRoute(request, env, origin);
    }

    if (url.pathname === "/project-files/upload" && request.method === "POST") {
      return projectFileUploadRoute(request, env, origin, url);
    }
    if (url.pathname === "/project-files/object" && request.method === "GET") {
      return projectFileGetRoute(request, env, origin, url);
    }
    if (url.pathname === "/project-files/delete" && request.method === "POST") {
      return projectFileDeleteRoute(request, env, origin);
    }
    if (url.pathname === "/project-files/delete-prefix" && request.method === "POST") {
      return projectFileDeletePrefixRoute(request, env, origin);
    }

    if (url.pathname === "/recaptcha/config" && request.method === "GET") {
      return recaptchaConfigRoute(env, origin);
    }
    if (url.pathname === "/recaptcha/verify" && request.method === "POST") {
      return recaptchaVerifyRoute(request, env, origin);
    }

    if (url.pathname === "/paypal/config" && request.method === "GET") {
      const clientId = clean(env.PAYPAL_CLIENT_ID, 300);
      if (!clientId) return json({ ok: false, error: "PayPal todavía no está configurado." }, 503, origin);
      return json({ ok: true, clientId }, 200, origin);
    }
    if (url.pathname === "/paypal/create-order" && request.method === "POST") return createPayPalOrderRoute(request, env, origin);
    if (url.pathname === "/paypal/capture-order" && request.method === "POST") return capturePayPalOrderRoute(request, env, origin);
    if (url.pathname === "/graphic/manual-payment" && request.method === "POST") return graphicManualPaymentRoute(request, env, origin);
    if (url.pathname === "/graphic/logo-references" && request.method === "POST") return graphicLogoReferencesRoute(request, env, origin);
    if (url.pathname === "/web/manual-payment" && request.method === "POST") return webManualPaymentRoute(request, env, origin);
    if (url.pathname === "/send-transactional-email" && request.method === "POST") return sendTransactionalEmailRoute(request, env, origin);
    if (url.pathname === "/notify-client-preview" && request.method === "POST") return notifyClientPreview(request, env, origin);

    return json({ ok: false, error: "Ruta no encontrada." }, 404, origin);
  }
};
