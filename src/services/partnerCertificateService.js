const DEFAULT_AUTH_BASE_URL = 'https://partner-wowlife.ru';
const DEFAULT_CERTIFICATES_PATH = '/restapi/certificate.getPartnerCertificates';
const DEFAULT_CHANGE_STAGE_PATH = '/restapi/certificate.changeCertificateStage';
const DEFAULT_REDEEM_INFO_PATH = '/restapi/certificate.getCertificateForRedeem';
const DEFAULT_REDEEM_CERTIFICATE_PATH = '/restapi/certificate.redeemCertificate';
const DEFAULT_LAST_VERIFICATION_DATE_PATH = '/restapi/certificate.getLastVerificationDate';
const DEFAULT_CREATE_VERIFICATION_PATH = '/restapi/certificate.createVerification';
const DEFAULT_PRODUCTS_PATH = '/restapi/product.getPartnerProducts';
const DEFAULT_CHANGE_PARTNER_PRODUCT_PATH = '/restapi/product.changePartnerProduct';
const DEFAULT_ADD_PARTNER_PRODUCT_PATH = '/restapi/product.addPartnerProduct';
const DEFAULT_SCHEDULE_TIME_ZONE = 'Europe/Moscow';
const DEFAULT_ACCEPT_WORK_STAGE_ID = 'C2:NEW';

const { fetchPartnerProfile } = require('./profileService');

const DEFAULT_GROUP_IDS = [
  'new',
  'waiting',
  'confirmed',
  'visited',
  'verification',
  'paid',
  'canceled',
  'notcome',
  'notrepaid'
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

function getRedeemInfoUrl() {
  return resolveUrl(
    process.env.CERTIFICATE_REDEEM_INFO_URL || process.env.CERTIFICATE_INFO_FOR_REDEEM_URL,
    process.env.CERTIFICATE_REDEEM_INFO_PATH || process.env.CERTIFICATE_INFO_FOR_REDEEM_PATH,
    DEFAULT_REDEEM_INFO_PATH
  );
}

function getRedeemCertificateUrl() {
  return resolveUrl(
    process.env.CERTIFICATE_REDEEM_URL || process.env.CERTIFICATE_REDEEM_CERTIFICATE_URL,
    process.env.CERTIFICATE_REDEEM_PATH || process.env.CERTIFICATE_REDEEM_CERTIFICATE_PATH,
    DEFAULT_REDEEM_CERTIFICATE_PATH
  );
}

function getLastVerificationDateUrl() {
  return resolveUrl(
    process.env.CERTIFICATE_LAST_VERIFICATION_DATE_URL || process.env.CERTIFICATE_LAST_VERIFICATION_URL,
    process.env.CERTIFICATE_LAST_VERIFICATION_DATE_PATH || process.env.CERTIFICATE_LAST_VERIFICATION_PATH,
    DEFAULT_LAST_VERIFICATION_DATE_PATH
  );
}

function getCreateVerificationUrl() {
  return resolveUrl(
    process.env.CERTIFICATE_CREATE_VERIFICATION_URL || process.env.CERTIFICATE_VERIFICATION_CREATE_URL,
    process.env.CERTIFICATE_CREATE_VERIFICATION_PATH || process.env.CERTIFICATE_VERIFICATION_CREATE_PATH,
    DEFAULT_CREATE_VERIFICATION_PATH
  );
}

function getPartnerProductsUrl() {
  return resolveUrl(
    process.env.PRODUCTS_SERVICE_URL || process.env.PARTNER_PRODUCTS_URL,
    process.env.PRODUCTS_SERVICE_PATH || process.env.PARTNER_PRODUCTS_PATH,
    DEFAULT_PRODUCTS_PATH
  );
}

function getChangePartnerProductUrl() {
  return resolveUrl(
    process.env.PRODUCT_CHANGE_PARTNER_PRODUCT_URL
      || process.env.PRODUCT_CHANGE_SERVICE_URL
      || process.env.CHANGE_PARTNER_PRODUCT_URL,
    process.env.PRODUCT_CHANGE_SERVICE_PATH || process.env.CHANGE_PARTNER_PRODUCT_PATH,
    DEFAULT_CHANGE_PARTNER_PRODUCT_PATH
  );
}

function getAddPartnerProductUrl() {
  return resolveUrl(
    process.env.PRODUCT_ADD_PARTNER_PRODUCT_URL
      || process.env.PRODUCT_ADD_SERVICE_URL
      || process.env.ADD_PARTNER_PRODUCT_URL,
    process.env.PRODUCT_ADD_SERVICE_PATH || process.env.ADD_PARTNER_PRODUCT_PATH,
    DEFAULT_ADD_PARTNER_PRODUCT_PATH
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

function parseIdList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniqNonEmpty(values = []) {
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));
}

function toIdArray(value) {
  if (Array.isArray(value)) {
    return uniqNonEmpty(value.flatMap((item) => toIdArray(item)));
  }

  if (value === null || value === undefined || value === '') return [];

  if (typeof value === 'number' || typeof value === 'bigint') {
    return [String(value)];
  }

  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  if (typeof value === 'object') {
    const idValues = [
      value.ID,
      value.id,
      value.VALUE,
      value.value,
      value.PARTNER_ID,
      value.partnerId,
      value.COMPANY_ID,
      value.companyId
    ];
    return uniqNonEmpty(idValues.flatMap((item) => toIdArray(item)));
  }

  return [];
}

function normalizeProfileKey(key) {
  return String(key || '').toLowerCase().replace(/[^a-zа-я0-9]/g, '');
}

function isProductPartnerProfileKey(key) {
  const normalized = normalizeProfileKey(key);
  const knownKeys = [
    'productsallids',
    'productallids',
    'productpartnerids',
    'productpartnerid',
    'partnerproductids',
    'partnerproductid',
    'partnerproductsids',
    'partnerproductsid',
    'partnerids',
    'partnerid',
    'partner',
    'companyid',
    'company'
  ];

  return knownKeys.includes(normalized) || (
    normalized.includes('partner') &&
    (normalized.includes('product') || normalized.includes('service') || normalized.includes('id'))
  );
}

function extractProductPartnerIdsFromProfile(profile = {}) {
  const candidates = [];
  const sources = [profile, profile.raw, profile.item, profile.item?.raw].filter(Boolean);

  sources.forEach((source) => {
    if (!source || typeof source !== 'object') return;

    Object.entries(source).forEach(([key, value]) => {
      if (isProductPartnerProfileKey(key)) {
        candidates.push(...toIdArray(value));
      }
    });
  });

  if (candidates.length > 0) return uniqNonEmpty(candidates);

  // Последний fallback тоже берётся из профиля, но не из env и не из хардкода.
  return uniqNonEmpty([profile.partnerId, profile.raw?.PARTNER, profile.raw?.PARTNER_ID, profile.raw?.COMPANY_ID, profile.id]);
}

async function getProductPartnerIdsFromProfile(session) {
  const { item: profile } = await fetchPartnerProfile({ session });
  const profileIds = extractProductPartnerIdsFromProfile(profile);

  if (profileIds.length === 0) {
    const error = new Error('No product partner identifiers in profile');
    error.statusCode = 400;
    error.publicMessage = 'В профиле партнёра не найдены идентификаторы для загрузки услуг.';
    throw error;
  }

  return profileIds;
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

function normalizeServiceDate(value) {
  const normalized = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : '';
}

function buildServiceFilters(query = {}, extraFilters = {}) {
  const filters = { ...extraFilters };

  const selectedGroupIds = getSelectedStageGroupIds(query.status);
  if (selectedGroupIds.length === 1 && !filters.stage_id) {
    filters.stage_id = { EQUAL: selectedGroupIds[0] };
  }

  const from = normalizeServiceDate(query.from);
  const to = normalizeServiceDate(query.to);

  if (from && to && !filters.schedule_time) {
    filters.schedule_time = { BETWEEN: [from, to] };
  }

  return filters;
}

function parseOpportunity(value) {
  if (value === null || value === undefined || value === '') return 0;
  const amount = Number(String(value).split('|')[0].replace(',', '.'));
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
}

function formatOpportunityLabel(value) {
  if (value === null || value === undefined || value === '') return '—';
  const [amountRaw, currencyRaw] = String(value).split('|');
  const amount = Number(String(amountRaw || '').replace(',', '.'));
  const amountText = Number.isFinite(amount)
    ? new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(amount)
    : String(amountRaw || '').trim();
  const currency = String(currencyRaw || 'RUB').trim() || 'RUB';
  return `${amountText} ${currency}`.trim();
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

function normalizeStageTitle(title) {
  const value = String(title || '').trim();
  if (!value) return null;
  const normalized = value.toLowerCase();
  if (normalized === 'ожидает сверки' || normalized === 'ожидание сверки') {
    return 'Ожидает оплаты';
  }
  const normalizedForCompare = normalized.replace(/ё/g, 'е');
  if (['подтвержден', 'подтержден', 'подтверждено', 'подтерждено'].includes(normalizedForCompare)) {
    return 'Записан';
  }
  if (['погашен', 'погашено'].includes(normalizedForCompare)) {
    return 'Посетил';
  }
  if (['не погашен', 'не погашено', 'непогашен', 'непогашено'].includes(normalizedForCompare)) {
    return 'Не погашен';
  }
  return value;
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
    statusLabel: normalizeStageTitle(stage.group_title || stage.groupTitle),
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


function parseProductMoney(value) {
  if (value === null || value === undefined || value === '') return 0;
  const amount = Number(String(value).replace(',', '.'));
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
}

function formatProductMoneyLabel(value, fallback = '0') {
  if (value === null || value === undefined || value === '') return fallback;
  const amount = Number(String(value).replace(',', '.'));
  if (!Number.isFinite(amount)) return String(value).trim() || fallback;
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(amount);
}

function mapPartnerProduct(raw = {}) {
  const priceRaw = raw.SELFPRICE ?? raw.selfprice ?? raw.price ?? 0;
  const openPriceRaw = raw.OPEN_PRICE ?? raw.openPrice ?? raw.open_price ?? 0;

  return {
    id: String(raw.ELEMENT_ID || raw.elementId || raw.id || raw.PRODUCT || raw.product || ''),
    elementId: raw.ELEMENT_ID || raw.elementId || null,
    name: raw.ELEMENT_NAME || raw.elementName || raw.name || 'Услуга',
    priceCents: parseProductMoney(priceRaw),
    priceLabel: formatProductMoneyLabel(priceRaw),
    openPriceCents: parseProductMoney(openPriceRaw),
    openPriceLabel: formatProductMoneyLabel(openPriceRaw),
    activeFrom: raw.ACTIVE_FROM || raw.activeFrom || null,
    activeTo: raw.ACTIVE_TO || raw.activeTo || null,
    active: raw.ACTIVE || raw.active || null,
    partnerId: raw.PARTNER || raw.partner || null,
    productId: raw.PRODUCT || raw.product || null,
    parentId: raw.PARENT_ID || raw.parentId || null,
    productCode: raw.PRODUCT_CODE || raw.productCode || null,
    productRegion: raw.PRODUCT_REGION || raw.productRegion || null,
    productLink: raw.PRODUCT_LINK || raw.productLink || null,
    raw
  };
}

async function fetchPartnerProducts({ session }) {
  const allIds = await getProductPartnerIdsFromProfile(session);

  const requestPayload = { allIds };

  try {
    const { payload } = await postJsonToPartnerService(session, getPartnerProductsUrl(), requestPayload, '/services');
    const result = getPayloadResult(payload) || [];
    const data = Array.isArray(result) ? result : (Array.isArray(result.data) ? result.data : []);

    return {
      items: data.map(mapPartnerProduct),
      source: 'wowlife',
      request: requestPayload
    };
  } catch (error) {
    if (!error.publicMessage || error.publicMessage === 'Не удалось выполнить запрос в сервис WOWlife.') {
      error.publicMessage = 'Не удалось получить список услуг из сервиса WOWlife.';
    }
    throw error;
  }
}

function normalizePlainText(value) {
  return String(value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();
}

function escapeProductInfoPart(value) {
  return normalizePlainText(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');
}

async function resolveProductChangeContactId(session, body = {}) {
  const directContactId = String(body.contactId || body.partnerId || '').trim();
  if (directContactId) return directContactId;

  try {
    const { item: profile } = await fetchPartnerProfile({ session });
    const profileId = String(profile?.id || profile?.raw?.ID || '').trim();
    if (profileId) return profileId;
  } catch (_error) {
    // Fallback to session identifiers below.
  }

  return String(session?.upstream?.contactId || session?.user?.id || '').trim();
}

async function changePartnerProduct({ session, body = {} }) {
  const description = normalizePlainText(body.description);
  const productName = normalizePlainText(body.productName || body.serviceName || body.name);

  if (!description) {
    const error = new Error('Product description is required');
    error.statusCode = 400;
    error.publicMessage = 'Введите описание для заявки на модерацию.';
    throw error;
  }

  if (!productName) {
    const error = new Error('Product name is required');
    error.statusCode = 400;
    error.publicMessage = 'Не удалось определить название услуги.';
    throw error;
  }

  const contactId = await resolveProductChangeContactId(session, body);
  if (!contactId) {
    const error = new Error('Contact id is required');
    error.statusCode = 400;
    error.publicMessage = 'Не удалось определить партнёра для заявки на модерацию.';
    throw error;
  }

  const requestPayload = {
    partnerData: {
      name: 'Заявка на модерацию товара',
      productInfo: `${escapeProductInfoPart(description)}<br>${escapeProductInfoPart(productName)}`
    },
    contactId
  };

  try {
    const { payload } = await postJsonToPartnerService(session, getChangePartnerProductUrl(), requestPayload, '/services');
    const result = getPayloadResult(payload) || {};
    return {
      item: result,
      raw: payload,
      source: 'wowlife',
      request: requestPayload
    };
  } catch (error) {
    if (!error.publicMessage || error.publicMessage === 'Не удалось выполнить запрос в сервис WOWlife.') {
      error.publicMessage = 'Не удалось отправить заявку на модерацию услуги.';
    }
    throw error;
  }
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


function formatDaysLeftLabel(daysLeft) {
  const count = Math.abs(Number(daysLeft)) % 100;
  const last = count % 10;
  if (count > 10 && count < 20) return 'дней';
  if (last > 1 && last < 5) return 'дня';
  if (last === 1) return 'день';
  return 'дней';
}

function normalizeLastVerificationDateResult(result = {}) {
  const parsedDaysLeft = Number(result.daysLeft ?? result.days_left ?? result.DAYS_LEFT);
  const daysLeft = Number.isFinite(parsedDaysLeft) ? parsedDaysLeft : null;
  const available = daysLeft === null ? true : daysLeft <= 0;

  return {
    lastVerificationDate: result.lastVerificationDate || result.last_verification_date || result.LAST_VERIFICATION_DATE || null,
    nextVerificationDate: result.nextVerificationDate || result.next_verification_date || result.NEXT_VERIFICATION_DATE || null,
    daysLeft,
    available,
    message: !available
      ? `Новая сверка будет доступна через ${daysLeft} ${formatDaysLeftLabel(daysLeft)}`
      : 'Создание новой сверки доступно.',
    raw: result
  };
}

async function fetchPartnerLastVerificationDateForReconciliation({ session }) {
  const allIds = getSessionAllIds(session);

  if (allIds.length === 0) {
    const error = new Error('No partner identifiers in session');
    error.statusCode = 401;
    error.publicMessage = 'В сессии не найден идентификатор партнёра. Войдите в приложение заново.';
    throw error;
  }

  const requestPayload = { allIds };

  try {
    const { payload } = await postJsonToPartnerService(
      session,
      getLastVerificationDateUrl(),
      requestPayload,
      '/certificates'
    );
    const result = getPayloadResult(payload) || {};

    return {
      ...normalizeLastVerificationDateResult(result),
      source: 'wowlife',
      request: requestPayload
    };
  } catch (error) {
    if (!error.publicMessage || error.publicMessage === 'Не удалось выполнить запрос в сервис WOWlife.') {
      error.publicMessage = 'Не удалось проверить доступность создания сверки.';
    }
    throw error;
  }
}


async function createPartnerVerificationForReconciliation({ session }) {
  const allIds = getSessionAllIds(session);

  if (allIds.length === 0) {
    const error = new Error('No partner identifiers in session');
    error.statusCode = 401;
    error.publicMessage = 'В сессии не найден идентификатор партнёра. Войдите в приложение заново.';
    throw error;
  }

  const requestPayload = { allIds };

  try {
    const { payload } = await postJsonToPartnerService(
      session,
      getCreateVerificationUrl(),
      requestPayload,
      '/reconciliations'
    );
    const result = getPayloadResult(payload) || {};

    return {
      result,
      raw: result,
      source: 'wowlife',
      request: requestPayload,
      message: 'Сверка создана.'
    };
  } catch (error) {
    if (!error.publicMessage || error.publicMessage === 'Не удалось выполнить запрос в сервис WOWlife.') {
      error.publicMessage = 'Не удалось создать сверку.';
    }
    throw error;
  }
}

async function fetchPartnerVisitedCertificatesForReconciliation({ session }) {
  const allIds = getSessionAllIds(session);

  if (allIds.length === 0) {
    const error = new Error('No partner identifiers in session');
    error.statusCode = 401;
    error.publicMessage = 'В сессии не найден идентификатор партнёра. Войдите в приложение заново.';
    throw error;
  }

  const requestPayload = {
    page: 1,
    limit: 1000,
    groupIds: ['visited'],
    allIds
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

function getAcceptWorkStageId() {
  return process.env.CERTIFICATE_ACCEPT_WORK_STAGE_ID || DEFAULT_ACCEPT_WORK_STAGE_ID;
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


function normalizeCertificateNumber(value) {
  return String(value || '').trim();
}

function mapRedeemCertificate(raw = {}) {
  const contacts = raw.CONTACTS || raw.contacts || {};
  const phones = Array.isArray(contacts.PHONES) ? contacts.PHONES : [];
  const emails = Array.isArray(contacts.EMAILS) ? contacts.EMAILS : [];
  const scheduleTime = raw.SCHEDULE_TIME || raw.scheduleTime || null;
  const opportunity = raw.OPPORTUNITY || raw.opportunity || '';

  return {
    id: String(raw.ID || raw.id || raw.NUMBER || raw.number || ''),
    externalId: raw.ID || raw.id || null,
    certificateNumber: String(raw.NUMBER || raw.number || ''),
    secretCode: raw.CODE || raw.code || null,
    title: raw.TITLE || raw.title || raw.SERVICE || raw.service || raw.OPTIONS || raw.options || 'Сертификат',
    service: raw.SERVICE || raw.service || raw.OPTIONS || raw.options || raw.TITLE || raw.title || '—',
    options: raw.OPTIONS || raw.options || null,
    amountCents: parseOpportunity(opportunity),
    amountLabel: formatOpportunityLabel(opportunity),
    stageId: raw.STAGE_ID || raw.stageId || null,
    status: raw.STAGE_ID || raw.stageId || null,
    serviceDate: formatServiceDate(scheduleTime),
    serviceTime: formatServiceTime(scheduleTime),
    scheduleTime,
    customerFullName: raw.NAME || raw.name || '—',
    customerEmail: emails[0] || null,
    customerPhone: phones[0] || null,
    customerEmails: emails,
    customerPhones: phones,
    raw
  };
}

async function fetchPartnerCertificateForRedeem({ session, body = {} }) {
  const allIds = getSessionAllIds(session);
  if (allIds.length === 0) {
    const error = new Error('No partner identifiers in session');
    error.statusCode = 401;
    error.publicMessage = 'В сессии не найден идентификатор партнёра. Войдите в приложение заново.';
    throw error;
  }

  const number = normalizeCertificateNumber(body.number || body.certificateNumber);
  const code = String(body.code || body.secretCode || '').trim();

  if (!number || !code) {
    const error = new Error('Certificate number and code are required');
    error.statusCode = 400;
    error.publicMessage = 'Укажите номер сертификата и секретный код.';
    throw error;
  }

  const requestPayload = { number, code, allIds };

  try {
    const { payload } = await postJsonToPartnerService(session, getRedeemInfoUrl(), requestPayload, '/redeem');
    const result = getPayloadResult(payload) || {};
    if (!result || Object.keys(result).length === 0) {
      const error = new Error('Empty certificate info response');
      error.statusCode = 404;
      error.publicMessage = 'Информация по сертификату не найдена.';
      throw error;
    }

    return {
      item: mapRedeemCertificate(result),
      source: 'wowlife',
      request: {
        number: requestPayload.number,
        allIds: requestPayload.allIds
      }
    };
  } catch (error) {
    if (!error.publicMessage || error.publicMessage === 'Не удалось выполнить запрос в сервис WOWlife.') {
      error.publicMessage = 'Не удалось получить данные сертификата из сервиса WOWlife.';
    }
    throw error;
  }
}


function getNewStageId() {
  return process.env.CERTIFICATE_NEW_STAGE_ID || 'C2:UC_MCMFWK';
}

function normalizeStatusValues(item = {}) {
  return [
    item.status,
    item.statusLabel,
    item.stageGroupId,
    item.stageId,
    item.raw?.STAGE_ID,
    item.raw?.STAGE?.id,
    item.raw?.STAGE?.group_id,
    item.raw?.STAGE?.group_title,
    item.raw?.IS_NEW
  ].map((value) => String(value || '').trim().toLowerCase()).filter(Boolean);
}

function isNewCertificateForRedeem(item = {}) {
  const newStageId = String(getNewStageId()).trim().toLowerCase();
  return normalizeStatusValues(item).some((value) => {
    if (value === 'new' || value === 'новый' || value === 'новая заявка') return true;
    if (value === 'y') return true;
    if (newStageId && value === newStageId) return true;
    return /(:|^)new$/.test(value);
  });
}

function isConfirmedCertificateForRedeem(item = {}) {
  const scheduleStageId = String(getDefaultScheduleStageId()).trim().toLowerCase();
  return normalizeStatusValues(item).some((value) => {
    if (value === 'confirmed' || value === 'подтвержден' || value === 'подтверждён' || value === 'записан') return true;
    if (scheduleStageId && value === scheduleStageId) return true;
    return false;
  });
}

function formatCurrentDateTime(timeZone = process.env.CERTIFICATE_SCHEDULE_TIME_ZONE || DEFAULT_SCHEDULE_TIME_ZONE) {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(now).reduce((acc, part) => {
    if (part.type !== 'literal') acc[part.type] = part.value;
    return acc;
  }, {});

  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`
  };
}

function getRawProfileAddresses(profile = {}) {
  const values = profile?.raw?.UF_CRM_1692176867840 || profile?.work?.addresses || [];
  return Array.isArray(values) ? values.map((value) => String(value || '').trim()).filter(Boolean) : [];
}

function getDefaultSchedulePhone(item = {}, profile = {}) {
  const phones = Array.isArray(item.customerPhones) ? item.customerPhones : [];
  return item.customerPhone || phones[0] || profile.phone || '';
}

function buildAutomaticSchedulePayload(item = {}, profile = {}) {
  const addressArray = getRawProfileAddresses(profile);
  const address = addressArray[0] || '';
  const { date, time } = formatCurrentDateTime();

  if (!address) {
    const error = new Error('Profile address is missing');
    error.statusCode = 400;
    error.publicMessage = 'Для записи сертификата не найден адрес в профиле партнёра.';
    throw error;
  }

  return buildSchedulePayload({
    dealId: item.externalId || item.id,
    id: item.id,
    title: item.service || item.title || item.certificateNumber || 'Сертификат',
    date,
    time,
    phone: getDefaultSchedulePhone(item, profile),
    address,
    addressArray,
    notes: '',
    cancel: '',
    datetime: `${date}T${time}:00`,
    stageId: getDefaultScheduleStageId()
  });
}

async function redeemPartnerCertificateById({ session, certificateId }) {
  const normalizedCertificateId = normalizeDealId(certificateId);
  if (!normalizedCertificateId) {
    const error = new Error('Certificate id is required for redeem');
    error.statusCode = 400;
    error.publicMessage = 'Не указан идентификатор сертификата для погашения.';
    throw error;
  }

  const requestPayload = { certificateId: normalizedCertificateId };

  try {
    const { payload } = await postJsonToPartnerService(session, getRedeemCertificateUrl(), requestPayload, '/redeem');
    const result = getPayloadResult(payload) || {};
    return {
      raw: result,
      source: 'wowlife',
      request: requestPayload
    };
  } catch (error) {
    if (!error.publicMessage || error.publicMessage === 'Не удалось выполнить запрос в сервис WOWlife.') {
      error.publicMessage = 'Не удалось погасить сертификат в сервисе WOWlife.';
    }
    throw error;
  }
}

async function redeemPartnerCertificate({ session, body = {} }) {
  const info = await fetchPartnerCertificateForRedeem({ session, body });
  const item = info.item;
  const certificateId = item.externalId || item.id;
  let scheduleResult = null;

  if (isNewCertificateForRedeem(item)) {
    const { item: profile } = await fetchPartnerProfile({ session });
    const schedulePayload = buildAutomaticSchedulePayload(item, profile);
    const { payload } = await postJsonToPartnerService(session, getChangeStageUrl(), schedulePayload, '/certificates');
    scheduleResult = getPayloadResult(payload) || {};
  }

  const redeemResult = await redeemPartnerCertificateById({ session, certificateId });

  return {
    item: {
      ...item,
      status: 'REDEEMED',
      statusLabel: 'Погашен',
      redeemed: true,
      rawRedeem: redeemResult.raw,
      rawSchedule: scheduleResult
    },
    source: 'wowlife',
    request: {
      certificateId,
      scheduledBeforeRedeem: Boolean(scheduleResult),
      directRedeem: isConfirmedCertificateForRedeem(item) || !scheduleResult
    }
  };
}

async function addPartnerProduct({ session, body = {} }) {
  const productName = normalizePlainText(body.productName || body.name || body.title);
  const price = normalizePlainText(body.price || body.productPrice);
  const description = normalizePlainText(body.description || body.productDescription);

  if (!productName) {
    const error = new Error('Product name is required');
    error.statusCode = 400;
    error.publicMessage = 'Введите название товара.';
    throw error;
  }

  if (!price) {
    const error = new Error('Product price is required');
    error.statusCode = 400;
    error.publicMessage = 'Введите цену товара.';
    throw error;
  }

  if (!description) {
    const error = new Error('Product description is required');
    error.statusCode = 400;
    error.publicMessage = 'Введите описание товара.';
    throw error;
  }

  const contactId = await resolveProductChangeContactId(session, body);
  if (!contactId) {
    const error = new Error('Contact id is required');
    error.statusCode = 400;
    error.publicMessage = 'Не удалось определить партнёра для заявки на новый товар.';
    throw error;
  }

  const requestPayload = {
    partnerData: {
      name: '',
      productInfo: [
        `Название товара: ${escapeProductInfoPart(productName)}`,
        `Цена: ${escapeProductInfoPart(price)}`,
        `Описание: ${escapeProductInfoPart(description)}`
      ].join('<br>')
    },
    contactId
  };

  try {
    const { payload } = await postJsonToPartnerService(session, getAddPartnerProductUrl(), requestPayload, '/services');
    const result = getPayloadResult(payload) || {};
    return {
      item: result,
      raw: payload,
      source: 'wowlife',
      request: requestPayload
    };
  } catch (error) {
    if (!error.publicMessage || error.publicMessage === 'Не удалось выполнить запрос в сервис WOWlife.') {
      error.publicMessage = 'Не удалось отправить заявку на новый товар.';
    }
    throw error;
  }
}


function buildSimpleStagePayload(body = {}) {
  const dealId = normalizeDealId(body.dealId || body.id || body.certificateId);
  const stageId = String(body.stageId || '').trim();

  if (!dealId) {
    const error = new Error('Certificate id is required for stage change');
    error.statusCode = 400;
    error.publicMessage = 'Не указан идентификатор сертификата.';
    throw error;
  }

  if (!stageId) {
    const error = new Error('Stage id is required for stage change');
    error.statusCode = 400;
    error.publicMessage = 'Не указан целевой статус сертификата.';
    throw error;
  }

  return { dealId, stageId };
}

async function changePartnerCertificateStageSimple({ session, body = {} }) {
  const requestPayload = buildSimpleStagePayload(body);

  try {
    const { payload } = await postJsonToPartnerService(session, getChangeStageUrl(), requestPayload, '/certificates');
    const result = getPayloadResult(payload) || {};
    return {
      item: mapChangedCertificate(result),
      raw: result,
      source: 'wowlife',
      request: requestPayload
    };
  } catch (error) {
    if (!error.publicMessage || error.publicMessage === 'Не удалось выполнить запрос в сервис WOWlife.') {
      error.publicMessage = 'Не удалось изменить статус сертификата в сервисе WOWlife.';
    }
    throw error;
  }
}

async function acceptPartnerCertificateWork({ session, certificateId }) {
  return changePartnerCertificateStageSimple({
    session,
    body: {
      dealId: certificateId,
      stageId: getAcceptWorkStageId()
    }
  });
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
  fetchPartnerProducts,
  changePartnerProduct,
  addPartnerProduct,
  fetchPartnerVisitedCertificatesForReconciliation,
  fetchPartnerLastVerificationDateForReconciliation,
  createPartnerVerificationForReconciliation,
  fetchPartnerCertificateById,
  fetchPartnerCertificateForRedeem,
  redeemPartnerCertificate,
  redeemPartnerCertificateById,
  changePartnerCertificateStage,
  acceptPartnerCertificateWork,
  DEFAULT_GROUP_IDS
};
