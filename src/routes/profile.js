const express = require('express');
const { fetchPartnerProfile } = require('../services/profileService');

const router = express.Router();

router.get('/', async (request, response, next) => {
  try {
    const result = await fetchPartnerProfile({ session: request.auth });
    response.json(result);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
