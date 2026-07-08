const crypto = require('crypto');

const COOKIE_NAME = 'wakesurf_session';
const DEFAULT_AUTH_BASE_URL = 'https://partner-wowlife.ru';
const DEFAULT_PASSWORD_PATH = '/restapi/auth.goPassword';
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

function getNestedCandidates(payload) {
  return [
    payload,
    payload?.data,
    payload?.result,
    payload?.response,
    payload?.payload,
    payload?.user,
    payload?.contact,
    payload?.data?.user,
    payload?.data?.contact,
    payload?.result?.user,
    payload?.result?.contact,
    payload?.response?.user,
    payload?.response?.contact
  ].filter((candidate) => candidate && typeof candidate === 'object');
}

function pickFirstField(payload, fieldNames) {
  for (const candidate of getNestedCandidates(payload)) {
    for (const fieldName of fieldNames) {
      const value = candidate[fieldName];
      if (value !== undefined && value !== null && String(value) !== '') {
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
  return pickFirstField(payload, [
    'accessToken',
    'access_token',
    'token',
    'jwt',
    'authToken',
    'authorizationToken'
  ]);
}

function extractRefreshToken(payload) {
  return pickFirstField(payload, ['refreshToken', 'refresh_token']);
}

function extractContactId(payload) {
  return pickFirstField(payload, ['contactId', 'contact_id', 'contactID']);
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

function buildAuthorizationBody({ contactId, token }) {
  return {
    domain: getAuthDomain(),
    cabinet: getAuthCabinet(),
    contactId: String(contactId),
    token
  };
}

async function requestJsonPost(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/plain, */*',
      'Origin': normalizeAuthBaseUrl(),
      'Referer': `${normalizeAuthBaseUrl()}/authentication/sign-in`
    },
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
      upstream: { token: null, refreshToken: null, cookies: [], authUrl: 'mock' }
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

  if (!contactId || !token) {
    const error = new Error('WOWlife auth.goPassword did not return contactId/token');
    error.statusCode = 502;
    error.publicMessage = 'Сервис авторизации WOWlife не вернул contactId/token для второго шага авторизации.';
    throw error;
  }

  let authorizationResult;
  try {
    authorizationResult = await requestJsonPost(authorizationUrl, buildAuthorizationBody({ contactId, token }));
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
      contactId
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
      passwordAuthUrl: upstream?.passwordAuthUrl || null,
      contactId: upstream?.contactId || null
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
  buildSession
};
