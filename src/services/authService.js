const crypto = require('crypto');

const COOKIE_NAME = 'wakesurf_session';
const DEFAULT_AUTH_BASE_URL = 'https://partner-wowlife.ru';
const DEFAULT_LOGIN_PATHS = [
  '/api/authentication/sign-in',
  '/api/auth/sign-in',
  '/api/account/sign-in',
  '/api/login',
  '/authentication/sign-in'
];

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

function getLoginUrls() {
  if (process.env.AUTH_LOGIN_URL) {
    return [process.env.AUTH_LOGIN_URL];
  }

  const baseUrl = normalizeAuthBaseUrl();
  const configuredPath = process.env.AUTH_LOGIN_PATH;
  const paths = configuredPath ? [configuredPath] : DEFAULT_LOGIN_PATHS;

  return paths.map((path) => {
    const normalizedPath = String(path).startsWith('/') ? path : `/${path}`;
    return `${baseUrl}${normalizedPath}`;
  });
}

function pickUser(payload, login) {
  const candidate = payload?.user || payload?.data?.user || payload?.partner || payload?.data || payload || {};
  return {
    id: candidate.id || candidate.userId || candidate.partnerId || candidate.uuid || null,
    name: candidate.name || candidate.fullName || candidate.displayName || candidate.title || login,
    email: candidate.email || candidate.login || null,
    phone: candidate.phone || candidate.phoneNumber || null,
    role: candidate.role || candidate.type || null
  };
}

function extractToken(payload) {
  const data = payload?.data || payload || {};
  return (
    data.accessToken ||
    data.access_token ||
    data.token ||
    data.jwt ||
    data.authToken ||
    payload?.accessToken ||
    payload?.token ||
    null
  );
}

function extractRefreshToken(payload) {
  const data = payload?.data || payload || {};
  return data.refreshToken || data.refresh_token || payload?.refreshToken || null;
}

function getSetCookieHeaders(headers) {
  if (typeof headers.getSetCookie === 'function') {
    return headers.getSetCookie();
  }

  const value = headers.get('set-cookie');
  return value ? [value] : [];
}

function buildCredentialsBody({ login, password }) {
  const usernameField = process.env.AUTH_USERNAME_FIELD || 'login';
  const passwordField = process.env.AUTH_PASSWORD_FIELD || 'password';
  return {
    [usernameField]: login,
    [passwordField]: password
  };
}

async function requestRemoteSignIn(url, body) {
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
    ok: response.ok,
    status: response.status,
    payload,
    cookies: getSetCookieHeaders(response.headers)
  };
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

  const credentialsBody = buildCredentialsBody({ login, password });
  const urls = getLoginUrls();
  const failures = [];

  for (const url of urls) {
    try {
      const result = await requestRemoteSignIn(url, credentialsBody);

      if (result.ok) {
        return {
          user: pickUser(result.payload, login),
          upstream: {
            token: extractToken(result.payload),
            refreshToken: extractRefreshToken(result.payload),
            cookies: result.cookies,
            authUrl: url
          }
        };
      }

      failures.push(`${url}: HTTP ${result.status}`);

      if (![404, 405].includes(result.status)) {
        const error = new Error('Partner auth rejected credentials');
        error.statusCode = result.status === 401 || result.status === 403 ? 401 : 502;
        error.publicMessage = result.payload?.message || result.payload?.error || 'Неверный логин или пароль';
        throw error;
      }
    } catch (error) {
      if (error.statusCode) throw error;
      failures.push(`${url}: ${error.message}`);
    }
  }

  const error = new Error(`Partner auth endpoint is not available. Tried: ${failures.join('; ')}`);
  error.statusCode = 502;
  error.publicMessage = 'Не удалось подключиться к сервису авторизации WOWlife. Проверьте AUTH_LOGIN_URL/AUTH_LOGIN_PATH.';
  throw error;
}

function buildSession({ user, upstream }) {
  const ttlSeconds = getSessionTtlSeconds();
  return {
    user,
    upstream: {
      token: upstream?.token || null,
      refreshToken: upstream?.refreshToken || null,
      authUrl: upstream?.authUrl || null
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
