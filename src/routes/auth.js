const express = require('express');
const {
  getRequestSession,
  setSessionCookie,
  clearSessionCookie,
  signInWithPartner,
  requestSmsCode,
  signInWithSmsCode,
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
    const { authMethod, method, phone, contact } = request.body || {};
    const selectedMethod = String(authMethod || method || 'sms').toLowerCase();

    if (selectedMethod !== 'sms') {
      return response.status(501).json({ error: 'Получение кода для этого типа авторизации пока не подключено' });
    }

    const result = await requestSmsCode({
      contact: String(contact || phone || '').trim()
    });

    response.status(201).json({ ok: true, contact: result.contact });
  } catch (error) {
    next(error);
  }
});

router.post('/sign-in', async (request, response, next) => {
  try {
    const { authMethod, method, login, email, phone, contact, username, password, code } = request.body || {};
    const selectedMethod = String(authMethod || method || 'password').toLowerCase();

    const result = selectedMethod === 'sms'
      ? await signInWithSmsCode({
          contact: String(contact || phone || '').trim(),
          code: String(code || '').trim()
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
