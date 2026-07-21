const express = require('express');
const {
  getBookingCrmData,
  saveBookingCrmData,
  createBookingOpenFrame,
  getBookingFrameSession,
  injectHtmlBase
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

router.post('/open-booking', async (request, response, next) => {
  try {
    const frame = await createBookingOpenFrame({
      session: request.auth,
      data: request.body || {}
    });
    response.json(frame);
  } catch (error) {
    next(error);
  }
});

router.get('/booking-frame/:id', async (request, response, next) => {
  try {
    const frameSession = getBookingFrameSession(request.params.id);
    const upstreamResponse = await fetch(frameSession.targetUrl, {
      method: 'GET',
      headers: frameSession.headers || {},
      redirect: 'follow'
    });

    const contentType = upstreamResponse.headers.get('content-type') || 'text/html; charset=utf-8';
    response.status(upstreamResponse.status);
    response.set('Cache-Control', 'no-store');
    response.set('Content-Type', contentType);

    if (/text\/html|application\/xhtml\+xml/i.test(contentType)) {
      const html = await upstreamResponse.text();
      response.send(injectHtmlBase(html, upstreamResponse.url || frameSession.targetUrl));
      return;
    }

    const buffer = Buffer.from(await upstreamResponse.arrayBuffer());
    response.send(buffer);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
