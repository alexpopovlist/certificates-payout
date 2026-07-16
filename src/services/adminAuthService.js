const crypto = require('crypto');
const { query } = require('../db');

const ADMIN_COOKIE_NAME = 'wowlife_admin_session';

function getAdminSessionSecret() {
  return process.env.ADMIN_SESSION_SECRET || process.env.AUTH_SESSION_SECRET || process.env.PUSH_ADMIN_TOKEN || 'local-admin-session-secret';
}

function getAdminSessionTtlSeconds() {
  const value = Number(process.env.ADMIN_SESSION_TTL_SECONDS || 60 * 60 * 12);
  return Number.isFinite(value) && value > 0 ? value : 60 * 60 * 12;
}

function normalizeLogin(value) {
  return String(value || '').trim();
}

function base64UrlEncode(value) {
  return Buffer.from(value).toString('base64url');
}

function base64UrlDecode(value) {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function sign(value) {
  return crypto
    .createHmac('sha256', getAdminSessionSecret())
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

function getAdminRequestSession(request) {
  const cookies = parseCookies(request.headers.cookie || '');
  return readSessionToken(cookies[ADMIN_COOKIE_NAME]);
}

function getCookieAttributes(maxAgeSeconds = getAdminSessionTtlSeconds()) {
  const secure = process.env.NODE_ENV === 'production';
  return [
    `Max-Age=${maxAgeSeconds}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    secure ? 'Secure' : ''
  ].filter(Boolean).join('; ');
}

function setAdminSessionCookie(response, session) {
  response.setHeader('Set-Cookie', `${ADMIN_COOKIE_NAME}=${createSessionToken(session)}; ${getCookieAttributes()}`);
}

function clearAdminSessionCookie(response) {
  response.setHeader('Set-Cookie', `${ADMIN_COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
}

function buildAdminSession(user) {
  const ttlSeconds = getAdminSessionTtlSeconds();
  return {
    user,
    issuedAt: Date.now(),
    expiresAt: Date.now() + ttlSeconds * 1000
  };
}

function rowToAdminUser(row) {
  return {
    id: row.id,
    login: row.login,
    role: row.role,
    isSuperAdmin: Boolean(row.is_super_admin)
  };
}

async function signInAdmin({ login, password }) {
  const normalizedLogin = normalizeLogin(login);
  const normalizedPassword = String(password || '');

  if (!normalizedLogin || !normalizedPassword) {
    const error = new Error('Admin login and password are required');
    error.statusCode = 400;
    error.publicMessage = 'Логин и пароль обязательны';
    throw error;
  }

  const { rows } = await query(
    `
      SELECT id, login, role, is_super_admin
      FROM admin_users
      WHERE lower(login) = lower($1)
        AND is_active = TRUE
        AND password_hash = crypt($2, password_hash)
      LIMIT 1
    `,
    [normalizedLogin, normalizedPassword]
  );

  if (rows.length === 0) {
    const error = new Error('Admin credentials rejected');
    error.statusCode = 401;
    error.publicMessage = 'Неверный логин или пароль администратора';
    throw error;
  }

  return rowToAdminUser(rows[0]);
}

async function registerAdmin({ login, password, inviteCode }) {
  const expectedInviteCode = process.env.MY_INVITE_CODE || process.env.ADMIN_INVITE_CODE || '';
  const normalizedLogin = normalizeLogin(login);
  const normalizedPassword = String(password || '');
  const normalizedInviteCode = String(inviteCode || '').trim();

  if (!expectedInviteCode) {
    const error = new Error('Admin invite code is not configured');
    error.statusCode = 503;
    error.publicMessage = 'Регистрация администраторов не настроена: добавьте MY_INVITE_CODE в env.';
    throw error;
  }

  if (!normalizedLogin || normalizedPassword.length < 6 || !normalizedInviteCode) {
    const error = new Error('Invalid admin registration payload');
    error.statusCode = 400;
    error.publicMessage = 'Укажите логин, пароль от 6 символов и invite-код';
    throw error;
  }

  if (normalizedInviteCode !== expectedInviteCode) {
    const error = new Error('Admin invite code rejected');
    error.statusCode = 403;
    error.publicMessage = 'Неверный invite-код';
    throw error;
  }

  try {
    const { rows } = await query(
      `
        INSERT INTO admin_users (login, password_hash, role, is_super_admin, is_active)
        VALUES ($1, crypt($2, gen_salt('bf')), 'admin', FALSE, TRUE)
        RETURNING id, login, role, is_super_admin
      `,
      [normalizedLogin, normalizedPassword]
    );

    return rowToAdminUser(rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      error.statusCode = 409;
      error.publicMessage = 'Администратор с таким логином уже существует';
    }
    throw error;
  }
}

function requireAdminAuth(request, response, next) {
  const session = getAdminRequestSession(request);
  if (!session?.user?.id) {
    return response.status(401).json({ error: 'Требуется вход администратора' });
  }

  request.admin = session;
  return next();
}

module.exports = {
  ADMIN_COOKIE_NAME,
  getAdminRequestSession,
  setAdminSessionCookie,
  clearAdminSessionCookie,
  buildAdminSession,
  signInAdmin,
  registerAdmin,
  requireAdminAuth
};
