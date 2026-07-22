const express = require('express');
const { setSessionCookie } = require('../services/authService');
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
      .send(renderYclientsLoginBridgePage(ticket, {
        forceTopLevel: request.query.mode === 'top-level',
        helperWindowName: request.query.helperWindow || ''
      }));
  } catch (error) {
    next(error);
  }
});


function buildYclientsProxyCookieHeader(session = {}) {
  const cookies = Array.isArray(session?.yclients?.cookies) ? session.yclients.cookies : [];
  return cookies
    .filter((cookie) => cookie && cookie.name && cookie.value !== undefined)
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');
}

function mapYclientsLocationToProxy(location = '') {
  try {
    const parsed = new URL(String(location || ''), 'https://www.yclients.com/');
    if (!parsed.hostname.toLowerCase().endsWith('yclients.com')) return parsed.toString();
    return `/api/crm-data/yclients-proxy${parsed.pathname}${parsed.search}`;
  } catch (_error) {
    return '/api/crm-data/yclients-proxy/';
  }
}

function rewriteYclientsProxyText(text = '') {
  const prefix = '/api/crm-data/yclients-proxy/';
  return String(text)
    .replaceAll('https://www.yclients.com/', prefix)
    .replaceAll('https://yclients.com/', prefix)
    .replaceAll('//www.yclients.com/', prefix)
    .replaceAll('//yclients.com/', prefix)
    .replace(/((?:href|src|action)=['"])\/(?!\/|api\/crm-data\/yclients-proxy\/)/gi, `$1${prefix}`)
    .replace(/url\((['"]?)\/(?!\/|api\/crm-data\/yclients-proxy\/)/gi, `url($1${prefix}`);
}

router.all('/yclients-proxy/*', async (request, response, next) => {
  try {
    const suffix = String(request.params[0] || '');
    const queryIndex = request.originalUrl.indexOf('?');
    const query = queryIndex >= 0 ? request.originalUrl.slice(queryIndex) : '';
    const upstreamUrl = new URL(`${suffix}${query}`, 'https://www.yclients.com/');
    if (!upstreamUrl.hostname.toLowerCase().endsWith('yclients.com')) {
      return response.status(400).send('Unsupported proxy host');
    }

    const headers = {
      'Accept': request.get('accept') || '*/*',
      'Accept-Language': request.get('accept-language') || 'ru-RU,ru;q=0.9,en;q=0.8',
      'User-Agent': request.get('user-agent') || 'WOWlife YCLIENTS Proxy Test/1.0',
      'Referer': 'https://www.yclients.com/'
    };
    const cookieHeader = buildYclientsProxyCookieHeader(request.auth);
    if (cookieHeader) headers.Cookie = cookieHeader;
    const contentType = request.get('content-type');
    if (contentType) headers['Content-Type'] = contentType;
    if (!['GET', 'HEAD'].includes(request.method)) headers.Origin = 'https://www.yclients.com';

    const upstream = await fetch(upstreamUrl, {
      method: request.method,
      headers,
      redirect: 'manual',
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body
    });

    if (upstream.status >= 300 && upstream.status < 400) {
      const location = upstream.headers.get('location');
      if (location) return response.redirect(upstream.status, mapYclientsLocationToProxy(location));
    }

    const responseType = upstream.headers.get('content-type') || 'application/octet-stream';
    response.status(upstream.status);
    response.set('Content-Type', responseType);
    response.set('Cache-Control', 'no-store');
    response.removeHeader('X-Frame-Options');
    response.removeHeader('Content-Security-Policy');

    const body = Buffer.from(await upstream.arrayBuffer());
    if (/text\/|javascript|json|xml|svg/i.test(responseType)) {
      response.send(rewriteYclientsProxyText(body.toString('utf8')));
    } else {
      response.send(body);
    }
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

    if (result?.sessionUpdated) {
      setSessionCookie(response, request.auth);
      delete result.sessionUpdated;
    }

    response.json(result);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
