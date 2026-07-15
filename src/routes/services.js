const express = require('express');
const { fetchPartnerProducts, changePartnerProduct } = require('../services/partnerCertificateService');

const router = express.Router();

router.get('/', async (request, response, next) => {
  try {
    const data = await fetchPartnerProducts({ session: request.auth });
    response.json(data);
  } catch (error) {
    next(error);
  }
});

router.post('/:id/description', async (request, response, next) => {
  try {
    const result = await changePartnerProduct({
      session: request.auth,
      body: {
        ...request.body,
        productId: request.params.id
      }
    });
    response.json(result);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
