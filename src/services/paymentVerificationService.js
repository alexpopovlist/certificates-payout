const DEFAULT_AUTH_BASE_URL = 'https://partner-wowlife.ru';
const DEFAULT_VERIFICATIONS_PATH = '/restapi/certificate.getVerifications';

function normalizeBaseUrl() {
  return String(process.env.AUTH_BASE_URL || DEFAULT_AUTH_BASE_URL).replace(/\/+$/, '');
}

function resolveUrl(explicitUrl, explicitPath, defaultPath) {
  if (explicitUrl) return explicitUrl;
  const path = explicitPath || defaultPath;
  const normalizedPath = String(path).startsWith('/') ? path : `/${path}`;
  return `${normalizeBaseUrl()}${normalizedPath}`;
}

function getVerificationsUrl() {
  return resolveUrl(
    process.env.VERIFICATIONS_SERVICE_URL || process.env.PAYMENTS_SERVICE_URL,
    process.env.VERIFICATIONS_SERVICE_PATH || process.env.PAYMENTS_SERVICE_PATH,
    DEFAULT_VERIFICATIONS_PATH
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

function getServiceErrorMessage(payload) {
  return payload?.error || payload?.message || payload?.errorMessage || payload?.result?.error || payload?.result?.message;
}

function parseOpportunity(value) {
  if (value === null || value === undefined || value === '') return 0;
  const normalized = String(value).split('|')[0].replace(',', '.').replace(/\s+/g, '');
  const amount = Number(normalized);
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
}

function mapVerificationStageToStatus(stage, paymentDate) {
  const normalizedStage = String(stage || '').toUpperCase();
  if (normalizedStage.includes('SUCCESS') || normalizedStage.includes('PAID') || paymentDate) {
    return 'PAID';
  }
  return 'PROCESSING';
}

function formatServiceDate(value) {
  if (!value) return null;
  const stringValue = String(value);
  const match = stringValue.match(/\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : null;
}

function formatServiceTime(value) {
  if (!value) return null;
  const stringValue = String(value);
  if (stringValue.length >= 16 && stringValue.includes(' ')) return stringValue.slice(11, 16);
  if (/^\d{2}:\d{2}/.test(stringValue)) return stringValue.slice(0, 5);
  return null;
}

function mapCertificateStageToStatus(stage) {
  const normalizedStage = String(stage || '').toUpperCase();
  if (normalizedStage.includes('WON') || normalizedStage.includes('SUCCESS') || normalizedStage.includes('PAID')) return 'PAID';
  if (normalizedStage.includes('WAIT') || normalizedStage.includes('VERIFICATION') || normalizedStage.includes('CONFIRM')) return 'PAYMENT_PROCESSING';
  return 'REDEEMED';
}

function mapVerificationCertificate(raw = {}, parent = {}) {
  const opportunity = raw.OPPORTUNITY ?? raw.opportunity ?? 0;

  return {
    id: String(raw.ID || raw.id || raw.NUMBER || raw.number || ''),
    externalId: raw.ID || raw.id || null,
    certificateNumber: String(raw.NUMBER || raw.number || raw.ID || raw.id || '—'),
    title: raw.TITLE || raw.title || raw.OPTIONS || raw.options || 'Сертификат',
    description: raw.OPTIONS || raw.options || null,
    amountCents: parseOpportunity(opportunity),
    serviceDurationMinutes: null,
    imageUrl: null,
    status: mapCertificateStageToStatus(raw.STAGE || raw.stage),
    stageId: raw.STAGE || raw.stage || null,
    serviceDate: null,
    serviceTime: null,
    customerFullName: raw.NAME || raw.name || '—',
    customerPhone: null,
    redeemedAt: parent.CREATED_TIME || parent.createdTime || null,
    createdAt: parent.CREATED_TIME || parent.createdTime || null,
    updatedAt: null,
    raw
  };
}

function mapVerification(raw = {}) {
  const certificates = Array.isArray(raw.CERTIFICATES)
    ? raw.CERTIFICATES
    : Array.isArray(raw.certificates)
      ? raw.certificates
      : [];

  const createdAt = raw.CREATED_TIME || raw.createdTime || null;
  const paymentDate = raw.PAYMENT_DATE || raw.paymentDate || null;
  const certificateItems = certificates.map((certificate) => mapVerificationCertificate(certificate, raw));
  const totalAmountCents = parseOpportunity(raw.OPPORTUNITY ?? raw.opportunity)
    || certificateItems.reduce((sum, certificate) => sum + Number(certificate.amountCents || 0), 0);

  return {
    id: String(raw.ID || raw.id || ''),
    externalId: raw.ID || raw.id || null,
    requestNumber: raw.ID || raw.id ? `Заявка №${raw.ID || raw.id}` : 'Заявка',
    periodFrom: null,
    periodTo: paymentDate || null,
    status: mapVerificationStageToStatus(raw.STAGE || raw.stage, paymentDate),
    stage: raw.STAGE || raw.stage || null,
    certificateCount: certificateItems.length,
    totalAmountCents,
    createdAt,
    paidAt: paymentDate || null,
    updatedAt: null,
    docLink: raw.DOC_LINK || raw.docLink || null,
    certificates: certificateItems,
    source: 'wowlife',
    raw
  };
}

async function postToVerificationsService(session, body) {
  const url = getVerificationsUrl();
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'Origin': normalizeBaseUrl(),
    'Referer': `${normalizeBaseUrl()}/payments`
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
    const error = new Error(`WOWlife verifications request failed: ${response.status}`);
    error.statusCode = response.status >= 400 ? response.status : 502;
    error.publicMessage = getServiceErrorMessage(payload) || 'Не удалось получить заявки на оплату из сервиса WOWlife.';
    error.upstreamPayload = payload;
    throw error;
  }

  return { payload, url };
}

function normalizeVerificationsPayload(payload) {
  if (Array.isArray(payload?.result)) return payload.result;
  if (Array.isArray(payload?.result?.data)) return payload.result.data;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload)) return payload;
  return [];
}

async function fetchPartnerVerifications({ session }) {
  const allIds = getSessionAllIds(session);

  if (allIds.length === 0) {
    const error = new Error('No partner identifiers in session');
    error.statusCode = 401;
    error.publicMessage = 'В сессии не найден идентификатор партнёра. Войдите в приложение заново.';
    throw error;
  }

  const requestPayload = { allIds };
  const { payload } = await postToVerificationsService(session, requestPayload);
  const items = normalizeVerificationsPayload(payload).map(mapVerification);
  const totalPaidAmountCents = items
    .filter((item) => item.status === 'PAID')
    .reduce((sum, item) => sum + Number(item.totalAmountCents || 0), 0);

  return {
    items,
    summary: { totalPaidAmountCents },
    source: 'wowlife',
    request: { allIds }
  };
}

async function fetchPartnerVerificationById({ session, id }) {
  const normalizedId = String(id || '').trim();
  if (!normalizedId) {
    const error = new Error('Verification id is required');
    error.statusCode = 400;
    error.publicMessage = 'Не указан идентификатор заявки.';
    throw error;
  }

  const data = await fetchPartnerVerifications({ session });
  const item = data.items.find((verification) =>
    String(verification.id) === normalizedId ||
    String(verification.externalId || '') === normalizedId ||
    String(verification.requestNumber || '') === normalizedId
  );

  if (!item) {
    const error = new Error('Verification not found in WOWlife service');
    error.statusCode = 404;
    error.publicMessage = 'Заявка не найдена в сервисе WOWlife.';
    throw error;
  }

  return {
    item,
    certificates: item.certificates || [],
    source: 'wowlife'
  };
}

module.exports = {
  fetchPartnerVerifications,
  fetchPartnerVerificationById
};
