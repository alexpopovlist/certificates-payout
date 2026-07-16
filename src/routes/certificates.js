const express = require('express');
const { query, withTransaction } = require('../db');
const { broadcastPush } = require('../services/pushService');
const {
  fetchPartnerCertificates,
  fetchPartnerVisitedCertificatesForReconciliation,
  fetchPartnerLastVerificationDateForReconciliation,
  createPartnerVerificationForReconciliation,
  fetchPartnerCertificateById,
  fetchPartnerCertificateForRedeem,
  redeemPartnerCertificate,
  changePartnerCertificateStage,
  acceptPartnerCertificateWork
} = require('../services/partnerCertificateService');

const router = express.Router();

function sendPushInBackground(payload) {
  broadcastPush(payload).catch((error) => {
    if (process.env.NODE_ENV !== 'test') {
      console.warn('Push notification skipped:', error.publicMessage || error.message);
    }
  });
}

function isTruthyEnv(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function shouldUseCertificatesService() {
  if (process.env.CERTIFICATES_USE_SERVICE === undefined || process.env.CERTIFICATES_USE_SERVICE === '') {
    return true;
  }
  return isTruthyEnv(process.env.CERTIFICATES_USE_SERVICE);
}

function parsePositiveInteger(value, fallback, maxValue = 100) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, maxValue);
}

function toCertificateDto(row) {
  return {
    id: row.id,
    certificateNumber: row.certificate_number,
    title: row.title,
    description: row.description,
    amountCents: row.amount_cents,
    serviceDurationMinutes: row.service_duration_minutes,
    imageUrl: row.image_url,
    status: row.status,
    serviceDate: row.service_date,
    serviceTime: row.service_time,
    customerFullName: row.customer_full_name,
    customerPhone: row.customer_phone,
    redeemedAt: row.redeemed_at,
    paymentRequestId: row.payment_request_id || null,
    paymentRequestStatus: row.payment_request_status || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function normalizeDbCertificateStatuses(statusQuery) {
  const statusMap = {
    new: 'REDEEMED',
    visited: 'REDEEMED',
    canceled: 'REDEEMED',
    waiting: 'PAYMENT_PROCESSING',
    confirmed: 'PAYMENT_PROCESSING',
    verification: 'PAYMENT_PROCESSING',
    paid: 'PAID',
    REDEEMED: 'REDEEMED',
    PAYMENT_PROCESSING: 'PAYMENT_PROCESSING',
    PAID: 'PAID'
  };

  const statuses = Array.isArray(statusQuery)
    ? statusQuery
    : String(statusQuery || '').split(',');

  return Array.from(new Set(statuses
    .map((status) => statusMap[String(status).trim()] || null)
    .filter(Boolean)));
}

function buildRedeemedFilters(filters) {
  const conditions = ["c.status <> 'NEW'"];
  const values = [];

  if (filters.status) {
    const normalizedStatuses = normalizeDbCertificateStatuses(filters.status);

    if (normalizedStatuses.length > 0) {
      values.push(normalizedStatuses);
      conditions.push(`c.status = ANY($${values.length}::certificate_status[])`);
    }
  }

  if (filters.from) {
    values.push(filters.from);
    conditions.push(`c.redeemed_at >= $${values.length}::date`);
  }

  if (filters.to) {
    values.push(filters.to);
    conditions.push(`c.redeemed_at < ($${values.length}::date + interval '1 day')`);
  }

  return { where: conditions.join(' AND '), values };
}

async function fetchDbRedeemedCertificates(filters) {
  const { where, values } = buildRedeemedFilters(filters);
  const page = parsePositiveInteger(filters.page, 1, 10000);
  const limit = parsePositiveInteger(filters.limit, 20, 100);
  const offset = (page - 1) * limit;

  const countResult = await query(
    `
      SELECT COUNT(*)::int AS total_items
      FROM certificates c
      WHERE ${where}
    `,
    values
  );

  const totalItems = Number(countResult.rows[0]?.total_items || 0);
  const totalPages = Math.max(1, Math.ceil(totalItems / limit));
  const limitValueIndex = values.length + 1;
  const offsetValueIndex = values.length + 2;

  const { rows } = await query(
    `
      SELECT
        c.*,
        pri.payment_request_id,
        pr.status AS payment_request_status
      FROM certificates c
      LEFT JOIN payment_request_items pri ON pri.certificate_id = c.id
      LEFT JOIN payment_requests pr ON pr.id = pri.payment_request_id
      WHERE ${where}
      ORDER BY c.redeemed_at DESC, c.created_at DESC
      LIMIT $${limitValueIndex}
      OFFSET $${offsetValueIndex}
    `,
    [...values, limit, offset]
  );

  return {
    items: rows.map(toCertificateDto),
    pagination: {
      currentPage: page,
      limit,
      totalItems,
      totalPages
    },
    source: 'database'
  };
}


async function fetchDbReconciliationCertificates() {
  const { rows } = await query(
    `
      SELECT
        c.*,
        pri.payment_request_id,
        pr.status AS payment_request_status
      FROM certificates c
      LEFT JOIN payment_request_items pri ON pri.certificate_id = c.id
      LEFT JOIN payment_requests pr ON pr.id = pri.payment_request_id
      WHERE c.status = 'REDEEMED'
      ORDER BY c.redeemed_at DESC, c.created_at DESC
      LIMIT 1000
    `
  );

  return {
    items: rows.map(toCertificateDto),
    pagination: {
      currentPage: 1,
      limit: 1000,
      totalItems: rows.length,
      totalPages: 1
    },
    source: 'database'
  };
}

async function fetchDbCertificateById(id) {
  const normalizedId = String(id || '').trim();
  if (!normalizedId) {
    const error = new Error('Certificate id is required');
    error.statusCode = 400;
    error.publicMessage = 'Не указан идентификатор сертификата.';
    throw error;
  }

  const { rows } = await query(
    `
      SELECT
        c.*,
        pri.payment_request_id,
        pr.status AS payment_request_status
      FROM certificates c
      LEFT JOIN payment_request_items pri ON pri.certificate_id = c.id
      LEFT JOIN payment_requests pr ON pr.id = pri.payment_request_id
      WHERE c.id::text = $1 OR c.certificate_number = $1
      LIMIT 1
    `,
    [normalizedId]
  );

  if (rows.length === 0) {
    const error = new Error('Certificate not found');
    error.statusCode = 404;
    error.publicMessage = 'Сертификат не найден.';
    throw error;
  }

  return toCertificateDto(rows[0]);
}


router.get('/reconciliations', async (request, response, next) => {
  try {
    const data = shouldUseCertificatesService()
      ? await fetchPartnerVisitedCertificatesForReconciliation({ session: request.auth })
      : await fetchDbReconciliationCertificates();

    response.json(data);
  } catch (error) {
    next(error);
  }
});


router.post('/reconciliations', async (request, response, next) => {
  try {
    if (!shouldUseCertificatesService()) {
      return response.status(409).json({
        error: 'Создание сверки через WOWlife доступно только при CERTIFICATES_USE_SERVICE=true.'
      });
    }

    const data = await createPartnerVerificationForReconciliation({ session: request.auth });
    return response.status(201).json(data);
  } catch (error) {
    next(error);
  }
});

router.get('/reconciliations/availability', async (request, response, next) => {
  try {
    if (!shouldUseCertificatesService()) {
      return response.json({
        available: true,
        daysLeft: 0,
        message: 'Создание новой сверки доступно.',
        source: 'database'
      });
    }

    const data = await fetchPartnerLastVerificationDateForReconciliation({ session: request.auth });
    return response.json(data);
  } catch (error) {
    next(error);
  }
});

router.get('/redeemed', async (request, response, next) => {
  try {
    if (shouldUseCertificatesService()) {
      const data = await fetchPartnerCertificates({
        session: request.auth,
        query: request.query
      });
      return response.json(data);
    }

    const data = await fetchDbRedeemedCertificates(request.query);
    return response.json(data);
  } catch (error) {
    next(error);
  }
});

router.get('/redeem', (_request, response) => {
  response.status(405).json({ error: 'Use POST /api/certificates/redeem' });
});

router.post('/redeem/info', async (request, response, next) => {
  try {
    const data = await fetchPartnerCertificateForRedeem({
      session: request.auth,
      body: request.body
    });

    return response.json(data);
  } catch (error) {
    next(error);
  }
});

router.post('/redeem', async (request, response, next) => {
  const {
    certificateNumber,
    secretCode,
    serviceDate,
    serviceTime,
    customerFullName,
    customerPhone
  } = request.body;

  if (!certificateNumber || !secretCode) {
    return response.status(400).json({ error: 'Номер сертификата и секретный код обязательны' });
  }

  try {
    if (shouldUseCertificatesService()) {
      const result = await redeemPartnerCertificate({
        session: request.auth,
        body: request.body
      });

      sendPushInBackground({
        title: 'Сертификат погашен',
        body: `${result.item.certificateNumber} · ${result.item.title}`,
        url: `/certificates/${result.item.id}`
      });

      return response.status(201).json(result);
    }

    const certificate = await withTransaction(async (client) => {
      const found = await client.query(
        `
          SELECT *
          FROM certificates
          WHERE certificate_number = $1 AND secret_code = $2
          FOR UPDATE
        `,
        [certificateNumber.trim(), secretCode.trim()]
      );

      if (found.rows.length === 0) {
        const error = new Error('Certificate not found');
        error.statusCode = 404;
        error.publicMessage = 'Сертификат не найден или секретный код неверный';
        throw error;
      }

      if (found.rows[0].status !== 'NEW') {
        const error = new Error('Certificate has already been redeemed');
        error.statusCode = 409;
        error.publicMessage = 'Сертификат уже был погашен';
        throw error;
      }

      const updated = await client.query(
        `
          UPDATE certificates
          SET
            status = 'REDEEMED',
            redeemed_at = now(),
            service_date = COALESCE($2::date, current_date),
            service_time = COALESCE($3::time, current_time),
            customer_full_name = COALESCE(NULLIF($4, ''), 'Не указано'),
            customer_phone = COALESCE(NULLIF($5, ''), 'Не указано')
          WHERE id = $1
          RETURNING *
        `,
        [
          found.rows[0].id,
          serviceDate || null,
          serviceTime || null,
          customerFullName || null,
          customerPhone || null
        ]
      );

      return updated.rows[0];
    });

    const item = toCertificateDto(certificate);

    sendPushInBackground({
      title: 'Сертификат погашен',
      body: `${item.certificateNumber} · ${item.title}`,
      url: `/certificates/${item.id}`
    });

    response.status(201).json({ item });
  } catch (error) {
    next(error);
  }
});


router.post('/:id/accept-work', async (request, response, next) => {
  try {
    if (!shouldUseCertificatesService()) {
      return response.status(409).json({
        error: 'Изменение статуса сертификата через WOWlife доступно только при CERTIFICATES_USE_SERVICE=true.'
      });
    }

    const result = await acceptPartnerCertificateWork({
      session: request.auth,
      certificateId: request.body?.dealId || request.params.id
    });

    return response.json(result);
  } catch (error) {
    next(error);
  }
});


router.post('/:id/schedule', async (request, response, next) => {
  try {
    if (!shouldUseCertificatesService()) {
      return response.status(409).json({
        error: 'Запись сертификата через WOWlife доступна только при CERTIFICATES_USE_SERVICE=true.'
      });
    }

    const payload = {
      ...request.body,
      id: request.params.id,
      dealId: request.body?.dealId || request.params.id
    };

    const result = await changePartnerCertificateStage({
      session: request.auth,
      body: payload
    });

    return response.json(result);
  } catch (error) {
    next(error);
  }
});

router.get('/:id', async (request, response, next) => {
  try {
    const item = shouldUseCertificatesService()
      ? await fetchPartnerCertificateById({ session: request.auth, id: request.params.id })
      : await fetchDbCertificateById(request.params.id);

    response.json({ item });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
