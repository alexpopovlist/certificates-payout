const express = require('express');
const {
  getRequestSession,
  setSessionCookie,
  clearSessionCookie,
  signInWithPartner,
  requestAuthCode,
  signInWithCode,
  buildSession
} = require('../services/authService');

const router = express.Router();

router.get('/me', (request, response) => {
  if (process.env.AUTH_DISABLED === 'true') {
    return response.json({ user: { id: 'disabled', name: 'Auth disabled' } });
  }

  const session = getRequestSession(request);
  if (!session) {
    return response.status(401).json({ error: 'Требуется авторизация' });
  }

  response.json({ user: session.user });
});

router.post('/request-code', async (request, response, next) => {
  try {
    const { authMethod, method, phone, email, contact } = request.body || {};
    const selectedMethod = String(authMethod || method || 'sms').toLowerCase();

    if (!['sms', 'email'].includes(selectedMethod)) {
      return response.status(400).json({ error: 'Неподдерживаемый тип авторизации для получения кода' });
    }

    const result = await requestAuthCode({
      contact: String(contact || email || phone || '').trim(),
      method: selectedMethod === 'email' ? 'email' : 'phone'
    });

    response.status(201).json({ ok: true, contact: result.contact, method: selectedMethod });
  } catch (error) {
    next(error);
  }
});

router.post('/sign-in', async (request, response, next) => {
  try {
    const { authMethod, method, login, email, phone, contact, username, password, code } = request.body || {};
    const selectedMethod = String(authMethod || method || 'password').toLowerCase();

    const result = ['sms', 'email'].includes(selectedMethod)
      ? await signInWithCode({
          contact: String(contact || email || phone || '').trim(),
          code: String(code || '').trim(),
          method: selectedMethod === 'email' ? 'email' : 'phone'
        })
      : await signInWithPartner({
          login: String(login || email || phone || username || '').trim(),
          password: String(password || '').trim()
        });

    const session = buildSession(result);
    setSessionCookie(response, session);

    response.status(201).json({ user: session.user });
  } catch (error) {
    next(error);
  }
});

router.post('/sign-out', (_request, response) => {
  clearSessionCookie(response);
  response.json({ ok: true });
});

module.exports = router;
