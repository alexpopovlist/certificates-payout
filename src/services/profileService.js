const { refreshAuthorizationSession } = require('./authService');

const DEFAULT_AUTH_BASE_URL = 'https://partner-wowlife.ru';
const DEFAULT_PROFILE_PATH = '/restapi/profile.getProfile';
const DEFAULT_NOTIFICATION_CHANNELS_PATH = '/restapi/profile.getNotificationChannels';
const DEFAULT_SET_PASSWORD_PATH = '/restapi/auth.setPassword';
const DEFAULT_SET_PARTNER_PROFILE_PATH = '/restapi/profile.setPartnerProfile';
const DEFAULT_SET_AGENT_REPORT_PATH = '/restapi/profile.setAgentReport';
const DEFAULT_SET_NOTIFICATION_CHANNELS_PATH = '/restapi/profile.setNotificationChannels';

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

function getNotificationChannelsUrl() {
  return resolveUrl(
    process.env.PROFILE_NOTIFICATION_CHANNELS_URL || process.env.NOTIFICATION_CHANNELS_SERVICE_URL,
    process.env.PROFILE_NOTIFICATION_CHANNELS_PATH || process.env.NOTIFICATION_CHANNELS_SERVICE_PATH,
    DEFAULT_NOTIFICATION_CHANNELS_PATH
  );
}

function getSetPasswordUrl() {
  return resolveUrl(
    process.env.AUTH_SET_PASSWORD_URL || process.env.PROFILE_SET_PASSWORD_URL,
    process.env.AUTH_SET_PASSWORD_PATH || process.env.PROFILE_SET_PASSWORD_PATH,
    DEFAULT_SET_PASSWORD_PATH
  );
}

function getSetPartnerProfileUrl() {
  return resolveUrl(
    process.env.PROFILE_SET_PARTNER_PROFILE_URL || process.env.PROFILE_MODERATION_URL,
    process.env.PROFILE_SET_PARTNER_PROFILE_PATH || process.env.PROFILE_MODERATION_PATH,
    DEFAULT_SET_PARTNER_PROFILE_PATH
  );
}

function getSetAgentReportUrl() {
  return resolveUrl(
    process.env.PROFILE_SET_AGENT_REPORT_URL || process.env.PROFILE_AGENT_REPORT_URL,
    process.env.PROFILE_SET_AGENT_REPORT_PATH || process.env.PROFILE_AGENT_REPORT_PATH,
    DEFAULT_SET_AGENT_REPORT_PATH
  );
}

function getSetNotificationChannelsUrl() {
  return resolveUrl(
    process.env.PROFILE_SET_NOTIFICATION_CHANNELS_URL || process.env.PROFILE_NOTIFICATION_CHANNELS_SET_URL,
    process.env.PROFILE_SET_NOTIFICATION_CHANNELS_PATH || process.env.PROFILE_NOTIFICATION_CHANNELS_SET_PATH,
    DEFAULT_SET_NOTIFICATION_CHANNELS_PATH
  );
}

function uniqStrings(values = []) {
  return Array.from(new Set(
    values
      .map((value) => String(value || '').trim())
      .filter(Boolean)
  ));
}

function getAuthCabinet() {
  return process.env.AUTH_CABINET || 'partner';
}

function getProfileCabinetCandidates() {
  // Для /profile важен полный ответ profile.getProfile. На части окружений
  // PROFILE_CABINET=partnerLow остаётся в .env со старых версий и даёт
  // урезанную карточку: телефон/адрес есть, но TITLE/WEB/EMAIL/REQUISITES
  // отсутствуют. Поэтому сначала пробуем кабинет текущей авторизации, а
  // профильный override оставляем как fallback, а не как единственный вариант.
  return uniqStrings([
    process.env.AUTH_PROFILE_CABINET,
    process.env.AUTH_CABINET,
    'partner',
    process.env.PROFILE_CABINET,
    'partnerLow'
  ]);
}

function getProfileIncludeDomainCandidates() {
  const configured = String(process.env.PROFILE_INCLUDE_DOMAIN || '').toLowerCase();
  if (configured === 'false') return [false, true];
  if (configured === 'true') return [true, false];
  return [false, true];
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

function getProfileCacheKey(requestPayload = {}) {
  return [
    getProfileUrl(),
    requestPayload.cabinet || '',
    requestPayload.domain ? `domain:${requestPayload.domain}` : 'no-domain',
    requestPayload.contactId || '',
    Array.isArray(requestPayload.allIds) ? requestPayload.allIds.join(',') : '',
    String(requestPayload.token || '').slice(-12)
  ].join('|');
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
  return scoreProfileCandidate(getBestProfileCandidate(profile)) > 0;
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

  // Bitrix service addresses are returned as "display value|lat;lon|id".
  // The partner profile should show only the human-readable address, matching
  // the original cabinet: "Адрес 2" instead of "Адрес 2|0;0|31739".
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

function collectPlainObjects(value, depth = 0, seen = new Set()) {
  if (!value || typeof value !== 'object' || depth > 7 || seen.has(value)) return [];
  seen.add(value);

  const objects = [];
  if (isPlainObject(value)) objects.push(value);

  const children = Array.isArray(value) ? value : Object.values(value);
  children.forEach((child) => {
    if (child && typeof child === 'object') {
      objects.push(...collectPlainObjects(child, depth + 1, seen));
    }
  });

  return objects;
}

function normalizeFieldKey(value) {
  return String(value || '').toLowerCase().replace(/[^a-zа-я0-9]/gi, '');
}

function hasOwnFieldCaseInsensitive(record, fieldName) {
  if (!isPlainObject(record)) return false;
  const normalizedFieldName = normalizeFieldKey(fieldName);
  return Object.keys(record).some((key) => normalizeFieldKey(key) === normalizedFieldName);
}

function scoreProfileCandidate(candidate = {}) {
  if (!isPlainObject(candidate)) return 0;

  let score = 0;
  const weightedFields = [
    ['TITLE', 40],
    ['WEB', 35],
    ['EMAIL', 35],
    ['PHONE', 30],
    ['REQUISITES', 60],
    ['BANK_REQUISITES', 45],
    ['UF_CRM_1692176867840', 30],
    ['UF_CRM_1684102959619', 30],
    ['UF_CRM_1692620240676', 20],
    ['PROFILE_PHOTO', 20],
    ['DATE_MODIFY', 10],
    ['COMPANY_TYPE', 10],
    ['ID', 8]
  ];

  weightedFields.forEach(([fieldName, weight]) => {
    if (hasOwnFieldCaseInsensitive(candidate, fieldName)) score += weight;
  });

  const rqFieldCount = Object.keys(candidate).filter((key) => String(key).toUpperCase().startsWith('RQ_')).length;
  if (rqFieldCount > 0) score += Math.min(rqFieldCount, 20);

  return score;
}

function getProfileCandidateRecords(value) {
  return collectPlainObjects(value)
    .map((record, index) => ({ record, index, score: scoreProfileCandidate(record) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => (right.score - left.score) || (left.index - right.index))
    .map((entry) => entry.record);
}

function getBestProfileCandidate(value) {
  return getProfileCandidateRecords(value)[0] || (isPlainObject(value) ? value : {});
}

function getFirstProfileCollection(profile, fieldNames) {
  const candidates = getProfileCandidateRecords(profile);
  const searchRecords = candidates.length > 0 ? candidates : [profile].filter(isPlainObject);

  for (const record of searchRecords) {
    const value = getRecordField(record, fieldNames);
    const items = collectionToArray(value);
    if (items.length > 0) return items;
  }

  return [];
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
  return getFirstProfileCollection(profile, ['REQUISITES', 'requisites'])
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
  return getFirstProfileCollection(profile, ['BANK_REQUISITES', 'bankRequisites'])
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
  const candidates = getProfileCandidateRecords(profile);
  const searchRecords = candidates.length > 0 ? candidates : [profile].filter(isPlainObject);

  for (const record of searchRecords) {
    const value = getRecordField(record, fieldNames);
    if (value !== null && value !== undefined && String(value).trim() !== '') return value;
  }

  return null;
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
  const messengerNote = 'Чтобы оповещения заработали, нужно написать в бот название вашей компании, менеджер подключит вас';

  return [
    {
      id: 'max',
      title: 'MAX',
      enabled: false,
      note: messengerNote
    },
    {
      id: 'tg',
      title: 'TG',
      enabled: false,
      note: messengerNote
    },
    { id: 'wa', title: 'WA', enabled: false, note: '' },
    { id: 'sms', title: 'SMS', enabled: false, note: '' },
    {
      id: 'email',
      title: 'email',
      enabled: false,
      note: 'Пришлите адрес почты для получения оповещений нашему менеджеру в тг @wowlifepartners или на почту oplata@wowlife.club'
    }
  ];
}

function normalizeNotificationChannelKey(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return '';
  if (['telegram', 'телеграм', 'тг'].includes(normalized)) return 'tg';
  if (['mail', 'e-mail', 'email', 'почта'].includes(normalized)) return 'email';
  if (normalized === 'max' || normalized === 'макс') return 'max';
  if (['whatsapp', 'wa', 'ватсап', 'вацап', 'вотсап'].includes(normalized)) return 'wa';
  if (normalized === 'sms' || normalized === 'смс') return 'sms';
  return normalized.replace(/[^a-zа-я0-9]/gi, '');
}

function normalizeNotificationChannelItems(payload) {
  const result = payload?.result || payload?.data || payload?.response || payload || {};
  const channels = result.channels || result.CHANNELS || result.notificationChannels || result.items || [];

  return collectionToArray(channels)
    .map((channel) => {
      if (typeof channel === 'string' || typeof channel === 'number') {
        return { id: null, name: String(channel) };
      }

      if (!isPlainObject(channel)) return null;

      return {
        id: channel.id || channel.ID || channel.channelId || channel.CHANNEL_ID || null,
        name: channel.name || channel.NAME || channel.title || channel.TITLE || channel.code || channel.CODE || ''
      };
    })
    .filter((channel) => channel && normalizeNotificationChannelKey(channel.name || channel.id));
}

function mergeNotificationChannels(serviceChannels = []) {
  const activeByKey = new Map();

  serviceChannels.forEach((channel) => {
    const keys = [
      normalizeNotificationChannelKey(channel.name),
      normalizeNotificationChannelKey(channel.id)
    ].filter(Boolean);

    keys.forEach((key) => {
      if (!activeByKey.has(key)) {
        activeByKey.set(key, channel);
      }
    });
  });

  return getDefaultNotificationChannels().map((channel) => {
    const matched = [
      normalizeNotificationChannelKey(channel.id),
      normalizeNotificationChannelKey(channel.title)
    ].map((key) => activeByKey.get(key)).find(Boolean);

    return {
      ...channel,
      enabled: Boolean(matched),
      upstreamId: matched?.id || null
    };
  });
}

function notificationChannelPayloadName(value) {
  const key = normalizeNotificationChannelKey(value);
  const names = {
    max: 'Max',
    wa: 'WA',
    tg: 'TG',
    sms: 'SMS',
    email: 'email'
  };
  return names[key] || '';
}

function normalizeNotificationChannelPayloadNames(channels = []) {
  return uniqStrings(collectionToArray(channels).map(notificationChannelPayloadName));
}


function normalizeProfile(rawProfile) {
  const payloadProfile = getPayloadResult(rawProfile || {});
  const profile = getBestProfileCandidate(payloadProfile);
  const profileSearchRoot = isPlainObject(payloadProfile) ? payloadProfile : profile;
  const requisiteRecords = getProfileRequisiteRecords(profileSearchRoot);
  const requisite = requisiteRecords[0] || {};
  const bankRequisites = getBankRequisiteRecords(profileSearchRoot);
  const normalizedRequisites = requisiteRecords.map((record) => (
    normalizeRequisite(record, findBankRequisiteForRecord(record, bankRequisites, requisiteRecords.length))
  ));
  const primaryRequisite = normalizedRequisites[0] || normalizeRequisite(
    requisite,
    findBankRequisiteForRecord(requisite, bankRequisites, requisiteRecords.length)
  );
  const addresses = normalizeProfileAddresses(profileSearchRoot);
  const documents = normalizeFiles(firstProfileField(profileSearchRoot, ['UF_CRM_1692620240676', 'DOCUMENTS', 'documents']));

  return {
    id: String(firstProfileField(profileSearchRoot, ['ID', 'id']) || ''),
    title: firstProfileField(profileSearchRoot, ['TITLE', 'title']) || 'Профиль партнёра',
    description: firstCleanText(profileSearchRoot, ['UF_CRM_1684102058711', 'DESCRIPTION', 'description']) || '',
    industry: firstProfileField(profileSearchRoot, ['INDUSTRY', 'industry']) || null,
    phone: firstContactValue(firstProfileField(profileSearchRoot, ['PHONE', 'phone'])),
    email: firstContactValue(firstProfileField(profileSearchRoot, ['EMAIL', 'email'])),
    sites: normalizeSites(profileSearchRoot),
    location: firstCleanText(profileSearchRoot, ['UF_CRM_1684102866982', 'LK_ADDRESS', 'ADDRESS_CITY', 'ADDRESS', 'location']),
    openLineContact: firstCleanText(profileSearchRoot, ['OPEN_LINE_CONTACT', 'UF_CRM_1689949947876']),
    openLineEmail: firstContactValue(firstProfileField(profileSearchRoot, ['OPEN_LINE_EMAIL', 'openLineEmail'])),
    openLinePhone: firstContactValue(firstProfileField(profileSearchRoot, ['OPEN_LINE_PHONE', 'openLinePhone'])),
    notificationChannels: getDefaultNotificationChannels(),
    work: {
      addresses,
      schedule: firstCleanText(profileSearchRoot, ['WORK_TIME', 'WORK_SCHEDULE', 'SCHEDULE', 'workTime', 'workSchedule']),
      cancellationPolicy: firstCleanText(profileSearchRoot, ['UF_CRM_1744724008473', 'UF_CRM_1684102224410', 'CANCELLATION_POLICY', 'cancellationPolicy'])
    },
    documents,
    requisites: {
      ...primaryRequisite,
      items: normalizedRequisites
    },
    additionalInfo: firstCleanText(profileSearchRoot, ['UF_CRM_1684102959619', 'ADDITIONAL_INFO', 'COMMENTS', 'additionalInfo']),
    agentReport: {
      legalAddress: firstCleanText(profileSearchRoot, ['UF_CRM_1756729018221', 'AGENT_LEGAL_ADDRESS', 'agentLegalAddress', 'legalAddress']),
      contractNumber: firstCleanText(profileSearchRoot, ['UF_CRM_1684102807864', 'AGENT_CONTRACT_NUMBER', 'agentContractNumber', 'contractNumber'])
    },
    profilePhotoUrl: normalizeProfilePhoto(firstProfileField(profileSearchRoot, ['PROFILE_PHOTO', 'profilePhoto', 'profilePhotoUrl'])),
    modifiedAt: firstProfileField(profileSearchRoot, ['DATE_MODIFY', 'modifiedAt']) || null,
    raw: profileSearchRoot,
    resolvedProfile: profile
  };
}

async function postToProfileEndpoint(session, body, url, publicMessage = 'Не удалось получить профиль из сервиса WOWlife.', options = {}) {
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

  const allowFalseResult = Boolean(options.allowFalseResult);

  if (!response.ok || (!allowFalseResult && payload?.result === false) || payload?.result === 'error' || payload?.error) {
    const error = new Error(`WOWlife profile request failed: ${response.status}`);
    error.statusCode = response.status >= 400 ? response.status : 502;
    error.publicMessage = getServiceErrorMessage(payload) || publicMessage;
    error.upstreamPayload = payload;
    throw error;
  }

  return { payload, cookies: getSetCookieHeaders(response.headers) };
}

function postToProfileService(session, body) {
  return postToProfileEndpoint(session, body, getProfileUrl(), 'Не удалось получить профиль из сервиса WOWlife.');
}

function postToNotificationChannelsService(session, body) {
  return postToProfileEndpoint(
    session,
    body,
    getNotificationChannelsUrl(),
    'Не удалось получить каналы уведомлений из сервиса WOWlife.'
  );
}

function postToSetPasswordService(session, body) {
  return postToProfileEndpoint(
    session,
    body,
    getSetPasswordUrl(),
    'Не удалось установить пароль через сервис WOWlife.'
  );
}

function postToSetPartnerProfileService(session, body) {
  return postToProfileEndpoint(
    session,
    body,
    getSetPartnerProfileUrl(),
    'Не удалось отправить заявку на модерацию через сервис WOWlife.'
  );
}

function postToSetAgentReportService(session, body) {
  return postToProfileEndpoint(
    session,
    body,
    getSetAgentReportUrl(),
    'Не удалось обновить отчет агента через сервис WOWlife.'
  );
}

function postToSetNotificationChannelsService(session, body) {
  return postToProfileEndpoint(
    session,
    body,
    getSetNotificationChannelsUrl(),
    'Не удалось обновить каналы уведомлений через сервис WOWlife.',
    { allowFalseResult: true }
  );
}

function getProfileRequestCredentials(session) {
  const contactId = getSessionContactId(session);
  const token = getSessionToken(session);

  if (!contactId || !token) {
    const error = new Error('No contactId/token in session');
    error.statusCode = 401;
    error.publicMessage = 'В сессии не найден contactId/token партнёра. Войдите в приложение заново.';
    throw error;
  }

  const allIds = Array.isArray(session?.upstream?.allIds)
    ? session.upstream.allIds.map((id) => String(id || '').trim()).filter(Boolean)
    : [];

  return { contactId: String(contactId), token, allIds };
}

function buildProfileRequestPayloads(session) {
  const { contactId, token, allIds } = getProfileRequestCredentials(session);
  const payloads = [];

  const allIdsVariants = allIds.length > 0 ? [[], allIds] : [[]];

  getProfileCabinetCandidates().forEach((cabinet) => {
    getProfileIncludeDomainCandidates().forEach((includeDomain) => {
      allIdsVariants.forEach((allIdsVariant) => {
        const requestPayload = {
          cabinet,
          contactId,
          token
        };

        if (includeDomain) {
          requestPayload.domain = getAuthDomain();
        }

        if (allIdsVariant.length > 0) {
          requestPayload.allIds = allIdsVariant;
        }

        payloads.push(requestPayload);
      });
    });
  });

  const seen = new Set();
  return payloads.filter((payload) => {
    const key = JSON.stringify(payload);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getProfileDisplayScore(profile) {
  const normalized = normalizeProfile(profile);
  let score = 0;

  if (normalized.id) score += 5;
  if (normalized.title && normalized.title !== 'Профиль партнёра') score += 40;
  if (normalized.phone) score += 10;
  if (normalized.email) score += 25;
  if (Array.isArray(normalized.sites) && normalized.sites.length > 0) score += 25;
  if (Array.isArray(normalized.work?.addresses) && normalized.work.addresses.length > 0) score += 10;
  if (normalized.requisites?.legalName) score += 30;
  if (normalized.requisites?.inn) score += 20;
  if (normalized.requisites?.ogrnip || normalized.requisites?.ogrn) score += 10;
  if (normalized.requisites?.bankName || normalized.requisites?.accountNumber) score += 10;
  if (normalized.additionalInfo) score += 25;
  if (Array.isArray(normalized.documents) && normalized.documents.length > 0) score += 5;

  return score;
}

async function requestProfilePayload(session, requestPayload, options = {}) {
  const cacheKey = getProfileCacheKey(requestPayload);
  const cachedResult = options.skipCache ? null : getCachedProfile(cacheKey);

  if (cachedResult) {
    return {
      payload: cachedResult,
      requestPayload,
      cacheKey,
      fromCache: true,
      score: getProfileDisplayScore(getPayloadResult(cachedResult))
    };
  }

  const { payload, cookies } = await postToProfileService(session, requestPayload);
  return {
    payload,
    cookies,
    requestPayload,
    cacheKey,
    fromCache: false,
    score: getProfileDisplayScore(getPayloadResult(payload))
  };
}

async function loadProfilePayload(session, options = {}) {
  const requestPayloads = buildProfileRequestPayloads(session);
  let bestResponse = null;
  let firstError = null;

  for (const requestPayload of requestPayloads) {
    let profileResponse;
    try {
      profileResponse = await requestProfilePayload(session, requestPayload, options);
    } catch (error) {
      if (!firstError) firstError = error;
      console.warn(
        'WOWlife profile.getProfile variant failed',
        {
          cabinet: requestPayload.cabinet,
          includeDomain: Boolean(requestPayload.domain),
          message: error.publicMessage || error.message
        }
      );
      continue;
    }

    const result = getPayloadResult(profileResponse.payload);
    const hasDisplayData = hasProfileDisplayData(result);

    if (hasDisplayData) {
      return profileResponse;
    }

    if (!bestResponse || profileResponse.score > bestResponse.score) {
      bestResponse = profileResponse;
    }
  }

  if (bestResponse) {
    console.warn(
      'WOWlife profile.getProfile returned only partial display data after all variants',
      {
        cabinet: bestResponse.requestPayload.cabinet,
        includeDomain: Boolean(bestResponse.requestPayload.domain),
        score: bestResponse.score,
        payload: sanitizeProfilePayload(bestResponse.payload)
      }
    );
    return bestResponse;
  }

  throw firstError || createEmptyProfileError({});
}

function hasProfileDisplayData(profile) {
  const normalized = normalizeProfile(profile);
  return Boolean(
    normalized.title && normalized.title !== 'Профиль партнёра' &&
    normalized.email &&
    Array.isArray(normalized.sites) && normalized.sites.length > 0 &&
    normalized.requisites?.legalName &&
    normalized.requisites?.inn &&
    normalized.additionalInfo
  );
}

function createEmptyProfileError(payload) {
  console.warn('WOWlife profile payload does not contain partner profile fields', sanitizeProfilePayload(payload));
  const error = new Error('WOWlife profile response is empty');
  error.statusCode = 401;
  error.code = 'PROFILE_REAUTH_REQUIRED';
  error.reauthRequired = true;
  error.publicMessage = 'Сервис WOWlife profile.getProfile вернул пустой профиль. Проверьте, что текущая сессия содержит актуальные contactId/token, и войдите заново.';
  error.upstreamPayload = sanitizeProfilePayload(payload);
  return error;
}

async function fetchProfileNotificationChannels({ session, contactId: explicitContactId } = {}) {
  const credentials = getProfileRequestCredentials(session);
  const contactId = String(explicitContactId || credentials.contactId || '').trim();
  if (!contactId) {
    const error = new Error('No contactId for notification channels');
    error.statusCode = 401;
    error.publicMessage = 'Не найден contactId партнёра для получения каналов уведомлений.';
    throw error;
  }

  const { payload } = await postToNotificationChannelsService(session, {
    contactId,
    token: credentials.token
  });
  return mergeNotificationChannels(normalizeNotificationChannelItems(payload));
}



function normalizeModerationFile(file = {}) {
  const fileName = String(file.fileName || file.name || '').trim();
  const fileContent = String(file.fileContent || file.content || '').trim();

  if (!fileName && !fileContent) return null;

  if (!fileName || !fileContent) {
    const error = new Error('Invalid moderation file');
    error.statusCode = 400;
    error.publicMessage = 'Файл для заявки передан не полностью.';
    throw error;
  }

  return { fileName, fileContent };
}

async function createProfileModerationRequest({ session, name, info, file } = {}) {
  const normalizedName = String(name || '').trim();
  const normalizedInfo = String(info || '').trim();
  const normalizedFile = normalizeModerationFile(file);

  if (!normalizedName) {
    const error = new Error('Moderation request title is required');
    error.statusCode = 400;
    error.publicMessage = 'Введите заголовок заявки.';
    throw error;
  }

  if (!normalizedInfo) {
    const error = new Error('Moderation request description is required');
    error.statusCode = 400;
    error.publicMessage = 'Введите описание заявки.';
    throw error;
  }

  const requestPayload = {
    partnerData: {
      name: normalizedName,
      info: normalizedInfo
    }
  };

  if (normalizedFile) {
    requestPayload.partnerData.file = normalizedFile;
  }

  const { payload } = await postToSetPartnerProfileService(session, requestPayload);
  const result = payload?.result ?? payload?.data?.result ?? payload?.response?.result;

  if (result !== true && result !== 'true' && !payload?.result?.ID && !payload?.result?.id) {
    const error = new Error('WOWlife profile.setPartnerProfile returned unsuccessful result');
    error.statusCode = 502;
    error.publicMessage = getServiceErrorMessage(payload) || 'Сервис WOWlife не подтвердил создание заявки на модерацию.';
    error.upstreamPayload = payload;
    throw error;
  }

  return {
    ok: true,
    item: payload?.result || null,
    request: {
      partnerData: {
        name: normalizedName,
        info: normalizedInfo,
        hasFile: Boolean(normalizedFile)
      }
    }
  };
}


async function setPartnerAgentReport({ session, legalAddress, contractNumber } = {}) {
  const credentials = getProfileRequestCredentials(session);
  const requestPayload = {
    contactId: credentials.contactId,
    token: credentials.token,
    UF_CRM_1756729018221: String(legalAddress ?? '').trim(),
    UF_CRM_1684102807864: String(contractNumber ?? '').trim()
  };

  const { payload } = await postToSetAgentReportService(session, requestPayload);
  const result = payload?.result ?? payload?.data?.result ?? payload?.response?.result;

  if (result !== true && result !== 'true') {
    const error = new Error('WOWlife profile.setAgentReport returned unsuccessful result');
    error.statusCode = 502;
    error.publicMessage = getServiceErrorMessage(payload) || 'Сервис WOWlife не подтвердил обновление отчета агента.';
    error.upstreamPayload = payload;
    throw error;
  }

  profileResponseCache.clear();

  return {
    ok: true,
    request: requestPayload
  };
}

async function setPartnerNotificationChannels({ session, channels } = {}) {
  const credentials = getProfileRequestCredentials(session);
  const normalizedChannels = normalizeNotificationChannelPayloadNames(channels);

  const requestPayload = {
    contactId: credentials.contactId,
    channels: normalizedChannels,
    token: credentials.token
  };

  const { payload } = await postToSetNotificationChannelsService(session, requestPayload);
  const result = payload?.result ?? payload?.data?.result ?? payload?.response?.result;

  if (result !== true && result !== 'true') {
    const error = new Error('WOWlife profile.setNotificationChannels returned unsuccessful result');
    error.statusCode = 502;
    error.publicMessage = getServiceErrorMessage(payload) || 'Сервис WOWlife не подтвердил обновление каналов уведомлений.';
    error.upstreamPayload = payload;
    throw error;
  }

  profileResponseCache.clear();

  return {
    ok: true,
    channels: normalizedChannels,
    request: requestPayload
  };
}

async function setPartnerPassword({ session, profile, password } = {}) {
  const normalizedPassword = String(password || '').trim();
  if (!normalizedPassword) {
    const error = new Error('Password is required');
    error.statusCode = 400;
    error.publicMessage = 'Введите пароль.';
    throw error;
  }

  const credentials = getProfileRequestCredentials(session);
  const id = String(profile?.id || credentials.contactId || '').trim();
  const email = String(profile?.email || session?.user?.email || '').trim();

  if (!id) {
    const error = new Error('Profile id is required for auth.setPassword');
    error.statusCode = 400;
    error.publicMessage = 'Не найден ID профиля для установки пароля.';
    throw error;
  }

  if (!email) {
    const error = new Error('Profile email is required for auth.setPassword');
    error.statusCode = 400;
    error.publicMessage = 'Не найден email профиля для установки пароля.';
    throw error;
  }

  const requestPayload = {
    id,
    token: credentials.token,
    password: normalizedPassword,
    email
  };

  const { payload } = await postToSetPasswordService(session, requestPayload);
  const result = payload?.result ?? payload?.data?.result ?? payload?.response?.result;

  if (result !== true) {
    const error = new Error('WOWlife auth.setPassword returned unsuccessful result');
    error.statusCode = 502;
    error.publicMessage = getServiceErrorMessage(payload) || 'Сервис WOWlife не подтвердил установку пароля.';
    error.upstreamPayload = payload;
    throw error;
  }

  return {
    ok: true,
    request: {
      id,
      email
    }
  };
}

async function fetchPartnerProfile({ session, skipCache = false } = {}) {
  let currentSession = session;
  let authorizationRefreshed = false;
  let profileResponse = await loadProfilePayload(currentSession, { skipCache });
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

  // Иногда profile.getProfile при старой/урезанной авторизации отвечает только
  // частью карточки партнёра: телефон и адрес уже есть, но TITLE/WEB/EMAIL/
  // REQUISITES/дополнительная информация пустые. Такой ответ нельзя считать
  // достаточным для экрана /profile — один раз принудительно обновляем
  // авторизацию и перечитываем профиль без cache.
  if (!authorizationRefreshed && !hasProfileDisplayData(result)) {
    if (profileResponse.cacheKey) {
      profileResponseCache.delete(profileResponse.cacheKey);
    }

    try {
      const refreshResult = await refreshAuthorizationSession({ session: currentSession });
      currentSession = refreshResult.session;
      authorizationRefreshed = true;
      profileResponse = await loadProfilePayload(currentSession, { skipCache: true });
      result = getPayloadResult(profileResponse.payload);
    } catch (error) {
      console.warn('WOWlife profile full-data retry failed', error.publicMessage || error.message);
    }
  }

  if (!profileResponse.fromCache && profileResponse.cacheKey && hasProfileDisplayData(result)) {
    setCachedProfile(profileResponse.cacheKey, profileResponse.payload);
  }

  const item = normalizeProfile(result);
  try {
    item.notificationChannels = await fetchProfileNotificationChannels({
      session: currentSession,
      contactId: item.id || profileResponse.requestPayload.contactId
    });
  } catch (error) {
    console.warn('WOWlife profile.getNotificationChannels failed', error.publicMessage || error.message);
    item.notificationChannels = getDefaultNotificationChannels();
  }

  return {
    item,
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
  fetchProfileNotificationChannels,
  setPartnerPassword,
  setPartnerAgentReport,
  setPartnerNotificationChannels,
  createProfileModerationRequest,
  normalizeProfile
};
