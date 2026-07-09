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
const APP_ROUTES = new Set(['redeem', 'services', 'certificates', 'reconciliations', 'payments', 'profile']);

const MOBILE_DIALOG_QUERY = '(max-width: 680px)';

const redeemInfoScreenState = {
  item: null,
  payload: null
};

function isMobileViewport() {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia) return window.matchMedia(MOBILE_DIALOG_QUERY).matches;
  return window.innerWidth <= 680;
}

function shouldUseDialogScreen() {
  return isMobileViewport();
}

function scheduleScreenPath(id, nextPath = '') {
  const normalizedId = encodeURIComponent(String(id || ''));
  const fallback = `/certificates/${normalizedId}`;
  const next = safeNextPath(nextPath || fallback);
  return `/certificates/${normalizedId}/schedule?next=${encodeURIComponent(next)}`;
}

function scheduleBackPath(id) {
  const params = new URLSearchParams(window.location.search);
  return safeNextPath(params.get('next') || `/certificates/${encodeURIComponent(String(id || ''))}`);
}

function getCurrentAppUrl() {
  return `${window.location.pathname}${window.location.search}`;
}

function safeNextPath(value) {
  const next = String(value || '').trim();
  if (!next || !next.startsWith('/') || next.startsWith('//')) return DEFAULT_APP_PATH;
  if (next.startsWith(SIGN_IN_PATH)) return DEFAULT_APP_PATH;
  return next;
}

function safeOptionalPath(value) {
  const next = String(value || '').trim();
  if (!next || !next.startsWith('/') || next.startsWith('//')) return '';
  if (next.startsWith(SIGN_IN_PATH)) return '';
  return next;
}

function navigationStateFor(path, options = {}) {
  const state = {};
  const explicitFrom = safeOptionalPath(options.from);
  const currentPath = safeOptionalPath(getCurrentAppUrl());
  const previousState = window.history.state && typeof window.history.state === 'object'
    ? window.history.state
    : {};
  const preservedFrom = safeOptionalPath(previousState.from);

  if (options.replace) {
    const from = explicitFrom || preservedFrom;
    if (from && from !== path) state.from = from;
    return state;
  }

  const from = explicitFrom || currentPath;
  if (from && from !== path) state.from = from;
  return state;
}

function navigate(path, options = {}) {
  const nextPath = safeNextPath(path);
  const state = navigationStateFor(nextPath, options);
  if (options.replace) {
    window.history.replaceState(state, '', nextPath);
  } else {
    window.history.pushState(state, '', nextPath);
  }
  route();
}

function getHistoryBackPath(fallback = DEFAULT_APP_PATH) {
  const state = window.history.state && typeof window.history.state === 'object'
    ? window.history.state
    : {};
  return safeOptionalPath(state.backTo || state.from) || fallback;
}

function shouldUseHistoryBack(backPath) {
  const state = window.history.state && typeof window.history.state === 'object'
    ? window.history.state
    : {};
  return window.history.length > 1 && safeOptionalPath(state.from) === backPath;
}

function getCertificateDetailBackPath(id) {
  const fallback = '/certificates';
  const backPath = getHistoryBackPath(fallback);
  const currentPath = getCurrentAppUrl();
  const normalizedId = encodeURIComponent(String(id || ''));

  if (backPath === currentPath) return fallback;
  if (backPath === `/certificates/${normalizedId}`) return fallback;
  if (backPath.startsWith(`/certificates/${normalizedId}/schedule`)) return fallback;
  return backPath;
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
  limit: 20,
  itemsById: new Map()
};

const reconciliationsState = {
  items: [],
  availability: null
};

const scheduleProfileCache = {
  item: null,
  promise: null
};

const certificateStatus = {
  NEW: { label: 'Новый', className: '' },
  REDEEMED: { label: 'Погашен', className: 'redeemed' },
  PAYMENT_PROCESSING: { label: 'В процессе оплаты', className: 'processing' },
  PAID: { label: 'Оплачен', className: 'paid' },
  new: { label: 'Новая заявка', className: '' },
  waiting: { label: 'Согласование', className: 'processing' },
  confirmed: { label: 'Записан', className: 'processing' },
  visited: { label: 'Посетил', className: 'redeemed' },
  verification: { label: 'Ожидание оплаты', className: 'processing' },
  paid: { label: 'Оплачен', className: 'paid' },
  canceled: { label: 'Отменен', className: '' }
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
  const showBack = Boolean(options.backTo || options.onBack);
  backButton.classList.toggle('hidden', !showBack);
  backButton.onclick = showBack
    ? () => {
        if (typeof options.onBack === 'function') {
          options.onBack();
          return;
        }
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

      pushPrompt.className = 'push-prompt hidden';
      pushPrompt.innerHTML = '';
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


function normalizeStatusLabel(label) {
  const value = String(label || '').trim();
  if (!value) return value;
  const normalized = value.toLowerCase();
  if (normalized === 'ожидает сверки' || normalized === 'ожидание сверки') {
    return 'Ожидает оплаты';
  }
  return value;
}

function statusHtml(statusMap, status, labelOverride = null) {
  const meta = statusMap[status] || { label: status || '—', className: '' };
  const label = normalizeStatusLabel(labelOverride || meta.label);
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
  const showScheduleButton = isNewCertificateStatus(certificate);

  return `
    <article class="card certificate-card certificate-card-clickable" data-certificate-link="/certificates/${certificate.id}" role="link" tabindex="0">
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
      ${showScheduleButton ? `
        <div class="certificate-card-actions">
          <button class="button certificate-list-action" type="button" data-certificate-schedule-id="${escapeHtml(certificate.id)}">Записать</button>
        </div>
      ` : ''}
    </article>
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


function formatProductDateTime(value) {
  const text = String(value || '').trim();
  if (!text) return '—';
  const match = text.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/);
  if (!match) return escapeHtml(text);
  return `${escapeHtml(match[1])}<br />${escapeHtml(match[2])}`;
}

function productLinkHtml(value) {
  const url = normalizeExternalUrl(value);
  if (!url) return '—';
  return `<a class="services-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Ссылка</a>`;
}

function productOpenPriceHtml(item = {}) {
  const label = String(item.openPriceLabel ?? '0').trim() || '0';
  return `
    <span class="services-open-price">
      <span>${escapeHtml(label)}</span>
      <button class="icon-button services-price-edit" type="button" data-service-price-id="${escapeHtml(item.id)}" aria-label="Изменить открытую цену">✎</button>
    </span>
  `;
}

function mobileTableRow(label, value) {
  return `<div class="mobile-table-row"><span>${escapeHtml(label)}</span><strong>${value}</strong></div>`;
}

function productDateText(value) {
  const formatted = formatProductDateTime(value);
  return String(formatted).replace('<br />', ' ');
}

function productsTable(items = []) {
  if (items.length === 0) {
    return `<div class="empty-state">Услуги не найдены.</div>`;
  }

  const rows = items.map((item) => `
    <tr>
      <td class="services-name-cell">${escapeHtml(item.name)}</td>
      <td>${formatMoney(item.priceCents)}</td>
      <td>${productOpenPriceHtml(item)}</td>
      <td>${formatProductDateTime(item.activeFrom)}</td>
      <td>${productLinkHtml(item.productLink)}</td>
      <td><button class="button services-edit-button" type="button" data-service-edit-id="${escapeHtml(item.id)}">Изменить</button></td>
    </tr>
  `).join('');

  const mobileCards = items.map((item) => `
    <article class="card payment-card table-mobile-card services-mobile-card">
      <div class="card-topline">
        <div class="card-title services-mobile-title">${escapeHtml(item.name)}</div>
        <div class="money">${formatMoney(item.priceCents)}</div>
      </div>
      <div class="dashed-line"></div>
      <div class="mobile-table-meta">
        ${mobileTableRow('Открытая цена', escapeHtml(String(item.openPriceLabel ?? '0')))}
        ${mobileTableRow('Дата начала', productDateText(item.activeFrom))}
        ${mobileTableRow('Сайт', productLinkHtml(item.productLink))}
      </div>
      <div class="services-mobile-actions">
        <button class="button services-edit-button" type="button" data-service-edit-id="${escapeHtml(item.id)}">Изменить</button>
      </div>
    </article>
  `).join('');

  return `
    <div class="table-wrapper services-table-wrapper">
      <table class="services-table">
        <thead>
          <tr>
            <th>Название</th>
            <th>Цена</th>
            <th>Открытая цена</th>
            <th>Дата начала</th>
            <th>Сайт</th>
            <th>Действия</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="mobile-cards">${mobileCards}</div>
  `;
}

function bindProductsActions() {
  const notice = document.querySelector('#servicesNotice');
  const showNotice = (message) => {
    if (!notice) return;
    notice.className = 'notice';
    notice.textContent = message;
  };

  document.querySelectorAll('[data-service-edit-id], [data-service-price-id]').forEach((button) => {
    button.addEventListener('click', () => {
      showNotice('Редактирование услуги будет подключено после описания запроса.');
    });
  });
}

async function renderServices() {
  setHeader('Услуги');
  setActiveNavigation('services');
  showLoading();

  try {
    const { items = [] } = await api('/api/services');
    app.innerHTML = `
      <div class="stack services-page">
        <div id="servicesNotice" class="notice hidden"></div>
        <section class="card table-card services-table-card">
          <div class="table-header">
            <div>
              <h2>Услуги</h2>
              <p>${items.length} ${declension(items.length, ['услуга', 'услуги', 'услуг'])}</p>
            </div>
          </div>
          ${productsTable(items)}
        </section>
      </div>
    `;
    bindProductsActions();
  } catch (error) {
    showError(error);
  }
}

function redeemInfoValue(value, fallback = '—') {
  const text = String(value ?? '').trim();
  return text ? escapeHtml(text) : escapeHtml(fallback);
}

function redeemInfoField(label, value, { full = true } = {}) {
  return `
    <div class="schedule-field ${full ? 'schedule-field-full' : ''} redeem-info-field">
      <label>${escapeHtml(label)}</label>
      <div class="redeem-info-control" role="textbox" aria-readonly="true">${redeemInfoValue(value)}</div>
    </div>
  `;
}

function getRedeemInfoEmail(item = {}) {
  if (item.customerEmail) return item.customerEmail;
  if (Array.isArray(item.customerEmails) && item.customerEmails.length > 0) return item.customerEmails[0];
  const rawEmails = item?.raw?.CONTACTS?.EMAILS;
  return Array.isArray(rawEmails) && rawEmails.length > 0 ? rawEmails[0] : '';
}

function getRedeemInfoPhone(item = {}) {
  if (item.customerPhone) return item.customerPhone;
  if (Array.isArray(item.customerPhones) && item.customerPhones.length > 0) return item.customerPhones[0];
  const rawPhones = item?.raw?.CONTACTS?.PHONES;
  return Array.isArray(rawPhones) && rawPhones.length > 0 ? rawPhones[0] : '';
}

function certificateRedeemInfoDialogHtml(item = {}) {
  const amount = item.amountLabel || formatMoney(item.amountCents);
  return `
    <div id="redeemInfoModal" class="schedule-modal redeem-info-modal" role="dialog" aria-modal="true" aria-labelledby="redeemInfoTitle">
      <button class="schedule-modal-backdrop" type="button" data-close-redeem-info aria-label="Закрыть"></button>
      <section class="schedule-panel redeem-info-panel">
        <header class="schedule-header">
          <h2 id="redeemInfoTitle">Данные сертификата</h2>
          <button class="icon-button schedule-close" type="button" data-close-redeem-info aria-label="Закрыть">×</button>
        </header>
        <div class="schedule-form redeem-info-form">
          ${redeemInfoField('Номер сертификата', item.certificateNumber)}
          ${redeemInfoField('Имя получателя', item.customerFullName)}
          ${redeemInfoField('Услуга', item.service || item.title)}
          <div class="schedule-grid-2 redeem-info-grid">
            ${redeemInfoField('Сумма', amount, { full: false })}
            ${redeemInfoField('Дата', formatDate(item.serviceDate || item.scheduleTime), { full: false })}
          </div>
          <div class="schedule-grid-2 redeem-info-grid">
            ${redeemInfoField('Email', getRedeemInfoEmail(item), { full: false })}
            ${redeemInfoField('Телефон', getRedeemInfoPhone(item), { full: false })}
          </div>
          <div id="redeemInfoNotice" class="hidden"></div>
          <div class="schedule-actions redeem-info-actions">
            <button id="redeemInfoRedeemButton" class="button schedule-submit" type="button">Погасить сертификат</button>
            <button class="button secondary schedule-cancel" type="button" data-close-redeem-info>Закрыть</button>
          </div>
        </div>
      </section>
    </div>
  `;
}

function closeRedeemInfoDialog() {
  document.querySelector('#redeemInfoModal')?.remove();
}

function openRedeemInfoDialog(item = {}, form, payload = null) {
  if (shouldUseDialogScreen()) {
    redeemInfoScreenState.item = item;
    redeemInfoScreenState.payload = payload;
    navigate('/redeem/info');
    return;
  }

  closeRedeemInfoDialog();
  document.body.insertAdjacentHTML('beforeend', certificateRedeemInfoDialogHtml(item));
  document.querySelectorAll('[data-close-redeem-info]').forEach((button) => {
    button.addEventListener('click', closeRedeemInfoDialog);
  });
  document.querySelector('#redeemInfoRedeemButton')?.addEventListener('click', () => {
    closeRedeemInfoDialog();
    if (form?.requestSubmit) form.requestSubmit();
    else form?.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  });
}

async function handleShowRedeemInfo(form, notice, button) {
  const formData = new FormData(form);
  const certificateNumber = String(formData.get('certificateNumber') || '').trim();
  const secretCode = String(formData.get('secretCode') || '').trim();

  if (notice) {
    notice.className = 'notice hidden';
    notice.textContent = '';
  }

  if (!certificateNumber || !secretCode) {
    if (notice) {
      notice.className = 'notice error';
      notice.textContent = 'Укажите номер сертификата и секретный код.';
    }
    return;
  }

  if (button) {
    button.disabled = true;
    button.textContent = 'Загрузка...';
  }

  try {
    const { item } = await api('/api/certificates/redeem/info', {
      method: 'POST',
      body: JSON.stringify({ certificateNumber, secretCode })
    });
    openRedeemInfoDialog(item, form, { certificateNumber, secretCode });
  } catch (error) {
    if (notice) {
      notice.className = 'notice error';
      notice.textContent = error.message;
    }
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = 'Показать информацию';
    }
  }
}

function declension(count, words) {
  const abs = Math.abs(Number(count)) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return words[2];
  if (last > 1 && last < 5) return words[1];
  if (last === 1) return words[0];
  return words[2];
}


function redeemInfoScreenHtml(item = {}) {
  const amount = item.amountLabel || formatMoney(item.amountCents);
  return `
    <section class="card schedule-screen-card redeem-info-screen-card">
      <header class="schedule-header schedule-screen-header">
        <h2>Данные сертификата</h2>
      </header>
      <div class="schedule-form redeem-info-form">
        ${redeemInfoField('Номер сертификата', item.certificateNumber)}
        ${redeemInfoField('Имя получателя', item.customerFullName)}
        ${redeemInfoField('Услуга', item.service || item.title)}
        <div class="schedule-grid-2 redeem-info-grid">
          ${redeemInfoField('Сумма', amount, { full: false })}
          ${redeemInfoField('Дата', formatDate(item.serviceDate || item.scheduleTime), { full: false })}
        </div>
        <div class="schedule-grid-2 redeem-info-grid">
          ${redeemInfoField('Email', getRedeemInfoEmail(item), { full: false })}
          ${redeemInfoField('Телефон', getRedeemInfoPhone(item), { full: false })}
        </div>
        <div id="redeemInfoScreenNotice" class="hidden"></div>
        <div class="schedule-actions redeem-info-actions">
          <button id="redeemInfoScreenRedeemButton" class="button schedule-submit" type="button">Погасить сертификат</button>
          <button id="redeemInfoScreenCloseButton" class="button secondary schedule-cancel" type="button">Закрыть</button>
        </div>
      </div>
    </section>
  `;
}

function renderRedeemInfoScreen() {
  setHeader('Данные сертификата', { backTo: '/redeem' });
  setActiveNavigation('redeem');

  const item = redeemInfoScreenState.item;
  const payload = redeemInfoScreenState.payload;

  if (!item || !payload) {
    app.innerHTML = `
      <section class="card pad form-card">
        <h2>Информация не загружена</h2>
        <p class="muted-text">Вернитесь на экран погашения и нажмите «Показать информацию» ещё раз.</p>
        <div class="actions">
          <button id="backToRedeem" class="button" type="button">Вернуться</button>
        </div>
      </section>
    `;
    document.querySelector('#backToRedeem')?.addEventListener('click', () => navigate('/redeem'));
    return;
  }

  app.innerHTML = redeemInfoScreenHtml(item);

  document.querySelector('#redeemInfoScreenCloseButton')?.addEventListener('click', () => navigate('/redeem'));
  document.querySelector('#redeemInfoScreenRedeemButton')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const notice = document.querySelector('#redeemInfoScreenNotice');

    if (notice) {
      notice.className = 'notice hidden';
      notice.textContent = '';
    }

    button.disabled = true;
    button.textContent = 'Погашаем...';

    try {
      const result = await api('/api/certificates/redeem', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      redeemInfoScreenState.item = null;
      redeemInfoScreenState.payload = null;
      navigate(`/certificates/${result.item.id}`);
    } catch (error) {
      if (notice) {
        notice.className = 'notice error';
        notice.textContent = error.message;
      }
      button.disabled = false;
      button.textContent = 'Погасить сертификат';
    }
  });
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
          <div class="actions redeem-actions">
            <button id="showRedeemInfo" class="button secondary" type="button">Показать информацию</button>
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
  const showInfoButton = document.querySelector('#showRedeemInfo');

  scannerButton?.addEventListener('click', openQrScanner);
  showInfoButton?.addEventListener('click', () => handleShowRedeemInfo(form, notice, showInfoButton));
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

function bindCertificateListActions(list) {
  list.querySelectorAll('[data-certificate-link]').forEach((card) => {
    const openCard = () => navigate(card.dataset.certificateLink);

    card.addEventListener('click', (event) => {
      if (event.target.closest('button, a, input, select, textarea')) return;
      openCard();
    });

    card.addEventListener('keydown', (event) => {
      if (event.target.closest('button, a, input, select, textarea')) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openCard();
      }
    });
  });

  list.querySelectorAll('[data-certificate-schedule-id]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();

      const item = certificatesListState.itemsById.get(String(button.dataset.certificateScheduleId));
      if (item) {
        openCertificateScheduleDialog(item, {
          nextPath: '/certificates',
          onSuccess: () => loadFilteredCertificates(certificatesListState.page)
        });
      }
    });
  });
}

function renderCertificatesResult(data, emptyText = 'Погашенных сертификатов пока нет.') {
  const list = document.querySelector('#certificatesList');
  const pagination = document.querySelector('#certificatesPagination');
  if (!list) return;

  const items = data.items || [];
  certificatesListState.itemsById = new Map(items.map((item) => [String(item.id), item]));

  if (items.length) {
    list.className = 'card table-card certificates-table-card';
    list.innerHTML = `
      <div class="table-header">
        <div>
          <h2>Сертификаты</h2>
        </div>
      </div>
      ${certificatesTable(items, { selectable: false, linkNumbers: true, scheduleActions: true, rowLinks: true })}
    `;
  } else {
    list.className = 'card table-card certificates-table-card';
    list.innerHTML = `<div class="empty-state">${escapeHtml(emptyText)}</div>`;
  }

  bindCertificateListActions(list);

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
                  <input type="checkbox" value="new" data-label="Новая заявка" />
                  <span class="multiselect-check" aria-hidden="true">✓</span>
                  <span>Новая заявка</span>
                </label>
                <label class="multiselect-option" role="option" aria-selected="false">
                  <input type="checkbox" value="waiting" data-label="Согласование" />
                  <span class="multiselect-check" aria-hidden="true">✓</span>
                  <span>Согласование</span>
                </label>
                <label class="multiselect-option" role="option" aria-selected="false">
                  <input type="checkbox" value="confirmed" data-label="Записан" />
                  <span class="multiselect-check" aria-hidden="true">✓</span>
                  <span>Записан</span>
                </label>
                <label class="multiselect-option" role="option" aria-selected="false">
                  <input type="checkbox" value="visited" data-label="Посетил" />
                  <span class="multiselect-check" aria-hidden="true">✓</span>
                  <span>Посетил</span>
                </label>
                <label class="multiselect-option" role="option" aria-selected="false">
                  <input type="checkbox" value="verification" data-label="Ожидание оплаты" />
                  <span class="multiselect-check" aria-hidden="true">✓</span>
                  <span>Ожидание оплаты</span>
                </label>
                <label class="multiselect-option" role="option" aria-selected="false">
                  <input type="checkbox" value="paid" data-label="Оплачен" />
                  <span class="multiselect-check" aria-hidden="true">✓</span>
                  <span>Оплачен</span>
                </label>
                <label class="multiselect-option" role="option" aria-selected="false">
                  <input type="checkbox" value="canceled" data-label="Отменен" />
                  <span class="multiselect-check" aria-hidden="true">✓</span>
                  <span>Отменен</span>
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
      <section id="certificatesList" class="card table-card certificates-table-card"><div class="loading-card">Загрузка...</div></section>
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
  if (list) {
    list.className = 'card table-card certificates-table-card';
    list.innerHTML = '<div class="loading-card">Загрузка...</div>';
  }
  if (pagination) pagination.innerHTML = '';

  try {
    const data = await api(`/api/certificates/redeemed?${params.toString()}`);
    renderCertificatesResult(data, emptyText);
  } catch (error) {
    if (list) list.innerHTML = `<div class="error-state">${escapeHtml(error.message)}</div>`;
  }
}


const CERTIFICATE_SCHEDULE_STAGE_ID = 'C2:UC_4Q05NY';

function isNewCertificateStatus(item = {}) {
  const values = [
    item.status,
    item.stageGroupId,
    item.statusLabel,
    item.stageId,
    item?.raw?.STAGE?.id,
    item?.raw?.STAGE?.group_id,
    item?.raw?.STAGE?.group_title,
    item?.raw?.STAGE_ID,
    item?.raw?.IS_NEW
  ].map((value) => String(value || '').trim().toLowerCase());

  return values.some((value) => {
    if (!value) return false;
    if (value === 'new' || value === 'новый' || value === 'новая заявка') return true;
    if (/(:|^)new$/.test(value)) return true;
    if (value === 'y') return true;
    return false;
  });
}

function decodeHtmlEntities(value) {
  const text = String(value || '');
  if (!text) return '';
  const textarea = document.createElement('textarea');
  textarea.innerHTML = text;
  return textarea.value;
}

function displayAddress(value) {
  return decodeHtmlEntities(String(value || '').split('|')[0].trim());
}

function getDateInputValue(value) {
  const match = String(value || '').match(/\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : formatDateInputValue(new Date());
}

function getTimeInputValue(value) {
  const match = String(value || '').match(/\d{2}:\d{2}/);
  return match ? match[0] : '00:00';
}

function certificateDealId(item = {}) {
  return item.externalId || item?.raw?.ID || item.id;
}

function certificateScheduleTitle(item = {}) {
  return item?.raw?.TITLE || item?.raw?.OPTIONS || item.title || '';
}

function getProfileRawAddresses(profile = {}) {
  const rawAddresses = profile?.raw?.UF_CRM_1692176867840;
  const normalizedAddresses = profile?.work?.addresses;
  const values = Array.isArray(rawAddresses) && rawAddresses.length > 0
    ? rawAddresses
    : Array.isArray(normalizedAddresses)
      ? normalizedAddresses
      : [];

  return values.map((value) => String(value || '').trim()).filter(Boolean);
}

function getCertificateAddressArray(item = {}, profile = {}) {
  const fromProfile = getProfileRawAddresses(profile);
  const candidates = [item.address, item?.raw?.ADDRESS, item?.raw?.address, ...fromProfile]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  return Array.from(new Set(candidates));
}

function getCertificateDefaultPhone(item = {}, profile = {}) {
  const contacts = item?.raw?.CONTACTS || {};
  const phones = Array.isArray(contacts.PHONES) ? contacts.PHONES : [];
  return item.customerPhone || phones[0] || profile.phone || '';
}

function certificateScheduleFormHtml(item = {}, profile = {}) {
  const addressArray = getCertificateAddressArray(item, profile);
  const selectedAddress = item.address || item?.raw?.ADDRESS || addressArray[0] || '';
  const title = certificateScheduleTitle(item);
  const date = getDateInputValue(item.serviceDate || item?.raw?.SCHEDULE_TIME || item?.raw?.ACTIVATION_DATE);
  const time = getTimeInputValue(item.serviceTime || item?.raw?.SCHEDULE_TIME);
  const phone = getCertificateDefaultPhone(item, profile);

  const addressOptions = addressArray.length > 0
    ? addressArray.map((address) => `
        <option value="${escapeHtml(address)}" ${address === selectedAddress ? 'selected' : ''}>${escapeHtml(displayAddress(address))}</option>
      `).join('')
    : '<option value="">Адрес не найден</option>';

  return `
    <form id="certificateScheduleForm" class="schedule-form">
      <div class="schedule-field schedule-field-full">
        <label for="scheduleTitle">Название услуги</label>
        <input id="scheduleTitle" name="title" value="${escapeHtml(title)}" placeholder="Название услуги" required />
      </div>

      <div class="schedule-grid-2 schedule-date-time-grid">
        <div class="schedule-field">
          <label for="scheduleDate">Дата</label>
          <input id="scheduleDate" name="date" type="date" value="${escapeHtml(date)}" required />
        </div>
        <div class="schedule-field">
          <label for="scheduleTime">Время</label>
          <input id="scheduleTime" name="time" type="time" value="${escapeHtml(time)}" required />
        </div>
      </div>

      <div class="schedule-field schedule-field-full">
        <label for="schedulePhone">Телефон для связи</label>
        <input id="schedulePhone" name="phone" value="${escapeHtml(phone)}" placeholder="+7" required />
      </div>

      <div class="schedule-field schedule-field-full">
        <label for="scheduleAddress">Адрес проведения</label>
        <select id="scheduleAddress" name="address" required>${addressOptions}</select>
      </div>

      <div class="schedule-field schedule-field-full schedule-textarea-field">
        <label for="scheduleNotes">Примечание</label>
        <textarea id="scheduleNotes" name="notes" rows="4" placeholder="Примечание"></textarea>
      </div>

      <div id="certificateScheduleNotice" class="hidden"></div>

      <div class="schedule-actions">
        <button class="button schedule-submit" type="submit">Подтвердить</button>
        <button class="button secondary schedule-cancel" type="button" data-close-schedule>Отмена</button>
      </div>
    </form>
  `;
}

function certificateScheduleDialogHtml(item = {}, profile = {}) {
  return `
    <div id="certificateScheduleModal" class="schedule-modal" role="dialog" aria-modal="true" aria-labelledby="certificateScheduleTitle">
      <button class="schedule-modal-backdrop" type="button" data-close-schedule aria-label="Закрыть"></button>
      <section class="schedule-panel">
        <header class="schedule-header">
          <h2 id="certificateScheduleTitle">Редактирование услуги</h2>
          <button class="icon-button schedule-close" type="button" data-close-schedule aria-label="Закрыть">×</button>
        </header>
        ${certificateScheduleFormHtml(item, profile)}
      </section>
    </div>
  `;
}

function closeCertificateScheduleDialog() {
  document.querySelector('#certificateScheduleModal')?.remove();
}

async function getScheduleProfile() {
  if (scheduleProfileCache.item) return scheduleProfileCache.item;
  if (!scheduleProfileCache.promise) {
    scheduleProfileCache.promise = api('/api/profile')
      .then((response) => {
        scheduleProfileCache.item = response.item || null;
        return scheduleProfileCache.item;
      })
      .catch((error) => {
        scheduleProfileCache.promise = null;
        throw error;
      });
  }
  return scheduleProfileCache.promise;
}

async function openCertificateScheduleDialog(item = {}, options = {}) {
  if (options.useScreen !== false && shouldUseDialogScreen()) {
    navigate(scheduleScreenPath(item.id, options.nextPath || `/certificates/${item.id}`));
    return;
  }

  closeCertificateScheduleDialog();
  document.body.insertAdjacentHTML('beforeend', `
    <div id="certificateScheduleModal" class="schedule-modal" role="dialog" aria-modal="true" aria-labelledby="certificateScheduleTitle">
      <button class="schedule-modal-backdrop" type="button" data-close-schedule aria-label="Закрыть"></button>
      <section class="schedule-panel schedule-panel-loading">
        <header class="schedule-header">
          <h2 id="certificateScheduleTitle">Редактирование услуги</h2>
          <button class="icon-button schedule-close" type="button" data-close-schedule aria-label="Закрыть">×</button>
        </header>
        <div class="loading-card">Загрузка данных...</div>
      </section>
    </div>
  `);

  document.querySelectorAll('[data-close-schedule]').forEach((button) => {
    button.addEventListener('click', closeCertificateScheduleDialog);
  });

  let profile = null;
  try {
    profile = await getScheduleProfile();
  } catch (_error) {
    profile = null;
  }

  closeCertificateScheduleDialog();
  document.body.insertAdjacentHTML('beforeend', certificateScheduleDialogHtml(item, profile || {}));

  document.querySelectorAll('[data-close-schedule]').forEach((button) => {
    button.addEventListener('click', closeCertificateScheduleDialog);
  });

  document.querySelector('#certificateScheduleForm')?.addEventListener('submit', (event) => {
    handleCertificateScheduleSubmit(event, item, getCertificateAddressArray(item, profile || {}), options);
  });
}

async function handleCertificateScheduleSubmit(event, item = {}, addressArray = [], options = {}) {
  event.preventDefault();
  const form = event.currentTarget;
  const notice = form.querySelector('#certificateScheduleNotice');
  const submit = form.querySelector('button[type="submit"]');
  const formData = new FormData(form);
  const date = String(formData.get('date') || '').trim();
  const time = String(formData.get('time') || '').trim();

  const payload = {
    dealId: certificateDealId(item),
    title: String(formData.get('title') || '').trim(),
    date,
    time,
    phone: String(formData.get('phone') || '').trim(),
    address: String(formData.get('address') || '').trim(),
    addressArray,
    notes: String(formData.get('notes') || ''),
    cancel: '',
    datetime: date && time ? `${date}T${time}:00` : '',
    stageId: CERTIFICATE_SCHEDULE_STAGE_ID
  };

  if (notice) {
    notice.className = 'hidden';
    notice.textContent = '';
  }
  if (submit) {
    submit.disabled = true;
    submit.textContent = 'Сохраняем...';
  }

  try {
    await api(`/api/certificates/${encodeURIComponent(item.id)}/schedule`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    closeCertificateScheduleDialog();
    if (typeof options.onSuccess === 'function') {
      await options.onSuccess();
    } else {
      await renderCertificateDetail(item.id);
    }
  } catch (error) {
    if (notice) {
      notice.className = 'notice error';
      notice.textContent = error.message;
    }
  } finally {
    if (submit) {
      submit.disabled = false;
      submit.textContent = 'Подтвердить';
    }
  }
}

async function renderCertificateScheduleScreen(id) {
  const backTo = scheduleBackPath(id);
  setHeader('Редактирование услуги', { backTo });
  setActiveNavigation('certificates');
  showLoading();

  try {
    const [{ item }, profile] = await Promise.all([
      api(`/api/certificates/${encodeURIComponent(id)}`),
      getScheduleProfile().catch(() => null)
    ]);
    const addressArray = getCertificateAddressArray(item, profile || {});

    app.innerHTML = `
      <section class="card schedule-screen-card">
        <header class="schedule-header schedule-screen-header">
          <h2>Редактирование услуги</h2>
        </header>
        ${certificateScheduleFormHtml(item, profile || {})}
      </section>
    `;

    document.querySelectorAll('[data-close-schedule]').forEach((button) => {
      button.addEventListener('click', () => navigate(backTo));
    });

    document.querySelector('#certificateScheduleForm')?.addEventListener('submit', (event) => {
      handleCertificateScheduleSubmit(event, item, addressArray, {
        onSuccess: () => navigate(backTo, { replace: true })
      });
    });
  } catch (error) {
    showError(error);
  }
}

async function renderCertificateDetail(id) {
  const backTo = getCertificateDetailBackPath(id);
  setHeader('Информация о сертификате', {
    backTo,
    onBack: () => {
      if (shouldUseHistoryBack(backTo)) {
        window.history.back();
        return;
      }
      navigate(backTo);
    }
  });
  setActiveNavigation('certificates');
  showLoading();

  try {
    const { item } = await api(`/api/certificates/${id}`);
    const showScheduleButton = isNewCertificateStatus(item);

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
          ${showScheduleButton ? `
            <div class="detail-actions detail-actions-right">
              <button id="openScheduleDialog" class="button detail-action-button" type="button">Записать</button>
            </div>
          ` : ''}
        </div>
      </section>
    `;

    document.querySelector('#openScheduleDialog')?.addEventListener('click', () => openCertificateScheduleDialog(item, {
      nextPath: `/certificates/${item.id}`
    }));
  } catch (error) {
    showError(error);
  }
}


function normalizeExternalUrl(value) {
  const url = String(value || '').trim();
  if (!url) return '';
  if (/^(https?:|mailto:|tel:)/i.test(url)) return url;
  if (url.includes('@') && !url.includes('/')) return `mailto:${url}`;
  if (/^\+?[\d\s()\-]+$/.test(url)) return `tel:${url.replace(/[^+\d]/g, '')}`;
  return `https://${url}`;
}

function profileEmpty(value = 'Не указано') {
  return `<span class="profile-empty">${escapeHtml(value)}</span>`;
}

function profileText(value, fallback = 'Не указано') {
  const text = String(value ?? '').trim();
  return text ? escapeHtml(text) : profileEmpty(fallback);
}

function profileMultilineText(value, fallback = 'Не указано') {
  const text = String(value ?? '').trim();
  if (!text) return profileEmpty(fallback);
  return escapeHtml(text).replaceAll('\n', '<br />');
}

function profileField(label, value, fallback = 'Не указано') {
  return `<div class="profile-line"><span>${escapeHtml(label)}</span><strong>${profileText(value, fallback)}</strong></div>`;
}

function profileLink(value, label = value) {
  const text = String(label || value || '').trim();
  if (!text) return '';
  const href = normalizeExternalUrl(value || text);
  return href
    ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(text)}</a>`
    : escapeHtml(text);
}

function profileInlineList(values, fallback = 'Не указано') {
  const items = Array.isArray(values) ? values.filter((value) => String(value || '').trim()) : [];
  if (items.length === 0) return profileEmpty(fallback);
  return items.map((value) => profileLink(value)).join(', ');
}

function profileBulletList(values, fallback = 'Не указано') {
  const items = Array.isArray(values) ? values.filter((value) => String(value || '').trim()) : [];
  if (items.length === 0) return profileEmpty(fallback);
  return `<ul class="profile-list">${items.map((value) => `<li>${profileMultilineText(value)}</li>`).join('')}</ul>`;
}

function profileInitials(title) {
  const words = String(title || 'Профиль').trim().split(/\s+/).filter(Boolean);
  const initials = words.slice(0, 2).map((word) => word[0]).join('').toUpperCase();
  return initials || 'WL';
}

function profileDocumentsHtml(documents = []) {
  const items = Array.isArray(documents) ? documents.filter((document) => document?.name || document?.url) : [];
  if (items.length === 0) return profileEmpty('Документы не прикреплены');

  return `<ul class="profile-documents">${items.map((document) => {
    const name = document.name || 'Документ';
    if (!document.url) return `<li>${escapeHtml(name)}</li>`;
    return `<li><a href="${escapeHtml(document.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(name)}</a></li>`;
  }).join('')}</ul>`;
}

function profileNotificationChannelsHtml(channels = []) {
  const items = Array.isArray(channels) ? channels : [];
  if (items.length === 0) return profileEmpty('Каналы не настроены');

  return `
    <div class="profile-channels">
      ${items.map((channel) => `
        <label class="profile-channel ${channel.enabled ? 'active' : ''}">
          <span class="profile-checkbox" aria-hidden="true">${channel.enabled ? '✓' : ''}</span>
          <span class="profile-channel-body">
            <strong>${escapeHtml(channel.title || '')}</strong>
            ${channel.note ? `<small>${escapeHtml(channel.note)}</small>` : ''}
          </span>
        </label>
      `).join('')}
    </div>
  `;
}

function profileSection(title, body, extraClass = '') {
  return `
    <section class="card profile-section ${extraClass}">
      <h2>${escapeHtml(title)}</h2>
      <div class="profile-section-body">${body}</div>
    </section>
  `;
}

async function renderProfile() {
  setHeader('Профиль');
  setActiveNavigation('profile');
  showLoading();

  try {
    const { item } = await api('/api/profile');
    const profile = item || {};
    const requisites = profile.requisites || {};
    const work = profile.work || {};
    const contactsBody = `
      <div class="profile-line"><span>Сайты</span><strong>${profileInlineList(profile.sites, 'Не указаны')}</strong></div>
      ${profileField('Почта', profile.email, 'Не указана')}
      ${profileField('Телефон', profile.phone, 'Не указан')}
      ${profileField('Контакт ОЛ', profile.openLineContact, 'Не указан')}
      ${profileField('Почта ОЛ', profile.openLineEmail, 'Не указана')}
      ${profileField('Телефон ОЛ', profile.openLinePhone, 'Не указан')}
      ${profileField('Локация', profile.location, 'Не указана')}
    `;
    const workItems = [];
    if (Array.isArray(work.addresses) && work.addresses.length > 0) {
      workItems.push(`<div class="profile-block-label">Адреса проведения услуг</div>${profileBulletList(work.addresses)}`);
    }
    if (work.schedule) {
      workItems.push(`<div class="profile-block-label">Рабочее время / расписание</div><p>${profileMultilineText(work.schedule)}</p>`);
    }
    if (work.cancellationPolicy) {
      workItems.push(`<div class="profile-block-label">Правила отмены</div><p>${profileMultilineText(work.cancellationPolicy)}</p>`);
    }

    const documentsBody = `
      <div class="profile-block-label">Прикрепленный договор (PDF, DOCX)</div>
      ${profileDocumentsHtml(profile.documents)}
    `;
    const requisitesBody = `
      ${profileField('Название юридического лица', requisites.legalName)}
      ${profileField('ИНН', requisites.inn)}
      ${profileField('ОГРНИП', requisites.ogrnip)}
      ${profileField('КПП', requisites.kpp)}
      ${profileField('ОГРН', requisites.ogrn)}
      ${requisites.bankName ? profileField('Банк', requisites.bankName) : ''}
      ${requisites.accountNumber ? profileField('Расчетный счет', requisites.accountNumber) : ''}
      ${requisites.bik ? profileField('БИК', requisites.bik) : ''}
    `;

    app.innerHTML = `
      <div class="profile-page">
        <section class="card profile-hero">
          <div class="profile-hero-main">
            ${profile.profilePhotoUrl
              ? `<img class="profile-avatar" src="${escapeHtml(profile.profilePhotoUrl)}" alt="" />`
              : `<div class="profile-avatar profile-avatar-fallback">${escapeHtml(profileInitials(profile.title))}</div>`}
            <div>
              <h2>${escapeHtml(profile.title || 'Профиль партнёра')}</h2>
              <p>${profileText(profile.description, 'Описание компании')}</p>
            </div>
          </div>
          <div class="profile-actions">
            <button class="button secondary" type="button" disabled>Заявка на модерацию</button>
            <button class="button secondary" type="button" disabled>Пароль</button>
          </div>
        </section>

        <div class="profile-grid">
          ${profileSection('Контакты', contactsBody)}
          ${profileSection('Канал связи для уведомлений', profileNotificationChannelsHtml(profile.notificationChannels))}
          ${profileSection('Локация и рабочее время', workItems.length ? workItems.join('') : profileEmpty('Информация не указана'))}
          ${profileSection('Документы', documentsBody)}
          ${profileSection('Финансовые реквизиты', requisitesBody)}
          ${profileSection('Дополнительная информация', profile.additionalInfo ? `<p>${profileMultilineText(profile.additionalInfo)}</p>` : profileEmpty('Информация не указана'))}
        </div>
      </div>
    `;
  } catch (error) {
    showError(error);
  }
}


function renderReconciliationsTable(items = []) {
  const container = document.querySelector('#reconciliationsTable');
  if (!container) return;

  if (items.length === 0) {
    container.innerHTML = `
      <div class="table-header">
        <div>
          <h2>Сертификаты для сверки</h2>
          <p>Нет сертификатов в статусе «Посетил».</p>
        </div>
      </div>
    `;
    return;
  }

  const tableItems = items.map((item) => ({
    ...item,
    statusLabel: null
  }));

  container.innerHTML = `
    <div class="table-header">
      <div>
        <h2>Сертификаты для сверки</h2>
      </div>
    </div>
    ${certificatesTable(tableItems, { selectable: false, linkNumbers: true })}
  `;
}


function formatReconciliationAvailabilityMessage(availability = {}) {
  if (availability.message) return String(availability.message);
  const daysLeft = Number(availability.daysLeft || 0);
  if (daysLeft > 0) {
    return `Новая сверка будет доступна через ${daysLeft} ${declension(daysLeft, ['день', 'дня', 'дней'])}`;
  }
  return 'Создание новой сверки доступно.';
}

function updateReconciliationAvailability(availability = {}, options = {}) {
  const button = document.querySelector('#createReconciliation');
  const notice = document.querySelector('#reconciliationNotice');
  const available = availability.available !== false;

  if (button) {
    button.disabled = !available;
    button.setAttribute('aria-disabled', String(!available));
  }

  if (!notice || options.keepNotice) return;

  if (!available) {
    notice.className = 'notice';
    notice.textContent = formatReconciliationAvailabilityMessage(availability);
    return;
  }

  notice.className = 'notice hidden';
  notice.textContent = '';
}

function updateReconciliationsSummary(items = []) {
  const summary = document.querySelector('#reconciliationsSummary');
  if (!summary) return;

  const totalAmountCents = items.reduce((sum, item) => sum + Number(item.amountCents || 0), 0);
  summary.innerHTML = `
    <span>Количество сертификатов в статусе &quot;Посетил&quot;: ${items.length}</span>
    <span>Сумма: ${formatMoney(totalAmountCents)}</span>
  `;
}

async function loadReconciliationsData(options = {}) {
  const notice = document.querySelector('#reconciliationNotice');
  const createButton = document.querySelector('#createReconciliation');

  const [certificatesResult, availabilityResult] = await Promise.allSettled([
    api('/api/certificates/reconciliations'),
    api('/api/certificates/reconciliations/availability')
  ]);

  if (availabilityResult.status === 'fulfilled') {
    reconciliationsState.availability = availabilityResult.value;
    updateReconciliationAvailability(availabilityResult.value, options);
  } else {
    if (createButton) createButton.disabled = true;
    if (notice && !options.keepNotice) {
      notice.className = 'notice error';
      notice.textContent = availabilityResult.reason?.message || 'Не удалось проверить доступность создания сверки.';
    }
  }

  if (certificatesResult.status === 'fulfilled') {
    const data = certificatesResult.value;
    reconciliationsState.items = data.items || [];
    updateReconciliationsSummary(reconciliationsState.items);
    renderReconciliationsTable(reconciliationsState.items);
  } else {
    const table = document.querySelector('#reconciliationsTable');
    if (table) table.innerHTML = `<div class="error-state">${escapeHtml(certificatesResult.reason?.message || 'Ошибка загрузки данных')}</div>`;
  }
}

async function createReconciliation() {
  const notice = document.querySelector('#reconciliationNotice');
  const button = document.querySelector('#createReconciliation');
  const availability = reconciliationsState.availability || {};

  if (availability.available === false) {
    if (notice) {
      notice.className = 'notice';
      notice.textContent = formatReconciliationAvailabilityMessage(availability);
    }
    return;
  }

  try {
    if (button) {
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
    }
    if (notice) {
      notice.className = 'notice';
      notice.textContent = 'Создаём сверку...';
    }

    const result = await api('/api/certificates/reconciliations', {
      method: 'POST',
      body: JSON.stringify({})
    });

    const successMessage = result.message || 'Сверка создана.';
    if (notice) {
      notice.className = 'notice';
      notice.textContent = successMessage;
    }

    await loadReconciliationsData();

    if (notice && reconciliationsState.availability?.available !== false) {
      notice.className = 'notice';
      notice.textContent = successMessage;
    }
  } catch (error) {
    if (notice) {
      notice.className = 'notice error';
      notice.textContent = error.message || 'Не удалось создать сверку.';
    }
    updateReconciliationAvailability(reconciliationsState.availability || {}, { keepNotice: true });
  } finally {
    if (button) button.removeAttribute('aria-busy');
  }
}

async function renderReconciliations() {
  setHeader('Сверки');
  setActiveNavigation('reconciliations');
  showLoading();

  app.innerHTML = `
    <div class="stack reconciliations-page">
      <section class="card summary-card">
        <div id="reconciliationsSummary" class="summary-amount">—</div>
        <button id="createReconciliation" class="button" type="button">Создать сверку</button>
      </section>
      <div id="reconciliationNotice" class="notice hidden"></div>
      <section id="reconciliationsTable" class="card table-card">
        <div class="loading-card">Загрузка...</div>
      </section>
    </div>
  `;

  const createButton = document.querySelector('#createReconciliation');
  if (createButton) {
    createButton.disabled = true;
    createButton.addEventListener('click', createReconciliation);
  }

  await loadReconciliationsData();
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
    const createActionHtml = data.source === 'wowlife'
      ? ''
      : '<a class="button" href="/payments/create">Создать заявку</a>';

    app.innerHTML = `
      <div class="stack">
        <section class="card summary-card">
          <div>
            <div class="summary-label">Общая сумма выплат за весь период:</div>
            <div class="summary-amount">${formatMoney(data.summary.totalPaidAmountCents)}</div>
          </div>
          ${createActionHtml}
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
    const canMarkPaid = item.status === 'PROCESSING' && data.source !== 'wowlife';

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
            ${item.docLink ? `<a class="doc-link" href="${escapeHtml(item.docLink)}" target="_blank" rel="noopener noreferrer">Документ по заявке</a>` : ''}
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
          ${certificatesTable(data.certificates, { selectable: false, linkNumbers: true })}
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
  const linkNumbers = Boolean(options.linkNumbers);
  const scheduleActions = Boolean(options.scheduleActions);
  const rowLinks = Boolean(options.rowLinks);

  const certificateNumberMarkup = (certificate) => {
    const number = escapeHtml(certificate.certificateNumber);
    const content = `<strong>${number}</strong>`;

    if (!linkNumbers || !certificate.id) {
      return content;
    }

    return `<a class="certificate-number-link" href="/certificates/${escapeHtml(certificate.id)}" aria-label="Открыть сертификат ${number}">${content}</a>`;
  };

  const scheduleActionMarkup = (certificate) => {
    if (!scheduleActions || !isNewCertificateStatus(certificate)) return '—';

    return `<button class="button certificate-list-action table-action-button" type="button" data-certificate-schedule-id="${escapeHtml(certificate.id)}">Записать</button>`;
  };

  const rows = certificates.map((certificate) => {
    const checkbox = selectable
      ? `<td class="checkbox-cell"><input data-certificate-checkbox type="checkbox" value="${escapeHtml(certificate.id)}" checked /></td>`
      : '';
    const rowLinkAttributes = rowLinks && certificate.id
      ? ` class="certificate-table-row" data-certificate-link="/certificates/${escapeHtml(certificate.id)}" tabindex="0" role="link"`
      : '';

    return `
      <tr${rowLinkAttributes}>
        ${checkbox}
        <td>${certificateNumberMarkup(certificate)}</td>
        <td>${escapeHtml(certificate.title)}</td>
        <td>${formatDate(certificate.serviceDate)} ${formatTime(certificate.serviceTime)}</td>
        <td>${escapeHtml(certificate.customerFullName || '—')}</td>
        <td><strong>${formatMoney(certificate.amountCents)}</strong></td>
        <td>${statusHtml(certificateStatus, certificate.status, certificate.statusLabel)}</td>
        ${scheduleActions ? `<td class="table-actions-cell">${scheduleActionMarkup(certificate)}</td>` : ''}
      </tr>
    `;
  }).join('');

  const mobileCards = certificates.map((certificate) => {
    const checkbox = selectable
      ? `<input data-certificate-checkbox type="checkbox" value="${escapeHtml(certificate.id)}" checked />`
      : '';
    const cardLinkAttributes = rowLinks && certificate.id
      ? ` data-certificate-link="/certificates/${escapeHtml(certificate.id)}" role="link" tabindex="0"`
      : '';
    const scheduleValue = `${formatDate(certificate.serviceDate)} · ${formatTime(certificate.serviceTime)}`;

    if (!selectable) {
      return `
        <article class="card payment-card table-mobile-card certificate-table-mobile-card ${rowLinks ? 'certificate-card-clickable' : ''}"${cardLinkAttributes}>
          <div class="card-topline">
            <div class="card-title">${certificateNumberMarkup(certificate)}</div>
            <div class="money">${formatMoney(certificate.amountCents)}</div>
          </div>
          <div class="dashed-line"></div>
          <div class="card-subtitle">${escapeHtml(certificate.title)}</div>
          <div class="mobile-table-meta">
            ${mobileTableRow('Запись', escapeHtml(scheduleValue))}
            ${mobileTableRow('Клиент', escapeHtml(certificate.customerFullName || '—'))}
          </div>
          <div class="status-row certificate-table-mobile-status">
            <span>Статус</span>
            ${statusHtml(certificateStatus, certificate.status, certificate.statusLabel)}
          </div>
          ${scheduleActions && isNewCertificateStatus(certificate) ? `
            <div class="certificate-card-actions">
              <button class="button certificate-list-action" type="button" data-certificate-schedule-id="${escapeHtml(certificate.id)}">Записать</button>
            </div>
          ` : ''}
        </article>
      `;
    }

    return `
      <article class="card payment-card mobile-check-card">
        <div>${checkbox}</div>
        <div>
          <div class="card-title">${certificateNumberMarkup(certificate)}</div>
          <div class="dashed-line"></div>
          <div class="card-subtitle">${escapeHtml(certificate.title)}</div>
          <div class="mobile-table-meta">
            ${mobileTableRow('Запись', escapeHtml(formatDate(certificate.serviceDate)))}
            ${mobileTableRow('Клиент', escapeHtml(certificate.customerFullName || '—'))}
          </div>
          <div class="status-row">
            <span class="money">${formatMoney(certificate.amountCents)}</span>
            ${statusHtml(certificateStatus, certificate.status, certificate.statusLabel)}
          </div>
        </div>
      </article>
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
            ${scheduleActions ? '<th>Действия</th>' : ''}
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
  const [root, id, action] = parts;

  if (!root) {
    navigate(DEFAULT_APP_PATH, { replace: true });
    return;
  }

  if (!APP_ROUTES.has(root)) {
    navigate(DEFAULT_APP_PATH, { replace: true });
    return;
  }

  if (root === 'redeem' && id === 'info') return renderRedeemInfoScreen();
  if (root === 'redeem') return renderRedeem();
  if (root === 'certificates' && id && action === 'schedule') return renderCertificateScheduleScreen(id);
  if (root === 'certificates' && id) return renderCertificateDetail(id);
  if (root === 'certificates') return renderCertificates();
  if (root === 'services') return renderServices();
  if (root === 'reconciliations') return renderReconciliations();
  if (root === 'profile') return renderProfile();
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
