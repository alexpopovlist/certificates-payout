const express = require('express');
const { fetchPartnerProfile } = require('../services/profileService');
const { setSessionCookie } = require('../services/authService');

const router = express.Router();

router.get('/', async (request, response, next) => {
  try {
    const result = await fetchPartnerProfile({ session: request.auth });
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
