const app = document.querySelector('#app');
const pageTitle = document.querySelector('#pageTitle');
const backButton = document.querySelector('#backButton');
const pushPrompt = document.querySelector('#pushPrompt');
const logoutButton = document.querySelector('.logout-button');

let currentUser = null;

const authUiState = {
  method: 'password',
  codeRequested: false,
  login: '',
  password: '',
  phone: '',
  email: '',
  code: ''
};

const SIGN_IN_PATH = '/authentication/sign-in';
const DEFAULT_APP_PATH = '/redeem';
const APP_ROUTES = new Set(['redeem', 'certificates', 'payments']);

function getCurrentAppUrl() {
  return `${window.location.pathname}${window.location.search}`;
}

function safeNextPath(value) {
  const next = String(value || '').trim();
  if (!next || !next.startsWith('/') || next.startsWith('//')) return DEFAULT_APP_PATH;
  if (next.startsWith(SIGN_IN_PATH)) return DEFAULT_APP_PATH;
  return next;
}

function navigate(path, options = {}) {
  const nextPath = safeNextPath(path);
  if (options.replace) {
    window.history.replaceState({}, '', nextPath);
  } else {
    window.history.pushState({}, '', nextPath);
  }
  route();
}

function normalizeLegacyHashRoute() {
  if (!window.location.hash || window.location.pathname !== '/') return false;
  const legacy = window.location.hash.replace(/^#/, '').replace(/^\/+/, '');
  if (!legacy) return false;
  const next = `/${legacy}`;
  window.history.replaceState({}, '', next);
  return true;
}

function ensureSignInPath() {
  if (window.location.pathname === SIGN_IN_PATH) return;

  const current = getCurrentAppUrl();
  const next = current && current !== '/' ? current : DEFAULT_APP_PATH;
  window.history.replaceState({}, '', `${SIGN_IN_PATH}?next=${encodeURIComponent(next)}`);
}

function leaveSignInPathAfterAuth() {
  if (window.location.pathname !== SIGN_IN_PATH) return;

  const params = new URLSearchParams(window.location.search);
  const next = safeNextPath(params.get('next'));
  window.history.replaceState({}, '', next);
}

const createRequestState = {
  items: [],
  selectedIds: new Set(),
  periodFrom: '',
  periodTo: ''
};

const certificatesListState = {
  page: 1,
  limit: 20
};

const certificateStatus = {
  NEW: { label: 'Новый', className: '' },
  REDEEMED: { label: 'Погашен', className: 'redeemed' },
  PAYMENT_PROCESSING: { label: 'В процессе оплаты', className: 'processing' },
  PAID: { label: 'Оплачен', className: 'paid' }
};

const paymentStatus = {
  PROCESSING: { label: 'Заявка в обработке', className: 'processing' },
  PAID: { label: 'Оплачено', className: 'paid' }
};

const certificateDetailHeroImage = '/assets/certificate-view-hero.svg';

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatMoney(amountCents) {
  const amount = Math.round(Number(amountCents || 0) / 100);
  return new Intl.NumberFormat('ru-RU').format(amount) + ' ₽';
}

function formatPlainMoney(amountCents) {
  const amount = Math.round(Number(amountCents || 0) / 100);
  return new Intl.NumberFormat('ru-RU').format(amount);
}

function formatDate(value) {
  if (!value) return '—';
  const [year, month, day] = String(value).slice(0, 10).split('-');
  if (!year || !month || !day) return '—';
  return `${day}.${month}.${year}`;
}

function formatDateInputValue(date) {
  const normalizedDate = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(normalizedDate.getTime())) return '';
  const year = normalizedDate.getFullYear();
  const month = String(normalizedDate.getMonth() + 1).padStart(2, '0');
  const day = String(normalizedDate.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getCertificatesDefaultDateRange() {
  const toDate = new Date();
  const fromDate = new Date(toDate);
  fromDate.setDate(fromDate.getDate() - 30);
  return {
    from: formatDateInputValue(fromDate),
    to: formatDateInputValue(toDate)
  };
}

function formatTime(value) {
  if (!value) return '—';
  return String(value).slice(0, 5);
}

function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return formatDate(value);
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

function setHeader(title, options = {}) {
  pageTitle.textContent = title;
  const showBack = Boolean(options.backTo);
  backButton.classList.toggle('hidden', !showBack);
  backButton.onclick = showBack
    ? () => {
        navigate(options.backTo);
      }
    : null;
}

function setActiveNavigation(routeName) {
  document.querySelectorAll('[data-route]').forEach((link) => {
    link.classList.toggle('active', link.dataset.route === routeName);
  });
}

function showLoading() {
  const template = document.querySelector('#loadingTemplate');
  app.replaceChildren(template.content.cloneNode(true));
}

function showError(error) {
  app.innerHTML = `<div class="error-state">${escapeHtml(error.message || 'Ошибка загрузки данных')}</div>`;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    ...options
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('/api/auth')) {
      currentUser = null;
      renderSignIn('Сессия истекла. Войдите снова.');
    }

    throw new Error(payload.error || 'Ошибка запроса');
  }

  return payload;
}

function setAuthMode(isAuthenticated) {
  document.body.classList.toggle('is-login', !isAuthenticated);
  document.body.classList.toggle('is-authenticated', isAuthenticated);
}

function getAuthMethodLabel(method) {
  const labels = {
    sms: 'SMS',
    email: 'Email',
    password: 'Пароль'
  };
  return labels[method] || labels.password;
}

function authMethodIconSvg(method) {
  const icons = {
    sms: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 16.92v2.2a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 3.4 2 2 0 0 1 4.11 1.22h2.21a2 2 0 0 1 2 1.72c.12.91.32 1.8.6 2.65a2 2 0 0 1-.45 2.11L7.54 8.63a16 16 0 0 0 7.83 7.83l.93-.93a2 2 0 0 1 2.11-.45c.85.28 1.74.48 2.65.6A2 2 0 0 1 22 16.92Z"/></svg>',
    email: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z"/><path d="m22 7-10 6L2 7"/></svg>',
    password: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>'
  };
  return icons[method] || icons.password;
}

function passwordVisibilityIconSvg(isVisible) {
  return isVisible
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.94 17.94A10.85 10.85 0 0 1 12 20C7 20 2.73 16.89 1 12c.8-2.27 2.2-4.2 4-5.62"/><path d="M9.9 4.24A10.7 10.7 0 0 1 12 4c5 0 9.27 3.11 11 8a11.5 11.5 0 0 1-2.14 3.4"/><path d="M14.12 14.12A3 3 0 0 1 9.88 9.88"/><path d="M1 1l22 22"/></svg>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
}

function formatAuthPhoneMask(rawValue) {
  const digitsAll = String(rawValue || '').replace(/[^\d]/g, '');
  if (!digitsAll) return '';

  let digits = digitsAll;
  if (digits.startsWith('8')) digits = `7${digits.slice(1)}`;

  if (digits.startsWith('7')) {
    digits = digits.slice(0, 11);
    if (digits.length <= 1) return '+7';

    const a = digits.slice(1, 4);
    const b = digits.slice(4, 7);
    const c = digits.slice(7, 9);
    const d = digits.slice(9, 11);

    let output = '+7';
    if (a) output += ` (${a}`;
    if (a.length === 3) output += ')';
    if (b) output += ` ${b}`;
    if (c) output += `-${c}`;
    if (d) output += `-${d}`;
    return output;
  }

  return `+${digitsAll.slice(0, 15)}`;
}

function normalizeAuthPhoneContact(rawValue) {
  const digitsAll = String(rawValue || '').replace(/[^\d]/g, '');
  if (!digitsAll) return '';

  let digits = digitsAll;
  if (digits.startsWith('8')) digits = `7${digits.slice(1)}`;
  if (!digits.startsWith('7') && digits.length === 10) digits = `7${digits}`;

  return `+${digits.slice(0, 15)}`;
}

function storeAuthFormValues(form = document.querySelector('#signInForm')) {
  if (!form) return;
  const formData = new FormData(form);
  ['login', 'password', 'phone', 'email', 'code'].forEach((fieldName) => {
    if (formData.has(fieldName)) {
      authUiState[fieldName] = String(formData.get(fieldName) || '').trim();
    }
  });
}

function getAuthIdentifierConfig(method) {
  if (method === 'sms') {
    return {
      name: 'phone',
      label: 'Телефон',
      type: 'tel',
      inputmode: 'tel',
      autocomplete: 'tel',
      placeholder: '+7 (___) ___-__-__'
    };
  }

  if (method === 'email') {
    return {
      name: 'email',
      label: 'Email',
      type: 'email',
      inputmode: 'email',
      autocomplete: 'email',
      placeholder: 'Email'
    };
  }

  return {
    name: 'login',
    label: 'Логин',
    type: 'text',
    inputmode: 'email',
    autocomplete: 'username',
    placeholder: 'Логин партнёрского кабинета'
  };
}

function authTabsHtml() {
  return `
    <div class="auth-tabs auth-tabs-wakesurf" role="tablist" aria-label="Тип авторизации">
      ${['sms', 'email', 'password'].map((method) => `
        <button
          class="auth-tab ${authUiState.method === method ? 'active' : ''}"
          type="button"
          role="tab"
          aria-selected="${authUiState.method === method ? 'true' : 'false'}"
          data-auth-method="${method}"
        >
          <span class="auth-tab-icon">${authMethodIconSvg(method)}</span>
          <span>${getAuthMethodLabel(method)}</span>
        </button>
      `).join('')}
    </div>
  `;
}

function passwordAuthFieldsHtml() {
  return `
    <div class="auth-input-stack">
      <label>
        <span>Логин</span>
        <input
          name="login"
          type="text"
          inputmode="email"
          autocomplete="username"
          placeholder="Логин партнёрского кабинета"
          value="${escapeHtml(authUiState.login)}"
          required
        />
      </label>
      <label>
        <span>Пароль</span>
        <span class="auth-password-field">
          <input
            id="authPasswordInput"
            name="password"
            type="password"
            autocomplete="current-password"
            placeholder="••••••"
            value="${escapeHtml(authUiState.password)}"
            required
          />
          <button class="auth-password-toggle" type="button" aria-controls="authPasswordInput" aria-label="Показать пароль">
            ${passwordVisibilityIconSvg(false)}
          </button>
        </span>
      </label>
      <button class="button auth-submit" type="submit">Войти</button>
    </div>
  `;
}

function codeAuthFieldsHtml() {
  const config = getAuthIdentifierConfig(authUiState.method);
  const value = authUiState[config.name] || '';

  return `
    <div class="auth-input-stack">
      <label>
        <span>${escapeHtml(config.label)}</span>
        <input
          name="${escapeHtml(config.name)}"
          type="${escapeHtml(config.type)}"
          inputmode="${escapeHtml(config.inputmode)}"
          autocomplete="${escapeHtml(config.autocomplete)}"
          placeholder="${escapeHtml(config.placeholder)}"
          value="${escapeHtml(value)}"
          required
        />
      </label>
      ${authUiState.codeRequested ? `
        <label>
          <span>Код</span>
          <input
            name="code"
            type="text"
            inputmode="numeric"
            autocomplete="one-time-code"
            placeholder="Код"
            value="${escapeHtml(authUiState.code)}"
            required
          />
        </label>
        <button class="button auth-submit" type="submit">Войти</button>
      ` : `
        <button id="requestAuthCode" class="button auth-submit" type="button">Получить код</button>
      `}
    </div>
  `;
}

function renderSignIn(message = '') {
  ensureSignInPath();
  setAuthMode(false);
  setHeader('Вход в кабинет партнёра');
  setActiveNavigation('');
  stopQrScanner({ keepModalOpen: false });
  if (pushPrompt) {
    pushPrompt.className = 'push-prompt hidden';
    pushPrompt.innerHTML = '';
  }

  app.innerHTML = `
    <section class="auth-screen auth-screen-wakesurf">
      <div class="auth-brand-panel" aria-hidden="true">
        <img src="/assets/wowlife-logo.svg" alt="" />
      </div>

      <div class="auth-panel">
        <div class="auth-panel-inner">
          <div class="auth-heading">
            <img class="auth-mobile-logo" src="/assets/wowlife-logo.svg" alt="" />
            <h1>Вход в кабинет партнёра</h1>
            <p>Войдите, чтобы управлять данными</p>
          </div>

          <form id="signInForm" class="auth-form auth-form-wakesurf">
            ${authTabsHtml()}
            <div id="authNotice" class="${message ? 'notice error' : 'hidden'}">${escapeHtml(message)}</div>
            ${authUiState.method === 'password' ? passwordAuthFieldsHtml() : codeAuthFieldsHtml()}
          </form>
        </div>
      </div>
    </section>
  `;

  const form = document.querySelector('#signInForm');

  form?.querySelectorAll('[data-auth-method]').forEach((button) => {
    button.addEventListener('click', () => {
      storeAuthFormValues(form);
      authUiState.method = button.dataset.authMethod || 'password';
      authUiState.codeRequested = false;
      authUiState.code = '';
      renderSignIn();
    });
  });

  form?.querySelector('#requestAuthCode')?.addEventListener('click', handleAuthCodeRequest);
  form?.querySelector('.auth-password-toggle')?.addEventListener('click', handlePasswordVisibilityToggle);

  const phoneInput = form?.querySelector('input[name="phone"]');
  phoneInput?.addEventListener('input', (event) => {
    const input = event.currentTarget;
    input.value = formatAuthPhoneMask(input.value);
    authUiState.phone = input.value;
  });

  form?.addEventListener('submit', handleSignInSubmit);
}

function handlePasswordVisibilityToggle(event) {
  const button = event.currentTarget;
  const input = document.querySelector('#authPasswordInput');
  if (!input) return;

  const shouldShow = input.type === 'password';
  input.type = shouldShow ? 'text' : 'password';
  button.innerHTML = passwordVisibilityIconSvg(shouldShow);
  button.setAttribute('aria-label', shouldShow ? 'Скрыть пароль' : 'Показать пароль');
  button.classList.toggle('is-visible', shouldShow);
}

async function handleAuthCodeRequest(event) {
  event.preventDefault();
  const button = event.currentTarget;
  const form = button.closest('form');
  const notice = form?.querySelector('#authNotice');

  storeAuthFormValues(form);

  const config = getAuthIdentifierConfig(authUiState.method);
  const value = authUiState[config.name];

  if (!value) {
    if (notice) {
      notice.className = 'notice error';
      notice.textContent = authUiState.method === 'sms'
        ? 'Введите телефон, чтобы получить код.'
        : 'Введите email, чтобы получить код.';
    }
    return;
  }

  if (authUiState.method !== 'sms') {
    if (notice) {
      notice.className = 'notice error';
      notice.textContent = 'Запросы для входа по Email будут подключены после описания модели API.';
    }
    return;
  }

  const contact = normalizeAuthPhoneContact(value);
  if (!contact) {
    if (notice) {
      notice.className = 'notice error';
      notice.textContent = 'Введите корректный телефон, чтобы получить код.';
    }
    return;
  }

  button.disabled = true;
  button.textContent = 'Отправляем...';
  if (notice) {
    notice.className = 'hidden';
    notice.textContent = '';
  }

  try {
    await api('/api/auth/request-code', {
      method: 'POST',
      body: JSON.stringify({
        authMethod: 'sms',
        phone: value,
        contact
      })
    });

    authUiState.phone = formatAuthPhoneMask(contact);
    authUiState.codeRequested = true;
    authUiState.code = '';
    renderSignIn();
  } catch (error) {
    if (notice) {
      notice.className = 'notice error';
      notice.textContent = error.message;
    }
  } finally {
    button.disabled = false;
    button.textContent = 'Получить код';
  }
}

async function handleSignInSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector('button[type="submit"]');
  const notice = form.querySelector('#authNotice');

  storeAuthFormValues(form);

  if (authUiState.method === 'email') {
    notice.className = 'notice error';
    notice.textContent = 'Запросы для входа по Email будут подключены после описания модели API.';
    return;
  }

  if (authUiState.method === 'sms' && !authUiState.code) {
    notice.className = 'notice error';
    notice.textContent = 'Введите код из SMS.';
    return;
  }

  submit.disabled = true;
  submit.textContent = 'Входим...';
  notice.className = 'hidden';
  notice.textContent = '';

  try {
    const formData = new FormData(form);
    const payload = Object.fromEntries(formData.entries());
    payload.authMethod = authUiState.method;

    if (authUiState.method === 'sms') {
      payload.contact = normalizeAuthPhoneContact(payload.phone || authUiState.phone);
    }

    const result = await api('/api/auth/sign-in', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    currentUser = result.user;
    setAuthMode(true);
    leaveSignInPathAfterAuth();
    route();
    initializePushClient();
  } catch (error) {
    notice.className = 'notice error';
    notice.textContent = error.message;
  } finally {
    submit.disabled = false;
    submit.textContent = 'Войти';
  }
}

async function initializeAuth() {
  showLoading();
  try {
    const result = await api('/api/auth/me');
    currentUser = result.user;
    setAuthMode(true);
    leaveSignInPathAfterAuth();
    return true;
  } catch (_error) {
    currentUser = null;
    renderSignIn();
    return false;
  }
}

async function signOut() {
  try {
    await api('/api/auth/sign-out', { method: 'POST' });
  } catch (_error) {
    // Даже если сервер недоступен, очищаем состояние интерфейса.
  }

  currentUser = null;
  renderSignIn();
}


let pushRegistration = null;
let pushPublicKeyPayload = null;

function isStandaloneApp() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function isMobileViewport() {
  return window.matchMedia('(max-width: 920px)').matches;
}

function isLocalhost() {
  return ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
}

function isPushSupported() {
  return (
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window &&
    (window.isSecureContext || isLocalhost())
  );
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replaceAll('-', '+').replaceAll('_', '/');
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((character) => character.charCodeAt(0)));
}

async function getPushPublicKeyPayload() {
  if (pushPublicKeyPayload) {
    return pushPublicKeyPayload;
  }

  pushPublicKeyPayload = await api('/api/push/public-key');
  return pushPublicKeyPayload;
}

async function getServiceWorkerRegistration() {
  if (pushRegistration) {
    return pushRegistration;
  }

  pushRegistration = await navigator.serviceWorker.register('/sw.js');
  return pushRegistration;
}

async function sendPushSubscription(subscription) {
  const payload = {
    subscription: subscription.toJSON(),
    installed: isStandaloneApp(),
    permission: Notification.permission,
    platform: navigator.platform || '',
    userAgent: navigator.userAgent
  };

  await api('/api/push/subscribe', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

async function ensurePushSubscription(options = {}) {
  if (!isPushSupported()) return false;

  if (!isStandaloneApp()) {
    renderPushPrompt('PUSH включаются после запуска приложения из ярлыка.', 'error');
    return false;
  }

  const publicKeyPayload = await getPushPublicKeyPayload();
  if (!publicKeyPayload.configured || !publicKeyPayload.publicKey) {
    renderPushPrompt('PUSH отключены на сервере. Добавьте VAPID-ключи в env.', 'error');
    return false;
  }

  if (Notification.permission === 'default' && options.requestPermission) {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      renderPushPrompt('Разрешение на PUSH не выдано. Уведомления приходить не будут.', 'error');
      return false;
    }
  }

  if (Notification.permission !== 'granted') {
    return false;
  }

  const registration = await getServiceWorkerRegistration();
  const existingSubscription = await registration.pushManager.getSubscription();

  const subscription = existingSubscription || await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKeyPayload.publicKey)
  });

  await sendPushSubscription(subscription);
  renderPushPrompt('PUSH уведомления включены для этого ярлыка.', 'success');

  return true;
}

function renderPushPrompt(message, type = '') {
  if (!pushPrompt) return;

  if (!isPushSupported()) {
    pushPrompt.className = 'push-prompt hidden';
    pushPrompt.innerHTML = '';
    return;
  }

  const installed = isStandaloneApp();
  const permission = Notification.permission;

  if (!message) {
    if (!installed) {
      if (!isMobileViewport()) {
        pushPrompt.className = 'push-prompt hidden';
        pushPrompt.innerHTML = '';
        return;
      }

      pushPrompt.className = 'push-prompt';
      pushPrompt.innerHTML = `
        <div>
          <strong>Добавьте приложение на экран телефона</strong>
          <span>После запуска из ярлыка можно включить PUSH-уведомления.</span>
        </div>
      `;
      return;
    }

    if (permission === 'granted') {
      pushPrompt.className = 'push-prompt success';
      pushPrompt.innerHTML = `
        <div>
          <strong>PUSH уведомления активны</strong>
          <span>Этот ярлык будет получать уведомления.</span>
        </div>
      `;
      return;
    }

    if (permission === 'denied') {
      pushPrompt.className = 'push-prompt error';
      pushPrompt.innerHTML = `
        <div>
          <strong>PUSH уведомления запрещены</strong>
          <span>Разрешите уведомления в настройках браузера или телефона.</span>
        </div>
      `;
      return;
    }

    pushPrompt.className = 'push-prompt';
    pushPrompt.innerHTML = `
      <div>
        <strong>Включить PUSH уведомления</strong>
        <span>Уведомления будут приходить на телефон, если приложение открыто из ярлыка.</span>
      </div>
      <button id="enablePushButton" class="button compact" type="button">Включить</button>
    `;
    return;
  }

  pushPrompt.className = `push-prompt ${type}`.trim();
  pushPrompt.innerHTML = `
    <div>
      <strong>${escapeHtml(message)}</strong>
      <span>${type === 'success' ? 'Подписка сохранена на сервере.' : 'Проверьте настройки PUSH.'}</span>
    </div>
    ${type === 'error' && installed && Notification.permission !== 'denied'
      ? '<button id="enablePushButton" class="button compact" type="button">Повторить</button>'
      : ''
    }
  `;
}

async function initializePushClient() {
  if (!isPushSupported()) return;

  try {
    await getServiceWorkerRegistration();

    if (isStandaloneApp() && Notification.permission === 'granted') {
      await ensurePushSubscription({ requestPermission: false });
    } else {
      renderPushPrompt();
    }
  } catch (_error) {
    renderPushPrompt('Не удалось подготовить PUSH уведомления.', 'error');
  }
}

document.addEventListener('click', async (event) => {
  const button = event.target.closest('#enablePushButton');
  if (!button) return;

  button.disabled = true;
  button.textContent = 'Включаю...';

  try {
    await ensurePushSubscription({ requestPermission: true });
  } catch (_error) {
    renderPushPrompt('Не удалось включить PUSH уведомления.', 'error');
  }
});


function statusHtml(statusMap, status, labelOverride = null) {
  const meta = statusMap[status] || { label: status || '—', className: '' };
  const label = labelOverride || meta.label;
  return `<span class="status ${meta.className}">${escapeHtml(label)}</span>`;
}

function initStatusMultiselect() {
  const root = document.querySelector('#statusFilter[data-multiselect]');
  if (!root) return;

  const control = root.querySelector('.multiselect-control');
  const value = root.querySelector('.multiselect-value');
  const options = Array.from(root.querySelectorAll('.multiselect-option'));
  const inputs = Array.from(root.querySelectorAll('input[type="checkbox"]'));

  const close = () => {
    root.classList.remove('open');
    control?.setAttribute('aria-expanded', 'false');
  };

  const updateValue = () => {
    const checked = inputs.filter((input) => input.checked);
    const labels = checked.map((input) => input.dataset.label || input.value);

    if (value) {
      if (labels.length === 0) {
        value.textContent = 'Все';
      } else if (labels.length === 1) {
        value.textContent = labels[0];
      } else {
        value.textContent = `${labels.length} статуса`;
      }
    }

    options.forEach((option) => {
      const input = option.querySelector('input');
      option.setAttribute('aria-selected', input?.checked ? 'true' : 'false');
    });
  };

  control?.addEventListener('click', () => {
    const isOpen = root.classList.toggle('open');
    control.setAttribute('aria-expanded', String(isOpen));
  });

  inputs.forEach((input) => {
    input.addEventListener('change', updateValue);
  });

  document.addEventListener('click', (event) => {
    if (!root.contains(event.target)) {
      close();
    }
  }, { once: false });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      close();
    }
  });

  updateValue();
}

let qrStream = null;
let qrScanFrame = null;
let qrDetector = null;
let qrScannerMode = null;
let qrDetectionBusy = false;
let qrCanvas = null;
let qrCanvasContext = null;
let qrLastDecodeAt = 0;

function setQrStatus(message, type = '') {
  const status = document.querySelector('#qrStatus');
  if (!status) return;
  status.className = `qr-status ${type}`.trim();
  status.textContent = message;
}

function stopQrScanner(options = {}) {
  if (qrScanFrame) {
    window.cancelAnimationFrame(qrScanFrame);
    qrScanFrame = null;
  }

  qrDetectionBusy = false;
  qrScannerMode = null;
  qrDetector = null;
  qrLastDecodeAt = 0;

  if (qrStream) {
    qrStream.getTracks().forEach((track) => track.stop());
    qrStream = null;
  }

  const video = document.querySelector('#qrVideo');
  if (video) {
    video.pause();
    video.srcObject = null;
  }

  const modal = document.querySelector('#qrModal');
  if (modal && !options.keepModalOpen) {
    modal.classList.add('hidden');
    document.body.classList.remove('no-scroll');
  }
}

function parseQrPayload(rawValue) {
  const value = String(rawValue || '').trim();
  if (!value) return {};

  const normalize = (object) => ({
    certificateNumber:
      object.certificateNumber ||
      object.certificate_number ||
      object.number ||
      object.cert ||
      object.certificate ||
      '',
    secretCode:
      object.secretCode ||
      object.secret_code ||
      object.code ||
      object.secret ||
      object.pin ||
      ''
  });

  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === 'object') {
      return normalize(parsed);
    }
  } catch (_error) {
    // QR может быть не JSON — продолжаем разбор как URL или простой текст.
  }

  try {
    const url = new URL(value);
    const params = Object.fromEntries(url.searchParams.entries());
    return normalize(params);
  } catch (_error) {
    // Не URL — продолжаем разбор как строку.
  }

  const byKeys = {};
  value
    .split(/[;\n,&]+/)
    .map((part) => part.trim())
    .forEach((part) => {
      const [key, ...rest] = part.split(/[:=]/);
      if (!key || rest.length === 0) return;
      byKeys[key.trim()] = rest.join(':').trim();
    });

  const fromKeys = normalize(byKeys);
  if (fromKeys.certificateNumber || fromKeys.secretCode) {
    return fromKeys;
  }

  const parts = value.split(/[\s|:;,_]+/).filter(Boolean);
  if (parts.length >= 2) {
    return {
      certificateNumber: parts[0],
      secretCode: parts[1]
    };
  }

  return {
    certificateNumber: value,
    secretCode: ''
  };
}

function applyQrPayload(rawValue) {
  const payload = parseQrPayload(rawValue);
  const numberInput = document.querySelector('#certificateNumber');
  const codeInput = document.querySelector('#secretCode');

  if (payload.certificateNumber && numberInput) {
    numberInput.value = payload.certificateNumber;
  }

  if (payload.secretCode && codeInput) {
    codeInput.value = payload.secretCode;
  }

  stopQrScanner();

  const notice = document.querySelector('#redeemNotice');
  if (notice) {
    notice.className = 'notice';
    notice.textContent = payload.secretCode
      ? 'QR код считан. Проверьте данные и нажмите «Погасить сертификат».'
      : 'QR код считан. Секретный код не найден — заполните его вручную.';
  }

  if (codeInput && !payload.secretCode) {
    codeInput.focus();
  }
}

function detectQrWithCanvas(video) {
  if (typeof window.jsQR !== 'function') return null;

  const sourceWidth = video.videoWidth || video.clientWidth || 0;
  const sourceHeight = video.videoHeight || video.clientHeight || 0;

  if (!sourceWidth || !sourceHeight) return null;

  if (!qrCanvas) {
    qrCanvas = document.createElement('canvas');
    qrCanvasContext = qrCanvas.getContext('2d', { willReadFrequently: true });
  }

  if (!qrCanvasContext) return null;

  const maxSide = 900;
  const scale = Math.min(1, maxSide / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));

  if (qrCanvas.width !== width || qrCanvas.height !== height) {
    qrCanvas.width = width;
    qrCanvas.height = height;
  }

  qrCanvasContext.drawImage(video, 0, 0, width, height);
  const imageData = qrCanvasContext.getImageData(0, 0, width, height);
  const code = window.jsQR(imageData.data, width, height, { inversionAttempts: 'attemptBoth' });

  return code?.data || null;
}

async function detectQrLoop(video) {
  if (!qrStream || video.readyState < 2) {
    qrScanFrame = window.requestAnimationFrame(() => detectQrLoop(video));
    return;
  }

  if (!qrDetectionBusy) {
    qrDetectionBusy = true;

    try {
      if (qrScannerMode === 'barcode' && qrDetector) {
        const codes = await qrDetector.detect(video);
        const qrCode = codes.find((code) => code.rawValue);
        if (qrCode) {
          setQrStatus('QR код найден. Заполняю данные...', 'success');
          applyQrPayload(qrCode.rawValue);
          return;
        }
      } else if (qrScannerMode === 'jsqr') {
        const now = Date.now();
        if (now - qrLastDecodeAt >= 180) {
          qrLastDecodeAt = now;
          const rawValue = detectQrWithCanvas(video);
          if (rawValue) {
            setQrStatus('QR код найден. Заполняю данные...', 'success');
            applyQrPayload(rawValue);
            return;
          }
        }
      }
    } catch (_error) {
      setQrStatus('Камера открыта, но распознать QR код не удалось. Попробуйте навести камеру ближе.', 'error');
    } finally {
      qrDetectionBusy = false;
    }
  }

  qrScanFrame = window.requestAnimationFrame(() => detectQrLoop(video));
}

async function openQrScanner() {
  const modal = document.querySelector('#qrModal');
  const video = document.querySelector('#qrVideo');

  if (!modal || !video) return;

  modal.classList.remove('hidden');
  document.body.classList.add('no-scroll');
  setQrStatus('Запрашиваю доступ к камере...');

  if (!navigator.mediaDevices?.getUserMedia) {
    setQrStatus('Браузер не поддерживает доступ к камере. Откройте приложение в современном браузере по HTTPS или localhost.', 'error');
    return;
  }

  try {
    qrStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      }
    });
  } catch (_primaryError) {
    try {
      qrStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
    } catch (error) {
      const message = error?.name === 'NotAllowedError'
        ? 'Доступ к камере запрещён. Разрешите камеру в настройках браузера и попробуйте ещё раз.'
        : 'Не удалось открыть камеру. Проверьте, что устройство подключено и страница открыта по HTTPS.';
      setQrStatus(message, 'error');
      return;
    }
  }

  video.srcObject = qrStream;
  await video.play().catch(() => null);

  qrScannerMode = null;
  qrDetector = null;

  if ('BarcodeDetector' in window) {
    try {
      qrDetector = new BarcodeDetector({ formats: ['qr_code'] });
      qrScannerMode = 'barcode';
    } catch (_error) {
      qrDetector = null;
    }
  }

  if (!qrScannerMode && typeof window.jsQR === 'function') {
    qrScannerMode = 'jsqr';
  }

  if (qrScannerMode) {
    setQrStatus('Наведите камеру на QR код сертификата.');
    detectQrLoop(video);
  } else {
    setQrStatus('Камера открыта, но этот браузер не поддерживает распознавание QR кода. Используйте ручной ввод ниже.', 'error');
  }
}


function certificateCard(certificate) {
  return `
    <a class="card certificate-card" href="/certificates/${certificate.id}">
      <div class="card-topline">
        <div class="card-title">${escapeHtml(certificate.certificateNumber)}</div>
        <div class="money">${formatPlainMoney(certificate.amountCents)}</div>
      </div>
      <div class="dashed-line"></div>
      <div class="card-subtitle">${escapeHtml(certificate.title)}</div>
      <div class="status-row">
        <span>${formatDate(certificate.serviceDate)} · ${formatTime(certificate.serviceTime)}</span>
        ${statusHtml(certificateStatus, certificate.status, certificate.statusLabel)}
      </div>
    </a>
  `;
}

function paymentCard(paymentRequest) {
  return `
    <a class="card payment-card" href="/payments/${paymentRequest.id}">
      <div class="card-topline">
        <div class="card-title">${formatDate(paymentRequest.createdAt)}</div>
        <div class="money">${formatMoney(paymentRequest.totalAmountCents)}</div>
      </div>
      <div class="dashed-line"></div>
      <div class="status-row">
        <span>${paymentRequest.certificateCount} ${declension(paymentRequest.certificateCount, ['сертификат', 'сертификата', 'сертификатов'])}</span>
        ${statusHtml(paymentStatus, paymentRequest.status)}
      </div>
    </a>
  `;
}

function declension(count, words) {
  const abs = Math.abs(Number(count)) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return words[2];
  if (last > 1 && last < 5) return words[1];
  if (last === 1) return words[0];
  return words[2];
}

async function renderRedeem() {
  setHeader('Погасить сертификат');
  setActiveNavigation('redeem');

  app.innerHTML = `
    <div class="stack">
      <button id="openQrScanner" class="card scan-card" type="button" aria-label="Сканировать QR код">
        <span class="scan-left">
          <span class="scan-icon"><img src="/assets/qr-scan.png" alt="" /></span>
          <span>Сканировать по QR коду</span>
        </span>
        <span>→</span>
      </button>

      <div id="qrModal" class="qr-modal hidden" role="dialog" aria-modal="true" aria-labelledby="qrTitle">
        <button class="qr-backdrop" type="button" data-close-qr aria-label="Закрыть сканер"></button>
        <section class="qr-panel">
          <header class="qr-header">
            <h2 id="qrTitle">Сканирование QR кода</h2>
            <button class="icon-button qr-close" type="button" data-close-qr aria-label="Закрыть">×</button>
          </header>
          <div class="qr-body">
            <div class="qr-video-wrap">
              <video id="qrVideo" playsinline muted autoplay></video>
              <div class="qr-frame" aria-hidden="true"></div>
            </div>
            <p class="qr-hint">Разрешите доступ к камере и наведите объектив на QR код сертификата.</p>
            <div id="qrStatus" class="qr-status">Камера ещё не запущена.</div>
          </div>
        </section>
      </div>

      <section class="card pad form-card">
        <h2>Погасить вручную</h2>
        <form id="redeemForm">
          <div class="field-list">
            <div class="field">
              <label for="certificateNumber">Номер сертификата:</label>
              <input id="certificateNumber" name="certificateNumber" placeholder="Номер" autocomplete="off" required />
            </div>
            <div class="field">
              <label for="secretCode">Секретный код:</label>
              <input id="secretCode" name="secretCode" placeholder="000000" autocomplete="off" required />
            </div>
          </div>
          <div class="actions">
            <button class="button" type="submit">Погасить сертификат</button>
          </div>
          <div id="redeemNotice" class="hidden"></div>
        </form>
      </section>
    </div>
  `;

  const form = document.querySelector('#redeemForm');
  const notice = document.querySelector('#redeemNotice');
  const scannerButton = document.querySelector('#openQrScanner');

  scannerButton?.addEventListener('click', openQrScanner);
  document.querySelectorAll('[data-close-qr]').forEach((button) => {
    button.addEventListener('click', () => stopQrScanner());
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    notice.className = 'notice hidden';

    try {
      const formData = new FormData(form);
      const payload = Object.fromEntries(formData.entries());
      const result = await api('/api/certificates/redeem', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      navigate(`/certificates/${result.item.id}`);
    } catch (error) {
      notice.className = 'notice error';
      notice.textContent = error.message;
    } finally {
      submit.disabled = false;
    }
  });
}


function certificatesPaginationHtml(pagination) {
  if (!pagination || Number(pagination.totalPages || 1) <= 1) return '';

  const currentPage = Number(pagination.currentPage || 1);
  const totalPages = Number(pagination.totalPages || 1);
  const totalItems = Number(pagination.totalItems || 0);
  const start = Math.max(1, currentPage - 2);
  const end = Math.min(totalPages, currentPage + 2);
  const pages = [];

  for (let page = start; page <= end; page += 1) {
    pages.push(`
      <button class="pagination-page ${page === currentPage ? 'active' : ''}" type="button" data-page="${page}" aria-label="Страница ${page}">${page}</button>
    `);
  }

  return `
    <nav class="pagination" aria-label="Навигация по страницам сертификатов">
      <div class="pagination-summary">${totalItems ? `${totalItems} ${declension(totalItems, ['сертификат', 'сертификата', 'сертификатов'])}` : `Страница ${currentPage} из ${totalPages}`}</div>
      <div class="pagination-controls">
        <button class="pagination-page" type="button" data-page="${Math.max(1, currentPage - 1)}" ${currentPage <= 1 ? 'disabled' : ''}>Назад</button>
        ${start > 1 ? '<span class="pagination-gap">…</span>' : ''}
        ${pages.join('')}
        ${end < totalPages ? '<span class="pagination-gap">…</span>' : ''}
        <button class="pagination-page" type="button" data-page="${Math.min(totalPages, currentPage + 1)}" ${currentPage >= totalPages ? 'disabled' : ''}>Вперёд</button>
      </div>
    </nav>
  `;
}

function renderCertificatesResult(data, emptyText = 'Погашенных сертификатов пока нет.') {
  const list = document.querySelector('#certificatesList');
  const pagination = document.querySelector('#certificatesPagination');
  if (!list) return;

  list.innerHTML = data.items?.length
    ? data.items.map(certificateCard).join('')
    : `<div class="empty-state">${escapeHtml(emptyText)}</div>`;

  if (pagination) {
    pagination.innerHTML = certificatesPaginationHtml(data.pagination);
    pagination.querySelectorAll('[data-page]').forEach((button) => {
      button.addEventListener('click', () => {
        const page = Number(button.dataset.page || 1);
        if (Number.isFinite(page) && page > 0) {
          loadFilteredCertificates(page);
        }
      });
    });
  }
}

async function renderCertificates() {
  setHeader('Погашенные сертификаты');
  setActiveNavigation('certificates');
  showLoading();
  certificatesListState.page = 1;

  app.innerHTML = `
    <div class="stack">
      <div class="card pad filters-card">
        <div class="filters certificate-filters">
          <div class="filter-field filter-field-status">
            <span class="filter-label">Статус</span>
            <div class="multiselect" id="statusFilter" data-multiselect>
              <button class="multiselect-control" type="button" aria-haspopup="listbox" aria-expanded="false">
                <span class="multiselect-value">Все</span>
                <span class="multiselect-arrow" aria-hidden="true">⌄</span>
              </button>
              <div class="multiselect-menu" role="listbox" aria-label="Статус сертификата" aria-multiselectable="true">
                <label class="multiselect-option" role="option" aria-selected="false">
                  <input type="checkbox" value="REDEEMED" data-label="Погашено" />
                  <span class="multiselect-check" aria-hidden="true">✓</span>
                  <span>Погашено</span>
                </label>
                <label class="multiselect-option" role="option" aria-selected="false">
                  <input type="checkbox" value="PAYMENT_PROCESSING" data-label="В процессе оплаты" />
                  <span class="multiselect-check" aria-hidden="true">✓</span>
                  <span>В процессе оплаты</span>
                </label>
                <label class="multiselect-option" role="option" aria-selected="false">
                  <input type="checkbox" value="PAID" data-label="Оплачено" />
                  <span class="multiselect-check" aria-hidden="true">✓</span>
                  <span>Оплачено</span>
                </label>
              </div>
            </div>
          </div>
          <div class="filter-date-row">
            <div class="filter-field">
              <label for="fromFilter">С даты</label>
              <input id="fromFilter" type="date" />
            </div>
            <div class="filter-field">
              <label for="toFilter">По дату</label>
              <input id="toFilter" type="date" />
            </div>
          </div>
          <button id="applyCertificateFilters" class="button filter-apply certificate-apply-button" type="button">Применить</button>
        </div>
      </div>
      <div id="certificatesList" class="list"><div class="loading-card">Загрузка...</div></div>
      <div id="certificatesPagination"></div>
    </div>
  `;

  initStatusMultiselect();
  document.querySelector('#applyCertificateFilters').addEventListener('click', () => loadFilteredCertificates(1));
  await loadFilteredCertificates(1, 'Погашенных сертификатов пока нет.');
}

async function loadFilteredCertificates(page = 1, emptyText = 'По выбранным фильтрам сертификатов нет.') {
  const params = new URLSearchParams();
  const statuses = Array.from(document.querySelectorAll('#statusFilter input[type="checkbox"]:checked'))
    .map((input) => input.value);
  const from = document.querySelector('#fromFilter')?.value || '';
  const to = document.querySelector('#toFilter')?.value || '';

  certificatesListState.page = page;
  statuses.forEach((status) => params.append('status', status));
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  params.set('page', String(page));
  params.set('limit', String(certificatesListState.limit));

  const list = document.querySelector('#certificatesList');
  const pagination = document.querySelector('#certificatesPagination');
  if (list) list.innerHTML = '<div class="loading-card">Загрузка...</div>';
  if (pagination) pagination.innerHTML = '';

  try {
    const data = await api(`/api/certificates/redeemed?${params.toString()}`);
    renderCertificatesResult(data, emptyText);
  } catch (error) {
    if (list) list.innerHTML = `<div class="error-state">${escapeHtml(error.message)}</div>`;
  }
}

async function renderCertificateDetail(id) {
  setHeader('Информация о сертификате', { backTo: '/certificates' });
  setActiveNavigation('certificates');
  showLoading();

  try {
    const { item } = await api(`/api/certificates/${id}`);
    app.innerHTML = `
      <section class="card detail-card">
        <img class="hero-image" src="${certificateDetailHeroImage}" alt="${escapeHtml(item.title)}" />
        <div class="detail-body">
          <h2 class="detail-title">${escapeHtml(item.title)}</h2>
          <div class="detail-table">
            <div class="detail-row"><span>Сертификат №</span><strong>${escapeHtml(item.certificateNumber)}</strong></div>
            <div class="detail-row"><span>Дата записи на услугу:</span><strong>${formatDate(item.serviceDate)}</strong></div>
            <div class="detail-row"><span>Время записи:</span><strong>${formatTime(item.serviceTime)}</strong></div>
            <div class="detail-row"><span>Ф.И.О.</span><strong>${escapeHtml(item.customerFullName || '—')}</strong></div>
            <div class="detail-row"><span>Телефон:</span><strong>${escapeHtml(item.customerPhone || '—')}</strong></div>
            <div class="detail-row total"><span>Сумма:</span><strong>${formatMoney(item.amountCents)}</strong></div>
            <div class="detail-row"><span>Статус:</span><strong>${statusHtml(certificateStatus, item.status, item.statusLabel)}</strong></div>
          </div>
        </div>
      </section>
    `;
  } catch (error) {
    showError(error);
  }
}

async function renderPayments() {
  setHeader('Заявки на оплату');
  setActiveNavigation('payments');
  showLoading();

  try {
    const data = await api('/api/payment-requests');
    const itemsHtml = data.items.length
      ? data.items.map(paymentCard).join('')
      : '<div class="empty-state">Заявок на оплату пока нет.</div>';

    app.innerHTML = `
      <div class="stack">
        <section class="card summary-card">
          <div>
            <div class="summary-label">Общая сумма выплат за весь период:</div>
            <div class="summary-amount">${formatMoney(data.summary.totalPaidAmountCents)}</div>
          </div>
          <a class="button" href="/payments/create">Создать заявку</a>
        </section>
        <div class="list">${itemsHtml}</div>
      </div>
    `;
  } catch (error) {
    showError(error);
  }
}

async function renderPaymentDetail(id) {
  setHeader('Информация по заявке', { backTo: '/payments' });
  setActiveNavigation('payments');
  showLoading();

  try {
    const data = await api(`/api/payment-requests/${id}`);
    const item = data.item;
    const canMarkPaid = item.status === 'PROCESSING';

    app.innerHTML = `
      <div class="stack">
        <section class="card summary-card">
          <div>
            <div class="summary-label">${escapeHtml(item.requestNumber)}</div>
            <div class="summary-amount">${formatMoney(item.totalAmountCents)}</div>
            <div class="status-row" style="margin-top: 10px; justify-content: flex-start; gap: 18px;">
              <span>${item.certificateCount} ${declension(item.certificateCount, ['сертификат', 'сертификата', 'сертификатов'])}</span>
              ${statusHtml(paymentStatus, item.status)}
            </div>
          </div>
          ${canMarkPaid ? '<button id="markPaid" class="button" type="button">Отметить оплаченной</button>' : ''}
        </section>
        <section class="card table-card">
          <div class="table-header">
            <div>
              <h2>Оплаченные сертификаты</h2>
              <p>Период: ${formatDate(item.periodFrom)} — ${formatDate(item.periodTo)}</p>
            </div>
          </div>
          ${certificatesTable(data.certificates, { selectable: false })}
        </section>
      </div>
    `;

    const markPaidButton = document.querySelector('#markPaid');
    if (markPaidButton) {
      markPaidButton.addEventListener('click', async () => {
        markPaidButton.disabled = true;
        try {
          await api(`/api/payment-requests/${id}/pay`, { method: 'PATCH' });
          await renderPaymentDetail(id);
        } catch (error) {
          showError(error);
        }
      });
    }
  } catch (error) {
    showError(error);
  }
}

async function renderCreatePayment() {
  setHeader('Создать заявку', { backTo: '/payments' });
  setActiveNavigation('payments');

  createRequestState.periodFrom = '';
  createRequestState.periodTo = '';
  createRequestState.items = [];
  createRequestState.selectedIds = new Set();

  app.innerHTML = `
    <div class="stack">
      <section class="card pad">
        <div class="filters">
          <div class="filter-field">
            <label for="periodFrom">С даты</label>
            <input id="periodFrom" type="date" />
          </div>
          <div class="filter-field">
            <label for="periodTo">По дату</label>
            <input id="periodTo" type="date" />
          </div>
          <button id="loadCandidates" class="button secondary" type="button">Показать</button>
        </div>
      </section>
      <section id="createRequestTable" class="card table-card">
        <div class="loading-card">Загрузка...</div>
      </section>
    </div>
  `;

  document.querySelector('#loadCandidates').addEventListener('click', () => {
    createRequestState.periodFrom = document.querySelector('#periodFrom').value;
    createRequestState.periodTo = document.querySelector('#periodTo').value;
    loadCandidates();
  });

  await loadCandidates();
}

async function loadCandidates() {
  const params = new URLSearchParams();
  if (createRequestState.periodFrom) params.set('from', createRequestState.periodFrom);
  if (createRequestState.periodTo) params.set('to', createRequestState.periodTo);

  const container = document.querySelector('#createRequestTable');
  container.innerHTML = '<div class="loading-card">Загрузка...</div>';

  try {
    const data = await api(`/api/payment-requests/candidates?${params.toString()}`);
    createRequestState.items = data.items;
    createRequestState.selectedIds = new Set(data.items.map((item) => item.id));
    renderCreatePaymentTable();
  } catch (error) {
    container.innerHTML = `<div class="error-state">${escapeHtml(error.message)}</div>`;
  }
}

function renderCreatePaymentTable() {
  const container = document.querySelector('#createRequestTable');

  if (createRequestState.items.length === 0) {
    container.innerHTML = `
      <div class="table-header">
        <div>
          <h2>Сертификаты к оплате</h2>
          <p>Нет погашенных сертификатов, доступных для новой заявки.</p>
        </div>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="table-header">
      <div>
        <h2>Сертификаты к оплате</h2>
        <p id="createRequestSummary"></p>
      </div>
      <button id="createPaymentRequest" class="button" type="button">Создать заявку</button>
    </div>
    ${certificatesTable(createRequestState.items, { selectable: true })}
  `;

  container.querySelectorAll('[data-certificate-checkbox]').forEach((checkbox) => {
    checkbox.addEventListener('change', (event) => {
      const certificateId = event.currentTarget.value;
      const checked = event.currentTarget.checked;
      if (checked) {
        createRequestState.selectedIds.add(certificateId);
      } else {
        createRequestState.selectedIds.delete(certificateId);
      }
      syncCertificateCheckboxes(certificateId, checked);
      updateCreateSummary();
    });
  });

  document.querySelector('#createPaymentRequest').addEventListener('click', createPaymentRequest);
  updateCreateSummary();
}

function syncCertificateCheckboxes(certificateId, checked) {
  document.querySelectorAll(`[data-certificate-checkbox][value="${CSS.escape(certificateId)}"]`).forEach((checkbox) => {
    checkbox.checked = checked;
  });
}

function updateCreateSummary() {
  const selected = createRequestState.items.filter((item) => createRequestState.selectedIds.has(item.id));
  const totalAmountCents = selected.reduce((sum, item) => sum + item.amountCents, 0);
  const summary = document.querySelector('#createRequestSummary');
  const button = document.querySelector('#createPaymentRequest');

  if (summary) {
    const period = createRequestState.periodFrom || createRequestState.periodTo
      ? `Период: ${formatDate(createRequestState.periodFrom)} — ${formatDate(createRequestState.periodTo)}. `
      : 'Период: все доступные погашения. ';

    summary.textContent = `${period}Выбрано: ${selected.length} ${declension(selected.length, ['сертификат', 'сертификата', 'сертификатов'])}. Сумма к оплате: ${formatMoney(totalAmountCents)}.`;
  }

  if (button) {
    button.disabled = selected.length === 0;
  }
}

async function createPaymentRequest() {
  const button = document.querySelector('#createPaymentRequest');
  button.disabled = true;

  try {
    const certificateIds = Array.from(createRequestState.selectedIds);
    const result = await api('/api/payment-requests', {
      method: 'POST',
      body: JSON.stringify({
        certificateIds,
        periodFrom: createRequestState.periodFrom || null,
        periodTo: createRequestState.periodTo || null
      })
    });
    navigate(`/payments/${result.item.id}`);
  } catch (error) {
    button.disabled = false;
    const container = document.querySelector('#createRequestTable');
    container.insertAdjacentHTML('afterbegin', `<div class="notice error">${escapeHtml(error.message)}</div>`);
  }
}

function certificatesTable(certificates, options = {}) {
  const selectable = Boolean(options.selectable);
  const rows = certificates.map((certificate) => {
    const checkbox = selectable
      ? `<td class="checkbox-cell"><input data-certificate-checkbox type="checkbox" value="${escapeHtml(certificate.id)}" checked /></td>`
      : '';

    return `
      <tr>
        ${checkbox}
        <td><strong>${escapeHtml(certificate.certificateNumber)}</strong></td>
        <td>${escapeHtml(certificate.title)}</td>
        <td>${formatDate(certificate.serviceDate)} ${formatTime(certificate.serviceTime)}</td>
        <td>${escapeHtml(certificate.customerFullName || '—')}</td>
        <td><strong>${formatMoney(certificate.amountCents)}</strong></td>
        <td>${statusHtml(certificateStatus, certificate.status, certificate.statusLabel)}</td>
      </tr>
    `;
  }).join('');

  const mobileCards = certificates.map((certificate) => {
    const checkbox = selectable
      ? `<input data-certificate-checkbox type="checkbox" value="${escapeHtml(certificate.id)}" checked />`
      : '';

    return `
      <div class="mobile-check-card">
        <div>${checkbox}</div>
        <div>
          <strong>${escapeHtml(certificate.certificateNumber)}</strong>
          <p>${escapeHtml(certificate.title)}</p>
          <p>${formatDate(certificate.serviceDate)} · ${escapeHtml(certificate.customerFullName || '—')}</p>
          <div class="status-row">
            <span class="money">${formatMoney(certificate.amountCents)}</span>
            ${statusHtml(certificateStatus, certificate.status, certificate.statusLabel)}
          </div>
        </div>
      </div>
    `;
  }).join('');

  return `
    <div class="table-wrapper">
      <table>
        <thead>
          <tr>
            ${selectable ? '<th></th>' : ''}
            <th>№ сертификата</th>
            <th>Услуга</th>
            <th>Запись</th>
            <th>Клиент</th>
            <th>Сумма</th>
            <th>Статус</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="mobile-cards">${mobileCards}</div>
  `;
}

function route() {
  normalizeLegacyHashRoute();

  if (!currentUser) {
    renderSignIn();
    return;
  }

  if (window.location.pathname === SIGN_IN_PATH) {
    leaveSignInPathAfterAuth();
  }

  stopQrScanner({ keepModalOpen: false });

  const currentPath = window.location.pathname === '/' ? DEFAULT_APP_PATH : window.location.pathname;
  const parts = currentPath.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
  const [root, id] = parts;

  if (!root) {
    navigate(DEFAULT_APP_PATH, { replace: true });
    return;
  }

  if (!APP_ROUTES.has(root)) {
    navigate(DEFAULT_APP_PATH, { replace: true });
    return;
  }

  if (root === 'redeem') return renderRedeem();
  if (root === 'certificates' && id) return renderCertificateDetail(id);
  if (root === 'certificates') return renderCertificates();
  if (root === 'payments' && id === 'create') return renderCreatePayment();
  if (root === 'payments' && id) return renderPaymentDetail(id);
  if (root === 'payments') return renderPayments();

  navigate(DEFAULT_APP_PATH, { replace: true });
}

window.addEventListener('beforeunload', () => stopQrScanner());
window.addEventListener('popstate', route);
logoutButton?.addEventListener('click', signOut);
document.addEventListener('click', (event) => {
  const link = event.target.closest?.('a[href]');
  if (!link) return;
  if (link.target || link.hasAttribute('download')) return;
  const href = link.getAttribute('href');
  if (!href || !href.startsWith('/')) return;
  if (href.startsWith('/api/') || href.startsWith('//')) return;
  const url = new URL(href, window.location.origin);
  if (url.origin !== window.location.origin) return;
  event.preventDefault();
  navigate(`${url.pathname}${url.search}`);
});
window.addEventListener('DOMContentLoaded', async () => {
  const authenticated = await initializeAuth();
  if (authenticated) {
    route();
    initializePushClient();
  }
});
