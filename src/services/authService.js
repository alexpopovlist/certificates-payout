const crypto = require('crypto');

const COOKIE_NAME = 'wakesurf_session';
const DEFAULT_AUTH_BASE_URL = 'https://partner-wowlife.ru';
const DEFAULT_PASSWORD_PATH = '/restapi/auth.goPassword';
const DEFAULT_CODE_PATH = '/restapi/auth.getCode';
const DEFAULT_AUTHENTICATION_PATH = '/restapi/auth.authentication';
const DEFAULT_AUTHORIZATION_PATH = '/restapi/auth.authorization';

function getSessionSecret() {
  return process.env.AUTH_SESSION_SECRET || process.env.PUSH_ADMIN_TOKEN || 'local-development-session-secret';
}

function getSessionTtlSeconds() {
  const value = Number(process.env.AUTH_SESSION_TTL_SECONDS || 60 * 60 * 24 * 7);
  return Number.isFinite(value) && value > 0 ? value : 60 * 60 * 24 * 7;
}

function base64UrlEncode(value) {
  return Buffer.from(value).toString('base64url');
}

function base64UrlDecode(value) {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function sign(value) {
  return crypto
    .createHmac('sha256', getSessionSecret())
    .update(value)
    .digest('base64url');
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function createSessionToken(session) {
  const payload = base64UrlEncode(JSON.stringify(session));
  return `${payload}.${sign(payload)}`;
}

function readSessionToken(token) {
  if (!token || !token.includes('.')) return null;

  const [payload, signature] = token.split('.');
  if (!payload || !signature || !safeEqual(sign(payload), signature)) return null;

  try {
    const parsed = JSON.parse(base64UrlDecode(payload));
    if (!parsed.expiresAt || Date.now() > Number(parsed.expiresAt)) return null;
    return parsed;
  } catch (_error) {
    return null;
  }
}

function parseCookies(cookieHeader = '') {
  return String(cookieHeader)
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((cookies, part) => {
      const index = part.indexOf('=');
      if (index === -1) return cookies;
      const key = decodeURIComponent(part.slice(0, index).trim());
      const value = decodeURIComponent(part.slice(index + 1).trim());
      cookies[key] = value;
      return cookies;
    }, {});
}

function getRequestSession(request) {
  const cookies = parseCookies(request.headers.cookie || '');
  return readSessionToken(cookies[COOKIE_NAME]);
}

function getCookieAttributes(maxAgeSeconds = getSessionTtlSeconds()) {
  const secure = process.env.NODE_ENV === 'production';
  return [
    `Max-Age=${maxAgeSeconds}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    secure ? 'Secure' : ''
  ].filter(Boolean).join('; ');
}

function setSessionCookie(response, session) {
  response.setHeader('Set-Cookie', `${COOKIE_NAME}=${createSessionToken(session)}; ${getCookieAttributes()}`);
}

function clearSessionCookie(response) {
  response.setHeader('Set-Cookie', `${COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
}

function normalizeAuthBaseUrl() {
  return String(process.env.AUTH_BASE_URL || DEFAULT_AUTH_BASE_URL).replace(/\/+$/, '');
}

function resolveAuthUrl(explicitUrl, explicitPath, defaultPath) {
  if (explicitUrl) return explicitUrl;

  const baseUrl = normalizeAuthBaseUrl();
  const path = explicitPath || defaultPath;
  const normalizedPath = String(path).startsWith('/') ? path : `/${path}`;
  return `${baseUrl}${normalizedPath}`;
}

function getPasswordUrl() {
  return resolveAuthUrl(
    process.env.AUTH_PASSWORD_URL || process.env.AUTH_LOGIN_URL,
    process.env.AUTH_PASSWORD_PATH || process.env.AUTH_LOGIN_PATH,
    DEFAULT_PASSWORD_PATH
  );
}

function getCodeUrl() {
  return resolveAuthUrl(
    process.env.AUTH_GET_CODE_URL || process.env.AUTH_CODE_URL,
    process.env.AUTH_GET_CODE_PATH || process.env.AUTH_CODE_PATH,
    DEFAULT_CODE_PATH
  );
}

function getAuthenticationUrl() {
  return resolveAuthUrl(
    process.env.AUTH_AUTHENTICATION_URL,
    process.env.AUTH_AUTHENTICATION_PATH,
    DEFAULT_AUTHENTICATION_PATH
  );
}

function getAuthorizationUrl() {
  return resolveAuthUrl(
    process.env.AUTH_AUTHORIZATION_URL,
    process.env.AUTH_AUTHORIZATION_PATH,
    DEFAULT_AUTHORIZATION_PATH
  );
}

function getAuthDomain() {
  return process.env.AUTH_DOMAIN || 'wowlife-crm.ru';
}

function getAuthCabinet() {
  return process.env.AUTH_CABINET || 'partner';
}

function getAuthMethod() {
  return process.env.AUTH_METHOD || 'password';
}

function getPhoneAuthMethod() {
  return process.env.AUTH_PHONE_METHOD || 'phone';
}

function getEmailAuthMethod() {
  return process.env.AUTH_EMAIL_METHOD || 'email';
}

function collectNestedCandidates(value, depth = 0, seen = new Set()) {
  if (!value || typeof value !== 'object' || depth > 8 || seen.has(value)) {
    return [];
  }

  seen.add(value);
  const candidates = [value];
  const values = Array.isArray(value) ? value : Object.values(value);

  for (const child of values) {
    if (child && typeof child === 'object') {
      candidates.push(...collectNestedCandidates(child, depth + 1, seen));
    }
  }

  return candidates;
}

function getNestedCandidates(payload) {
  return collectNestedCandidates(payload).filter((candidate) => candidate && typeof candidate === 'object');
}

function normalizeFieldName(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function getObjectFieldCaseInsensitive(object, fieldName) {
  if (!object || typeof object !== 'object') return undefined;

  if (Object.prototype.hasOwnProperty.call(object, fieldName)) {
    return object[fieldName];
  }

  const normalizedTarget = normalizeFieldName(fieldName);
  const matchedKey = Object.keys(object).find((key) => normalizeFieldName(key) === normalizedTarget);
  return matchedKey ? object[matchedKey] : undefined;
}

function getValueByPath(payload, path) {
  if (!path) return undefined;

  return String(path)
    .split('.')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((current, part) => getObjectFieldCaseInsensitive(current, part), payload);
}

function pickFirstPath(payload, paths) {
  for (const path of paths) {
    const value = getValueByPath(payload, path);
    if (value !== undefined && value !== null && String(value) !== '') {
      return String(value);
    }
  }

  return null;
}

function pickFirstField(payload, fieldNames) {
  const normalizedNames = new Set(fieldNames.map(normalizeFieldName));

  for (const candidate of getNestedCandidates(payload)) {
    for (const [key, value] of Object.entries(candidate)) {
      if (value !== undefined && value !== null && String(value) !== '' && normalizedNames.has(normalizeFieldName(key))) {
        return String(value);
      }
    }
  }

  return null;
}

function hasBusinessError(payload) {
  const candidates = getNestedCandidates(payload);
  return candidates.some((candidate) =>
    candidate.success === false ||
    candidate.ok === false ||
    candidate.result === false ||
    candidate.status === false ||
    Boolean(candidate.error) ||
    Boolean(candidate.errorMessage)
  );
}

function getPayloadMessage(payload) {
  return pickFirstField(payload, ['message', 'error', 'errorMessage', 'description', 'detail']);
}

function pickUser(payload, login, fallback = {}) {
  const candidate =
    payload?.user ||
    payload?.contact ||
    payload?.data?.user ||
    payload?.data?.contact ||
    payload?.result?.user ||
    payload?.result?.contact ||
    payload?.response?.user ||
    payload?.response?.contact ||
    payload?.data ||
    payload?.result ||
    payload?.response ||
    payload ||
    {};

  const id =
    candidate.contactId ||
    candidate.contact_id ||
    candidate.id ||
    candidate.userId ||
    candidate.partnerId ||
    candidate.uuid ||
    fallback.contactId ||
    null;

  const email = candidate.email || candidate.login || (String(login).includes('@') ? login : null);

  return {
    id,
    name: candidate.name || candidate.fullName || candidate.displayName || candidate.title || email || login,
    email,
    phone: candidate.phone || candidate.phoneNumber || null,
    role: candidate.role || candidate.type || null
  };
}

function extractToken(payload) {
  const configuredPath = process.env.AUTH_PASSWORD_TOKEN_PATH || process.env.AUTH_TOKEN_PATH;
  return pickFirstPath(payload, [configuredPath].filter(Boolean)) || pickFirstField(payload, [
    'accessToken',
    'access_token',
    'token',
    'jwt',
    'authToken',
    'authorizationToken',
    'TOKEN',
    'AUTH_TOKEN'
  ]);
}

function extractRefreshToken(payload) {
  return pickFirstField(payload, ['refreshToken', 'refresh_token', 'REFRESH_TOKEN']);
}

function extractContactId(payload) {
  const configuredPath = process.env.AUTH_PASSWORD_CONTACT_ID_PATH || process.env.AUTH_CONTACT_ID_PATH;
  const configuredValue = pickFirstPath(payload, [configuredPath].filter(Boolean));
  if (configuredValue) return configuredValue;

  for (const candidate of getNestedCandidates(payload)) {
    const explicitValue = pickFirstField(candidate, [
      'contactId',
      'contact_id',
      'contactID',
      'CONTACT_ID'
    ]);
    if (explicitValue) return explicitValue;

    const contactValue = getObjectFieldCaseInsensitive(candidate, 'contact');
    if (contactValue !== undefined && contactValue !== null && typeof contactValue !== 'object' && String(contactValue) !== '') {
      return String(contactValue);
    }

    const idValue = pickFirstField(candidate, ['id', 'ID']);
    if (idValue) return idValue;
  }

  return null;
}

function extractAllIds(payload, fallbackId) {
  const configuredPath = process.env.AUTH_ALL_IDS_PATH;
  const configuredValue = configuredPath ? getValueByPath(payload, configuredPath) : undefined;

  const normalize = (value) => {
    if (Array.isArray(value)) {
      return value.map((item) => String(item)).filter(Boolean);
    }
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value)
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    }
    return [];
  };

  let ids = normalize(configuredValue);
  if (ids.length > 0) return Array.from(new Set(ids));

  const fieldNames = ['allIds', 'all_ids', 'ALL_IDS', 'partnerIds', 'partner_ids', 'ids', 'IDS'];
  for (const candidate of getNestedCandidates(payload)) {
    for (const fieldName of fieldNames) {
      ids = normalize(getObjectFieldCaseInsensitive(candidate, fieldName));
      if (ids.length > 0) return Array.from(new Set(ids));
    }
  }

  return fallbackId ? [String(fallbackId)] : [];
}

function sanitizeAuthPayload(value, depth = 0, seen = new Set()) {
  if (!value || typeof value !== 'object' || depth > 5 || seen.has(value)) {
    return value;
  }

  seen.add(value);

  if (Array.isArray(value)) {
    return value.slice(0, 5).map((item) => sanitizeAuthPayload(item, depth + 1, seen));
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => {
      const normalizedKey = normalizeFieldName(key);
      if (normalizedKey.includes('password')) return [key, '[hidden]'];
      if (normalizedKey.includes('token')) return [key, entry ? '[present]' : entry];
      return [key, sanitizeAuthPayload(entry, depth + 1, seen)];
    })
  );
}

function getSetCookieHeaders(headers) {
  if (typeof headers.getSetCookie === 'function') {
    return headers.getSetCookie();
  }

  const value = headers.get('set-cookie');
  return value ? [value] : [];
}

function buildPasswordBody({ login, password }) {
  return {
    domain: getAuthDomain(),
    cabinet: getAuthCabinet(),
    method: getAuthMethod(),
    login,
    password
  };
}

function buildCodeBody({ contact, method = getPhoneAuthMethod() }) {
  return {
    domain: getAuthDomain(),
    cabinet: getAuthCabinet(),
    contact,
    method
  };
}

function buildAuthenticationBody({ contact, code, method = getPhoneAuthMethod() }) {
  return {
    domain: getAuthDomain(),
    cabinet: getAuthCabinet(),
    contact,
    code,
    method
  };
}

function buildAuthorizationBody({ contactId, token }) {
  return {
    domain: getAuthDomain(),
    cabinet: getAuthCabinet(),
    contactId: String(contactId),
    token
  };
}

async function requestJsonPost(url, body, options = {}) {
  const cookieHeader = Array.isArray(options.cookies)
    ? options.cookies.map((cookie) => String(cookie).split(';')[0]).filter(Boolean).join('; ')
    : '';

  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/plain, */*',
    'Origin': normalizeAuthBaseUrl(),
    'Referer': `${normalizeAuthBaseUrl()}/authentication/sign-in`
  };

  if (cookieHeader) {
    headers.Cookie = cookieHeader;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });

  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch (_error) {
    payload = { message: text };
  }

  return {
    ok: response.ok && !hasBusinessError(payload),
    httpOk: response.ok,
    status: response.status,
    payload,
    cookies: getSetCookieHeaders(response.headers)
  };
}

function throwAuthRejected(result, fallbackMessage = 'Неверный логин или пароль') {
  const error = new Error('Partner auth rejected credentials');
  error.statusCode = result.status === 401 || result.status === 403 ? 401 : 502;
  error.publicMessage = getPayloadMessage(result.payload) || fallbackMessage;
  throw error;
}

function normalizePhoneContact(value) {
  const digitsAll = String(value || '').replace(/[^\d]/g, '');
  if (!digitsAll) return '';

  let digits = digitsAll;
  if (digits.startsWith('8')) digits = `7${digits.slice(1)}`;
  if (!digits.startsWith('7') && digits.length === 10) digits = `7${digits}`;

  return `+${digits.slice(0, 15)}`;
}

function normalizeEmailContact(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeCodeContact(value, method = getPhoneAuthMethod()) {
  const normalizedMethod = String(method || '').toLowerCase();
  if (normalizedMethod === 'email' || normalizedMethod === getEmailAuthMethod().toLowerCase()) {
    return normalizeEmailContact(value);
  }
  return normalizePhoneContact(value);
}

function getCodeContactLabel(method = getPhoneAuthMethod()) {
  const normalizedMethod = String(method || '').toLowerCase();
  return normalizedMethod === 'email' || normalizedMethod === getEmailAuthMethod().toLowerCase() ? 'Email' : 'Телефон';
}


function getAuthorizationContactIdFromSession(session) {
  return (
    session?.upstream?.contactId ||
    session?.upstream?.allIds?.[0] ||
    session?.user?.id ||
    null
  );
}

function getAuthorizationTokenFromSession(session) {
  return (
    session?.upstream?.token ||
    session?.upstream?.authToken ||
    session?.upstream?.accessToken ||
    null
  );
}

function mergeAuthCookies(existingCookies = [], nextCookies = []) {
  const cookieMap = new Map();

  [...existingCookies, ...nextCookies]
    .map((cookie) => String(cookie || '').trim())
    .filter(Boolean)
    .forEach((cookie) => {
      const key = cookie.split(';')[0].split('=')[0];
      if (key) cookieMap.set(key, cookie);
    });

  return Array.from(cookieMap.values());
}

async function refreshAuthorizationSession({ session }) {
  const contactId = getAuthorizationContactIdFromSession(session);
  const token = getAuthorizationTokenFromSession(session);

  if (!contactId || !token) {
    const error = new Error('No contactId/token in session for authorization refresh');
    error.statusCode = 401;
    error.publicMessage = 'В сессии не найден contactId/token для повторной авторизации WOWlife.';
    throw error;
  }

  const authorizationUrl = getAuthorizationUrl();
  let authorizationResult;

  try {
    authorizationResult = await requestJsonPost(
      authorizationUrl,
      buildAuthorizationBody({ contactId, token }),
      { cookies: session?.upstream?.cookies || [] }
    );
  } catch (error) {
    const serviceError = new Error(`WOWlife authorization refresh request failed: ${error.message}`);
    serviceError.statusCode = 502;
    serviceError.publicMessage = 'Не удалось повторно выполнить авторизацию WOWlife auth.authorization.';
    throw serviceError;
  }

  if (!authorizationResult.ok) {
    throwAuthRejected(authorizationResult, 'Не удалось повторно выполнить авторизацию WOWlife');
  }

  const refreshedContactId = extractContactId(authorizationResult.payload) || String(contactId);
  const refreshedToken = extractToken(authorizationResult.payload) || token;
  const refreshedAllIds = extractAllIds(authorizationResult.payload, null);
  const existingAllIds = Array.isArray(session?.upstream?.allIds)
    ? session.upstream.allIds.map((id) => String(id)).filter(Boolean)
    : [];
  const allIds = refreshedAllIds.length > 0
    ? refreshedAllIds
    : (existingAllIds.length > 0 ? existingAllIds : [String(refreshedContactId)]);
  const refreshedUser = session?.user || pickUser(authorizationResult.payload, String(refreshedContactId), { contactId: refreshedContactId });

  return {
    session: {
      ...session,
      user: refreshedUser,
      upstream: {
        ...(session?.upstream || {}),
        token: refreshedToken,
        refreshToken: extractRefreshToken(authorizationResult.payload) || session?.upstream?.refreshToken || null,
        authUrl: authorizationUrl,
        contactId: refreshedContactId,
        allIds,
        cookies: mergeAuthCookies(session?.upstream?.cookies || [], authorizationResult.cookies)
      }
    },
    payload: authorizationResult.payload,
    request: {
      domain: getAuthDomain(),
      cabinet: getAuthCabinet(),
      contactId: String(contactId)
    }
  };
}

async function requestAuthCode({ contact, method = getPhoneAuthMethod() }) {
  const normalizedMethod = String(method || getPhoneAuthMethod()).toLowerCase();
  const normalizedContact = normalizeCodeContact(contact, normalizedMethod);
  const contactLabel = getCodeContactLabel(normalizedMethod);

  if (!normalizedContact) {
    const error = new Error('Contact is required');
    error.statusCode = 400;
    error.publicMessage = `${contactLabel} обязателен`;
    throw error;
  }

  if (normalizedMethod === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedContact)) {
    const error = new Error('Valid email is required');
    error.statusCode = 400;
    error.publicMessage = 'Введите корректный email';
    throw error;
  }

  if (process.env.AUTH_MOCK === 'true') {
    return { ok: true, contact: normalizedContact, method: normalizedMethod, upstream: { codeUrl: 'mock' } };
  }

  const codeUrl = getCodeUrl();
  let codeResult;

  try {
    codeResult = await requestJsonPost(codeUrl, buildCodeBody({ contact: normalizedContact, method: normalizedMethod }));
  } catch (error) {
    const serviceError = new Error(`WOWlife auth.getCode request failed: ${error.message}`);
    serviceError.statusCode = 502;
    serviceError.publicMessage = 'Не удалось отправить код через сервис авторизации WOWlife auth.getCode.';
    throw serviceError;
  }

  if (!codeResult.ok) {
    throwAuthRejected(codeResult, 'Не удалось отправить код авторизации');
  }

  return { ok: true, contact: normalizedContact, method: normalizedMethod, upstream: { codeUrl, cookies: codeResult.cookies } };
}

async function requestSmsCode({ contact }) {
  return requestAuthCode({ contact, method: getPhoneAuthMethod() });
}

async function signInWithCode({ contact, code, method = getPhoneAuthMethod() }) {
  const normalizedMethod = String(method || getPhoneAuthMethod()).toLowerCase();
  const normalizedContact = normalizeCodeContact(contact, normalizedMethod);
  const normalizedCode = String(code || '').trim();
  const contactLabel = getCodeContactLabel(normalizedMethod);

  if (!normalizedContact || !normalizedCode) {
    const error = new Error('Contact and code are required');
    error.statusCode = 400;
    error.publicMessage = `${contactLabel} и код обязательны`;
    throw error;
  }

  if (process.env.AUTH_MOCK === 'true') {
    return {
      user: {
        id: 'mock-user',
        name: normalizedContact,
        email: normalizedMethod === 'email' ? normalizedContact : null,
        phone: normalizedMethod === 'email' ? null : normalizedContact,
        role: 'mock'
      },
      upstream: { token: null, refreshToken: null, cookies: [], authUrl: 'mock', authenticationUrl: 'mock', contactId: 'mock-user', allIds: ['mock-user'] }
    };
  }

  const authenticationUrl = getAuthenticationUrl();
  const authorizationUrl = getAuthorizationUrl();
  let authenticationResult;

  try {
    authenticationResult = await requestJsonPost(
      authenticationUrl,
      buildAuthenticationBody({ contact: normalizedContact, code: normalizedCode, method: normalizedMethod })
    );
  } catch (error) {
    const serviceError = new Error(`WOWlife auth.authentication request failed: ${error.message}`);
    serviceError.statusCode = 502;
    serviceError.publicMessage = 'Не удалось проверить код через сервис авторизации WOWlife auth.authentication.';
    throw serviceError;
  }

  if (!authenticationResult.ok) {
    throwAuthRejected(authenticationResult, 'Неверный код авторизации');
  }

  const contactId = extractContactId(authenticationResult.payload);
  const token = extractToken(authenticationResult.payload);
  const allIds = extractAllIds(authenticationResult.payload, contactId);

  if (!contactId || !token) {
    console.warn('WOWlife auth.authentication payload missing contactId/token', sanitizeAuthPayload(authenticationResult.payload));
    const error = new Error('WOWlife auth.authentication did not return contactId/token');
    error.statusCode = 502;
    error.publicMessage = 'Сервис авторизации WOWlife не вернул contactId/token после проверки кода.';
    throw error;
  }

  let authorizationResult;
  try {
    authorizationResult = await requestJsonPost(
      authorizationUrl,
      buildAuthorizationBody({ contactId, token }),
      { cookies: authenticationResult.cookies }
    );
  } catch (error) {
    const serviceError = new Error(`WOWlife authorization request failed: ${error.message}`);
    serviceError.statusCode = 502;
    serviceError.publicMessage = 'Не удалось завершить авторизацию WOWlife auth.authorization.';
    throw serviceError;
  }

  if (!authorizationResult.ok) {
    throwAuthRejected(authorizationResult, 'Не удалось завершить авторизацию WOWlife');
  }

  return {
    user: pickUser(authorizationResult.payload, normalizedContact, { contactId }),
    upstream: {
      token: extractToken(authorizationResult.payload) || token,
      refreshToken: extractRefreshToken(authorizationResult.payload),
      cookies: [...authenticationResult.cookies, ...authorizationResult.cookies],
      authUrl: authorizationUrl,
      authenticationUrl,
      contactId,
      allIds
    }
  };
}

async function signInWithSmsCode({ contact, code }) {
  return signInWithCode({ contact, code, method: getPhoneAuthMethod() });
}

async function signInWithPartner({ login, password }) {
  if (!login || !password) {
    const error = new Error('Login and password are required');
    error.statusCode = 400;
    error.publicMessage = 'Логин и пароль обязательны';
    throw error;
  }

  if (process.env.AUTH_MOCK === 'true') {
    return {
      user: { id: 'mock-user', name: login, email: login, phone: null, role: 'mock' },
      upstream: { token: null, refreshToken: null, cookies: [], authUrl: 'mock', contactId: 'mock-user', allIds: ['mock-user'] }
    };
  }

  const passwordUrl = getPasswordUrl();
  const authorizationUrl = getAuthorizationUrl();
  let passwordResult;

  try {
    passwordResult = await requestJsonPost(passwordUrl, buildPasswordBody({ login, password }));
  } catch (error) {
    const serviceError = new Error(`WOWlife password auth request failed: ${error.message}`);
    serviceError.statusCode = 502;
    serviceError.publicMessage = 'Не удалось подключиться к сервису авторизации WOWlife auth.goPassword.';
    throw serviceError;
  }

  if (!passwordResult.ok) {
    throwAuthRejected(passwordResult);
  }

  const contactId = extractContactId(passwordResult.payload);
  const token = extractToken(passwordResult.payload);
  const allIds = extractAllIds(passwordResult.payload, contactId);

  if (!contactId || !token) {
    console.warn('WOWlife auth.goPassword payload missing contactId/token', sanitizeAuthPayload(passwordResult.payload));
    const error = new Error('WOWlife auth.goPassword did not return contactId/token');
    error.statusCode = 502;
    error.publicMessage = 'Сервис авторизации WOWlife не вернул contactId/token для второго шага авторизации.';
    throw error;
  }

  let authorizationResult;
  try {
    authorizationResult = await requestJsonPost(authorizationUrl, buildAuthorizationBody({ contactId, token }), { cookies: passwordResult.cookies });
  } catch (error) {
    const serviceError = new Error(`WOWlife authorization request failed: ${error.message}`);
    serviceError.statusCode = 502;
    serviceError.publicMessage = 'Не удалось завершить авторизацию WOWlife auth.authorization.';
    throw serviceError;
  }

  if (!authorizationResult.ok) {
    throwAuthRejected(authorizationResult, 'Не удалось завершить авторизацию WOWlife');
  }

  return {
    user: pickUser(authorizationResult.payload, login, { contactId }),
    upstream: {
      token: extractToken(authorizationResult.payload) || token,
      refreshToken: extractRefreshToken(authorizationResult.payload),
      cookies: [...passwordResult.cookies, ...authorizationResult.cookies],
      authUrl: authorizationUrl,
      passwordAuthUrl: passwordUrl,
      contactId,
      allIds
    }
  };
}

function buildSession({ user, upstream }) {
  const ttlSeconds = getSessionTtlSeconds();
  return {
    user,
    upstream: {
      token: upstream?.token || null,
      refreshToken: upstream?.refreshToken || null,
      authUrl: upstream?.authUrl || null,
      authenticationUrl: upstream?.authenticationUrl || null,
      passwordAuthUrl: upstream?.passwordAuthUrl || null,
      contactId: upstream?.contactId || null,
      allIds: Array.isArray(upstream?.allIds) ? upstream.allIds.map((id) => String(id)).filter(Boolean) : [],
      cookies: Array.isArray(upstream?.cookies) ? upstream.cookies : []
    },
    issuedAt: Date.now(),
    expiresAt: Date.now() + ttlSeconds * 1000
  };
}

module.exports = {
  COOKIE_NAME,
  getRequestSession,
  setSessionCookie,
  clearSessionCookie,
  signInWithPartner,
  requestSmsCode,
  requestAuthCode,
  signInWithSmsCode,
  signInWithCode,
  refreshAuthorizationSession,
  buildSession
};
