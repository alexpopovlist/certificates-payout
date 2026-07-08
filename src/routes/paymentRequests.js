const express = require('express');
const { query, withTransaction } = require('../db');

const router = express.Router();

function toPaymentRequestDto(row) {
  return {
    id: row.id,
    requestNumber: row.request_number,
    periodFrom: row.period_from,
    periodTo: row.period_to,
    status: row.status,
    certificateCount: Number(row.certificate_count || 0),
    totalAmountCents: Number(row.total_amount_cents || 0),
    createdAt: row.created_at,
    paidAt: row.paid_at,
    updatedAt: row.updated_at
  };
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
    redeemedAt: row.redeemed_at
  };
}

function buildCandidateFilters(filters) {
  const conditions = ["c.status = 'REDEEMED'"];
  const values = [];

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

router.get('/', async (_request, response, next) => {
  try {
    const [requests, summary] = await Promise.all([
      query(`
        SELECT *
        FROM payment_requests
        ORDER BY created_at DESC
      `),
      query(`
        SELECT COALESCE(SUM(total_amount_cents), 0) AS total_paid_amount_cents
        FROM payment_requests
        WHERE status = 'PAID'
      `)
    ]);

    response.json({
      items: requests.rows.map(toPaymentRequestDto),
      summary: {
        totalPaidAmountCents: Number(summary.rows[0].total_paid_amount_cents || 0)
      }
    });
  } catch (error) {
    next(error);
  }
});

router.get('/candidates', async (request, response, next) => {
  try {
    const { where, values } = buildCandidateFilters(request.query);
    const { rows } = await query(
      `
        SELECT c.*
        FROM certificates c
        WHERE ${where}
        ORDER BY c.redeemed_at DESC
      `,
      values
    );

    const totalAmountCents = rows.reduce((sum, row) => sum + row.amount_cents, 0);
    response.json({
      items: rows.map(toCertificateDto),
      summary: {
        certificateCount: rows.length,
        totalAmountCents
      }
    });
  } catch (error) {
    next(error);
  }
});

router.get('/:id', async (request, response, next) => {
  try {
    const requestResult = await query(
      'SELECT * FROM payment_requests WHERE id = $1',
      [request.params.id]
    );

    if (requestResult.rows.length === 0) {
      return response.status(404).json({ error: 'Payment request not found' });
    }

    const certificates = await query(
      `
        SELECT c.*
        FROM payment_request_items pri
        JOIN certificates c ON c.id = pri.certificate_id
        WHERE pri.payment_request_id = $1
        ORDER BY c.redeemed_at DESC
      `,
      [request.params.id]
    );

    response.json({
      item: toPaymentRequestDto(requestResult.rows[0]),
      certificates: certificates.rows.map(toCertificateDto)
    });
  } catch (error) {
    next(error);
  }
});

router.post('/', async (request, response, next) => {
  const { certificateIds, periodFrom, periodTo } = request.body;

  if (!Array.isArray(certificateIds) || certificateIds.length === 0) {
    return response.status(400).json({ error: 'Выберите хотя бы один сертификат' });
  }

  try {
    const paymentRequest = await withTransaction(async (client) => {
      const certificates = await client.query(
        `
          SELECT *
          FROM certificates
          WHERE id = ANY($1::uuid[])
          FOR UPDATE
        `,
        [certificateIds]
      );

      if (certificates.rows.length !== certificateIds.length) {
        const error = new Error('Some certificates not found');
        error.statusCode = 404;
        error.publicMessage = 'Часть выбранных сертификатов не найдена';
        throw error;
      }

      const unavailable = certificates.rows.filter((certificate) => certificate.status !== 'REDEEMED');
      if (unavailable.length > 0) {
        const error = new Error('Some certificates are not available for payout');
        error.statusCode = 409;
        error.publicMessage = 'В выборке есть сертификаты, которые уже находятся в заявке или оплачены';
        throw error;
      }

      const totalAmountCents = certificates.rows.reduce((sum, certificate) => sum + certificate.amount_cents, 0);
      const requestNumber = `PAY-${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}`;

      const inserted = await client.query(
        `
          INSERT INTO payment_requests (
            request_number, period_from, period_to, status,
            certificate_count, total_amount_cents
          )
          VALUES ($1, $2::date, $3::date, 'PROCESSING', $4, $5)
          RETURNING *
        `,
        [
          requestNumber,
          periodFrom || null,
          periodTo || null,
          certificates.rows.length,
          totalAmountCents
        ]
      );

      const paymentRequestId = inserted.rows[0].id;

      for (const certificate of certificates.rows) {
        await client.query(
          `
            INSERT INTO payment_request_items (payment_request_id, certificate_id, amount_cents)
            VALUES ($1, $2, $3)
          `,
          [paymentRequestId, certificate.id, certificate.amount_cents]
        );
      }

      await client.query(
        `
          UPDATE certificates
          SET status = 'PAYMENT_PROCESSING'
          WHERE id = ANY($1::uuid[])
        `,
        [certificateIds]
      );

      return inserted.rows[0];
    });

    response.status(201).json({ item: toPaymentRequestDto(paymentRequest) });
  } catch (error) {
    next(error);
  }
});

router.patch('/:id/pay', async (request, response, next) => {
  try {
    const paymentRequest = await withTransaction(async (client) => {
      const found = await client.query(
        'SELECT * FROM payment_requests WHERE id = $1 FOR UPDATE',
        [request.params.id]
      );

      if (found.rows.length === 0) {
        const error = new Error('Payment request not found');
        error.statusCode = 404;
        error.publicMessage = 'Заявка не найдена';
        throw error;
      }

      if (found.rows[0].status === 'PAID') {
        return found.rows[0];
      }

      const updated = await client.query(
        `
          UPDATE payment_requests
          SET status = 'PAID', paid_at = now()
          WHERE id = $1
          RETURNING *
        `,
        [request.params.id]
      );

      await client.query(
        `
          UPDATE certificates
          SET status = 'PAID'
          WHERE id IN (
            SELECT certificate_id
            FROM payment_request_items
            WHERE payment_request_id = $1
          )
        `,
        [request.params.id]
      );

      return updated.rows[0];
    });

    response.json({ item: toPaymentRequestDto(paymentRequest) });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
