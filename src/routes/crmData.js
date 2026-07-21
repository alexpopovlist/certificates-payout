const express = require('express');
const {
  getBookingCrmData,
  saveBookingCrmData,
  createBookingOpenTarget,
  takeYclientsLoginTicket,
  renderYclientsLoginBridgePage
} = require('../services/bookingCrmService');

const router = express.Router();

router.get('/', async (request, response, next) => {
  try {
    const item = await getBookingCrmData({ session: request.auth });
    response.json({ item });
  } catch (error) {
    next(error);
  }
});

router.post('/', async (request, response, next) => {
  try {
    const item = await saveBookingCrmData({
      session: request.auth,
      data: request.body || {}
    });
    response.json({ result: true, item });
  } catch (error) {
    next(error);
  }
});


router.get('/yclients-login/:ticketId', (request, response, next) => {
  try {
    const ticket = takeYclientsLoginTicket(request.params.ticketId);
    response
      .status(200)
      .set('Content-Type', 'text/html; charset=utf-8')
      .set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
      .set('Pragma', 'no-cache')
      .set('Expires', '0')
      .send(renderYclientsLoginBridgePage(ticket));
  } catch (error) {
    next(error);
  }
});

router.post('/open-booking', async (request, response, next) => {
  try {
    const result = await createBookingOpenTarget({
      session: request.auth,
      data: request.body || {}
    });
    response.json(result);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
