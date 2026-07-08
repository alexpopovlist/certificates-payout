const { getRequestSession } = require('../services/authService');

function requireAuth(request, response, next) {
  if (process.env.AUTH_DISABLED === 'true') {
    request.auth = { user: { id: 'disabled', name: 'Auth disabled' }, upstream: null };
    return next();
  }

  const session = getRequestSession(request);
  if (!session) {
    return response.status(401).json({ error: 'Требуется авторизация' });
  }

  request.auth = session;
  return next();
}

module.exports = { requireAuth };
