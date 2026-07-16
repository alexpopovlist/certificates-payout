const express = require('express');
const { fetchPartnerProfile, setPartnerPassword, createProfileModerationRequest } = require('../services/profileService');
const { setSessionCookie } = require('../services/authService');

const router = express.Router();

router.get('/', async (request, response, next) => {
  try {
    response.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    response.set('Pragma', 'no-cache');
    response.set('Expires', '0');

    const result = await fetchPartnerProfile({
      session: request.auth,
      skipCache: request.query.refresh === '1' || request.query.fresh === '1'
    });
    const { session, ...payload } = result;
    if (session) {
      request.auth = session;
      setSessionCookie(response, session);
    }
    response.json(payload);
  } catch (error) {
    next(error);
  }
});



router.post('/moderation', async (request, response, next) => {
  try {
    const body = request.body || {};
    const result = await createProfileModerationRequest({
      session: request.auth,
      name: body.name,
      info: body.info,
      file: body.file
    });

    response.json({ result: true, item: result.item || null });
  } catch (error) {
    next(error);
  }
});

router.post('/password', async (request, response, next) => {
  try {
    const password = String(request.body?.password || '').trim();
    if (!password) {
      return response.status(400).json({ error: 'Введите пароль.' });
    }

    const profileResult = await fetchPartnerProfile({
      session: request.auth,
      skipCache: false
    });

    const activeSession = profileResult.session || request.auth;
    if (profileResult.session) {
      request.auth = profileResult.session;
      setSessionCookie(response, profileResult.session);
    }

    await setPartnerPassword({
      session: activeSession,
      profile: profileResult.item,
      password
    });

    response.json({ result: true });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
