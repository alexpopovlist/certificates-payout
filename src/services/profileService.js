const DEFAULT_AUTH_BASE_URL = 'https://partner-wowlife.ru';
const DEFAULT_PROFILE_PATH = '/restapi/profile.getProfile';

function normalizeBaseUrl() {
  return String(process.env.AUTH_BASE_URL || DEFAULT_AUTH_BASE_URL).replace(/\/+$/, '');
}

function resolveUrl(explicitUrl, explicitPath, defaultPath) {
  if (explicitUrl) return explicitUrl;
  const path = explicitPath || defaultPath;
  const normalizedPath = String(path).startsWith('/') ? path : `/${path}`;
  return `${normalizeBaseUrl()}${normalizedPath}`;
}

function getProfileUrl() {
  return resolveUrl(
    process.env.PROFILE_SERVICE_URL || process.env.AUTH_PROFILE_URL,
    process.env.PROFILE_SERVICE_PATH || process.env.AUTH_PROFILE_PATH,
    DEFAULT_PROFILE_PATH
  );
}

function getAuthCabinet() {
  return process.env.PROFILE_CABINET || process.env.AUTH_PROFILE_CABINET || 'partnerLow';
}

function getAuthDomain() {
  return process.env.AUTH_DOMAIN || 'wowlife-crm.ru';
}

function parseJsonSafe(text) {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (_error) {
    return { raw: text };
  }
}

function getSessionContactId(session) {
  return (
    session?.upstream?.contactId ||
    session?.upstream?.allIds?.[0] ||
    session?.user?.id ||
    process.env.PROFILE_CONTACT_ID ||
    null
  );
}

function getSessionToken(session) {
  return (
    session?.upstream?.token ||
    session?.upstream?.authToken ||
    session?.upstream?.accessToken ||
    process.env.PROFILE_TOKEN ||
    null
  );
}

function getUpstreamCookies(session) {
  const cookies = session?.upstream?.cookies;
  return Array.isArray(cookies) ? cookies.filter(Boolean) : [];
}

function getSetCookieHeaders(headers) {
  if (typeof headers.getSetCookie === 'function') {
    return headers.getSetCookie();
  }

  const value = headers.get('set-cookie');
  return value ? [value] : [];
}

const profileResponseCache = new Map();
const PROFILE_CACHE_TTL_MS = Number.parseInt(process.env.PROFILE_CACHE_TTL_MS || '300000', 10);

function getProfileCacheKey(contactId, token) {
  return [getProfileUrl(), getAuthCabinet(), String(contactId || ''), String(token || '').slice(-12)].join('|');
}

function getCachedProfile(cacheKey) {
  const cached = profileResponseCache.get(cacheKey);
  if (!cached) return null;
  if (Date.now() - cached.createdAt > PROFILE_CACHE_TTL_MS) {
    profileResponseCache.delete(cacheKey);
    return null;
  }
  return cached.value;
}

function setCachedProfile(cacheKey, value) {
  if (!PROFILE_CACHE_TTL_MS || PROFILE_CACHE_TTL_MS <= 0) return;
  profileResponseCache.set(cacheKey, { createdAt: Date.now(), value });
}

function getServiceErrorMessage(payload) {
  return payload?.error || payload?.message || payload?.errorMessage || payload?.result?.error || payload?.result?.message;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function unwrapProfileContainer(value) {
  if (Array.isArray(value)) return value[0] || {};
  if (!isPlainObject(value)) return value || {};

  if (isPlainObject(value[0])) return value[0];
  if (isPlainObject(value['0'])) return value['0'];

  const numericKey = Object.keys(value).find((key) => /^\d+$/.test(key) && isPlainObject(value[key]));
  return numericKey ? value[numericKey] : value;
}

function getPayloadResult(payload) {
  if (isPlainObject(payload?.result) || Array.isArray(payload?.result)) return unwrapProfileContainer(payload.result);
  if (isPlainObject(payload?.data) || Array.isArray(payload?.data)) return unwrapProfileContainer(payload.data);
  if (isPlainObject(payload?.response) || Array.isArray(payload?.response)) return unwrapProfileContainer(payload.response);
  return unwrapProfileContainer(payload);
}

function hasProfileIdentity(profile) {
  return Boolean(
    profile &&
    typeof profile === 'object' &&
    (profile.ID || profile.id || profile.TITLE || profile.title || profile.PHONE || profile.EMAIL || profile.REQUISITES)
  );
}

function sanitizeProfilePayload(value, depth = 0, seen = new Set()) {
  if (!value || typeof value !== 'object' || depth > 4 || seen.has(value)) return value;
  seen.add(value);

  if (Array.isArray(value)) {
    return value.slice(0, 5).map((item) => sanitizeProfilePayload(item, depth + 1, seen));
  }

  return Object.fromEntries(Object.entries(value).map(([key, entry]) => {
    const normalizedKey = String(key).toLowerCase();
    if (normalizedKey.includes('token')) return [key, entry ? '[present]' : entry];
    return [key, sanitizeProfilePayload(entry, depth + 1, seen)];
  }));
}

function asArray(value) {
  if (Array.isArray(value)) return value.filter((item) => item !== null && item !== undefined && String(item).trim() !== '');
  if (value === null || value === undefined || String(value).trim() === '') return [];
  return [value];
}

function decodeHtml(value) {
  return String(value || '')
    .replaceAll('&quot;', '"')
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&#039;', "'")
    .replaceAll('&nbsp;', ' ');
}

function cleanText(value) {
  return decodeHtml(value)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\s+\n/g, '\n')
    .trim();
}

function normalizeAddress(value) {
  const text = cleanText(value);
  if (!text) return '';
  return text.split('|')[0].trim();
}

function getFirstRequisite(profile) {
  const requisites = asArray(profile.REQUISITES || profile.requisites);
  return requisites[0] || {};
}

function normalizeFiles(files) {
  return asArray(files).map((file) => ({
    id: file.ID || file.id || file.fileId || null,
    name: file.originalName || file.name || file.NAME || 'Документ',
    url: file.downloadUrl || file.url || file.URL || file.showUrl || null
  }));
}

function normalizeContactValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
  if (isPlainObject(value)) {
    return String(value.VALUE || value.value || value.EMAIL || value.PHONE || value.phone || value.email || '').trim();
  }
  return '';
}

function firstContactValue(value) {
  return asArray(value).map(normalizeContactValue).find(Boolean) || null;
}

function normalizeSites(profile) {
  return asArray(profile.WEB || profile.web).map((item) => {
    if (typeof item === 'string') return item;
    return item.VALUE || item.value || item.URL || item.url || '';
  }).filter(Boolean);
}

function hasIm(profile, predicate) {
  return asArray(profile.IM || profile.im).some((item) => {
    const type = String(item.VALUE_TYPE || item.valueType || '').toLowerCase();
    const value = String(item.VALUE || item.value || '').toLowerCase();
    return predicate({ type, value });
  });
}

function normalizeProfile(rawProfile) {
  const profile = getPayloadResult(rawProfile || {});
  const requisite = getFirstRequisite(profile);
  const bankRequisite = profile.BANK_REQUISITES || profile.bankRequisites || {};
  const addresses = asArray(profile.UF_CRM_1692176867840).map(normalizeAddress).filter(Boolean);
  const documents = normalizeFiles(profile.UF_CRM_1692620240676);
  const hasMax = hasIm(profile, ({ value }) => value.includes('|max|') || value.includes('wz_max'));
  const hasTelegram = hasIm(profile, ({ type, value }) => type.includes('telegram') || value.includes('telegram'));

  return {
    id: String(profile.ID || profile.id || ''),
    title: profile.TITLE || profile.title || 'Профиль партнёра',
    description: profile.DESCRIPTION || profile.description || profile.UF_CRM_1684102058711 || '',
    industry: profile.INDUSTRY || profile.industry || null,
    phone: firstContactValue(profile.PHONE || profile.phone),
    email: firstContactValue(profile.EMAIL || profile.email),
    sites: normalizeSites(profile),
    location: profile.UF_CRM_1684102866982 || profile.ADDRESS_CITY || profile.ADDRESS || null,
    openLineContact: profile.OPEN_LINE_CONTACT || profile.UF_CRM_1689949947876 || null,
    openLineEmail: profile.OPEN_LINE_EMAIL || null,
    openLinePhone: profile.OPEN_LINE_PHONE || null,
    notificationChannels: [
      {
        id: 'max',
        title: 'Max',
        enabled: hasMax,
        note: 'Чтобы оповещения заработали нужно подписаться WOWlife Max Bot'
      },
      {
        id: 'tg',
        title: 'TG',
        enabled: false,
        note: 'Чтобы оповещения заработали нужно подписаться WOWlife Bot',
        detected: hasTelegram
      },
      { id: 'sms', title: 'SMS', enabled: false, note: '' },
      { id: 'email', title: 'email', enabled: false, note: '' }
    ],
    work: {
      addresses,
      schedule: profile.UF_CRM_1684102212641 || null,
      cancellationPolicy: profile.UF_CRM_1684102224410 || null
    },
    documents,
    requisites: {
      legalName: requisite.RQ_COMPANY_FULL_NAME || requisite.RQ_COMPANY_NAME || requisite.RQ_NAME || null,
      inn: requisite.RQ_INN || null,
      ogrnip: requisite.RQ_OGRNIP || null,
      kpp: requisite.RQ_KPP || null,
      ogrn: requisite.RQ_OGRN || null,
      okpo: requisite.RQ_OKPO || null,
      bankName: bankRequisite.RQ_BANK_NAME || null,
      accountNumber: bankRequisite.RQ_ACC_NUM || null,
      correspondentAccount: bankRequisite.RQ_COR_ACC_NUM || null,
      bik: bankRequisite.RQ_BIK || null
    },
    additionalInfo: profile.UF_CRM_1684102959619 || profile.ADDITIONAL_INFO || profile.COMMENTS || null,
    profilePhotoUrl: typeof profile.PROFILE_PHOTO === 'string' ? profile.PROFILE_PHOTO : profile.PROFILE_PHOTO?.url || null,
    modifiedAt: profile.DATE_MODIFY || null,
    raw: profile
  };
}

async function postToProfileService(session, body) {
  const url = getProfileUrl();
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/plain, */*',
    'Origin': normalizeBaseUrl(),
    'Referer': `${normalizeBaseUrl()}/profile`
  };

  const cookies = getUpstreamCookies(session);
  if (cookies.length > 0) {
    headers.Cookie = cookies.map((cookie) => String(cookie).split(';')[0]).join('; ');
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });

  const text = await response.text();
  const payload = parseJsonSafe(text);

  if (!response.ok || payload?.result === false || payload?.result === 'error' || payload?.error) {
    const error = new Error(`WOWlife profile request failed: ${response.status}`);
    error.statusCode = response.status >= 400 ? response.status : 502;
    error.publicMessage = getServiceErrorMessage(payload) || 'Не удалось получить профиль из сервиса WOWlife.';
    error.upstreamPayload = payload;
    throw error;
  }

  return { payload, cookies: getSetCookieHeaders(response.headers) };
}

async function fetchPartnerProfile({ session }) {
  const contactId = getSessionContactId(session);
  const token = getSessionToken(session);

  if (!contactId || !token) {
    const error = new Error('No contactId/token in session');
    error.statusCode = 401;
    error.publicMessage = 'В сессии не найден contactId/token партнёра. Войдите в приложение заново.';
    throw error;
  }

  const requestPayload = {
    cabinet: getAuthCabinet(),
    contactId: String(contactId),
    token
  };

  if (process.env.PROFILE_INCLUDE_DOMAIN === 'true') {
    requestPayload.domain = getAuthDomain();
  }

  const cacheKey = getProfileCacheKey(contactId, token);
  const cachedResult = getCachedProfile(cacheKey);
  const payload = cachedResult || (await postToProfileService(session, requestPayload)).payload;
  if (!cachedResult) {
    setCachedProfile(cacheKey, payload);
  }

  const result = getPayloadResult(payload);

  if (!hasProfileIdentity(result)) {
    console.warn('WOWlife profile payload does not contain partner profile fields', sanitizeProfilePayload(payload));
    const error = new Error('WOWlife profile response is empty');
    error.statusCode = 502;
    error.publicMessage = 'Сервис WOWlife profile.getProfile вернул пустой профиль. Проверьте, что текущая сессия содержит актуальные contactId/token, и войдите заново.';
    error.upstreamPayload = sanitizeProfilePayload(payload);
    throw error;
  }

  return {
    item: normalizeProfile(result),
    source: 'wowlife',
    request: {
      cabinet: requestPayload.cabinet,
      contactId: requestPayload.contactId
    }
  };
}

module.exports = {
  fetchPartnerProfile,
  normalizeProfile
};
