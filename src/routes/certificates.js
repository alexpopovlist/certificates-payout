const express = require('express');
const { withTransaction } = require('../db');
const { broadcastPush } = require('../services/pushService');
const { fetchPartnerCertificates, fetchPartnerCertificateById } = require('../services/partnerCertificateService');

const router = express.Router();


function sendPushInBackground(payload) {
  broadcastPush(payload).catch((error) => {
    if (process.env.NODE_ENV !== 'test') {
      console.warn('Push notification skipped:', error.publicMessage || error.message);
    }
  });
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

function buildRedeemedFilters(filters) {
  const conditions = ["c.status <> 'NEW'"];
  const values = [];

  if (filters.status) {
    const statuses = Array.isArray(filters.status)
      ? filters.status
      : String(filters.status).split(',');
    const normalizedStatuses = statuses
      .map((status) => String(status).trim())
      .filter((status) => ['REDEEMED', 'PAYMENT_PROCESSING', 'PAID'].includes(status));

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

router.get('/redeemed', async (request, response, next) => {
  try {
    const data = await fetchPartnerCertificates({
      session: request.auth,
      query: request.query
    });

    response.json(data);
  } catch (error) {
    next(error);
  }
});

router.get('/redeem', (_request, response) => {
  response.status(405).json({ error: 'Use POST /api/certificates/redeem' });
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

router.get('/:id', async (request, response, next) => {
  try {
    const item = await fetchPartnerCertificateById({
      session: request.auth,
      id: request.params.id
    });

    response.json({ item });
  } catch (error) {
    next(error);
  }
});




module.exports = router;
