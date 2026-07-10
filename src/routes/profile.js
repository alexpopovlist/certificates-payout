const express = require('express');
const { fetchPartnerProfile } = require('../services/profileService');
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

module.exports = router;
