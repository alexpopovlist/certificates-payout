const DEFAULT_AUTH_BASE_URL = 'https://partner-wowlife.ru';
const DEFAULT_CERTIFICATES_PATH = '/restapi/certificate.getPartnerCertificates';
const DEFAULT_CHANGE_STAGE_PATH = '/restapi/certificate.changeCertificateStage';

const DEFAULT_GROUP_IDS = [
  'new',
  'waiting',
  'confirmed',
  'visited',
  'verification',
  'paid',
  'canceled'
];

const ALLOWED_STAGE_GROUP_IDS = new Set(DEFAULT_GROUP_IDS);

const LEGACY_STATUS_TO_GROUP_IDS = {
  REDEEMED: ['new', 'visited', 'canceled'],
  PAYMENT_PROCESSING: ['waiting', 'confirmed', 'verification'],
  PAID: ['paid']
};

function normalizeBaseUrl() {
  return String(process.env.AUTH_BASE_URL || DEFAULT_AUTH_BASE_URL).replace(/\/+$/, '');
}

function resolveUrl(explicitUrl, explicitPath, defaultPath) {
  if (explicitUrl) return explicitUrl;
  const path = explicitPath || defaultPath;
  const normalizedPath = String(path).startsWith('/') ? path : `/${path}`;
  return `${normalizeBaseUrl()}${normalizedPath}`;
}

function getCertificatesUrl() {
  return resolveUrl(
    process.env.CERTIFICATES_SERVICE_URL || process.env.AUTH_CERTIFICATES_URL,
    process.env.CERTIFICATES_SERVICE_PATH || process.env.AUTH_CERTIFICATES_PATH,
    DEFAULT_CERTIFICATES_PATH
  );
}

function getChangeStageUrl() {
  return resolveUrl(
    process.env.CERTIFICATE_STAGE_CHANGE_URL || process.env.CERTIFICATE_CHANGE_STAGE_URL,
    process.env.CERTIFICATE_STAGE_CHANGE_PATH || process.env.CERTIFICATE_CHANGE_STAGE_PATH,
    DEFAULT_CHANGE_STAGE_PATH
  );
}

function parseJsonSafe(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_error) {
    return { raw: text };
  }
}

function getSessionAllIds(session) {
  const upstreamAllIds = session?.upstream?.allIds;
  if (Array.isArray(upstreamAllIds) && upstreamAllIds.length > 0) {
    return upstreamAllIds.map((id) => String(id)).filter(Boolean);
  }

  const contactId = session?.upstream?.contactId || session?.user?.id;
  return contactId ? [String(contactId)] : [];
}

function getUpstreamCookies(session) {
  const cookies = session?.upstream?.cookies;
  return Array.isArray(cookies) ? cookies.filter(Boolean) : [];
}

function parsePositiveInteger(value, fallback, maxValue = 100) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, maxValue);
}

function parseOrder(value) {
  return String(value || 'DESC').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
}

function parseDefaultGroupIds() {
  const raw = process.env.CERTIFICATES_GROUP_IDS;
  if (!raw) return DEFAULT_GROUP_IDS;
  const groupIds = raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => ALLOWED_STAGE_GROUP_IDS.has(item));
  return groupIds.length > 0 ? groupIds : DEFAULT_GROUP_IDS;
}

function getSelectedStageGroupIds(statusQuery) {
  const statuses = Array.isArray(statusQuery)
    ? statusQuery
    : String(statusQuery || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);

  if (statuses.length === 0) return [];

  const groupIds = statuses.flatMap((status) => {
    const normalized = String(status || '').trim();
    if (ALLOWED_STAGE_GROUP_IDS.has(normalized)) return [normalized];

    const legacyStatus = normalized.toUpperCase();
    return LEGACY_STATUS_TO_GROUP_IDS[legacyStatus] || [];
  });

  return Array.from(new Set(groupIds));
}

function buildGroupIds(statusQuery) {
  const selectedGroupIds = getSelectedStageGroupIds(statusQuery);
  return selectedGroupIds.length > 0 ? selectedGroupIds : parseDefaultGroupIds();
}

function buildServiceFilters(query = {}, extraFilters = {}) {
  const filters = { ...extraFilters };

  const selectedGroupIds = getSelectedStageGroupIds(query.status);
  if (selectedGroupIds.length === 1 && !filters.stage_id) {
    filters.stage_id = { EQUAL: selectedGroupIds[0] };
  }


  if (query.from) {
    filters.from = query.from;
    filters.dateFrom = query.from;
    filters.activationDateFrom = query.from;
  }

  if (query.to) {
    filters.to = query.to;
    filters.dateTo = query.to;
    filters.activationDateTo = query.to;
  }

  return filters;
}

function parseOpportunity(value) {
  if (value === null || value === undefined || value === '') return 0;
  const amount = Number(String(value).split('|')[0].replace(',', '.'));
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
}

function formatServiceTime(value) {
  if (!value) return null;
  const stringValue = String(value);
  if (stringValue.length >= 16 && stringValue.includes(' ')) return stringValue.slice(11, 16);
  if (/^\d{2}:\d{2}/.test(stringValue)) return stringValue.slice(0, 5);
  return null;
}

function formatServiceDate(value) {
  if (!value) return null;
  const stringValue = String(value);
  const match = stringValue.match(/\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : null;
}

function mapStageToStatus(stage = {}) {
  const groupId = String(stage.group_id || stage.groupId || '').toLowerCase();

  if (ALLOWED_STAGE_GROUP_IDS.has(groupId)) return groupId;
  if (groupId === 'paid') return 'PAID';
  if (['waiting', 'confirmed', 'verification'].includes(groupId)) return 'PAYMENT_PROCESSING';
  return 'REDEEMED';
}

function mapCertificate(raw = {}) {
  const stage = raw.STAGE || raw.stage || {};
  const contacts = raw.CONTACTS || raw.contacts || {};
  const phones = Array.isArray(contacts.PHONES) ? contacts.PHONES : [];
  const emails = Array.isArray(contacts.EMAILS) ? contacts.EMAILS : [];
  const scheduleTime = raw.SCHEDULE_TIME || raw.scheduleTime || null;
  const activationDate = raw.ACTIVATION_DATE || raw.activationDate || null;

  return {
    id: String(raw.ID || raw.id || raw.NUMBER || raw.number || ''),
    externalId: raw.ID || raw.id || null,
    certificateNumber: String(raw.NUMBER || raw.number || raw.ID || raw.id || '—'),
    title: raw.TITLE || raw.title || raw.OPTIONS || raw.options || 'Сертификат',
    description: raw.ADDITIONAL_INFO || raw.additionalInfo || raw.OPTIONS || raw.options || null,
    amountCents: parseOpportunity(raw.OPPORTUNITY || raw.opportunity),
    serviceDurationMinutes: null,
    imageUrl: null,
    status: mapStageToStatus(stage),
    statusLabel: stage.group_title || stage.groupTitle || null,
    stageGroupId: stage.group_id || stage.groupId || null,
    stageId: stage.id || null,
    serviceDate: formatServiceDate(activationDate || scheduleTime),
    serviceTime: formatServiceTime(scheduleTime),
    customerFullName: raw.NAME || raw.name || '—',
    customerPhone: phones[0] || null,
    customerEmail: emails[0] || null,
    customerPhones: phones,
    customerEmails: emails,
    address: raw.ADDRESS || raw.address || null,
    options: raw.OPTIONS || raw.options || null,
    additionalInfo: raw.ADDITIONAL_INFO || raw.additionalInfo || null,
    clientComment: raw.COMMENT_CLIENT_ACTIVATION || raw.commentClientActivation || null,
    partnerComment: raw.COMMENT_PARTNER_ACTIVATION || raw.commentPartnerActivation || null,
    messenger: raw.MESSAGER || raw.messenger || null,
    telegramUsername: raw.TGUSERNAME || raw.tgUsername || null,
    redeemedAt: activationDate || null,
    paymentRequestId: null,
    paymentRequestStatus: null,
    createdAt: scheduleTime || activationDate || null,
    updatedAt: null,
    raw
  };
}

function normalizePagination(payloadPagination = {}, requestPayload = {}) {
  const currentPage = Number(payloadPagination.current_page || payloadPagination.currentPage || requestPayload.page || 1);
  const limit = Number(payloadPagination.limit || requestPayload.limit || 20);
  const totalItems = Number(payloadPagination.total_items || payloadPagination.totalItems || 0);
  const totalPages = Number(payloadPagination.total_pages || payloadPagination.totalPages || 1);

  return {
    currentPage: Number.isFinite(currentPage) && currentPage > 0 ? currentPage : 1,
    limit: Number.isFinite(limit) && limit > 0 ? limit : 20,
    totalItems: Number.isFinite(totalItems) && totalItems >= 0 ? totalItems : 0,
    totalPages: Number.isFinite(totalPages) && totalPages > 0 ? totalPages : 1
  };
}

function getPayloadResult(payload) {
  return payload?.result && typeof payload.result === 'object' ? payload.result : payload;
}

function getServiceErrorMessage(payload) {
  return payload?.error || payload?.message || payload?.errorMessage || payload?.result?.error || payload?.result?.message;
}


async function postJsonToPartnerService(session, url, body, refererPath = '/certificates') {
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'Origin': normalizeBaseUrl(),
    'Referer': `${normalizeBaseUrl()}${refererPath}`
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
    const error = new Error(`WOWlife request failed: ${response.status}`);
    error.statusCode = response.status >= 400 ? response.status : 502;
    error.publicMessage = getServiceErrorMessage(payload) || 'Не удалось выполнить запрос в сервис WOWlife.';
    error.upstreamPayload = payload;
    throw error;
  }

  return { payload, url };
}

async function postToCertificatesService(session, body) {
  try {
    return await postJsonToPartnerService(session, getCertificatesUrl(), body, '/authentication/sign-in');
  } catch (error) {
    if (!error.publicMessage || error.publicMessage === 'Не удалось выполнить запрос в сервис WOWlife.') {
      error.publicMessage = 'Не удалось получить сертификаты из сервиса WOWlife.';
    }
    throw error;
  }
}

async function fetchPartnerCertificates({ session, query = {}, page, limit, order, filters = {} }) {
  const allIds = getSessionAllIds(session);

  if (allIds.length === 0) {
    const error = new Error('No partner identifiers in session');
    error.statusCode = 401;
    error.publicMessage = 'В сессии не найден идентификатор партнёра. Войдите в приложение заново.';
    throw error;
  }

  const requestPayload = {
    page: parsePositiveInteger(page || query.page, 1, 10000),
    limit: parsePositiveInteger(limit || query.limit, 20, 100),
    order: parseOrder(order || query.order),
    groupIds: buildGroupIds(query.status),
    allIds,
    filters: buildServiceFilters(query, filters)
  };

  const { payload } = await postToCertificatesService(session, requestPayload);
  const result = getPayloadResult(payload) || {};
  const data = Array.isArray(result.data) ? result.data : [];
  const pagination = normalizePagination(result.pagination, requestPayload);

  return {
    items: data.map(mapCertificate),
    pagination,
    source: 'wowlife',
    request: {
      page: requestPayload.page,
      limit: requestPayload.limit,
      order: requestPayload.order,
      groupIds: requestPayload.groupIds
    }
  };
}

function isSameCertificate(item, id) {
  const normalizedId = String(id || '').trim();
  return String(item.id) === normalizedId || String(item.externalId || '') === normalizedId || String(item.certificateNumber) === normalizedId;
}

async function fetchPartnerCertificateById({ session, id }) {
  const normalizedId = String(id || '').trim();
  if (!normalizedId) {
    const error = new Error('Certificate id is required');
    error.statusCode = 400;
    error.publicMessage = 'Не указан идентификатор сертификата.';
    throw error;
  }

  const result = await fetchPartnerCertificates({
    session,
    page: 1,
    limit: 20,
    order: 'DESC',
    filters: {
      certificate_id: { '=': normalizedId }
    }
  });

  const found = result.items.find((item) => isSameCertificate(item, normalizedId)) || result.items[0];
  if (found) return found;

  const error = new Error('Certificate not found in WOWlife service');
  error.statusCode = 404;
  error.publicMessage = 'Сертификат не найден в сервисе WOWlife.';
  throw error;
}


function getDefaultScheduleStageId() {
  return process.env.CERTIFICATE_SCHEDULE_STAGE_ID || 'C2:UC_4Q05NY';
}

function normalizeDealId(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  const numeric = Number(text);
  return Number.isFinite(numeric) && String(Math.trunc(numeric)) === text ? Math.trunc(numeric) : text;
}

function normalizeScheduleDate(value) {
  const text = String(value || '').trim();
  const match = text.match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : '';
}

function normalizeScheduleTime(value) {
  const text = String(value || '').trim();
  const match = text.match(/^\d{2}:\d{2}/);
  return match ? match[0] : '';
}

function normalizeAddressArray(addressArray, selectedAddress) {
  const values = Array.isArray(addressArray) ? addressArray : [];
  const normalized = values.map((item) => String(item || '').trim()).filter(Boolean);
  const selected = String(selectedAddress || '').trim();
  if (selected && !normalized.includes(selected)) normalized.unshift(selected);
  return Array.from(new Set(normalized));
}

function buildSchedulePayload(body = {}) {
  const date = normalizeScheduleDate(body.date);
  const time = normalizeScheduleTime(body.time) || '00:00';
  const address = String(body.address || '').trim();
  const addressArray = normalizeAddressArray(body.addressArray, address);
  const stageId = String(body.stageId || getDefaultScheduleStageId()).trim();
  const payload = {
    dealId: normalizeDealId(body.dealId || body.id),
    title: String(body.title || '').trim(),
    date,
    time,
    phone: String(body.phone || '').trim(),
    address,
    addressArray,
    notes: String(body.notes || ''),
    cancel: String(body.cancel || ''),
    datetime: String(body.datetime || (date ? `${date}T${time}:00` : '')).trim(),
    stageId
  };

  const requiredFields = [
    ['dealId', 'Не указан идентификатор заявки.'],
    ['title', 'Укажите название услуги.'],
    ['date', 'Укажите дату записи.'],
    ['time', 'Укажите время записи.'],
    ['phone', 'Укажите телефон для связи.'],
    ['address', 'Укажите адрес проведения.'],
    ['stageId', 'Не указан целевой статус записи.']
  ];

  for (const [field, message] of requiredFields) {
    if (!payload[field]) {
      const error = new Error(`Schedule payload field is missing: ${field}`);
      error.statusCode = 400;
      error.publicMessage = message;
      throw error;
    }
  }

  if (payload.addressArray.length === 0) payload.addressArray = [payload.address];
  return payload;
}

function mapChangedCertificate(raw = {}) {
  const serviceDateTime = raw.UF_CRM_1654155455356 || raw.serviceDateTime || null;
  return {
    id: String(raw.ID || raw.id || raw.VALUE_ID || ''),
    externalId: raw.ID || raw.id || raw.VALUE_ID || null,
    certificateNumber: String(raw.UF_CRM_1653569678 || raw.NUMBER || raw.number || raw.ID || raw.id || '—'),
    title: raw.UF_CRM_1654152270753 || raw.TITLE || raw.title || 'Сертификат',
    description: raw.UF_CRM_1655304753465 || raw.ADDITIONAL_INFO || raw.additionalInfo || null,
    amountCents: parseOpportunity(raw.OPPORTUNITY || raw.UF_CRM_1654155963380 || raw.opportunity),
    status: raw.STAGE_ID || raw.stageId || null,
    stageId: raw.STAGE_ID || raw.stageId || null,
    serviceDate: formatServiceDate(serviceDateTime),
    serviceTime: formatServiceTime(serviceDateTime),
    customerFullName: raw.UF_CRM_1749636338014 || raw.NAME || raw.name || '—',
    customerPhone: raw.UF_CRM_1748509255109 || raw.UF_CRM_1749635241862 || raw.PHONE || raw.phone || null,
    address: raw.UF_CRM_1692301312085 || raw.ADDRESS || raw.address || null,
    raw
  };
}

async function changePartnerCertificateStage({ session, body = {} }) {
  const requestPayload = buildSchedulePayload(body);

  try {
    const { payload } = await postJsonToPartnerService(session, getChangeStageUrl(), requestPayload, '/certificates');
    const result = getPayloadResult(payload) || {};
    return {
      item: mapChangedCertificate(result),
      raw: result,
      source: 'wowlife',
      request: {
        dealId: requestPayload.dealId,
        stageId: requestPayload.stageId,
        date: requestPayload.date,
        time: requestPayload.time
      }
    };
  } catch (error) {
    if (!error.publicMessage || error.publicMessage === 'Не удалось выполнить запрос в сервис WOWlife.') {
      error.publicMessage = 'Не удалось записать сертификат в сервисе WOWlife.';
    }
    throw error;
  }
}

module.exports = {
  fetchPartnerCertificates,
  fetchPartnerCertificateById,
  changePartnerCertificateStage,
  DEFAULT_GROUP_IDS
};
