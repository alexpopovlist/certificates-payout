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

const CERTIFICATE_STAGE_ID_STATUS_MAP = {
  'uc_rpz7aa': 'verification',
  'c2:uc_rpz7aa': 'verification',
  'c2:8': 'notrepaid',
  '8': 'notrepaid',
  'uc_zry3c1': 'visited',
  'c2:uc_zry3c1': 'visited',
  'uc_m7shzp': 'confirmed',
  'c2:uc_m7shzp': 'confirmed'
};

const CERTIFICATE_STAGE_GROUP_STATUS_MAP = {
  verification: 'verification',
  notrepaid: 'notrepaid',
  visited: 'visited',
  confirmed: 'confirmed',
  paid: 'paid',
  waiting: 'waiting',
  new: 'new',
  canceled: 'canceled'
};

function getStageField(stage, snakeName, camelName) {
  if (!stage || typeof stage !== 'object') return null;
  return stage[snakeName] ?? stage[camelName] ?? null;
}

function normalizeStageText(value) {
  return String(value || '').trim().toLowerCase().replace(/ё/g, 'е');
}

function getCertificateStageTitle(stage) {
  if (!stage) return null;
  if (typeof stage === 'object') {
    return getStageField(stage, 'group_title', 'groupTitle') || getStageField(stage, 'title', 'title') || getStageField(stage, 'name', 'name');
  }
  return null;
}

function getCertificateStageId(stage) {
  if (!stage) return '';
  if (typeof stage === 'object') {
    return String(
      getStageField(stage, 'id', 'id') ||
      getStageField(stage, 'stage_id', 'stageId') ||
      getStageField(stage, 'status_id', 'statusId') ||
      ''
    ).trim();
  }
  return String(stage).trim();
}

function pickCertificateStage(raw = {}) {
  const directStage = raw.STAGE || raw.stage;
  if (directStage && typeof directStage === 'object') return directStage;

  const stageId = directStage || raw.STAGE_ID || raw.stageId || raw.STATUS_ID || raw.statusId || raw.STATUS || raw.status;
  const groupId = raw.STAGE_GROUP_ID || raw.stageGroupId || raw.GROUP_ID || raw.groupId;
  const title = raw.STAGE_TITLE || raw.stageTitle || raw.STAGE_GROUP_TITLE || raw.stageGroupTitle || raw.STATUS_TITLE || raw.statusTitle || raw.STATUS_NAME || raw.statusName;

  return {
    id: stageId || null,
    group_id: groupId || null,
    group_title: title || null
  };
}

function normalizeCertificateStageTitle(title) {
  const value = String(title || '').trim();
  if (!value) return null;

  const normalized = normalizeStageText(value);
  if (normalized === 'ожидает сверки' || normalized === 'ожидание сверки') return 'Ожидает оплаты';
  if (['подтвержден', 'подтержден', 'подтверждено', 'подтерждено'].includes(normalized)) return 'Записан';
  if (['погашен', 'погашено'].includes(normalized)) return 'Посетил';
  if (['не погашен', 'не погашено', 'непогашен', 'непогашено'].includes(normalized)) return 'Не погашен';

  return value;
}

function mapCertificateStageToStatus(stage) {
  const groupId = normalizeStageText(getStageField(stage, 'group_id', 'groupId'));
  if (CERTIFICATE_STAGE_GROUP_STATUS_MAP[groupId]) return CERTIFICATE_STAGE_GROUP_STATUS_MAP[groupId];

  const stageId = getCertificateStageId(stage);
  const normalizedStageId = normalizeStageText(stageId);
  if (CERTIFICATE_STAGE_ID_STATUS_MAP[normalizedStageId]) return CERTIFICATE_STAGE_ID_STATUS_MAP[normalizedStageId];

  const normalizedStage = normalizeStageText([stageId, getCertificateStageTitle(stage)].filter(Boolean).join(' '));

  if (normalizedStage.includes('ожидает сверки') || normalizedStage.includes('ожидание сверки') || normalizedStage.includes('verification')) return 'verification';
  if (normalizedStage.includes('не погашен') || normalizedStage.includes('непогашен') || normalizedStage.includes('notrepaid')) return 'notrepaid';
  if (normalizedStage.includes('подтвержден') || normalizedStage.includes('подтержден') || normalizedStage.includes('confirmed')) return 'confirmed';
  if (normalizedStage.includes('погашен') || normalizedStage.includes('visited')) return 'visited';

  if (normalizedStage.includes('won') || normalizedStage.includes('success') || normalizedStage.includes('paid')) return 'paid';
  if (normalizedStage.includes('wait')) return 'verification';

  return 'visited';
}

function mapVerificationCertificate(raw = {}, parent = {}) {
  const opportunity = raw.OPPORTUNITY ?? raw.opportunity ?? 0;
  const stage = pickCertificateStage(raw);

  return {
    id: String(raw.ID || raw.id || raw.NUMBER || raw.number || ''),
    externalId: raw.ID || raw.id || null,
    certificateNumber: String(raw.NUMBER || raw.number || raw.ID || raw.id || '—'),
    title: raw.TITLE || raw.title || raw.OPTIONS || raw.options || 'Сертификат',
    description: raw.OPTIONS || raw.options || null,
    amountCents: parseOpportunity(opportunity),
    serviceDurationMinutes: null,
    imageUrl: null,
    status: mapCertificateStageToStatus(stage),
    statusLabel: normalizeCertificateStageTitle(getCertificateStageTitle(stage)),
    stageGroupId: getStageField(stage, 'group_id', 'groupId'),
    stageId: getCertificateStageId(stage) || null,
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
