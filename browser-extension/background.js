chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'wowlife-extension-yclients-login') return undefined;

  (async () => {
    try {
      const body = new URLSearchParams();
      body.set('email', String(message.email || ''));
      body.set('password', String(message.password || ''));
      const response = await fetch(message.loginUrl || 'https://www.yclients.com/auth/login/1', {
        method: 'POST',
        credentials: 'include',
        redirect: 'follow',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body
      });
      const cookies = await chrome.cookies.getAll({ domain: 'yclients.com' });
      sendResponse({
        ok: response.ok && cookies.length > 0,
        httpStatus: response.status,
        cookieCount: cookies.length,
        cookieNames: cookies.map((cookie) => cookie.name),
        error: cookies.length ? '' : 'После fetch расширение не нашло cookies домена yclients.com.'
      });
    } catch (error) {
      sendResponse({ ok: false, error: error?.message || String(error) });
    }
  })();
  return true;
});
