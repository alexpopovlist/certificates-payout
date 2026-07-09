const express = require('express');
const { fetchPartnerProducts } = require('../services/partnerCertificateService');

const router = express.Router();

router.get('/', async (request, response, next) => {
  try {
    const data = await fetchPartnerProducts({ session: request.auth });
    response.json(data);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
