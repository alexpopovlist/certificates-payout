const express = require('express');
const {
  getBookingCrmData,
  saveBookingCrmData,
  createBookingOpenFrame,
  getBookingFrameSession,
  buildFrameTargetUrl,
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

function buildProxyHeaders(request, frameSession) {
  const headers = {};
  const allowedRequestHeaders = [
    'accept',
    'accept-language',
    'content-type',
    'user-agent'
  ];

  allowedRequestHeaders.forEach((name) => {
    if (request.headers[name]) headers[name] = request.headers[name];
  });

  Object.entries(frameSession.headers || {}).forEach(([name, value]) => {
    if (value) headers[name] = value;
  });

  headers['Cache-Control'] = 'no-cache';
  return headers;
}

function buildProxyBody(request) {
  if (['GET', 'HEAD'].includes(request.method)) return undefined;
  if (request.body === undefined || request.body === null) return undefined;

  if (Buffer.isBuffer(request.body) || typeof request.body === 'string') {
    return request.body;
  }

  if (typeof request.body === 'object' && Object.keys(request.body).length) {
    return JSON.stringify(request.body);
  }

  return undefined;
}

function copyProxyResponseHeaders(upstreamResponse, response) {
  upstreamResponse.headers.forEach((value, key) => {
    const lowerKey = key.toLowerCase();
    if ([
      'content-encoding',
      'content-length',
      'connection',
      'transfer-encoding',
      'keep-alive',
      'x-frame-options',
      'content-security-policy',
      'content-security-policy-report-only',
      'set-cookie'
    ].includes(lowerKey)) {
      return;
    }
    response.set(key, value);
  });
}

async function proxyBookingFrameRequest(request, response, next) {
  try {
    const frameSession = getBookingFrameSession(request.params.id);
    const targetUrl = buildFrameTargetUrl(
      frameSession,
      request.params[0] || '',
      request.originalUrl.includes('?') ? request.originalUrl.split('?').slice(1).join('?') : ''
    );

    const upstreamResponse = await fetch(targetUrl, {
      method: request.method,
      headers: buildProxyHeaders(request, frameSession),
      body: buildProxyBody(request),
      redirect: 'follow'
    });

    const contentType = upstreamResponse.headers.get('content-type') || 'text/html; charset=utf-8';
    response.status(upstreamResponse.status);
    response.set('Cache-Control', 'no-store');
    response.set('Content-Type', contentType);
    copyProxyResponseHeaders(upstreamResponse, response);

    if (/text\/html|application\/xhtml\+xml/i.test(contentType)) {
      const html = await upstreamResponse.text();
      response.send(injectHtmlBase(html, upstreamResponse.url || targetUrl, frameSession));
      return;
    }

    if (/text\/css/i.test(contentType)) {
      const css = await upstreamResponse.text();
      response.send(css.replace(/url\((['"]?)\/(?!\/|api\/crm-data\/booking-frame\/)([^)'"]+)\1\)/gi, (_match, quote, path) => {
        return `url(${quote}/api/crm-data/booking-frame/${encodeURIComponent(frameSession.id)}/${path}${quote})`;
      }));
      return;
    }

    const buffer = Buffer.from(await upstreamResponse.arrayBuffer());
    response.send(buffer);
  } catch (error) {
    next(error);
  }
}

router.all('/booking-frame/:id', proxyBookingFrameRequest);
router.all('/booking-frame/:id/*', proxyBookingFrameRequest);

module.exports = router;
