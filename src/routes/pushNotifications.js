const express = require('express');
const {
  getPublicKey,
  isPushConfigured,
  saveSubscription,
  deactivateSubscription,
  broadcastPush
} = require('../services/pushService');

const router = express.Router();

function requirePushAdmin(request, response, next) {
  const expectedToken = process.env.PUSH_ADMIN_TOKEN;

  if (!expectedToken) {
    return next();
  }

  const authorization = request.get('authorization') || '';
  const bearerToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length).trim()
    : '';
  const headerToken = request.get('x-push-admin-token') || '';

  if (bearerToken === expectedToken || headerToken === expectedToken) {
    return next();
  }

  return response.status(401).json({ error: 'Push admin token is required' });
}

router.get('/public-key', (_request, response) => {
  response.json({
    configured: isPushConfigured(),
    publicKey: getPublicKey()
  });
});

router.post('/subscribe', async (request, response, next) => {
  try {
    if (!isPushConfigured()) {
      return response.status(503).json({
        error: 'PUSH-уведомления не настроены: добавьте VAPID_PUBLIC_KEY и VAPID_PRIVATE_KEY'
      });
    }

    const session = request.auth || {};
    const profileIds = Array.isArray(session?.upstream?.allIds)
      ? session.upstream.allIds.map((id) => String(id)).filter(Boolean)
      : [];
    const profileId = profileIds[0] || session?.upstream?.contactId || session?.user?.id || null;

    const saved = await saveSubscription({
      subscription: request.body.subscription,
      userAgent: request.get('user-agent') || request.body.userAgent,
      platform: request.body.platform,
      installed: request.body.installed,
      permission: request.body.permission,
      profileId,
      profileIds: profileIds.length > 0 ? profileIds : [profileId].filter(Boolean),
      userId: session?.user?.id,
      userName: session?.user?.name,
      userEmail: session?.user?.email
    });

    response.status(201).json({ item: saved });
  } catch (error) {
    next(error);
  }
});

router.delete('/unsubscribe', async (request, response, next) => {
  try {
    await deactivateSubscription(request.body.endpoint);
    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

router.get('/subscriptions/summary', requirePushAdmin, async (_request, response, next) => {
  try {
    const { query } = require('../db');
    const { rows } = await query(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE is_active = TRUE)::int AS active,
        COUNT(*) FILTER (WHERE is_active = TRUE AND installed = TRUE)::int AS installed_active
      FROM push_subscriptions
    `);

    response.json({ summary: rows[0] });
  } catch (error) {
    next(error);
  }
});

router.post('/profile-broadcast', async (_request, response, next) => {
  try {
    const result = await broadcastPush(
      {
        title: 'WowLife',
        body: 'WowLife на связи!',
        url: '/profile',
        tag: 'wowlife-profile-broadcast'
      },
      { installedOnly: true }
    );

    response.json(result);
  } catch (error) {
    next(error);
  }
});

router.post('/broadcast', requirePushAdmin, async (request, response, next) => {
  try {
    const { title, body, url, installedOnly } = request.body || {};

    if (!title || !body) {
      return response.status(400).json({ error: 'title и body обязательны' });
    }

    const result = await broadcastPush(
      { title, body, url },
      { installedOnly: installedOnly !== false }
    );

    response.json(result);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
