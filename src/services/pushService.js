const webPush = require('web-push');
const { query } = require('../db');

let configured = false;

function getPublicKey() {
  return process.env.VAPID_PUBLIC_KEY || '';
}

function getPrivateKey() {
  return process.env.VAPID_PRIVATE_KEY || '';
}

function getVapidSubject() {
  return process.env.VAPID_SUBJECT || process.env.PUSH_SUBJECT || 'mailto:admin@example.com';
}

function isPushConfigured() {
  return Boolean(getPublicKey() && getPrivateKey());
}

function configureWebPush() {
  if (configured || !isPushConfigured()) {
    return isPushConfigured();
  }

  webPush.setVapidDetails(getVapidSubject(), getPublicKey(), getPrivateKey());
  configured = true;
  return true;
}

function rowToSubscription(row) {
  return {
    endpoint: row.endpoint,
    keys: {
      p256dh: row.p256dh,
      auth: row.auth
    }
  };
}

async function saveSubscription({ subscription, userAgent, platform, installed, permission }) {
  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    const error = new Error('Invalid push subscription');
    error.statusCode = 400;
    error.publicMessage = 'Некорректная PUSH-подписка';
    throw error;
  }

  const { rows } = await query(
    `
      INSERT INTO push_subscriptions (
        endpoint,
        p256dh,
        auth,
        user_agent,
        platform,
        installed,
        permission,
        is_active,
        last_seen_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, now())
      ON CONFLICT (endpoint)
      DO UPDATE SET
        p256dh = EXCLUDED.p256dh,
        auth = EXCLUDED.auth,
        user_agent = EXCLUDED.user_agent,
        platform = EXCLUDED.platform,
        installed = EXCLUDED.installed,
        permission = EXCLUDED.permission,
        is_active = TRUE,
        last_seen_at = now()
      RETURNING id, endpoint, installed, permission, last_seen_at
    `,
    [
      subscription.endpoint,
      subscription.keys.p256dh,
      subscription.keys.auth,
      userAgent || null,
      platform || null,
      Boolean(installed),
      permission || 'granted'
    ]
  );

  return rows[0];
}

async function deactivateSubscription(endpoint) {
  if (!endpoint) return;

  await query(
    `
      UPDATE push_subscriptions
      SET is_active = FALSE
      WHERE endpoint = $1
    `,
    [endpoint]
  );
}

function normalizePayload(payload = {}) {
  return {
    title: payload.title || 'WakeSurf',
    body: payload.body || 'Новое уведомление',
    url: payload.url || '/',
    icon: payload.icon || '/assets/pwa-icon-192.png',
    badge: payload.badge || '/assets/pwa-badge-96.png',
    tag: payload.tag || 'wakesurf-certificates',
    createdAt: new Date().toISOString()
  };
}

async function broadcastPush(payload, options = {}) {
  if (!configureWebPush()) {
    const error = new Error('Push notifications are not configured');
    error.statusCode = 503;
    error.publicMessage = 'PUSH-уведомления не настроены: добавьте VAPID_PUBLIC_KEY и VAPID_PRIVATE_KEY';
    throw error;
  }

  const installedOnly = options.installedOnly !== false;
  const payloadString = JSON.stringify(normalizePayload(payload));

  const { rows } = await query(
    `
      SELECT *
      FROM push_subscriptions
      WHERE is_active = TRUE
        AND permission = 'granted'
        AND ($1::boolean = FALSE OR installed = TRUE)
      ORDER BY last_seen_at DESC
    `,
    [installedOnly]
  );

  const results = await Promise.allSettled(
    rows.map(async (row) => {
      try {
        await webPush.sendNotification(rowToSubscription(row), payloadString);
        return { endpoint: row.endpoint, ok: true };
      } catch (error) {
        if (error.statusCode === 404 || error.statusCode === 410) {
          await deactivateSubscription(row.endpoint);
        }

        return {
          endpoint: row.endpoint,
          ok: false,
          statusCode: error.statusCode || null,
          message: error.message
        };
      }
    })
  );

  const sent = results.filter((result) => result.status === 'fulfilled' && result.value.ok).length;
  const failed = results.length - sent;

  return {
    total: rows.length,
    sent,
    failed,
    installedOnly,
    details: results.map((result) =>
      result.status === 'fulfilled'
        ? result.value
        : { ok: false, message: result.reason?.message || 'Unknown push error' }
    )
  };
}

module.exports = {
  getPublicKey,
  isPushConfigured,
  saveSubscription,
  deactivateSubscription,
  broadcastPush
};
