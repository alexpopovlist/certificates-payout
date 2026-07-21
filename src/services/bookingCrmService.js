const crypto = require('crypto');
const { query } = require('../db');

const BOOKING_NAME_OPTIONS = ['yclients', 'dikidi Business', 'Собственная', 'Отсутствует', 'Нет данных'];
const AUTH_TYPE_OPTIONS = ['Базовый', 'Нет данных'];
const DEFAULT_YCLIENTS_API_BASE_URL = 'https://api.yclients.com/api/v1';
const DEFAULT_YCLIENTS_AUTH_PATH = '/auth';
const DEFAULT_YCLIENTS_WEB_LOGIN_URL = 'https://www.yclients.com/auth/login/1';
const YCLIENTS_LOGIN_TICKET_TTL_MS = 2 * 60 * 1000;
const yclientsLoginTickets = new Map();

function normalizeText(value) {
  return String(value ?? '').trim();
}
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeJsString(value) {
  return JSON.stringify(String(value ?? ''));
}


function splitSetCookieHeader(value = '') {
  const text = String(value || '');
  if (!text) return [];
  return text.split(/,(?=\s*[^;,\s]+=)/g).map((part) => part.trim()).filter(Boolean);
}

function getSetCookieHeaders(response) {
  if (!response?.headers) return [];

  if (typeof response.headers.getSetCookie === 'function') {
    const cookies = response.headers.getSetCookie();
    if (Array.isArray(cookies) && cookies.length) return cookies;
  }

  const joined = response.headers.get('set-cookie');
  return splitSetCookieHeader(joined);
}

function parseSetCookieHeader(header = '') {
  const parts = String(header || '').split(';').map((part) => part.trim()).filter(Boolean);
  const [pair, ...attributes] = parts;
  if (!pair || !pair.includes('=')) return null;

  const index = pair.indexOf('=');
  const name = pair.slice(0, index).trim();
  const value = pair.slice(index + 1).trim();
  if (!name) return null;

  const cookie = {
    name,
    value,
    domain: '',
    path: '/',
    expires: null,
    maxAge: null,
    secure: false,
    httpOnly: false,
    sameSite: ''
  };

  for (const attribute of attributes) {
    const [rawKey, ...rawValue] = attribute.split('=');
    const key = normalizeText(rawKey).toLowerCase();
    const attrValue = rawValue.join('=').trim();

    if (key === 'domain') cookie.domain = attrValue.toLowerCase();
    if (key === 'path') cookie.path = attrValue || '/';
    if (key === 'expires') cookie.expires = attrValue;
    if (key === 'max-age') cookie.maxAge = Number(attrValue);
    if (key === 'secure') cookie.secure = true;
    if (key === 'httponly') cookie.httpOnly = true;
    if (key === 'samesite') cookie.sameSite = attrValue;
  }

  return cookie;
}

function isExpiredYclientsCookie(cookie) {
  if (!cookie) return true;
  if (Number.isFinite(cookie.maxAge) && Number(cookie.maxAge) <= 0) return true;
  if (cookie.expires) {
    const expiresAt = Date.parse(cookie.expires);
    if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) return true;
  }
  return false;
}

function yclientsCookieKey(cookie = {}) {
  return [cookie.name || '', cookie.domain || '', cookie.path || '/'].join('|');
}

function normalizeStoredYclientsCookies(cookies = []) {
  return Array.isArray(cookies)
    ? cookies
        .map((cookie) => ({
          name: normalizeText(cookie?.name),
          value: String(cookie?.value ?? ''),
          domain: normalizeText(cookie?.domain).toLowerCase(),
          path: normalizeText(cookie?.path) || '/',
          expires: cookie?.expires || null,
          maxAge: Number.isFinite(Number(cookie?.maxAge)) ? Number(cookie.maxAge) : null,
          secure: Boolean(cookie?.secure),
          httpOnly: Boolean(cookie?.httpOnly),
          sameSite: normalizeText(cookie?.sameSite)
        }))
        .filter((cookie) => cookie.name && !isExpiredYclientsCookie(cookie))
    : [];
}

function getYclientsSessionCookies(session = {}) {
  return normalizeStoredYclientsCookies(session?.yclients?.cookies);
}

function buildYclientsCookieHeader(session = {}) {
  return getYclientsSessionCookies(session)
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');
}

function storeYclientsCookiesInSession(session, setCookieHeaders = []) {
  if (!session || !Array.isArray(setCookieHeaders) || setCookieHeaders.length === 0) {
    return { updated: false, receivedCount: 0, storedCount: getYclientsSessionCookies(session).length };
  }

  const currentCookies = getYclientsSessionCookies(session);
  const cookiesByKey = new Map(currentCookies.map((cookie) => [yclientsCookieKey(cookie), cookie]));
  let changed = false;
  let receivedCount = 0;

  for (const header of setCookieHeaders) {
    const cookie = parseSetCookieHeader(header);
    if (!cookie?.name) continue;
    receivedCount += 1;
    const key = yclientsCookieKey(cookie);

    if (isExpiredYclientsCookie(cookie)) {
      if (cookiesByKey.delete(key)) changed = true;
      continue;
    }

    cookiesByKey.set(key, cookie);
    changed = true;
  }

  const cookies = Array.from(cookiesByKey.values()).filter((cookie) => !isExpiredYclientsCookie(cookie));
  session.yclients = {
    ...(session.yclients || {}),
    cookies,
    cookieHeader: cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; '),
    updatedAt: new Date().toISOString()
  };

  return { updated: changed, receivedCount, storedCount: cookies.length };
}

function withYclientsCookieHeader(headers = {}, session = {}) {
  const cookieHeader = buildYclientsCookieHeader(session);
  return cookieHeader ? { ...headers, Cookie: cookieHeader } : headers;
}


function getSessionProfileId(session) {
  const candidates = [
    session?.upstream?.contactId,
    session?.upstream?.profileContactId,
    session?.user?.id,
    session?.upstream?.allIds?.[0]
  ];

  const profileId = candidates
    .map((value) => normalizeText(value))
    .find(Boolean);

  if (!profileId) {
    const error = new Error('No profile id in session');
    error.statusCode = 401;
    error.publicMessage = 'В сессии не найден ID профиля. Войдите в приложение заново.';
    throw error;
  }

  return profileId;
}

function normalizeOption(value, options, fallback) {
  const text = normalizeText(value);
  return options.includes(text) ? text : fallback;
}

function normalizeBookingCrmData(value = {}) {
  return {
    bookingName: normalizeOption(value.bookingName ?? value.booking_name, BOOKING_NAME_OPTIONS, 'Нет данных'),
    bookingUrl: normalizeText(value.bookingUrl ?? value.booking_url),
    authType: normalizeOption(value.authType ?? value.auth_type, AUTH_TYPE_OPTIONS, 'Нет данных'),
    login: normalizeText(value.login),
    password: normalizeText(value.password)
  };
}

function mapRow(row = {}, profileId = '') {
  return {
    profileId: normalizeText(row.profile_id || profileId),
    bookingName: row.booking_name || 'Нет данных',
    bookingUrl: row.booking_url || '',
    authType: row.auth_type || 'Нет данных',
    login: row.login || '',
    password: row.password || '',
    updatedAt: row.updated_at || null
  };
}

function defaultBookingCrmData(profileId) {
  return {
    profileId,
    bookingName: 'Нет данных',
    bookingUrl: '',
    authType: 'Нет данных',
    login: '',
    password: '',
    updatedAt: null
  };
}

function parseJsonSafe(text) {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (_error) {
    return { raw: text };
  }
}

function buildServiceError(publicMessage, statusCode = 400, details = null) {
  const error = new Error(publicMessage);
  error.statusCode = statusCode;
  error.publicMessage = publicMessage;
  if (details) error.upstreamPayload = details;
  return error;
}

function normalizeBookingUrl(value) {
  const trimmed = normalizeText(value);
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function parseBookingUrl(value) {
  const normalized = normalizeBookingUrl(value);
  if (!normalized) {
    throw buildServiceError('Укажите ссылку на Booking сервис.');
  }

  let url;
  try {
    url = new URL(normalized);
  } catch (_error) {
    throw buildServiceError('Укажите корректную ссылку на Booking сервис.');
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw buildServiceError('Ссылка на Booking сервис должна начинаться с http:// или https://.');
  }

  return url;
}


function isYclientsBooking(data = {}) {
  const bookingName = normalizeText(data.bookingName ?? data.booking_name).toLowerCase();
  if (bookingName === 'yclients') return true;

  try {
    const url = parseBookingUrl(data.bookingUrl ?? data.booking_url);
    return isAllowedYclientsHost(url);
  } catch (_error) {
    return false;
  }
}

function isAllowedYclientsHost(url) {
  const hostname = normalizeText(url?.hostname).toLowerCase();
  return hostname === 'yclients.com' || hostname.endsWith('.yclients.com');
}

function buildBasicAuthUrl(data) {
  const url = parseBookingUrl(data.bookingUrl);

  if (data.authType === 'Базовый') {
    if (!data.login || !data.password) {
      throw buildServiceError('Для базовой авторизации заполните логин и пароль.');
    }
    url.username = data.login;
    url.password = data.password;
  }

  return url.toString();
}

function getYclientsApiBaseUrl() {
  return String(process.env.YCLIENTS_API_BASE_URL || DEFAULT_YCLIENTS_API_BASE_URL).replace(/\/+$/, '');
}

function getYclientsAuthUrl() {
  if (process.env.YCLIENTS_AUTH_URL) return process.env.YCLIENTS_AUTH_URL;

  const baseUrl = getYclientsApiBaseUrl();
  const path = String(process.env.YCLIENTS_AUTH_PATH || DEFAULT_YCLIENTS_AUTH_PATH);
  return `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
}

function getYclientsCompaniesUrl() {
  return process.env.YCLIENTS_COMPANIES_URL || `${getYclientsApiBaseUrl()}/companies`;
}

function getYclientsWebLoginUrl() {
  return process.env.YCLIENTS_WEB_LOGIN_URL || DEFAULT_YCLIENTS_WEB_LOGIN_URL;
}


function normalizeYclientsCompanyId(value) {
  const text = normalizeText(value);
  const match = text.match(/^\d{2,}$/);
  return match ? match[0] : '';
}

function getYclientsTimetableBaseUrl() {
  return String(process.env.YCLIENTS_TIMETABLE_BASE_URL || 'https://yclients.com').replace(/\/+$/, '');
}

function buildYclientsTimetableUrl(companyId) {
  const normalizedCompanyId = normalizeYclientsCompanyId(companyId);
  return normalizedCompanyId ? `${getYclientsTimetableBaseUrl()}/timetable/${normalizedCompanyId}` : '';
}

function extractYclientsCompanyIdFromText(value) {
  const text = String(value ?? '');
  if (!text) return '';

  const patterns = [
    /["']yc_company_id["']\s*[:=]\s*["']?(\d{2,})/i,
    /["']company_id["']\s*[:=]\s*["']?(\d{2,})/i,
    /["']companyId["']\s*[:=]\s*["']?(\d{2,})/i,
    /yc_company_id=(\d{2,})/i,
    /\/timetable\/(\d{2,})(?:\/|\?|#|$)/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return normalizeYclientsCompanyId(match[1]);
  }

  return '';
}

function extractYclientsCompanyIdFromCookies(cookies = []) {
  const normalizedCookies = Array.isArray(cookies) ? cookies : [];
  const companyCookie = normalizedCookies.find((cookie) => normalizeText(cookie?.name).toLowerCase() === 'yc_company_id');
  return normalizeYclientsCompanyId(companyCookie?.value);
}

function collectYclientsCompanyIdCandidates(value, path = [], candidates = [], depth = 0, seen = new Set()) {
  if (value == null || depth > 8) return candidates;

  if (typeof value === 'string' || typeof value === 'number') {
    const lastKey = normalizeText(path[path.length - 1]).toLowerCase();
    const joinedPath = path.map((key) => normalizeText(key).toLowerCase()).join('.');
    const directId = normalizeYclientsCompanyId(value);
    const idFromText = extractYclientsCompanyIdFromText(value);

    if (directId && ['yc_company_id', 'company_id', 'companyid'].includes(lastKey)) {
      candidates.push({ id: directId, score: 100, source: joinedPath || 'payload' });
    } else if (directId && joinedPath.includes('company') && lastKey === 'id') {
      candidates.push({ id: directId, score: 80, source: joinedPath || 'payload' });
    } else if (idFromText) {
      candidates.push({ id: idFromText, score: 70, source: joinedPath || 'payload' });
    }

    return candidates;
  }

  if (typeof value !== 'object') return candidates;
  if (seen.has(value)) return candidates;
  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach((item, index) => collectYclientsCompanyIdCandidates(item, path.concat(String(index)), candidates, depth + 1, seen));
    return candidates;
  }

  for (const [key, item] of Object.entries(value)) {
    collectYclientsCompanyIdCandidates(item, path.concat(key), candidates, depth + 1, seen);
  }

  return candidates;
}

function extractYclientsCompanyIdFromPayload(payload = {}) {
  const candidates = collectYclientsCompanyIdCandidates(payload)
    .filter((candidate) => candidate.id)
    .sort((left, right) => right.score - left.score);

  return candidates[0]?.id || '';
}

function extractYclientsCompanyIdFromBookingUrl(value) {
  let url;
  try {
    url = parseBookingUrl(value);
  } catch (_error) {
    return '';
  }

  const directFromUrl = extractYclientsCompanyIdFromText(url.toString());
  if (directFromUrl) return directFromUrl;

  for (const key of ['yc_company_id', 'company_id', 'companyId']) {
    const queryId = normalizeYclientsCompanyId(url.searchParams.get(key));
    if (queryId) return queryId;
  }

  const pathParts = url.pathname.split('/').filter(Boolean);
  const signinIndex = pathParts.findIndex((part) => part.toLowerCase() === 'signin');
  if (signinIndex >= 0 && pathParts[signinIndex + 1]) {
    const encoded = pathParts[signinIndex + 1].replace(/-/g, '+').replace(/_/g, '/');
    try {
      const decoded = Buffer.from(encoded, 'base64').toString('utf8');
      const decodedUrl = decodeURIComponent(decoded);
      const idFromDecoded = extractYclientsCompanyIdFromText(decodedUrl);
      if (idFromDecoded) return idFromDecoded;
    } catch (_error) {
      return '';
    }
  }

  return '';
}

function extractYclientsCompanyId({ payload, rawText, cookies, bookingUrl } = {}) {
  return extractYclientsCompanyIdFromCookies(cookies)
    || extractYclientsCompanyIdFromPayload(payload)
    || extractYclientsCompanyIdFromText(rawText)
    || extractYclientsCompanyIdFromBookingUrl(bookingUrl);
}

function resolveYclientsTimetableTarget({ originalUrl, authResult, webLoginResult } = {}) {
  const sources = [
    { source: 'web-login-cookies', id: webLoginResult?.companyIdFromCookies },
    { source: 'web-login-response', id: webLoginResult?.companyId },
    { source: 'api-auth-response', id: authResult?.companyId },
    { source: 'booking-url', id: extractYclientsCompanyIdFromBookingUrl(originalUrl) }
  ];

  for (const item of sources) {
    const companyId = normalizeYclientsCompanyId(item.id);
    const url = buildYclientsTimetableUrl(companyId);
    if (url) {
      return {
        url,
        companyId,
        source: item.source
      };
    }
  }

  return {
    url: normalizeBookingUrl(originalUrl),
    companyId: '',
    source: 'booking-url-original'
  };
}

function cleanupYclientsLoginTickets() {
  const now = Date.now();
  for (const [ticketId, ticket] of yclientsLoginTickets.entries()) {
    if (!ticket || ticket.expiresAt <= now) {
      yclientsLoginTickets.delete(ticketId);
    }
  }
}

function createYclientsLoginTicket({ bookingUrl, login, password, apiAuthResult = {} } = {}) {
  cleanupYclientsLoginTickets();

  const ticketId = crypto.randomBytes(24).toString('hex');
  yclientsLoginTickets.set(ticketId, {
    bookingUrl: normalizeText(bookingUrl),
    login: normalizeText(login),
    password: normalizeText(password),
    loginUrl: getYclientsWebLoginUrl(),
    apiAuthResult,
    expiresAt: Date.now() + YCLIENTS_LOGIN_TICKET_TTL_MS
  });

  return ticketId;
}

function takeYclientsLoginTicket(ticketId) {
  cleanupYclientsLoginTickets();
  const normalizedTicketId = normalizeText(ticketId);
  const ticket = yclientsLoginTickets.get(normalizedTicketId);
  yclientsLoginTickets.delete(normalizedTicketId);

  if (!ticket) {
    throw buildServiceError('Ссылка авторизации YCLIENTS устарела. Откройте Booking ещё раз.', 410);
  }

  return ticket;
}


function formatYclientsWebLoginStatus(result = null) {
  if (!result) {
    return {
      label: 'Ответ web-авторизации не получен',
      tone: 'warning',
      httpStatus: 'нет данных',
      responseText: 'Сервер не вернул ответ от YCLIENTS auth/login/1.'
    };
  }

  const status = Number(result.status || 0);
  const ok = Boolean(result.ok);
  const warning = normalizeText(result.warning);
  const rawText = normalizeText(result.rawText || result.responseText);
  const payloadText = rawText || JSON.stringify(result.payload ?? {}, null, 2);

  const cookies = result.cookies || {};
  const receivedCount = Number(cookies.receivedCount || 0);
  const storedCount = Number(cookies.storedCount || 0);
  const cookieNames = Array.isArray(cookies.names) && cookies.names.length
    ? ` Имена cookies: ${cookies.names.join(', ')}.`
    : '';
  const companyId = normalizeYclientsCompanyId(result.companyId || result.companyIdFromCookies);
  const companyMessage = companyId ? ` Компания YCLIENTS: ${companyId}.` : '';
  const cookieMessage = receivedCount > 0
    ? `Cookies YCLIENTS получены: ${receivedCount}. В текущей сессии сохранено: ${storedCount}.${companyMessage}${cookieNames}`
    : `Cookies YCLIENTS в ответе сервиса не получены.${companyMessage}`;

  return {
    label: ok ? 'Авторизация отправлена успешно' : 'Авторизация не подтверждена',
    tone: ok ? 'success' : 'error',
    httpStatus: status ? `HTTP ${status}` : 'HTTP статус не получен',
    responseText: warning || payloadText || 'Пустой ответ сервиса.',
    cookieMessage
  };
}

function renderYclientsLoginBridgePage(ticket) {
  const loginUrl = normalizeBookingUrl(ticket.loginUrl || getYclientsWebLoginUrl());
  const bookingUrl = normalizeBookingUrl(ticket.bookingUrl);
  const email = normalizeText(ticket.login);
  const password = normalizeText(ticket.password);
  const apiMessage = normalizeText(ticket.apiAuthResult?.message);
  const webLoginStatus = formatYclientsWebLoginStatus(ticket.apiAuthResult?.webLoginResult);
  const yclientsCompanyId = normalizeYclientsCompanyId(ticket.apiAuthResult?.yclientsCompanyId);
  const yclientsCompanyIdSource = normalizeText(ticket.apiAuthResult?.yclientsCompanyIdSource);
  const autoBrowserLoginDelayMs = email && password ? 900 : 0;

  return `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex,nofollow" />
    <link rel="icon" type="image/x-icon" href="/favicon.ico?v=wowlife-20260721" />
    <link rel="shortcut icon" href="/favicon.ico?v=wowlife-20260721" />
    <link rel="icon" type="image/png" sizes="16x16" href="/assets/favicon-16.png?v=wowlife-20260721" />
    <link rel="icon" type="image/png" sizes="32x32" href="/assets/favicon-32.png?v=wowlife-20260721" />
    <link rel="icon" type="image/png" sizes="48x48" href="/assets/favicon-48.png?v=wowlife-20260721" />
    <link rel="icon" type="image/png" sizes="192x192" href="/assets/pwa-icon-192.png?v=wowlife-20260721" />
    <title>Открытие YCLIENTS</title>
    <style>
      :root { color-scheme: light; }
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif; color: #101828; background: #f3f6fb; }
      main { width: min(680px, calc(100vw - 40px)); padding: 32px; border: 1px solid #dbe3ef; border-radius: 28px; background: #fff; box-shadow: 0 20px 60px rgba(15, 23, 42, .14); }
      h1 { margin: 0 0 10px; font-size: 28px; line-height: 1.2; }
      p { margin: 0 0 16px; color: #64748b; line-height: 1.5; font-size: 16px; }
      .status { display: grid; gap: 10px; margin: 22px 0; padding: 18px; border-radius: 18px; background: #f8fafc; border: 1px solid #e2e8f0; color: #334155; }
      .service-status, .browser-status { display: grid; gap: 12px; margin: 18px 0 0; padding: 16px; border-radius: 18px; border: 1px solid #e2e8f0; background: #fff; }
      .service-status.success, .browser-status.success { border-color: #bbf7d0; background: #f0fdf4; }
      .service-status.error, .browser-status.error { border-color: #fecaca; background: #fef2f2; }
      .service-status.warning, .browser-status.warning { border-color: #fde68a; background: #fffbeb; }
      .service-status.info, .browser-status.info { border-color: #bfdbfe; background: #eff6ff; }
      .service-status strong, .browser-status strong { color: #0f172a; }
      .service-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; justify-content: space-between; }
      .badge { display: inline-flex; align-items: center; min-height: 28px; padding: 4px 10px; border-radius: 999px; background: rgba(15, 23, 42, .08); color: #0f172a; font-size: 13px; font-weight: 800; }
      pre { max-height: 260px; overflow: auto; margin: 0; padding: 14px; border-radius: 14px; background: rgba(15, 23, 42, .06); color: #0f172a; white-space: pre-wrap; word-break: break-word; font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
      .actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 22px; }
      button, a { min-height: 46px; padding: 12px 18px; border-radius: 14px; border: 1px solid #dbe3ef; font: inherit; font-weight: 700; cursor: pointer; text-decoration: none; }
      .primary { border-color: #0f172a; background: #0f172a; color: #fff; }
      .secondary { background: #fff; color: #0f172a; }
      .muted { font-size: 13px; color: #94a3b8; }
      .hidden { display: none !important; }
    </style>
  </head>
  <body>
    <main>
      <h1>Открываем YCLIENTS</h1>
      <p>Сначала показываем серверную проверку, затем пробуем скрытую отправку формы. Для гарантированного получения cookies браузером после скрытой попытки автоматически выполняется прямой вход через домен yclients.com и только потом открывается расписание.</p>
      <div class="status" aria-live="polite">
        <strong id="statusTitle">Запрос авторизации выполнен сервером</strong>
        <span id="statusText">POST ${escapeHtml(loginUrl)} с email и password уже выполнен на backend. Следующий шаг — браузерная авторизация: сначала скрытая попытка, затем надёжный top-level вход через домен YCLIENTS.</span>
        ${apiMessage ? `<span class="muted">${escapeHtml(apiMessage)}</span>` : ''}
        <div class="service-status ${escapeHtml(webLoginStatus.tone)}">
          <div class="service-row">
            <strong>Серверный статус авторизации</strong>
            <span class="badge">${escapeHtml(webLoginStatus.httpStatus)}</span>
          </div>
          <span>${escapeHtml(webLoginStatus.label)}</span>
          <strong>Ответ сервиса</strong>
          <pre>${escapeHtml(webLoginStatus.responseText)}</pre>
          <span class="muted">${escapeHtml(webLoginStatus.cookieMessage)}</span>
        </div>
        <div class="service-status info">
          <div class="service-row">
            <strong>Итоговый переход</strong>
            <span class="badge">${yclientsCompanyId ? `company ${escapeHtml(yclientsCompanyId)}` : 'исходная ссылка'}</span>
          </div>
          <pre>${escapeHtml(bookingUrl)}</pre>
          ${yclientsCompanyIdSource ? `<span class="muted">ID компании взят из источника: ${escapeHtml(yclientsCompanyIdSource)}.</span>` : ''}
        </div>
        <div class="browser-status info" id="browserStatusBox">
          <div class="service-row">
            <strong>Передача cookies в браузер</strong>
            <span class="badge" id="browserStatusBadge">ожидание</span>
          </div>
          <span id="browserStatusText">Через несколько секунд будет выполнена скрытая отправка формы в iframe. После неё вкладка автоматически выполнит прямой вход через yclients.com/auth/login/1, чтобы cookies точно попали в браузерную сессию YCLIENTS.</span>
          <pre id="browserResponseText">Скрытый iframe не позволяет прочитать текст ответа YCLIENTS из-за cross-origin политики браузера. Серверный ответ показан выше.</pre>
        </div>
      </div>
      <div class="actions">
        <button class="primary" id="browserLoginButton" type="button">Войти через YCLIENTS напрямую сейчас</button>
        <button class="secondary" id="openNowButton" type="button">Открыть Booking без ожидания</button>
        <a class="secondary" href="${escapeHtml(bookingUrl)}" rel="noreferrer">Открыть вручную</a>
      </div>
      <p class="muted" style="margin-top:18px">Скрытый вход используется только как мягкая попытка. Надёжный шаг — короткий прямой переход через auth/login/1: именно он позволяет браузеру получить cookies YCLIENTS, после чего исходная вкладка приложения автоматически откроет расписание.</p>
    </main>

    <form id="yclientsHiddenLoginForm" method="post" action="${escapeHtml(loginUrl)}" target="yclientsHiddenLoginFrame" style="display:none">
      <input type="hidden" name="email" value="${escapeHtml(email)}" />
      <input type="hidden" name="password" value="${escapeHtml(password)}" />
    </form>
    <iframe id="yclientsHiddenLoginFrame" name="yclientsHiddenLoginFrame" title="Скрытая авторизация YCLIENTS" style="position:absolute;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0;border:0;pointer-events:none" aria-hidden="true"></iframe>

    <form id="yclientsTopLevelLoginForm" method="post" action="${escapeHtml(loginUrl)}" target="_self" style="display:none">
      <input type="hidden" name="email" value="${escapeHtml(email)}" />
      <input type="hidden" name="password" value="${escapeHtml(password)}" />
    </form>

    <script>
      (function () {
        var bookingUrl = ${escapeJsString(bookingUrl)};
        var loginUrl = ${escapeJsString(loginUrl)};
        var email = ${escapeJsString(email)};
        var password = ${escapeJsString(password)};
        var statusTitle = document.getElementById('statusTitle');
        var statusText = document.getElementById('statusText');
        var browserStatusBox = document.getElementById('browserStatusBox');
        var browserStatusBadge = document.getElementById('browserStatusBadge');
        var browserStatusText = document.getElementById('browserStatusText');
        var browserResponseText = document.getElementById('browserResponseText');
        var browserLoginButton = document.getElementById('browserLoginButton');
        var openNowButton = document.getElementById('openNowButton');
        var hiddenForm = document.getElementById('yclientsHiddenLoginForm');
        var hiddenFrame = document.getElementById('yclientsHiddenLoginFrame');
        var form = document.getElementById('yclientsTopLevelLoginForm');
        var finished = false;
        var hiddenAttemptStarted = false;
        var hiddenAttemptCompleted = false;
        var hiddenTimeoutId = null;
        var directLoginTimerId = null;

        function setBrowserStatus(tone, badge, text, responseText) {
          browserStatusBox.className = 'browser-status ' + tone;
          browserStatusBadge.textContent = badge;
          browserStatusText.textContent = text;
          if (typeof responseText === 'string') {
            browserResponseText.textContent = responseText;
          }
        }

        function openBooking() {
          if (finished) return;
          finished = true;
          statusTitle.textContent = 'Открываем Booking...';
          statusText.textContent = 'Переходим к расписанию YCLIENTS.';
          window.location.replace(bookingUrl);
        }

        function notifyOpenerLoginSubmitted() {
          try {
            if (window.opener && !window.opener.closed) {
              window.opener.postMessage({
                type: 'wowlife-yclients-login-submitted',
                bookingUrl: bookingUrl,
                loginUrl: loginUrl
              }, window.location.origin);
            }
          } catch (_error) {}
        }

        function submitTopLevelLogin() {
          if (finished) return;
          finished = true;
          if (hiddenTimeoutId) {
            clearTimeout(hiddenTimeoutId);
            hiddenTimeoutId = null;
          }
          if (directLoginTimerId) {
            clearTimeout(directLoginTimerId);
            directLoginTimerId = null;
          }
          statusTitle.textContent = 'Выполняем прямой вход через YCLIENTS...';
          statusText.textContent = 'Вкладка ненадолго перейдёт на yclients.com/auth/login/1, чтобы ответ пришёл от домена YCLIENTS и браузер сохранил его cookies. После этого исходная вкладка приложения переведёт это окно на расписание.';
          setBrowserStatus('info', 'прямой вход', 'Отправляем форму напрямую на домен YCLIENTS. Этот шаг обязателен для гарантированной установки cookies в браузерную сессию YCLIENTS.', browserResponseText.textContent);
          notifyOpenerLoginSubmitted();
          form.submit();
        }

        function finishHiddenAttempt() {
          if (finished || !hiddenAttemptStarted || hiddenAttemptCompleted) return;
          hiddenAttemptCompleted = true;
          if (hiddenTimeoutId) {
            clearTimeout(hiddenTimeoutId);
            hiddenTimeoutId = null;
          }
          setBrowserStatus(
            'info',
            'iframe load',
            'Скрытый login-запрос завершился. Но third-party cookies из iframe могут не сохраниться, поэтому сейчас автоматически выполним прямой вход через домен YCLIENTS.',
            'Ответ YCLIENTS загружен в скрытом iframe. Из-за cross-origin политики текст ответа в iframe прочитать нельзя.'
          );
          directLoginTimerId = window.setTimeout(function () {
            if (!finished) submitTopLevelLogin();
          }, 900);
        }

        function submitHiddenLogin() {
          if (finished || hiddenAttemptStarted) return;
          if (!email || !password) {
            setBrowserStatus('error', 'нет данных', 'Логин или пароль не заполнены. Заполните их на экране «Данные CRM».', '');
            return;
          }

          hiddenAttemptStarted = true;
          browserLoginButton.disabled = false;
          setBrowserStatus(
            'info',
            'скрытый iframe',
            'Пробуем скрыто отправить форму на yclients.com/auth/login/1. Пользователь не увидит страницу auth/login/1, если браузер разрешит cookies в iframe.',
            'Ожидаем загрузку ответа YCLIENTS в скрытом iframe...'
          );

          hiddenFrame.addEventListener('load', finishHiddenAttempt, { once: true });
          try {
            hiddenForm.submit();
          } catch (error) {
            hiddenAttemptCompleted = true;
            setBrowserStatus(
              'warning',
              'iframe error',
              'Скрытая отправка формы не запустилась. Используйте прямой вход через YCLIENTS.',
              error && error.message ? error.message : String(error)
            );
            return;
          }

          hiddenTimeoutId = window.setTimeout(function () {
            if (finished || hiddenAttemptCompleted) return;
            hiddenAttemptCompleted = true;
            setBrowserStatus(
              'warning',
              'top-level fallback',
              'Скрытый iframe не подтвердил установку cookies. Автоматически выполняем прямой вход через YCLIENTS, чтобы браузер точно получил cookies.',
              'Скрытый запрос мог быть заблокирован настройками third-party cookies или политикой браузера.'
            );
            directLoginTimerId = window.setTimeout(function () {
              if (!finished) submitTopLevelLogin();
            }, 600);
          }, 2600);
        }

        browserLoginButton.addEventListener('click', function () {
          if (finished) return;
          submitTopLevelLogin();
        });
        openNowButton.addEventListener('click', openBooking);

        var autoDelay = ${autoBrowserLoginDelayMs};
        if (autoDelay > 0) {
          statusText.textContent = 'Серверный ответ показан ниже. Сейчас попробуем скрытую авторизацию через iframe, затем автоматически выполним прямой вход через домен YCLIENTS для установки cookies.';
          window.setTimeout(function () {
            if (!finished) submitHiddenLogin();
          }, autoDelay);
        } else {
          setBrowserStatus('error', 'нет данных', 'Логин или пароль не заполнены. Заполните их на экране «Данные CRM».', '');
        }
      })();
    </script>
  </body>
</html>`;
}

async function postYclientsWebLoginJson({ login, password, session } = {}) {
  const normalizedLogin = normalizeText(login);
  const normalizedPassword = normalizeText(password);

  if (!normalizedLogin || !normalizedPassword) {
    throw buildServiceError('Для web-авторизации YCLIENTS заполните логин и пароль.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(getYclientsWebLoginUrl(), {
      method: 'POST',
      redirect: 'manual',
      signal: controller.signal,
      headers: withYclientsCookieHeader({
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/plain, */*',
        'User-Agent': 'WOWlife Partner Cabinet/1.0'
      }, session),
      body: JSON.stringify({
        email: normalizedLogin,
        password: normalizedPassword
      })
    });

    const setCookieHeaders = getSetCookieHeaders(response);
    const receivedCookies = setCookieHeaders.map(parseSetCookieHeader).filter(Boolean);
    const cookieResult = storeYclientsCookiesInSession(session, setCookieHeaders);
    const text = await response.text();
    const payload = parseJsonSafe(text);
    const companyIdFromCookies = extractYclientsCompanyIdFromCookies(receivedCookies);
    const companyId = extractYclientsCompanyId({
      payload,
      rawText: text,
      cookies: receivedCookies
    });

    return {
      ok: response.ok || (response.status >= 300 && response.status < 400),
      status: response.status,
      statusText: response.statusText || '',
      redirected: response.status >= 300 && response.status < 400,
      rawText: text,
      payload,
      companyId,
      companyIdFromCookies,
      cookies: {
        receivedCount: cookieResult.receivedCount,
        storedCount: cookieResult.storedCount,
        updated: cookieResult.updated,
        names: receivedCookies.map((cookie) => cookie.name).filter(Boolean)
      }
    };
  } finally {
    clearTimeout(timeout);
  }
}

function getYclientsPartnerToken() {
  return normalizeText(process.env.YCLIENTS_PARTNER_TOKEN || process.env.YCLIENTS_APP_TOKEN || process.env.YCLIENTS_API_TOKEN);
}

function getYclientsUserTokenFromPayload(payload = {}) {
  const candidates = [
    payload?.data?.user_token,
    payload?.data?.userToken,
    payload?.result?.user_token,
    payload?.result?.userToken,
    payload?.user_token,
    payload?.userToken,
    payload?.token,
    payload?.data?.token,
    payload?.result?.token
  ];

  return candidates
    .map((value) => normalizeText(value))
    .find(Boolean) || '';
}

async function fetchYclientsUserToken({ login, password, partnerToken: providedPartnerToken, session } = {}) {
  const normalizedLogin = normalizeText(login);
  const normalizedPassword = normalizeText(password);
  const partnerToken = normalizeText(providedPartnerToken) || getYclientsPartnerToken();

  if (!normalizedLogin || !normalizedPassword) {
    throw buildServiceError('Для авторизации в YCLIENTS заполните логин и пароль.');
  }

  if (!partnerToken) {
    return {
      userToken: '',
      partnerToken: '',
      payload: {},
      skipped: true,
      message: 'YCLIENTS partner token не настроен. API-проверка авторизации пропущена.'
    };
  }

  const response = await fetch(getYclientsAuthUrl(), {
    method: 'POST',
    headers: withYclientsCookieHeader({
      'Content-Type': 'application/json',
      'Accept': 'application/vnd.yclients.v2+json, application/json, text/plain, */*',
      'Authorization': `Bearer ${partnerToken}`
    }, session),
    body: JSON.stringify({
      login: normalizedLogin,
      password: normalizedPassword
    })
  });

  const setCookieHeaders = getSetCookieHeaders(response);
  const receivedCookies = setCookieHeaders.map(parseSetCookieHeader).filter(Boolean);
  const cookieResult = storeYclientsCookiesInSession(session, setCookieHeaders);

  const text = await response.text();
  const payload = parseJsonSafe(text);
  const userToken = getYclientsUserTokenFromPayload(payload);
  const companyId = extractYclientsCompanyId({ payload, rawText: text, cookies: receivedCookies });
  const successFlag = payload?.success ?? payload?.result;

  if (!response.ok || successFlag === false || !userToken) {
    const message = payload?.meta?.message
      || payload?.message
      || payload?.error
      || payload?.errors?.[0]?.message
      || 'YCLIENTS не подтвердил авторизацию. Проверьте логин и пароль.';
    throw buildServiceError(message, response.ok ? 502 : response.status, payload);
  }

  return {
    userToken,
    partnerToken,
    payload,
    companyId,
    cookies: {
      receivedCount: cookieResult.receivedCount,
      storedCount: cookieResult.storedCount,
      updated: cookieResult.updated
    }
  };
}

function getYclientsEnvUserToken() {
  return normalizeText(process.env.YCLIENTS_USER_TOKEN || process.env.YCLIENTS_SYSTEM_USER_TOKEN);
}

async function verifyYclientsUserToken({ partnerToken, userToken, session } = {}) {
  const response = await fetch(getYclientsCompaniesUrl(), {
    method: 'GET',
    headers: withYclientsCookieHeader({
      'Accept': 'application/vnd.yclients.v2+json, application/json, text/plain, */*',
      'Authorization': yclientsAuthorizationHeader({ partnerToken, userToken })
    }, session)
  });

  const setCookieHeaders = getSetCookieHeaders(response);
  const receivedCookies = setCookieHeaders.map(parseSetCookieHeader).filter(Boolean);
  const cookieResult = storeYclientsCookiesInSession(session, setCookieHeaders);
  const text = await response.text();
  const payload = parseJsonSafe(text);

  if (!response.ok) {
    const message = payload?.meta?.message
      || payload?.message
      || payload?.error
      || payload?.errors?.[0]?.message
      || 'YCLIENTS не подтвердил доступ по YCLIENTS_PARTNER_TOKEN и YCLIENTS_USER_TOKEN.';
    throw buildServiceError(message, response.status, payload);
  }

  return {
    payload,
    companyId: extractYclientsCompanyId({ payload, rawText: text, cookies: receivedCookies }),
    cookies: {
      receivedCount: cookieResult.receivedCount,
      storedCount: cookieResult.storedCount,
      updated: cookieResult.updated
    }
  };
}

function yclientsOpenWarning(error) {
  const message = normalizeText(error?.publicMessage || error?.message);
  return message || 'ошибка проверки YCLIENTS API';
}

async function authorizeYclientsForExternalOpen(data = {}, session = null) {
  const partnerToken = getYclientsPartnerToken();
  const envUserToken = getYclientsEnvUserToken();
  const login = normalizeText(data.login);
  const password = normalizeText(data.password);

  if (!partnerToken) {
    throw buildServiceError('Для авторизации YCLIENTS укажите YCLIENTS_PARTNER_TOKEN в env.', 400);
  }

  if (login && password) {
    const apiLoginResult = await fetchYclientsUserToken({ login, password, partnerToken, session });
    return {
      apiAuthorized: true,
      authMode: 'yclients-api-crm-login-password',
      partnerTokenSource: 'env',
      userTokenSource: 'crm-data-login-password',
      companyId: apiLoginResult.companyId,
      cookies: apiLoginResult.cookies,
      message: 'YCLIENTS API-авторизация выполнена по логину и паролю из экрана «Данные CRM». Открываем Booking в новой вкладке.'
    };
  }

  if (envUserToken) {
    const apiVerifyResult = await verifyYclientsUserToken({ partnerToken, userToken: envUserToken, session });
    return {
      apiAuthorized: true,
      authMode: 'yclients-api-env-user-token',
      partnerTokenSource: 'env',
      userTokenSource: 'env',
      companyId: apiVerifyResult.companyId,
      cookies: apiVerifyResult.cookies,
      message: 'YCLIENTS API-авторизация выполнена по YCLIENTS_PARTNER_TOKEN и YCLIENTS_USER_TOKEN. Открываем Booking в новой вкладке.'
    };
  }

  throw buildServiceError('Для авторизации YCLIENTS заполните логин и пароль на экране «Данные CRM» или задайте YCLIENTS_USER_TOKEN в env.', 400);
}

function yclientsAuthorizationHeader({ partnerToken, userToken } = {}) {
  return `Bearer ${partnerToken}, User ${userToken}`;
}

async function createBookingOpenTarget({ session, data } = {}) {
  getSessionProfileId(session);
  const normalized = normalizeBookingCrmData(data || {});
  const parsedTargetUrl = parseBookingUrl(normalized.bookingUrl);
  const originalTargetUrl = parsedTargetUrl.toString();

  if (isYclientsBooking(normalized) && normalized.authType === 'Базовый') {
    if (!isAllowedYclientsHost(parsedTargetUrl)) {
      throw buildServiceError('Для авторизации YCLIENTS укажите ссылку на домене yclients.com.');
    }

    if (!normalized.login || !normalized.password) {
      throw buildServiceError('Для авторизации YCLIENTS заполните логин и пароль на экране «Данные CRM».');
    }

    let authResult = {
      apiAuthorized: false,
      authMode: 'yclients-web-login-post',
      message: 'Открываем YCLIENTS: сначала пробуем скрытую web-авторизацию, затем открываем расписание.'
    };

    try {
      authResult = await authorizeYclientsForExternalOpen(normalized, session);
    } catch (error) {
      authResult = {
        apiAuthorized: false,
        authMode: 'yclients-web-login-post',
        apiWarning: yclientsOpenWarning(error),
        message: 'API-проверка YCLIENTS не выполнена, но скрытая web-авторизация будет отправлена в новой вкладке.'
      };
    }

    let webLoginResult = null;
    try {
      webLoginResult = await postYclientsWebLoginJson({
        login: normalized.login,
        password: normalized.password,
        session
      });
    } catch (error) {
      webLoginResult = {
        ok: false,
        status: 0,
        warning: yclientsOpenWarning(error)
      };
    }

    const timetableTarget = resolveYclientsTimetableTarget({
      originalUrl: originalTargetUrl,
      authResult,
      webLoginResult
    });
    const targetUrl = timetableTarget.url || originalTargetUrl;
    const bookingUrlUpdated = targetUrl !== originalTargetUrl || targetUrl !== normalized.bookingUrl;
    let savedItem = null;
    let bookingUrlSaveWarning = '';

    if (bookingUrlUpdated) {
      try {
        savedItem = await saveBookingCrmData({
          session,
          data: {
            ...normalized,
            bookingUrl: targetUrl
          }
        });
      } catch (error) {
        bookingUrlSaveWarning = yclientsOpenWarning(error);
      }
    }

    const ticketId = createYclientsLoginTicket({
      bookingUrl: targetUrl,
      login: normalized.login,
      password: normalized.password,
      apiAuthResult: {
        ...authResult,
        webLoginResult,
        resolvedBookingUrl: targetUrl,
        yclientsCompanyId: timetableTarget.companyId,
        yclientsCompanyIdSource: timetableTarget.source
      }
    });

    return {
      result: true,
      openUrl: `/api/crm-data/yclients-login/${ticketId}`,
      externalUrl: targetUrl,
      originalExternalUrl: originalTargetUrl,
      savedBookingUrl: savedItem?.bookingUrl || (bookingUrlUpdated && !bookingUrlSaveWarning ? targetUrl : ''),
      bookingUrlUpdated: Boolean(savedItem),
      bookingUrlSaveWarning,
      item: savedItem || null,
      loginUrl: getYclientsWebLoginUrl(),
      authMode: 'yclients-web-login-post',
      yclientsCompanyId: timetableTarget.companyId,
      yclientsCompanyIdSource: timetableTarget.source,
      webLoginRequest: {
        method: 'POST',
        url: getYclientsWebLoginUrl(),
        payloadFields: ['email', 'password'],
        contentType: 'application/json'
      },
      browserAuthRedirectAfterSubmitMs: 5000,
      browserAuthFallbackRedirectMs: 18000,
      webLoginResult,
      sessionUpdated: Boolean(webLoginResult?.cookies?.updated || authResult?.cookies?.updated),
      ...authResult,
      message: timetableTarget.companyId
        ? `Открываем YCLIENTS в новой вкладке: сначала пробуем скрытый вход, затем выполняется прямой вход через домен YCLIENTS и переход на ${targetUrl}. Ссылка на Booking сервис${savedItem ? ' обновлена' : bookingUrlSaveWarning ? ' не обновлена' : ' уже актуальна'}.`
        : 'Открываем YCLIENTS в новой вкладке: сначала пробуем скрытую авторизацию через iframe, затем выполняется прямой вход через домен YCLIENTS и открывается расписание.'
    };
  }

  const externalUrl = buildBasicAuthUrl(normalized);
  return {
    result: true,
    openUrl: externalUrl,
    externalUrl,
    authMode: normalized.authType === 'Базовый' ? 'basic-url' : 'none',
    apiAuthorized: false,
    message: normalized.authType === 'Базовый'
      ? 'Booking открыт в новой вкладке с базовой авторизацией в URL.'
      : 'Booking открыт в новой вкладке без подстановки авторизации.'
  };
}

async function getBookingCrmData({ session } = {}) {
  const profileId = getSessionProfileId(session);
  const { rows } = await query(
    `SELECT profile_id, booking_name, booking_url, auth_type, login, password, updated_at
       FROM profile_booking_crm_data
      WHERE profile_id = $1`,
    [profileId]
  );

  return rows[0] ? mapRow(rows[0], profileId) : defaultBookingCrmData(profileId);
}

async function saveBookingCrmData({ session, data } = {}) {
  const profileId = getSessionProfileId(session);
  const normalized = normalizeBookingCrmData(data || {});

  const { rows } = await query(
    `INSERT INTO profile_booking_crm_data (
        profile_id,
        booking_name,
        booking_url,
        auth_type,
        login,
        password
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (profile_id) DO UPDATE SET
        booking_name = EXCLUDED.booking_name,
        booking_url = EXCLUDED.booking_url,
        auth_type = EXCLUDED.auth_type,
        login = EXCLUDED.login,
        password = EXCLUDED.password,
        updated_at = now()
      RETURNING profile_id, booking_name, booking_url, auth_type, login, password, updated_at`,
    [
      profileId,
      normalized.bookingName,
      normalized.bookingUrl,
      normalized.authType,
      normalized.login,
      normalized.password
    ]
  );

  return mapRow(rows[0], profileId);
}

module.exports = {
  BOOKING_NAME_OPTIONS,
  AUTH_TYPE_OPTIONS,
  getBookingCrmData,
  saveBookingCrmData,
  normalizeBookingCrmData,
  createBookingOpenTarget,
  takeYclientsLoginTicket,
  renderYclientsLoginBridgePage
};
