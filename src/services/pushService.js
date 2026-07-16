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

function normalizeTextArray(value) {
  if (Array.isArray(value)) {
    return Array.from(new Set(value.map((item) => String(item || '').trim()).filter(Boolean)));
  }

  if (value === undefined || value === null || value === '') return [];

  return Array.from(new Set(String(value)
    .split(/[,;\s]+/)
    .map((item) => item.trim())
    .filter(Boolean)));
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

function rowToPushDevice(row) {
  return {
    id: row.id,
    endpoint: row.endpoint,
    profileId: row.profile_id || null,
    profileIds: Array.isArray(row.profile_ids) ? row.profile_ids : [],
    userId: row.user_id || null,
    userName: row.user_name || null,
    userEmail: row.user_email || null,
    platform: row.platform || null,
    installed: Boolean(row.installed),
    permission: row.permission || null,
    isActive: Boolean(row.is_active),
    lastSeenAt: row.last_seen_at,
    subscribedAt: row.subscribed_at,
    createdAt: row.created_at
  };
}


function normalizeCampaignStatus(value) {
  const status = String(value || '').trim().toLowerCase();
  if (['success', 'sent', 'ok', 'успешно'].includes(status)) return 'success';
  if (['error', 'failed', 'ошибка'].includes(status)) return 'error';
  return '';
}

function rowToPushCampaign(row) {
  const details = Array.isArray(row.result_details) ? row.result_details : [];
  const derivedStatus = row.delivery_status || (Number(row.failed_count || 0) > 0 ? 'error' : 'success');

  return {
    id: row.id,
    title: row.title,
    body: row.body,
    url: row.url || null,
    profileIds: Array.isArray(row.profile_ids) ? row.profile_ids : [],
    installedOnly: Boolean(row.installed_only),
    total: Number(row.total_count || 0),
    sent: Number(row.sent_count || 0),
    failed: Number(row.failed_count || 0),
    status: normalizeCampaignStatus(derivedStatus) || 'success',
    details,
    createdAt: row.created_at
  };
}

function rowToPushLog(row) {
  return {
    id: row.id,
    endpoint: row.endpoint,
    eventType: row.event_type,
    profileId: row.profile_id || null,
    profileIds: Array.isArray(row.profile_ids) ? row.profile_ids : [],
    userId: row.user_id || null,
    userName: row.user_name || null,
    userEmail: row.user_email || null,
    platform: row.platform || null,
    installed: Boolean(row.installed),
    permission: row.permission || null,
    createdAt: row.created_at
  };
}

async function saveSubscription({
  subscription,
  userAgent,
  platform,
  installed,
  permission,
  profileId,
  profileIds,
  userId,
  userName,
  userEmail
}) {
  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    const error = new Error('Invalid push subscription');
    error.statusCode = 400;
    error.publicMessage = 'Некорректная PUSH-подписка';
    throw error;
  }

  const normalizedProfileIds = normalizeTextArray(profileIds);
  const normalizedProfileId = String(profileId || normalizedProfileIds[0] || '').trim() || null;

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
        profile_id,
        profile_ids,
        user_id,
        user_name,
        user_email,
        is_active,
        subscribed_at,
        last_seen_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::text[], $10, $11, $12, TRUE, now(), now())
      ON CONFLICT (endpoint)
      DO UPDATE SET
        p256dh = EXCLUDED.p256dh,
        auth = EXCLUDED.auth,
        user_agent = EXCLUDED.user_agent,
        platform = EXCLUDED.platform,
        installed = EXCLUDED.installed,
        permission = EXCLUDED.permission,
        profile_id = EXCLUDED.profile_id,
        profile_ids = EXCLUDED.profile_ids,
        user_id = EXCLUDED.user_id,
        user_name = EXCLUDED.user_name,
        user_email = EXCLUDED.user_email,
        is_active = TRUE,
        subscribed_at = COALESCE(push_subscriptions.subscribed_at, now()),
        last_seen_at = now()
      RETURNING id, endpoint, installed, permission, profile_id, profile_ids, user_id, user_name, user_email, last_seen_at, subscribed_at, is_active, platform, created_at
    `,
    [
      subscription.endpoint,
      subscription.keys.p256dh,
      subscription.keys.auth,
      userAgent || null,
      platform || null,
      Boolean(installed),
      permission || 'granted',
      normalizedProfileId,
      normalizedProfileIds,
      userId ? String(userId) : null,
      userName || null,
      userEmail || null
    ]
  );

  const saved = rows[0];

  await query(
    `
      INSERT INTO push_subscription_logs (
        push_subscription_id,
        endpoint,
        event_type,
        profile_id,
        profile_ids,
        user_id,
        user_name,
        user_email,
        user_agent,
        platform,
        installed,
        permission
      )
      VALUES ($1, $2, 'subscribe', $3, $4::text[], $5, $6, $7, $8, $9, $10, $11)
    `,
    [
      saved.id,
      subscription.endpoint,
      normalizedProfileId,
      normalizedProfileIds,
      userId ? String(userId) : null,
      userName || null,
      userEmail || null,
      userAgent || null,
      platform || null,
      Boolean(installed),
      permission || 'granted'
    ]
  );

  return rowToPushDevice(saved);
}

async function deactivateSubscription(endpoint) {
  if (!endpoint) return;

  const { rows } = await query(
    `
      UPDATE push_subscriptions
      SET is_active = FALSE
      WHERE endpoint = $1
      RETURNING id, endpoint, profile_id, profile_ids, user_id, user_name, user_email, user_agent, platform, installed, permission
    `,
    [endpoint]
  );

  const row = rows[0];
  if (!row) return;

  await query(
    `
      INSERT INTO push_subscription_logs (
        push_subscription_id,
        endpoint,
        event_type,
        profile_id,
        profile_ids,
        user_id,
        user_name,
        user_email,
        user_agent,
        platform,
        installed,
        permission
      )
      VALUES ($1, $2, 'unsubscribe', $3, $4::text[], $5, $6, $7, $8, $9, $10, $11)
    `,
    [
      row.id,
      row.endpoint,
      row.profile_id || null,
      normalizeTextArray(row.profile_ids),
      row.user_id || null,
      row.user_name || null,
      row.user_email || null,
      row.user_agent || null,
      row.platform || null,
      Boolean(row.installed),
      row.permission || null
    ]
  );
}

function normalizePayload(payload = {}) {
  return {
    title: payload.title || 'WowLife',
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
  const profileIds = normalizeTextArray(options.profileIds);
  const payloadString = JSON.stringify(normalizePayload(payload));

  const { rows } = await query(
    `
      SELECT *
      FROM push_subscriptions
      WHERE is_active = TRUE
        AND permission = 'granted'
        AND ($1::boolean = FALSE OR installed = TRUE)
        AND (
          $2::text[] IS NULL
          OR profile_id = ANY($2::text[])
          OR profile_ids && $2::text[]
        )
      ORDER BY last_seen_at DESC
    `,
    [installedOnly, profileIds.length > 0 ? profileIds : null]
  );

  const results = await Promise.allSettled(
    rows.map(async (row) => {
      try {
        await webPush.sendNotification(rowToSubscription(row), payloadString);
        return { endpoint: row.endpoint, profileId: row.profile_id || null, ok: true };
      } catch (error) {
        if (error.statusCode === 404 || error.statusCode === 410) {
          await deactivateSubscription(row.endpoint);
        }

        return {
          endpoint: row.endpoint,
          profileId: row.profile_id || null,
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
    profileIds,
    details: results.map((result) =>
      result.status === 'fulfilled'
        ? result.value
        : { ok: false, message: result.reason?.message || 'Unknown push error' }
    )
  };
}

async function getPushSummary() {
  const { rows } = await query(`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE is_active = TRUE)::int AS active,
      COUNT(*) FILTER (WHERE is_active = TRUE AND installed = TRUE)::int AS installed_active,
      COUNT(DISTINCT NULLIF(profile_id, '')) FILTER (WHERE is_active = TRUE)::int AS active_profiles
    FROM push_subscriptions
  `);

  const campaigns = await query(`
    SELECT COUNT(*)::int AS total_campaigns
    FROM push_notification_campaigns
  `);

  return {
    ...rows[0],
    total_campaigns: campaigns.rows[0]?.total_campaigns || 0
  };
}

async function listPushSubscriptions({ profileIds = [], limit = 100 } = {}) {
  const normalizedProfileIds = normalizeTextArray(profileIds);
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const { rows } = await query(
    `
      SELECT id, endpoint, profile_id, profile_ids, user_id, user_name, user_email, platform, installed, permission, is_active, last_seen_at, subscribed_at, created_at
      FROM push_subscriptions
      WHERE ($1::text[] IS NULL OR profile_id = ANY($1::text[]) OR profile_ids && $1::text[])
      ORDER BY last_seen_at DESC
      LIMIT $2
    `,
    [normalizedProfileIds.length > 0 ? normalizedProfileIds : null, safeLimit]
  );

  return rows.map(rowToPushDevice);
}

async function listPushSubscriptionLogs({ profileIds = [], limit = 100 } = {}) {
  const normalizedProfileIds = normalizeTextArray(profileIds);
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const { rows } = await query(
    `
      SELECT id, endpoint, event_type, profile_id, profile_ids, user_id, user_name, user_email, platform, installed, permission, created_at
      FROM push_subscription_logs
      WHERE ($1::text[] IS NULL OR profile_id = ANY($1::text[]) OR profile_ids && $1::text[])
      ORDER BY created_at DESC
      LIMIT $2
    `,
    [normalizedProfileIds.length > 0 ? normalizedProfileIds : null, safeLimit]
  );

  return rows.map(rowToPushLog);
}

async function savePushCampaign({ adminUserId, title, body, url, profileIds = [], installedOnly = true, result = {} }) {
  const normalizedProfileIds = normalizeTextArray(profileIds);
  const deliveryStatus = Number(result.failed || 0) > 0 ? 'error' : 'success';
  const resultDetails = Array.isArray(result.details) ? result.details : [];
  const { rows } = await query(
    `
      INSERT INTO push_notification_campaigns (
        admin_user_id,
        title,
        body,
        url,
        profile_ids,
        installed_only,
        total_count,
        sent_count,
        failed_count,
        delivery_status,
        result_details
      )
      VALUES ($1, $2, $3, $4, $5::text[], $6, $7, $8, $9, $10, $11::jsonb)
      RETURNING id, title, body, url, profile_ids, installed_only, total_count, sent_count, failed_count, delivery_status, result_details, created_at
    `,
    [
      adminUserId || null,
      title,
      body,
      url || null,
      normalizedProfileIds,
      Boolean(installedOnly),
      Number(result.total || 0),
      Number(result.sent || 0),
      Number(result.failed || 0),
      deliveryStatus,
      JSON.stringify(resultDetails)
    ]
  );

  return rowToPushCampaign(rows[0]);
}


async function listPushCampaigns({ dateFrom = '', dateTo = '', status = '', search = '', profileId = '', limit = 100 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const normalizedStatus = normalizeCampaignStatus(status);
  const normalizedSearch = String(search || '').trim() || null;
  const normalizedProfileId = String(profileId || '').trim() || null;
  const normalizedDateFrom = String(dateFrom || '').trim() || null;
  const normalizedDateTo = String(dateTo || '').trim() || null;

  const { rows } = await query(
    `
      SELECT id, title, body, url, profile_ids, installed_only, total_count, sent_count, failed_count, delivery_status, result_details, created_at
      FROM push_notification_campaigns
      WHERE ($1::date IS NULL OR created_at >= $1::date)
        AND ($2::date IS NULL OR created_at < ($2::date + INTERVAL '1 day'))
        AND (
          $3::text IS NULL
          OR delivery_status = $3::text
          OR ($3::text = 'success' AND failed_count = 0)
          OR ($3::text = 'error' AND failed_count > 0)
        )
        AND (
          $4::text IS NULL
          OR title ILIKE '%' || $4::text || '%'
          OR body ILIKE '%' || $4::text || '%'
        )
        AND (
          $5::text IS NULL
          OR $5::text = ANY(profile_ids)
          OR array_length(profile_ids, 1) IS NULL
        )
      ORDER BY created_at DESC
      LIMIT $6
    `,
    [
      normalizedDateFrom,
      normalizedDateTo,
      normalizedStatus || null,
      normalizedSearch,
      normalizedProfileId,
      safeLimit
    ]
  );

  return rows.map(rowToPushCampaign);
}

module.exports = {
  getPublicKey,
  isPushConfigured,
  saveSubscription,
  deactivateSubscription,
  broadcastPush,
  getPushSummary,
  listPushSubscriptions,
  listPushSubscriptionLogs,
  listPushCampaigns,
  savePushCampaign
};
