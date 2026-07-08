const express = require('express');
const {
  getRequestSession,
  setSessionCookie,
  clearSessionCookie,
  signInWithPartner,
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

router.post('/sign-in', async (request, response, next) => {
  try {
    const { login, email, phone, username, password } = request.body || {};
    const normalizedLogin = String(login || email || phone || username || '').trim();
    const normalizedPassword = String(password || '').trim();

    const result = await signInWithPartner({
      login: normalizedLogin,
      password: normalizedPassword
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
