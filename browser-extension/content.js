window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const data = event.data;
  if (data?.type !== 'wowlife-extension-yclients-login-request') return;

  chrome.runtime.sendMessage({
    type: 'wowlife-extension-yclients-login',
    loginUrl: data.loginUrl,
    email: data.email,
    password: data.password
  }, (response) => {
    const runtimeError = chrome.runtime.lastError;
    window.postMessage({
      type: 'wowlife-extension-yclients-login-response',
      requestId: data.requestId,
      ...(response || { ok: false, error: runtimeError?.message || 'Расширение не вернуло ответ.' })
    }, window.location.origin);
  });
});
