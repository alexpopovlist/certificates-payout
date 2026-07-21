const { query } = require('../db');

const BOOKING_NAME_OPTIONS = ['yclients', 'dikidi Business', 'Собственная', 'Отсутствует', 'Нет данных'];
const AUTH_TYPE_OPTIONS = ['Базовый', 'Нет данных'];
const DEFAULT_YCLIENTS_API_BASE_URL = 'https://api.yclients.com/api/v1';
const DEFAULT_YCLIENTS_AUTH_PATH = '/auth';

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

async function fetchYclientsUserToken({ login, password, partnerToken: providedPartnerToken } = {}) {
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

function getYclientsEnvUserToken() {
  return normalizeText(process.env.YCLIENTS_USER_TOKEN || process.env.YCLIENTS_SYSTEM_USER_TOKEN);
}

async function verifyYclientsUserToken({ partnerToken, userToken } = {}) {
  const response = await fetch(getYclientsCompaniesUrl(), {
    method: 'GET',
    headers: {
      'Accept': 'application/vnd.yclients.v2+json, application/json, text/plain, */*',
      'Authorization': yclientsAuthorizationHeader({ partnerToken, userToken })
    }
  });

  if (!response.ok) {
    const payload = parseJsonSafe(await response.text());
    const message = payload?.meta?.message
      || payload?.message
      || payload?.error
      || payload?.errors?.[0]?.message
      || 'YCLIENTS не подтвердил доступ по YCLIENTS_PARTNER_TOKEN и YCLIENTS_USER_TOKEN.';
    throw buildServiceError(message, response.status, payload);
  }

  return true;
}

function yclientsOpenWarning(error) {
  const message = normalizeText(error?.publicMessage || error?.message);
  return message || 'ошибка проверки YCLIENTS API';
}

async function authorizeYclientsForExternalOpen(data = {}) {
  const partnerToken = getYclientsPartnerToken();
  const envUserToken = getYclientsEnvUserToken();
  const login = normalizeText(data.login);
  const password = normalizeText(data.password);

  if (partnerToken && login && password) {
    try {
      await fetchYclientsUserToken({ login, password, partnerToken });
      return {
        apiAuthorized: true,
        authMode: 'yclients-api-crm-login-password',
        partnerTokenSource: 'env',
        userTokenSource: 'crm-data-login-password',
        message: 'YCLIENTS API-проверка выполнена по логину и паролю из экрана «Данные CRM». Web-кабинет открыт в новой вкладке.'
      };
    } catch (error) {
      return {
        apiAuthorized: false,
        authMode: 'yclients-api-crm-login-password-failed',
        partnerTokenSource: 'env',
        userTokenSource: 'crm-data-login-password',
        message: `YCLIENTS открыт в новой вкладке. API-проверка по данным экрана «Данные CRM» не выполнена: ${yclientsOpenWarning(error)}.`
      };
    }
  }

  if (partnerToken && envUserToken) {
    try {
      await verifyYclientsUserToken({ partnerToken, userToken: envUserToken });
      return {
        apiAuthorized: true,
        authMode: 'yclients-api-env-user-token',
        partnerTokenSource: 'env',
        userTokenSource: 'env',
        message: 'YCLIENTS API-проверка по YCLIENTS_PARTNER_TOKEN и YCLIENTS_USER_TOKEN выполнена. Web-кабинет открыт в новой вкладке.'
      };
    } catch (error) {
      return {
        apiAuthorized: false,
        authMode: 'yclients-api-env-user-token-failed',
        partnerTokenSource: 'env',
        userTokenSource: 'env',
        message: `YCLIENTS открыт в новой вкладке. API-проверка по env-токенам не выполнена: ${yclientsOpenWarning(error)}.`
      };
    }
  }

  if (login && password) {
    return {
      apiAuthorized: false,
      authMode: 'yclients-login-password-only',
      userTokenSource: 'crm-data-login-password',
      message: 'YCLIENTS открыт в новой вкладке. Для API-проверки добавьте YCLIENTS_PARTNER_TOKEN; логин и пароль берутся с экрана «Данные CRM».'
    };
  }

  return {
    apiAuthorized: false,
    authMode: 'yclients-no-auth-data',
    message: 'YCLIENTS открыт в новой вкладке без API-проверки: заполните логин и пароль на экране «Данные CRM» или задайте YCLIENTS_USER_TOKEN в env.'
  };
}

function yclientsAuthorizationHeader({ partnerToken, userToken } = {}) {
  return `Bearer ${partnerToken}, User ${userToken}`;
}

async function createBookingOpenTarget({ session, data } = {}) {
  getSessionProfileId(session);
  const normalized = normalizeBookingCrmData(data || {});
  const parsedTargetUrl = parseBookingUrl(normalized.bookingUrl);
  const targetUrl = parsedTargetUrl.toString();

  if (isYclientsBooking(normalized) && normalized.authType === 'Базовый') {
    if (!isAllowedYclientsHost(parsedTargetUrl)) {
      throw buildServiceError('Для авторизации YCLIENTS укажите ссылку на домене yclients.com.');
    }

    const authResult = await authorizeYclientsForExternalOpen(normalized);
    return {
      result: true,
      openUrl: targetUrl,
      externalUrl: targetUrl,
      ...authResult
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
  createBookingOpenTarget
};
