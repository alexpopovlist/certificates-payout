const { refreshAuthorizationSession } = require('./authService');

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
  const candidates = [
    session?.upstream?.contactId,
    session?.upstream?.profileContactId,
    session?.user?.id,
    session?.upstream?.allIds?.[0]
  ];

  return candidates
    .map((value) => String(value || '').trim())
    .find(Boolean) || null;
}

function getSessionToken(session) {
  const candidates = [
    session?.upstream?.token,
    session?.upstream?.authToken,
    session?.upstream?.accessToken
  ];

  return candidates
    .map((value) => String(value || '').trim())
    .find(Boolean) || null;
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

function collectionToArray(value) {
  if (Array.isArray(value)) return value.filter((item) => item !== null && item !== undefined);
  if (!isPlainObject(value)) return asArray(value);

  const numericEntries = Object.entries(value)
    .filter(([key, item]) => /^\d+$/.test(String(key)) && item !== null && item !== undefined)
    .sort(([left], [right]) => Number(left) - Number(right))
    .map(([, item]) => item);

  if (numericEntries.length > 0) return numericEntries;

  const objectValues = Object.values(value)
    .filter((item) => isPlainObject(item) && Object.keys(item).some((key) => String(key).toUpperCase().startsWith('RQ_')));

  if (objectValues.length > 0) return objectValues;
  return [value];
}

function getRecordField(record, fieldNames) {
  if (!isPlainObject(record)) return null;

  for (const fieldName of fieldNames) {
    const value = record[fieldName];
    if (value !== null && value !== undefined && String(value).trim() !== '') return value;
  }

  const entries = Object.entries(record);
  for (const fieldName of fieldNames) {
    const normalizedFieldName = String(fieldName).toLowerCase();
    const match = entries.find(([key, value]) => (
      String(key).toLowerCase() === normalizedFieldName &&
      value !== null &&
      value !== undefined &&
      String(value).trim() !== ''
    ));
    if (match) return match[1];
  }

  return null;
}

function getProfileRequisiteRecords(profile) {
  return collectionToArray(profile.REQUISITES || profile.requisites)
    .filter(isPlainObject)
    .filter((record) => Object.keys(record).some((key) => String(key).toUpperCase().startsWith('RQ_')));
}

function getRequisiteLegalName(record = {}) {
  const explicitName = getRecordField(record, ['RQ_COMPANY_FULL_NAME', 'RQ_COMPANY_NAME', 'RQ_NAME']);
  if (explicitName) return explicitName;

  const entityName = cleanText(getRecordField(record, ['NAME']) || '');
  const personName = [
    getRecordField(record, ['RQ_LAST_NAME']),
    getRecordField(record, ['RQ_FIRST_NAME']),
    getRecordField(record, ['RQ_SECOND_NAME'])
  ].map(cleanText).filter(Boolean).join(' ');

  return [entityName, personName].filter(Boolean).join(' ') || null;
}

function getBankRequisiteRecords(profile) {
  return collectionToArray(profile.BANK_REQUISITES || profile.bankRequisites)
    .filter(isPlainObject)
    .filter((record) => Object.keys(record).some((key) => String(key).toUpperCase().startsWith('RQ_')));
}

function findBankRequisiteForRecord(record = {}, bankRecords = [], totalRequisites = 0) {
  const requisiteId = String(getRecordField(record, ['ID', 'id']) || '').trim();
  if (requisiteId) {
    const matched = bankRecords.find((bankRecord) => (
      String(getRecordField(bankRecord, ['ENTITY_ID', 'entityId']) || '').trim() === requisiteId
    ));
    if (matched) return matched;
  }

  return bankRecords.length === 1 && totalRequisites <= 1 ? bankRecords[0] : {};
}

function normalizeRequisite(record = {}, bankRecord = {}) {
  return {
    legalName: getRequisiteLegalName(record),
    inn: getRecordField(record, ['RQ_INN']),
    ogrnip: getRecordField(record, ['RQ_OGRNIP']),
    kpp: getRecordField(record, ['RQ_KPP']),
    ogrn: getRecordField(record, ['RQ_OGRN']),
    okpo: getRecordField(record, ['RQ_OKPO']),
    bankName: getRecordField(record, ['RQ_BANK_NAME']) || getRecordField(bankRecord, ['RQ_BANK_NAME']),
    accountNumber: getRecordField(record, ['RQ_ACC_NUM']) || getRecordField(bankRecord, ['RQ_ACC_NUM']),
    correspondentAccount: getRecordField(record, ['RQ_COR_ACC_NUM']) || getRecordField(bankRecord, ['RQ_COR_ACC_NUM']),
    bik: getRecordField(record, ['RQ_BIK']) || getRecordField(bankRecord, ['RQ_BIK'])
  };
}

function getFirstRequisite(profile) {
  return getProfileRequisiteRecords(profile)[0] || {};
}

function firstProfileField(profile, fieldNames) {
  return getRecordField(profile, fieldNames);
}

function normalizeFileUrl(file) {
  if (!file) return null;
  if (typeof file === 'string') return file;
  if (!isPlainObject(file)) return null;

  return file.downloadUrl || file.downloadURL || file.url || file.URL || file.showUrl || file.SHOW_URL || null;
}

function normalizeFiles(files) {
  return collectionToArray(files).map((file) => {
    if (typeof file === 'string' || typeof file === 'number') {
      return { id: String(file), name: `Документ ${file}`, url: typeof file === 'string' ? file : null };
    }

    return {
      id: file.ID || file.id || file.fileId || null,
      name: file.originalName || file.name || file.NAME || file.title || file.TITLE || 'Документ',
      url: normalizeFileUrl(file)
    };
  });
}

function normalizeProfilePhoto(value) {
  return normalizeFileUrl(value);
}

function firstCleanText(profile, fieldNames) {
  const value = firstProfileField(profile, fieldNames);
  const text = cleanText(value || '');
  return text || null;
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
  return collectionToArray(value).map(normalizeContactValue).find(Boolean) || null;
}

function normalizeSites(profile) {
  return collectionToArray(firstProfileField(profile, ['WEB', 'web', 'SITES', 'sites'])).map((item) => {
    if (typeof item === 'string') return item;
    return item.VALUE || item.value || item.URL || item.url || '';
  }).filter(Boolean);
}

function normalizeProfileAddresses(profile) {
  return asArray(firstProfileField(profile, ['UF_CRM_1692176867840', 'SERVICE_ADDRESSES', 'serviceAddresses']))
    .map(normalizeAddress)
    .filter(Boolean);
}

function getDefaultNotificationChannels() {
  return [
    {
      id: 'max',
      title: 'Max',
      enabled: false,
      note: 'Чтобы оповещения заработали нужно подписаться WOWlife Max Bot'
    },
    {
      id: 'tg',
      title: 'TG',
      enabled: false,
      note: 'Чтобы оповещения заработали нужно подписаться WOWlife Bot'
    },
    { id: 'sms', title: 'SMS', enabled: false, note: '' },
    { id: 'email', title: 'email', enabled: false, note: '' }
  ];
}

function normalizeProfile(rawProfile) {
  const profile = getPayloadResult(rawProfile || {});
  const requisiteRecords = getProfileRequisiteRecords(profile);
  const requisite = getFirstRequisite(profile);
  const bankRequisites = getBankRequisiteRecords(profile);
  const normalizedRequisites = requisiteRecords.map((record) => (
    normalizeRequisite(record, findBankRequisiteForRecord(record, bankRequisites, requisiteRecords.length))
  ));
  const primaryRequisite = normalizedRequisites[0] || normalizeRequisite(
    requisite,
    findBankRequisiteForRecord(requisite, bankRequisites, requisiteRecords.length)
  );
  const addresses = normalizeProfileAddresses(profile);
  const documents = normalizeFiles(firstProfileField(profile, ['UF_CRM_1692620240676', 'DOCUMENTS', 'documents']));

  return {
    id: String(firstProfileField(profile, ['ID', 'id']) || ''),
    title: firstProfileField(profile, ['TITLE', 'title']) || 'Профиль партнёра',
    description: firstCleanText(profile, ['UF_CRM_1684102058711', 'DESCRIPTION', 'description']) || '',
    industry: firstProfileField(profile, ['INDUSTRY', 'industry']) || null,
    phone: firstContactValue(firstProfileField(profile, ['PHONE', 'phone'])),
    email: firstContactValue(firstProfileField(profile, ['EMAIL', 'email'])),
    sites: normalizeSites(profile),
    location: firstCleanText(profile, ['UF_CRM_1684102866982', 'LK_ADDRESS', 'ADDRESS_CITY', 'ADDRESS', 'location']),
    openLineContact: firstCleanText(profile, ['OPEN_LINE_CONTACT', 'UF_CRM_1689949947876']),
    openLineEmail: firstContactValue(firstProfileField(profile, ['OPEN_LINE_EMAIL', 'openLineEmail'])),
    openLinePhone: firstContactValue(firstProfileField(profile, ['OPEN_LINE_PHONE', 'openLinePhone'])),
    notificationChannels: getDefaultNotificationChannels(),
    work: {
      addresses,
      schedule: firstCleanText(profile, ['WORK_TIME', 'WORK_SCHEDULE', 'SCHEDULE', 'workTime', 'workSchedule']),
      cancellationPolicy: firstCleanText(profile, ['UF_CRM_1744724008473', 'UF_CRM_1684102224410', 'CANCELLATION_POLICY', 'cancellationPolicy'])
    },
    documents,
    requisites: {
      ...primaryRequisite,
      items: normalizedRequisites
    },
    additionalInfo: firstCleanText(profile, ['UF_CRM_1684102959619', 'ADDITIONAL_INFO', 'COMMENTS', 'additionalInfo']),
    profilePhotoUrl: normalizeProfilePhoto(firstProfileField(profile, ['PROFILE_PHOTO', 'profilePhoto', 'profilePhotoUrl'])),
    modifiedAt: firstProfileField(profile, ['DATE_MODIFY', 'modifiedAt']) || null,
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

function buildProfileRequestPayload(session) {
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

  return { requestPayload, contactId, token };
}

async function loadProfilePayload(session, options = {}) {
  const { requestPayload, contactId, token } = buildProfileRequestPayload(session);
  const cacheKey = getProfileCacheKey(contactId, token);
  const cachedResult = options.skipCache ? null : getCachedProfile(cacheKey);

  if (cachedResult) {
    return { payload: cachedResult, requestPayload, cacheKey, fromCache: true };
  }

  const { payload, cookies } = await postToProfileService(session, requestPayload);
  return { payload, cookies, requestPayload, cacheKey, fromCache: false };
}

function createEmptyProfileError(payload) {
  console.warn('WOWlife profile payload does not contain partner profile fields', sanitizeProfilePayload(payload));
  const error = new Error('WOWlife profile response is empty');
  error.statusCode = 502;
  error.publicMessage = 'Сервис WOWlife profile.getProfile вернул пустой профиль. Проверьте, что текущая сессия содержит актуальные contactId/token, и войдите заново.';
  error.upstreamPayload = sanitizeProfilePayload(payload);
  return error;
}

async function fetchPartnerProfile({ session }) {
  let currentSession = session;
  let authorizationRefreshed = false;
  let profileResponse = await loadProfilePayload(currentSession);
  let result = getPayloadResult(profileResponse.payload);

  if (!hasProfileIdentity(result)) {
    if (profileResponse.cacheKey) {
      profileResponseCache.delete(profileResponse.cacheKey);
    }

    let refreshResult;
    try {
      refreshResult = await refreshAuthorizationSession({ session: currentSession });
    } catch (error) {
      console.warn('WOWlife auth.authorization retry before profile retry failed', error.publicMessage || error.message);
      throw createEmptyProfileError(profileResponse.payload);
    }

    currentSession = refreshResult.session;
    authorizationRefreshed = true;
    profileResponse = await loadProfilePayload(currentSession, { skipCache: true });
    result = getPayloadResult(profileResponse.payload);
  }

  if (!hasProfileIdentity(result)) {
    if (profileResponse.cacheKey) {
      profileResponseCache.delete(profileResponse.cacheKey);
    }
    throw createEmptyProfileError(profileResponse.payload);
  }

  if (!profileResponse.fromCache && profileResponse.cacheKey) {
    setCachedProfile(profileResponse.cacheKey, profileResponse.payload);
  }

  return {
    item: normalizeProfile(result),
    source: 'wowlife',
    request: {
      cabinet: profileResponse.requestPayload.cabinet,
      contactId: profileResponse.requestPayload.contactId,
      authorizationRefreshed
    },
    session: authorizationRefreshed ? currentSession : undefined
  };
}

module.exports = {
  fetchPartnerProfile,
  normalizeProfile
};
