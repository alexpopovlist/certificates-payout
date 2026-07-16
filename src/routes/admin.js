const express = require('express');
const {
  getAdminRequestSession,
  setAdminSessionCookie,
  clearAdminSessionCookie,
  buildAdminSession,
  signInAdmin,
  registerAdmin,
  requireAdminAuth
} = require('../services/adminAuthService');
const {
  broadcastPush,
  listPushSubscriptions,
  listPushSubscriptionLogs,
  getPushSummary,
  listPushCampaigns,
  savePushCampaign
} = require('../services/pushService');

const router = express.Router();

function normalizeProfileIds(value) {
  if (Array.isArray(value)) {
    return Array.from(new Set(value.map((item) => String(item || '').trim()).filter(Boolean)));
  }

  return Array.from(new Set(String(value || '')
    .split(/[,;\s]+/)
    .map((item) => item.trim())
    .filter(Boolean)));
}

router.get('/me', (request, response) => {
  const session = getAdminRequestSession(request);
  if (!session?.user?.id) {
    return response.status(401).json({ error: 'Требуется вход администратора' });
  }

  response.json({ user: session.user });
});

router.post('/sign-in', async (request, response, next) => {
  try {
    const user = await signInAdmin({
      login: request.body?.login,
      password: request.body?.password
    });
    const session = buildAdminSession(user);
    setAdminSessionCookie(response, session);
    response.status(201).json({ user });
  } catch (error) {
    next(error);
  }
});

router.post('/register', async (request, response, next) => {
  try {
    const user = await registerAdmin({
      login: request.body?.login,
      password: request.body?.password,
      inviteCode: request.body?.inviteCode || request.body?.code
    });
    const session = buildAdminSession(user);
    setAdminSessionCookie(response, session);
    response.status(201).json({ user });
  } catch (error) {
    next(error);
  }
});

router.post('/sign-out', (_request, response) => {
  clearAdminSessionCookie(response);
  response.json({ ok: true });
});

router.get('/push/summary', requireAdminAuth, async (_request, response, next) => {
  try {
    const [summary, subscriptions, logs] = await Promise.all([
      getPushSummary(),
      listPushSubscriptions({ limit: 30 }),
      listPushSubscriptionLogs({ limit: 30 })
    ]);

    response.json({ summary, subscriptions, logs });
  } catch (error) {
    next(error);
  }
});

router.get('/push/subscriptions', requireAdminAuth, async (request, response, next) => {
  try {
    const profileIds = normalizeProfileIds(request.query.profileIds || request.query.profileId);
    const subscriptions = await listPushSubscriptions({ profileIds, limit: Number(request.query.limit || 100) });
    response.json({ items: subscriptions });
  } catch (error) {
    next(error);
  }
});

router.get('/push/logs', requireAdminAuth, async (request, response, next) => {
  try {
    const profileIds = normalizeProfileIds(request.query.profileIds || request.query.profileId);
    const logs = await listPushSubscriptionLogs({ profileIds, limit: Number(request.query.limit || 100) });
    response.json({ items: logs });
  } catch (error) {
    next(error);
  }
});

router.get('/push/campaigns', requireAdminAuth, async (request, response, next) => {
  try {
    const campaigns = await listPushCampaigns({
      dateFrom: request.query.dateFrom,
      dateTo: request.query.dateTo,
      status: request.query.status,
      search: request.query.search,
      profileId: request.query.profileId,
      limit: Number(request.query.limit || 100)
    });

    response.json({ items: campaigns });
  } catch (error) {
    next(error);
  }
});

router.post('/push/broadcast', requireAdminAuth, async (request, response, next) => {
  try {
    const { title, body, url, installedOnly } = request.body || {};
    const profileIds = normalizeProfileIds(request.body?.profileIds || request.body?.profileIdsText);

    if (!title || !body) {
      return response.status(400).json({ error: 'title и body обязательны' });
    }

    const result = await broadcastPush(
      { title, body, url: url || '/profile', tag: 'wowlife-admin-broadcast' },
      {
        installedOnly: installedOnly !== false,
        profileIds
      }
    );

    const campaign = await savePushCampaign({
      adminUserId: request.admin.user.id,
      title,
      body,
      url: url || '/profile',
      profileIds,
      installedOnly: installedOnly !== false,
      result
    });

    response.json({ ...result, campaign });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
