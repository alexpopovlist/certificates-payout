const { randomUUID } = require('crypto');
const { query } = require('../db');

const BOOKING_NAME_OPTIONS = ['yclients', 'dikidi Business', 'Собственная', 'Отсутствует', 'Нет данных'];
const AUTH_TYPE_OPTIONS = ['Базовый', 'Нет данных'];
const DEFAULT_YCLIENTS_API_BASE_URL = 'https://api.yclients.com/api/v1';
const DEFAULT_YCLIENTS_AUTH_PATH = '/auth';
const BOOKING_FRAME_SESSION_TTL_MS = 5 * 60 * 1000;
const bookingFrameSessions = new Map();

function normalizeText(value) {
  return String(value ?? '').trim();
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

function getYclientsAuthUrl() {
  if (process.env.YCLIENTS_AUTH_URL) return process.env.YCLIENTS_AUTH_URL;

  const baseUrl = String(process.env.YCLIENTS_API_BASE_URL || DEFAULT_YCLIENTS_API_BASE_URL).replace(/\/+$/, '');
  const path = String(process.env.YCLIENTS_AUTH_PATH || DEFAULT_YCLIENTS_AUTH_PATH);
  return `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
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

async function fetchYclientsUserToken({ login, password } = {}) {
  const normalizedLogin = normalizeText(login);
  const normalizedPassword = normalizeText(password);
  const partnerToken = getYclientsPartnerToken();

  if (!normalizedLogin || !normalizedPassword) {
    throw buildServiceError('Для авторизации в YCLIENTS заполните логин и пароль.');
  }

  if (!partnerToken) {
    throw buildServiceError('Не настроена переменная окружения YCLIENTS_PARTNER_TOKEN для авторизации YCLIENTS.', 500);
  }

  const response = await fetch(getYclientsAuthUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/vnd.yclients.v2+json, application/json, text/plain, */*',
      'Authorization': `Bearer ${partnerToken}`
    },
    body: JSON.stringify({
      login: normalizedLogin,
      password: normalizedPassword
    })
  });

  const text = await response.text();
  const payload = parseJsonSafe(text);
  const userToken = getYclientsUserTokenFromPayload(payload);
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
    payload
  };
}

function yclientsAuthorizationHeader({ partnerToken, userToken } = {}) {
  return `Bearer ${partnerToken}, User ${userToken}`;
}

function cleanupBookingFrameSessions() {
  const now = Date.now();
  for (const [id, frameSession] of bookingFrameSessions.entries()) {
    if (!frameSession || frameSession.expiresAt <= now) {
      bookingFrameSessions.delete(id);
    }
  }
}

function createLocalFrameSession({ targetUrl, headers = {}, externalUrl, authMode = 'none' } = {}) {
  cleanupBookingFrameSessions();
  const id = randomUUID();
  bookingFrameSessions.set(id, {
    id,
    targetUrl,
    headers,
    externalUrl: externalUrl || targetUrl,
    authMode,
    createdAt: Date.now(),
    expiresAt: Date.now() + BOOKING_FRAME_SESSION_TTL_MS
  });
  return id;
}

function getBookingFrameSession(id) {
  cleanupBookingFrameSessions();
  const frameSession = bookingFrameSessions.get(normalizeText(id));
  if (!frameSession) {
    throw buildServiceError('Сессия открытия Booking истекла. Нажмите «Открыть Booking» ещё раз.', 404);
  }
  return frameSession;
}

function injectHtmlBase(html, targetUrl) {
  const baseHref = new URL('.', targetUrl).href;
  const baseTag = `<base href="${baseHref}">`;
  if (/<base\s/i.test(html)) return html;
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${baseTag}`);
  }
  return `${baseTag}${html}`;
}

function isYclientsBooking(data = {}) {
  return normalizeText(data.bookingName).toLowerCase() === 'yclients';
}

async function createBookingOpenFrame({ session, data } = {}) {
  getSessionProfileId(session);
  const normalized = normalizeBookingCrmData(data || {});
  const targetUrl = parseBookingUrl(normalized.bookingUrl).toString();

  if (isYclientsBooking(normalized) && normalized.authType === 'Базовый') {
    const { userToken, partnerToken } = await fetchYclientsUserToken({
      login: normalized.login,
      password: normalized.password
    });

    const frameId = createLocalFrameSession({
      targetUrl,
      externalUrl: targetUrl,
      authMode: 'yclients-api',
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7',
        'Authorization': yclientsAuthorizationHeader({ partnerToken, userToken })
      }
    });

    return {
      result: true,
      iframeUrl: `/api/crm-data/booking-frame/${encodeURIComponent(frameId)}`,
      externalUrl: targetUrl,
      authMode: 'yclients-api',
      message: 'YCLIENTS авторизован через API, данные открываются в iframe через защищённый локальный proxy.'
    };
  }

  const iframeUrl = buildBasicAuthUrl(normalized);
  return {
    result: true,
    iframeUrl,
    externalUrl: iframeUrl,
    authMode: normalized.authType === 'Базовый' ? 'basic-url' : 'none',
    message: normalized.authType === 'Базовый'
      ? 'Booking открыт в iframe с базовой авторизацией по сохранённым логину и паролю.'
      : 'Booking открыт в iframe без подстановки авторизации.'
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
  createBookingOpenFrame,
  getBookingFrameSession,
  injectHtmlBase
};
