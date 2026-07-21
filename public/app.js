const app = document.querySelector('#app');
const pageTitle = document.querySelector('#pageTitle');
const backButton = document.querySelector('#backButton');
const pushPrompt = document.querySelector('#pushPrompt');
const logoutButton = document.querySelector('.logout-button');
const mobileMenuButton = document.querySelector('#mobileMenuButton');
const mobileMenuCloseButton = document.querySelector('#mobileMenuCloseButton');
const mobileMenuOverlay = document.querySelector('#mobileMenuOverlay');
const desktopSidebar = document.querySelector('.sidebar');
const mobileSideMenu = document.querySelector('#mobileSideMenu');
const defaultDesktopSidebarHtml = desktopSidebar?.innerHTML || '';
const defaultMobileSideMenuHtml = mobileSideMenu?.innerHTML || '';

let currentUser = null;
let currentAdmin = null;

const authUiState = {
  method: 'password',
  codeRequested: false,
  login: '',
  password: '',
  phone: '',
  email: '',
  code: ''
};

const adminAuthUiState = {
  login: '',
  password: '',
  inviteCode: ''
};

const profilePasswordState = {
  password: ''
};

const profileModerationState = {
  name: '',
  info: '',
  file: null
};

const profileAgentReportState = {
  legalAddress: '',
  contractNumber: ''
};

const profileNotificationChannelsState = {
  channels: [],
  isEditing: false
};

const crmDataState = {
  bookingName: 'Нет данных',
  bookingUrl: '',
  authType: 'Нет данных',
  login: '',
  password: ''
};

const CRM_BOOKING_NAME_OPTIONS = ['yclients', 'dikidi Business', 'Собственная', 'Отсутствует', 'Нет данных'];
const CRM_AUTH_TYPE_OPTIONS = ['Базовый', 'Нет данных'];

const SIGN_IN_PATH = '/authentication/sign-in';
const ADMIN_SIGN_IN_PATH = '/admin/login';
const ADMIN_REGISTER_PATH = '/admin/register';
const ADMIN_PUSH_PATH = '/admin/push';
const ADMIN_PUSH_CAMPAIGNS_PATH = '/admin/push/campaigns';
const ADMIN_PUSH_DEVICES_PATH = '/admin/push/devices';
const ADMIN_PUSH_LOGS_PATH = '/admin/push/logs';
const DEFAULT_APP_PATH = '/redeem';
const PROFILE_EMPTY_REAUTH_MESSAGE = 'Сервис WOWlife profile.getProfile вернул пустой профиль. Проверьте, что текущая сессия содержит актуальные contactId/token, и войдите заново.';
const PROFILE_REAUTH_NOTICE = 'Авторизация устарела. Войдите заново, чтобы обновить данные профиля.';
const APP_ROUTES = new Set(['redeem', 'services', 'certificates', 'new-requests', 'reconciliations', 'payments', 'profile', 'crm-data']);

const MOBILE_DIALOG_QUERY = '(max-width: 680px)';
const MOBILE_SERVICES_DIALOG_QUERY = '(max-width: 920px)';

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

function shouldUseServicesDialogScreen() {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia) return window.matchMedia(MOBILE_SERVICES_DIALOG_QUERY).matches;
  return window.innerWidth <= 920;
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

function serviceDescriptionScreenPath(id, nextPath = '') {
  const normalizedId = encodeURIComponent(String(id || ''));
  const next = safeNextPath(nextPath || '/services');
  return `/services/${normalizedId}/description?next=${encodeURIComponent(next)}`;
}

function serviceCreateScreenPath(nextPath = '') {
  const next = safeNextPath(nextPath || '/services');
  return `/services/create?next=${encodeURIComponent(next)}`;
}

function serviceScreenBackPath() {
  const params = new URLSearchParams(window.location.search);
  return safeNextPath(params.get('next') || '/services');
}

function profileModerationBackPath() {
  const params = new URLSearchParams(window.location.search);
  return safeNextPath(params.get('next') || '/profile');
}

function profileAgentReportBackPath() {
  const params = new URLSearchParams(window.location.search);
  return safeNextPath(params.get('next') || '/profile');
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

function isAdminRoutePath(pathname = window.location.pathname) {
  return String(pathname || '').replace(/^\/+/, '').startsWith('admin');
}

function ensureAdminSignInPath() {
  if (window.location.pathname === ADMIN_SIGN_IN_PATH) return;
  if (window.location.pathname === ADMIN_REGISTER_PATH) return;

  const current = getCurrentAppUrl();
  const next = current && current !== '/' ? current : ADMIN_PUSH_PATH;
  window.history.replaceState({}, '', `${ADMIN_SIGN_IN_PATH}?next=${encodeURIComponent(next)}`);
}

function leaveAdminSignInPathAfterAuth() {
  if (window.location.pathname !== ADMIN_SIGN_IN_PATH && window.location.pathname !== ADMIN_REGISTER_PATH) return;

  const params = new URLSearchParams(window.location.search);
  const next = safeNextPath(params.get('next') || ADMIN_PUSH_PATH);
  window.history.replaceState({}, '', next.startsWith('/admin') ? next : ADMIN_PUSH_PATH);
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

function createHandledAuthRedirectError(message = PROFILE_REAUTH_NOTICE) {
  const error = new Error(message);
  error.handledAuthRedirect = true;
  return error;
}

function isHandledAuthRedirectError(error) {
  return Boolean(error?.handledAuthRedirect);
}

function isProfileReauthPayload(payload = {}) {
  const message = String(payload?.error || payload?.message || '').trim();
  return Boolean(payload?.reauthRequired)
    || payload?.code === 'PROFILE_REAUTH_REQUIRED'
    || message === PROFILE_EMPTY_REAUTH_MESSAGE;
}

function redirectToSignInForProfileReauth(message = PROFILE_REAUTH_NOTICE) {
  currentUser = null;
  try {
    if (typeof scheduleProfileCache !== 'undefined') {
      scheduleProfileCache.item = null;
      scheduleProfileCache.promise = null;
    }
  } catch (_error) {
    // Cache may not be initialized yet during early bootstrap.
  }
  renderSignIn(message || PROFILE_REAUTH_NOTICE);
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
  new: { label: 'Новый', className: '' },
  waiting: { label: 'Принять заявку в работу', className: 'processing' },
  confirmed: { label: 'Записан', className: 'scheduled' },
  visited: { label: 'Посетил', className: 'visited' },
  verification: { label: 'Ожидает оплаты', className: 'awaiting-payment' },
  notrepaid: { label: 'Не погашен', className: 'not-redeemed' },
  paid: { label: 'Оплачен', className: 'paid' },
  canceled: { label: 'Отменен', className: '' },
  'C2:NEW': { label: 'Новый', className: '' },
  NEW: { label: 'Новый', className: '' },
  'C2:UC_RPZ7AA': { label: 'Ожидает оплаты', className: 'awaiting-payment' },
  UC_RPZ7AA: { label: 'Ожидает оплаты', className: 'awaiting-payment' },
  'C2:8': { label: 'Не погашен', className: 'not-redeemed' },
  '8': { label: 'Не погашен', className: 'not-redeemed' },
  'C2:UC_ZRY3C1': { label: 'Посетил', className: 'visited' },
  UC_ZRY3C1: { label: 'Посетил', className: 'visited' },
  'C2:UC_M7SHZP': { label: 'Записан', className: 'scheduled' },
  UC_M7SHZP: { label: 'Записан', className: 'scheduled' }
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

function openMobileMenu() {
  if (!mobileMenuOverlay || !mobileMenuButton) return;
  mobileMenuOverlay.classList.add('open');
  mobileMenuOverlay.setAttribute('aria-hidden', 'false');
  mobileMenuButton.setAttribute('aria-expanded', 'true');
  document.body.classList.add('mobile-menu-open');
}

function closeMobileMenu() {
  if (!mobileMenuOverlay || !mobileMenuButton) return;
  mobileMenuOverlay.classList.remove('open');
  mobileMenuOverlay.setAttribute('aria-hidden', 'true');
  mobileMenuButton.setAttribute('aria-expanded', 'false');
  document.body.classList.remove('mobile-menu-open');
}

function showLoading() {
  const template = document.querySelector('#loadingTemplate');
  app.replaceChildren(template.content.cloneNode(true));
}

function showError(error) {
  if (isHandledAuthRedirectError(error)) return;
  app.innerHTML = `<div class="error-state">${escapeHtml(error.message || 'Ошибка загрузки данных')}</div>`;
}

async function api(path, options = {}) {
  const { skipAuthRedirect = false, ...requestOptions } = options;
  const response = await fetch(path, {
    credentials: 'same-origin',
    cache: requestOptions.cache || 'no-store',
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      ...(requestOptions.headers || {})
    },
    ...requestOptions
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const errorMessage = payload.error || 'Ошибка запроса';
    const shouldHandleAdminAuthError = response.status === 401
      && path.startsWith('/api/admin')
      && !skipAuthRedirect
      && !['/api/admin/me', '/api/admin/sign-in', '/api/admin/register'].includes(path);

    if (shouldHandleAdminAuthError) {
      currentAdmin = null;
      renderAdminSignIn('Сессия администратора истекла. Войдите снова.');
      throw createHandledAuthRedirectError(errorMessage);
    }

    if (!skipAuthRedirect && isProfileReauthPayload(payload)) {
      redirectToSignInForProfileReauth(PROFILE_REAUTH_NOTICE);
      throw createHandledAuthRedirectError(errorMessage);
    }

    if (response.status === 401 && !path.startsWith('/api/auth') && !skipAuthRedirect) {
      currentUser = null;
      renderSignIn('Сессия истекла. Войдите снова.');
      throw createHandledAuthRedirectError(errorMessage);
    }

    throw new Error(errorMessage);
  }

  return payload;
}

function setAuthMode(isAuthenticated) {
  document.body.classList.toggle('is-login', !isAuthenticated);
  document.body.classList.toggle('is-authenticated', isAuthenticated);
}

function setAdminMode(isAdmin) {
  document.body.classList.toggle('is-admin', Boolean(isAdmin));
  document.body.classList.toggle('is-login', !isAdmin);
  document.body.classList.toggle('is-authenticated', Boolean(isAdmin));
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
  document.body.classList.remove('is-admin', 'is-admin-auth');
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

  const contact = authUiState.method === 'sms'
    ? normalizeAuthPhoneContact(value)
    : String(value || '').trim().toLowerCase();

  if (!contact) {
    if (notice) {
      notice.className = 'notice error';
      notice.textContent = authUiState.method === 'sms'
        ? 'Введите корректный телефон, чтобы получить код.'
        : 'Введите корректный email, чтобы получить код.';
    }
    return;
  }

  if (authUiState.method === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)) {
    if (notice) {
      notice.className = 'notice error';
      notice.textContent = 'Введите корректный email, чтобы получить код.';
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
        authMethod: authUiState.method,
        [authUiState.method === 'sms' ? 'phone' : 'email']: value,
        contact
      })
    });

    if (authUiState.method === 'sms') {
      authUiState.phone = formatAuthPhoneMask(contact);
    } else {
      authUiState.email = contact;
    }
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

  if (['sms', 'email'].includes(authUiState.method) && !authUiState.code) {
    notice.className = 'notice error';
    notice.textContent = authUiState.method === 'sms' ? 'Введите код из SMS.' : 'Введите код из email.';
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
    } else if (authUiState.method === 'email') {
      payload.contact = String(payload.email || authUiState.email || '').trim().toLowerCase();
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
  if (isAdminRoutePath() || currentAdmin) {
    await signOutAdmin();
    return;
  }

  try {
    await api('/api/auth/sign-out', { method: 'POST' });
  } catch (_error) {
    // Даже если сервер недоступен, очищаем состояние интерфейса.
  }

  currentUser = null;
  renderSignIn();
}


function adminAuthFieldsHtml({ register = false } = {}) {
  return `
    <div class="auth-input-stack">
      <label>
        <span>Логин администратора</span>
        <input
          name="login"
          type="text"
          autocomplete="username"
          placeholder="admin"
          value="${escapeHtml(adminAuthUiState.login)}"
          required
        />
      </label>
      <label>
        <span>Пароль</span>
        <span class="auth-password-field">
          <input
            id="adminPasswordInput"
            name="password"
            type="password"
            autocomplete="${register ? 'new-password' : 'current-password'}"
            placeholder="••••••"
            value="${escapeHtml(adminAuthUiState.password)}"
            required
          />
          <button class="auth-password-toggle" type="button" aria-controls="adminPasswordInput" aria-label="Показать пароль">
            ${passwordVisibilityIconSvg(false)}
          </button>
        </span>
      </label>
      ${register ? `
        <label>
          <span>Invite-код</span>
          <input
            name="inviteCode"
            type="text"
            autocomplete="one-time-code"
            placeholder="my-invite код"
            value="${escapeHtml(adminAuthUiState.inviteCode)}"
            required
          />
        </label>
      ` : ''}
      <button class="button auth-submit" type="submit">${register ? 'Зарегистрироваться' : 'Войти'}</button>
    </div>
  `;
}

function storeAdminAuthFormValues(form = document.querySelector('#adminAuthForm')) {
  if (!form) return;
  const formData = new FormData(form);
  ['login', 'password', 'inviteCode'].forEach((fieldName) => {
    if (formData.has(fieldName)) {
      adminAuthUiState[fieldName] = String(formData.get(fieldName) || '').trim();
    }
  });
}

function renderAdminAuthScreen({ register = false, message = '' } = {}) {
  if (register && window.location.pathname !== ADMIN_REGISTER_PATH) {
    window.history.replaceState({}, '', ADMIN_REGISTER_PATH);
  }
  if (!register) ensureAdminSignInPath();

  setAdminMode(false);
  document.body.classList.add('is-admin-auth');
  setHeader(register ? 'Регистрация администратора' : 'Вход администратора');
  setActiveNavigation('');
  stopQrScanner({ keepModalOpen: false });
  if (pushPrompt) {
    pushPrompt.className = 'push-prompt hidden';
    pushPrompt.innerHTML = '';
  }

  app.innerHTML = `
    <section class="auth-screen auth-screen-wakesurf admin-auth-screen">
      <div class="auth-brand-panel" aria-hidden="true">
        <img src="/assets/wowlife-logo.svg" alt="" />
      </div>

      <div class="auth-panel">
        <div class="auth-panel-inner">
          <div class="auth-heading">
            <img class="auth-mobile-logo" src="/assets/wowlife-logo.svg" alt="" />
            <h1>${register ? 'Регистрация администратора' : 'Панель администратора'}</h1>
            <p>${register ? 'Создайте администратора по invite-коду' : 'Войдите по логину и паролю администратора'}</p>
          </div>

          <form id="adminAuthForm" class="auth-form auth-form-wakesurf">
            <div id="adminAuthNotice" class="${message ? 'notice error' : 'hidden'}">${escapeHtml(message)}</div>
            ${adminAuthFieldsHtml({ register })}
          </form>
          <p class="admin-auth-helper">
            ${register
              ? `Уже есть доступ? <a href="${ADMIN_SIGN_IN_PATH}">Войти в админку</a>`
              : `<a href="${ADMIN_REGISTER_PATH}">Зарегистрироваться по invite-коду</a>`
            }
          </p>
        </div>
      </div>
    </section>
  `;

  const form = document.querySelector('#adminAuthForm');
  form?.querySelector('.auth-password-toggle')?.addEventListener('click', (event) => {
    const button = event.currentTarget;
    const input = document.querySelector('#adminPasswordInput');
    if (!input) return;
    const shouldShow = input.type === 'password';
    input.type = shouldShow ? 'text' : 'password';
    button.innerHTML = passwordVisibilityIconSvg(shouldShow);
    button.setAttribute('aria-label', shouldShow ? 'Скрыть пароль' : 'Показать пароль');
    button.classList.toggle('is-visible', shouldShow);
  });
  form?.addEventListener('submit', register ? handleAdminRegisterSubmit : handleAdminSignInSubmit);
}

function renderAdminSignIn(message = '') {
  renderAdminAuthScreen({ register: false, message });
}

function renderAdminRegister(message = '') {
  renderAdminAuthScreen({ register: true, message });
}

async function handleAdminSignInSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector('button[type="submit"]');
  const notice = form.querySelector('#adminAuthNotice');
  storeAdminAuthFormValues(form);

  submit.disabled = true;
  submit.textContent = 'Входим...';
  notice.className = 'hidden';
  notice.textContent = '';

  try {
    const result = await api('/api/admin/sign-in', {
      method: 'POST',
      skipAuthRedirect: true,
      body: JSON.stringify({
        login: adminAuthUiState.login,
        password: adminAuthUiState.password
      })
    });
    currentAdmin = result.user;
    setAdminMode(true);
    document.body.classList.remove('is-admin-auth');
    leaveAdminSignInPathAfterAuth();
    route();
  } catch (error) {
    notice.className = 'notice error';
    notice.textContent = error.message;
  } finally {
    submit.disabled = false;
    submit.textContent = 'Войти';
  }
}

async function handleAdminRegisterSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector('button[type="submit"]');
  const notice = form.querySelector('#adminAuthNotice');
  storeAdminAuthFormValues(form);

  submit.disabled = true;
  submit.textContent = 'Создаём...';
  notice.className = 'hidden';
  notice.textContent = '';

  try {
    const result = await api('/api/admin/register', {
      method: 'POST',
      skipAuthRedirect: true,
      body: JSON.stringify({
        login: adminAuthUiState.login,
        password: adminAuthUiState.password,
        inviteCode: adminAuthUiState.inviteCode
      })
    });
    currentAdmin = result.user;
    setAdminMode(true);
    document.body.classList.remove('is-admin-auth');
    navigate(ADMIN_PUSH_PATH, { replace: true });
  } catch (error) {
    notice.className = 'notice error';
    notice.textContent = error.message;
  } finally {
    submit.disabled = false;
    submit.textContent = 'Зарегистрироваться';
  }
}

async function initializeAdminAuth() {
  showLoading();
  try {
    const result = await api('/api/admin/me', { skipAuthRedirect: true });
    currentAdmin = result.user;
    setAdminMode(true);
    document.body.classList.remove('is-admin-auth');
    leaveAdminSignInPathAfterAuth();
    route();
    return true;
  } catch (_error) {
    currentAdmin = null;
    if (window.location.pathname === ADMIN_REGISTER_PATH) {
      renderAdminRegister();
    } else {
      renderAdminSignIn();
    }
    return false;
  }
}

async function signOutAdmin() {
  try {
    await api('/api/admin/sign-out', { method: 'POST' });
  } catch (_error) {
    // Even if API is unavailable, reset local admin state.
  }

  currentAdmin = null;
  renderAdminSignIn();
}

function adminStatCard(label, value) {
  return `
    <article class="admin-stat-card">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value ?? 0)}</strong>
    </article>
  `;
}

function adminNavigationItems() {
  return [
    { href: ADMIN_PUSH_PATH, label: 'Новая рассылка' },
    { href: ADMIN_PUSH_CAMPAIGNS_PATH, label: 'Таблица рассылок' },
    { href: ADMIN_PUSH_DEVICES_PATH, label: 'Подписанные устройства' },
    { href: ADMIN_PUSH_LOGS_PATH, label: 'Лог подписок' }
  ];
}

function adminNavigationLinksHtml(activePath = ADMIN_PUSH_PATH, attributeName = 'data-admin-route') {
  return adminNavigationItems().map((item) => `
    <a class="${item.href === activePath ? 'active' : ''}" href="${item.href}" ${attributeName}="${item.href}">
      ${escapeHtml(item.label)}
    </a>
  `).join('');
}

function adminDesktopSidebarHtml(activePath = ADMIN_PUSH_PATH) {
  return `
    <a class="brand admin-brand" href="${ADMIN_PUSH_PATH}" aria-label="WowLife">
      <img src="/assets/wowlife-logo.svg" alt="WowLife" />
    </a>
    <nav class="desktop-nav admin-desktop-nav" aria-label="Навигация администратора">
      ${adminNavigationLinksHtml(activePath)}
    </nav>
  `;
}

function adminMobileSideMenuHtml(activePath = ADMIN_PUSH_PATH) {
  return `
    <div class="mobile-side-menu-header">
      <img src="/assets/wowlife-logo.svg" alt="WowLife" />
      <button id="mobileMenuCloseButton" class="icon-button mobile-menu-close" type="button" aria-label="Закрыть меню" data-mobile-menu-close>×</button>
    </div>
    <nav class="mobile-side-nav admin-mobile-side-nav" aria-label="Мобильное меню администратора">
      ${adminNavigationLinksHtml(activePath)}
    </nav>
  `;
}

function resetAppNavigation() {
  if (desktopSidebar && desktopSidebar.innerHTML !== defaultDesktopSidebarHtml) {
    desktopSidebar.innerHTML = defaultDesktopSidebarHtml;
  }
  if (mobileSideMenu && mobileSideMenu.innerHTML !== defaultMobileSideMenuHtml) {
    mobileSideMenu.innerHTML = defaultMobileSideMenuHtml;
  }
}

function setAdminLayout(activePath = ADMIN_PUSH_PATH) {
  setAdminMode(true);
  if (desktopSidebar) desktopSidebar.innerHTML = adminDesktopSidebarHtml(activePath);
  if (mobileSideMenu) mobileSideMenu.innerHTML = adminMobileSideMenuHtml(activePath);
}

function adminShellHtml(_activePath, contentHtml) {
  return `
    <div class="admin-shell">
      <div class="admin-shell-content">
        ${contentHtml}
      </div>
    </div>
  `;
}

function adminProfileIdsText(item) {
  const ids = Array.isArray(item.profileIds) && item.profileIds.length > 0
    ? item.profileIds
    : [item.profileId].filter(Boolean);
  return ids.length > 0 ? ids.join(', ') : '—';
}

function adminMobileCardHtml({ title, meta = '', badge = '', rows = [], subtitle = '' } = {}) {
  const rowsHtml = rows
    .filter((row) => row && row.label)
    .map((row) => mobileTableRow(row.label, row.value ?? '—'))
    .join('');

  return `
    <article class="card payment-card table-mobile-card admin-mobile-card">
      <div class="card-topline admin-mobile-card-topline">
        <div>
          <div class="card-title admin-mobile-card-title">${title || '—'}</div>
          ${meta ? `<p class="admin-mobile-card-meta">${meta}</p>` : ''}
        </div>
        ${badge ? `<div class="admin-mobile-card-badge">${badge}</div>` : ''}
      </div>
      ${subtitle ? `<p class="card-subtitle admin-mobile-card-subtitle">${subtitle}</p>` : ''}
      <div class="dashed-line"></div>
      <div class="mobile-table-meta">${rowsHtml}</div>
    </article>
  `;
}

function adminDeviceStatusHtml(item = {}) {
  return statusHtml(certificateStatus, item.isActive ? 'paid' : 'canceled', item.isActive ? 'Активна' : 'Отключена');
}

function adminInstalledText(item = {}) {
  return item.installed ? 'PWA установлено' : 'Браузер';
}

function adminPermissionText(value) {
  const permission = String(value || '').trim();
  if (!permission) return '—';
  if (permission === 'granted') return 'Разрешено';
  if (permission === 'denied') return 'Запрещено';
  if (permission === 'default') return 'Не выбрано';
  return escapeHtml(permission);
}

function adminEventText(value) {
  return value === 'unsubscribe' ? 'Отписка' : 'Подписка';
}

function adminDevicesTable(items = []) {
  if (!items.length) return '<div class="empty-state compact">Подписанных устройств пока нет.</div>';

  const desktopRows = items.map((item) => `
    <tr>
      <td>${escapeHtml(adminProfileIdsText(item))}</td>
      <td>${escapeHtml(item.userName || item.userEmail || item.userId || '—')}</td>
      <td>${escapeHtml(item.platform || 'PWA')}</td>
      <td>${adminDeviceStatusHtml(item)}</td>
      <td>${escapeHtml(formatDateTime(item.lastSeenAt || item.createdAt))}</td>
    </tr>
  `).join('');

  const mobileCards = items.map((item) => adminMobileCardHtml({
    title: escapeHtml(adminProfileIdsText(item)),
    meta: 'Профиль партнёра',
    badge: adminDeviceStatusHtml(item),
    rows: [
      { label: 'Пользователь', value: escapeHtml(item.userName || item.userEmail || item.userId || '—') },
      { label: 'Устройство', value: escapeHtml(item.platform || 'PWA') },
      { label: 'Тип', value: escapeHtml(adminInstalledText(item)) },
      { label: 'Разрешение', value: adminPermissionText(item.permission) },
      { label: 'Последняя активность', value: escapeHtml(formatDateTime(item.lastSeenAt || item.createdAt)) },
      { label: 'Дата подписки', value: escapeHtml(formatDateTime(item.subscribedAt || item.createdAt)) }
    ]
  })).join('');

  return `
    <div class="table-wrapper admin-push-table">
      <table>
        <thead>
          <tr>
            <th>Профиль</th>
            <th>Пользователь</th>
            <th>Устройство</th>
            <th>Статус</th>
            <th>Последняя активность</th>
          </tr>
        </thead>
        <tbody>${desktopRows}</tbody>
      </table>
    </div>
    <div class="mobile-cards admin-mobile-cards">${mobileCards}</div>
  `;
}

function adminLogsTable(items = []) {
  if (!items.length) return '<div class="empty-state compact">Лог подписок пока пуст.</div>';

  const desktopRows = items.map((item) => `
    <tr>
      <td>${escapeHtml(adminEventText(item.eventType))}</td>
      <td>${escapeHtml(adminProfileIdsText(item))}</td>
      <td>${escapeHtml(item.userName || item.userEmail || item.userId || '—')}</td>
      <td>${escapeHtml(item.platform || 'PWA')}</td>
      <td>${escapeHtml(formatDateTime(item.createdAt))}</td>
    </tr>
  `).join('');

  const mobileCards = items.map((item) => adminMobileCardHtml({
    title: escapeHtml(adminEventText(item.eventType)),
    meta: escapeHtml(formatDateTime(item.createdAt)),
    badge: statusHtml(certificateStatus, item.eventType === 'unsubscribe' ? 'canceled' : 'paid', adminEventText(item.eventType)),
    rows: [
      { label: 'Профиль', value: escapeHtml(adminProfileIdsText(item)) },
      { label: 'Пользователь', value: escapeHtml(item.userName || item.userEmail || item.userId || '—') },
      { label: 'Устройство', value: escapeHtml(item.platform || 'PWA') },
      { label: 'Тип', value: escapeHtml(adminInstalledText(item)) },
      { label: 'Разрешение', value: adminPermissionText(item.permission) }
    ]
  })).join('');

  return `
    <div class="table-wrapper admin-push-table">
      <table>
        <thead>
          <tr>
            <th>Событие</th>
            <th>Профиль</th>
            <th>Пользователь</th>
            <th>Устройство</th>
            <th>Дата</th>
          </tr>
        </thead>
        <tbody>${desktopRows}</tbody>
      </table>
    </div>
    <div class="mobile-cards admin-mobile-cards">${mobileCards}</div>
  `;
}


function adminCampaignProfilesText(item) {
  const ids = Array.isArray(item.profileIds) ? item.profileIds.filter(Boolean) : [];
  return ids.length > 0 ? ids.join(', ') : 'Все профили';
}

function adminCampaignStatusHtml(status) {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'error') return statusHtml(certificateStatus, 'notrepaid', 'Ошибка');
  return statusHtml(certificateStatus, 'paid', 'Успешно');
}

function adminCampaignFiltersFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return {
    dateFrom: params.get('dateFrom') || '',
    dateTo: params.get('dateTo') || '',
    status: params.get('status') || '',
    search: params.get('search') || '',
    profileId: params.get('profileId') || ''
  };
}

function adminCampaignFiltersQuery(filters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    const normalized = String(value || '').trim();
    if (normalized) params.set(key, normalized);
  });
  return params.toString();
}

function adminCampaignResultText(item) {
  return `${Number(item.sent || 0)} успешно / ${Number(item.failed || 0)} ошибка / ${Number(item.total || 0)} всего`;
}

function adminCampaignsTable(items = []) {
  if (!items.length) return '<div class="empty-state compact">Рассылок по заданным фильтрам не найдено.</div>';

  const desktopRows = items.map((item) => `
    <tr>
      <td>${escapeHtml(formatDateTime(item.createdAt))}</td>
      <td>
        <strong>${escapeHtml(item.title || '—')}</strong>
        <small>${escapeHtml(item.body || '—')}</small>
      </td>
      <td>${escapeHtml(adminCampaignProfilesText(item))}</td>
      <td>${adminCampaignStatusHtml(item.status)}</td>
      <td>${escapeHtml(adminCampaignResultText(item))}</td>
    </tr>
  `).join('');

  const mobileCards = items.map((item) => adminMobileCardHtml({
    title: escapeHtml(item.title || '—'),
    meta: escapeHtml(formatDateTime(item.createdAt)),
    badge: adminCampaignStatusHtml(item.status),
    subtitle: escapeHtml(item.body || '—'),
    rows: [
      { label: 'ID профилей', value: escapeHtml(adminCampaignProfilesText(item)) },
      { label: 'Результат', value: escapeHtml(adminCampaignResultText(item)) },
      { label: 'Ссылка', value: escapeHtml(item.url || '—') },
      { label: 'Установленные PWA', value: item.installedOnly ? 'Да' : 'Нет' }
    ]
  })).join('');

  return `
    <div class="table-wrapper admin-push-table admin-campaigns-table">
      <table>
        <thead>
          <tr>
            <th>Дата</th>
            <th>Текст рассылки</th>
            <th>ID профилей</th>
            <th>Статус PUSH</th>
            <th>Результат</th>
          </tr>
        </thead>
        <tbody>${desktopRows}</tbody>
      </table>
    </div>
    <div class="mobile-cards admin-mobile-cards">${mobileCards}</div>
  `;
}

function adminCampaignFiltersHtml(filters = {}) {
  return `
    <form id="adminCampaignFiltersForm" class="admin-campaign-filters">
      <label>
        <span>Дата С</span>
        <input name="dateFrom" type="date" value="${escapeHtml(filters.dateFrom || '')}" />
      </label>
      <label>
        <span>Дата По</span>
        <input name="dateTo" type="date" value="${escapeHtml(filters.dateTo || '')}" />
      </label>
      <label>
        <span>Статус рассылки</span>
        <select name="status">
          <option value="" ${!filters.status ? 'selected' : ''}>Все статусы</option>
          <option value="success" ${filters.status === 'success' ? 'selected' : ''}>Успешно</option>
          <option value="error" ${filters.status === 'error' ? 'selected' : ''}>Ошибка</option>
        </select>
      </label>
      <label>
        <span>Поиск по тексту</span>
        <input name="search" type="search" value="${escapeHtml(filters.search || '')}" placeholder="Заголовок или текст" />
      </label>
      <label>
        <span>ID профиля</span>
        <input name="profileId" type="text" inputmode="numeric" value="${escapeHtml(filters.profileId || '')}" placeholder="301" />
      </label>
      <div class="admin-campaign-filter-actions">
        <button class="button" type="submit">Найти</button>
        <button id="adminCampaignFiltersReset" class="button secondary" type="button">Сбросить</button>
      </div>
    </form>
  `;
}

async function renderAdminPush() {
  if (!currentAdmin) {
    return renderAdminSignIn();
  }

  setAdminLayout(ADMIN_PUSH_PATH);
  document.body.classList.remove('is-admin-auth');
  setHeader('Панель администратора');
  setActiveNavigation('');
  showLoading();

  try {
    const data = await api('/api/admin/push/summary');
    const summary = data.summary || {};
    app.innerHTML = adminShellHtml(ADMIN_PUSH_PATH, `
      <div class="stack admin-push-screen admin-new-broadcast-screen">
        <section class="card pad admin-push-hero">
          <div>
            <p class="eyebrow">PUSH уведомления</p>
            <h2>Новая рассылка</h2>
            <p>Отправляйте уведомления всем подписанным устройствам или только партнёрам с указанными ID профилей.</p>
          </div>
          <div class="admin-hero-actions">
            <button id="adminSignOutButton" class="button secondary" type="button">Выйти</button>
          </div>
        </section>

        <section class="admin-stat-grid">
          ${adminStatCard('Всего устройств', summary.total)}
          ${adminStatCard('Активных', summary.active)}
          ${adminStatCard('PWA активных', summary.installed_active)}
          ${adminStatCard('Профилей', summary.active_profiles)}
        </section>

        <section class="card pad admin-broadcast-card">
          <div class="table-header">
            <div>
              <h2>Новая PUSH-рассылка</h2>
              <p>Оставьте ID профилей пустыми, чтобы отправить всем подписанным PWA-устройствам.</p>
            </div>
          </div>
          <form id="adminPushForm" class="admin-push-form">
            <div class="form-grid two">
              <label>
                <span>Заголовок</span>
                <input name="title" type="text" value="WowLife" required />
              </label>
              <label>
                <span>Ссылка при клике</span>
                <input name="url" type="text" value="/profile" placeholder="/profile" />
              </label>
            </div>
            <label>
              <span>Текст уведомления</span>
              <textarea name="body" rows="4" placeholder="Текст PUSH уведомления" required></textarea>
            </label>
            <label>
              <span>ID профилей партнёров</span>
              <textarea name="profileIdsText" rows="3" placeholder="301, 4457, 584"></textarea>
            </label>
            <label class="checkbox-inline admin-installed-only">
              <input name="installedOnly" type="checkbox" checked />
              <span>Отправлять только установленным PWA мобильным версиям</span>
            </label>
            <div id="adminPushNotice" class="hidden"></div>
            <button class="button" type="submit">Отправить PUSH</button>
          </form>
        </section>
      </div>
    `);

    document.querySelector('#adminSignOutButton')?.addEventListener('click', signOutAdmin);
    document.querySelector('#adminPushForm')?.addEventListener('submit', handleAdminPushBroadcastSubmit);
  } catch (error) {
    showError(error);
  }
}

async function renderAdminPushDevices() {
  if (!currentAdmin) {
    return renderAdminSignIn();
  }

  setAdminLayout(ADMIN_PUSH_DEVICES_PATH);
  document.body.classList.remove('is-admin-auth');
  setHeader('Панель администратора');
  setActiveNavigation('');
  showLoading();

  try {
    const data = await api('/api/admin/push/summary');
    const summary = data.summary || {};
    app.innerHTML = adminShellHtml(ADMIN_PUSH_DEVICES_PATH, `
      <div class="stack admin-push-screen admin-devices-screen">
        <section class="card pad admin-push-hero">
          <div>
            <p class="eyebrow">PUSH уведомления</p>
            <h2>Подписанные устройства</h2>
            <p>Активные подписки с ID профилей компаний и данными мобильных PWA-устройств.</p>
          </div>
          <div class="admin-hero-actions">
            <button id="adminSignOutButton" class="button secondary" type="button">Выйти</button>
          </div>
        </section>

        <section class="admin-stat-grid">
          ${adminStatCard('Всего устройств', summary.total)}
          ${adminStatCard('Активных', summary.active)}
          ${adminStatCard('PWA активных', summary.installed_active)}
          ${adminStatCard('Профилей', summary.active_profiles)}
        </section>

        <section class="card table-card admin-push-list-card">
          <div class="table-header">
            <div>
              <h2>Подписанные устройства</h2>
              <p>Последние активные подписки с ID профилей компаний.</p>
            </div>
          </div>
          ${adminDevicesTable(data.subscriptions || [])}
        </section>
      </div>
    `);

    document.querySelector('#adminSignOutButton')?.addEventListener('click', signOutAdmin);
  } catch (error) {
    showError(error);
  }
}

async function renderAdminPushLogs() {
  if (!currentAdmin) {
    return renderAdminSignIn();
  }

  setAdminLayout(ADMIN_PUSH_LOGS_PATH);
  document.body.classList.remove('is-admin-auth');
  setHeader('Панель администратора');
  setActiveNavigation('');
  showLoading();

  try {
    const data = await api('/api/admin/push/summary');
    app.innerHTML = adminShellHtml(ADMIN_PUSH_LOGS_PATH, `
      <div class="stack admin-push-screen admin-subscription-logs-screen">
        <section class="card pad admin-push-hero">
          <div>
            <p class="eyebrow">PUSH уведомления</p>
            <h2>Лог подписок</h2>
            <p>История подписок и отписок по профилям, пользователям и устройствам.</p>
          </div>
          <div class="admin-hero-actions">
            <button id="adminSignOutButton" class="button secondary" type="button">Выйти</button>
          </div>
        </section>

        <section class="card table-card admin-push-list-card">
          <div class="table-header">
            <div>
              <h2>Лог подписок</h2>
              <p>Кто и с какого профиля подписался на PUSH уведомления.</p>
            </div>
          </div>
          ${adminLogsTable(data.logs || [])}
        </section>
      </div>
    `);

    document.querySelector('#adminSignOutButton')?.addEventListener('click', signOutAdmin);
  } catch (error) {
    showError(error);
  }
}

async function renderAdminPushCampaigns() {
  if (!currentAdmin) {
    return renderAdminSignIn();
  }

  setAdminLayout(ADMIN_PUSH_CAMPAIGNS_PATH);
  document.body.classList.remove('is-admin-auth');
  setHeader('Панель администратора');
  setActiveNavigation('');
  showLoading();

  const filters = adminCampaignFiltersFromUrl();
  const query = adminCampaignFiltersQuery(filters);

  try {
    const data = await api(`/api/admin/push/campaigns${query ? `?${query}` : ''}`);
    app.innerHTML = adminShellHtml(ADMIN_PUSH_CAMPAIGNS_PATH, `
      <div class="stack admin-push-screen admin-campaigns-screen">
        <section class="card pad admin-push-hero">
          <div>
            <h2>Таблица рассылок</h2>
            <p>Проверяйте, каким профилям была отправка, и отслеживайте статус PUSH уведомления.</p>
          </div>
          <div class="admin-hero-actions">
            <button id="adminSignOutButton" class="button secondary" type="button">Выйти</button>
          </div>
        </section>

        <section class="card pad admin-campaign-filters-card">
          <div class="table-header">
            <div>
              <h2>Фильтры</h2>
              <p>Можно выбрать период, статус, найти рассылку по тексту или ID профиля.</p>
            </div>
          </div>
          ${adminCampaignFiltersHtml(filters)}
        </section>

        <section class="card table-card admin-push-list-card">
          <div class="table-header">
            <div>
              <h2>Рассылки</h2>
              <p>Статус «Ошибка» отображается, если хотя бы одно PUSH уведомление не доставлено.</p>
            </div>
          </div>
          ${adminCampaignsTable(data.items || [])}
        </section>
      </div>
    `);

    document.querySelector('#adminSignOutButton')?.addEventListener('click', signOutAdmin);
    document.querySelector('#adminCampaignFiltersForm')?.addEventListener('submit', handleAdminCampaignFiltersSubmit);
    document.querySelector('#adminCampaignFiltersReset')?.addEventListener('click', () => navigate(ADMIN_PUSH_CAMPAIGNS_PATH));
  } catch (error) {
    showError(error);
  }
}

function handleAdminCampaignFiltersSubmit(event) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  const query = adminCampaignFiltersQuery({
    dateFrom: formData.get('dateFrom'),
    dateTo: formData.get('dateTo'),
    status: formData.get('status'),
    search: formData.get('search'),
    profileId: formData.get('profileId')
  });
  navigate(`${ADMIN_PUSH_CAMPAIGNS_PATH}${query ? `?${query}` : ''}`);
}

async function handleAdminPushBroadcastSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector('button[type="submit"]');
  const notice = form.querySelector('#adminPushNotice');
  const formData = new FormData(form);

  submit.disabled = true;
  submit.textContent = 'Отправляем...';
  notice.className = 'hidden';
  notice.textContent = '';

  try {
    const result = await api('/api/admin/push/broadcast', {
      method: 'POST',
      body: JSON.stringify({
        title: String(formData.get('title') || '').trim(),
        body: String(formData.get('body') || '').trim(),
        url: String(formData.get('url') || '').trim() || '/profile',
        profileIdsText: String(formData.get('profileIdsText') || '').trim(),
        installedOnly: formData.has('installedOnly')
      })
    });
    notice.className = 'notice success';
    notice.textContent = `Отправлено: ${result.sent || 0}. Ошибок: ${result.failed || 0}. Получателей: ${result.total || 0}.`;
    await renderAdminPush();
  } catch (error) {
    notice.className = 'notice error';
    notice.textContent = error.message;
  } finally {
    submit.disabled = false;
    submit.textContent = 'Отправить PUSH';
  }
}


let pushRegistration = null;
let pushPublicKeyPayload = null;

const PROFILE_BROADCAST_NOTIFICATION = {
  title: 'WowLife',
  body: 'WowLife на связи!',
  url: '/profile',
  icon: '/assets/pwa-icon-192.png',
  badge: '/assets/pwa-badge-96.png',
  tag: 'wowlife-profile-broadcast'
};

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
  if (isMobileViewport()) {
    renderPushPrompt();
  } else {
    renderPushPrompt('PUSH уведомления включены для этого ярлыка.', 'success');
  }

  return true;
}

async function ensureProfileNotificationPermission() {
  if (!isPushSupported()) {
    renderPushPrompt('PUSH не поддерживаются на этом устройстве или страница открыта не по HTTPS.', 'error');
    return false;
  }

  if (!isStandaloneApp() && isMobileViewport()) {
    renderPushPrompt('PUSH доступны после запуска приложения из ярлыка.', 'error');
    return false;
  }

  if (Notification.permission === 'default') {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      renderPushPrompt('Разрешение на PUSH не выдано. Уведомления приходить не будут.', 'error');
      return false;
    }
  }

  if (Notification.permission !== 'granted') {
    renderPushPrompt('PUSH уведомления запрещены в настройках браузера или телефона.', 'error');
    return false;
  }

  return true;
}

async function showProfileLocalNotification() {
  const registration = await getServiceWorkerRegistration();
  const notificationOptions = {
    body: PROFILE_BROADCAST_NOTIFICATION.body,
    icon: PROFILE_BROADCAST_NOTIFICATION.icon,
    badge: PROFILE_BROADCAST_NOTIFICATION.badge,
    tag: PROFILE_BROADCAST_NOTIFICATION.tag,
    renotify: true,
    data: {
      url: PROFILE_BROADCAST_NOTIFICATION.url
    }
  };

  if (typeof registration.showNotification === 'function') {
    await registration.showNotification(PROFILE_BROADCAST_NOTIFICATION.title, notificationOptions);
    return;
  }

  new Notification(PROFILE_BROADCAST_NOTIFICATION.title, notificationOptions);
}

async function sendProfileBroadcastNotification() {
  let serverPushError = null;

  if (isStandaloneApp() && isPushSupported()) {
    const permissionGranted = await ensureProfileNotificationPermission();
    if (permissionGranted) {
      try {
        await ensurePushSubscription({ requestPermission: false });
      } catch (error) {
        serverPushError = error;
      }
    }
  }

  try {
    const result = await api('/api/push/profile-broadcast', {
      method: 'POST',
      body: JSON.stringify({})
    });

    if (Number(result.sent || 0) > 0) {
      renderPushPrompt(`PUSH рассылка отправлена. Получателей: ${result.sent}.`, 'success');
      return true;
    }
  } catch (error) {
    serverPushError = error;
  }

  const permissionGranted = await ensureProfileNotificationPermission();
  if (!permissionGranted) return false;

  await showProfileLocalNotification();
  renderPushPrompt(
    serverPushError
      ? 'Серверная рассылка недоступна. Уведомление отправлено на это устройство.'
      : 'PUSH уведомление отправлено на это устройство.',
    'success'
  );
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
      if (installed && isMobileViewport()) {
        pushPrompt.className = 'push-prompt hidden';
        pushPrompt.innerHTML = '';
        return;
      }

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

document.addEventListener('click', async (event) => {
  const button = event.target.closest('#profileBroadcastButton');
  if (!button) return;

  const initialText = button.textContent;
  button.disabled = true;
  button.textContent = 'Отправляю...';

  try {
    await sendProfileBroadcastNotification();
  } catch (error) {
    renderPushPrompt(error.message || 'Не удалось отправить PUSH уведомление.', 'error');
  } finally {
    button.disabled = false;
    button.textContent = initialText;
  }
});


function normalizeStatusLabel(label) {
  const value = String(label || '').trim();
  if (!value) return value;
  const normalized = value.toLowerCase();
  if (normalized === 'ожидает сверки' || normalized === 'ожидание сверки') {
    return 'Ожидает оплаты';
  }
  if (normalized === 'согласование') {
    return 'Принять заявку в работу';
  }
  const normalizedForCompare = normalized.replace(/ё/g, 'е');
  if (normalizedForCompare === 'c2:new' || normalizedForCompare === 'new' || normalizedForCompare === 'новый') {
    return 'Новый';
  }
  if (normalizedForCompare.includes('uc_rpz7aa') || normalizedForCompare === 'verification') {
    return 'Ожидает оплаты';
  }
  if (normalizedForCompare === 'c2:8' || normalizedForCompare === 'notrepaid') {
    return 'Не погашен';
  }
  if (normalizedForCompare.includes('uc_zry3c1') || normalizedForCompare === 'visited') {
    return 'Посетил';
  }
  if (normalizedForCompare.includes('uc_m7shzp') || normalizedForCompare === 'confirmed') {
    return 'Записан';
  }
  if (['подтвержден', 'подтержден', 'подтверждено', 'подтерждено'].includes(normalizedForCompare)) {
    return 'Записан';
  }
  if (['погашен', 'погашено'].includes(normalizedForCompare)) {
    return 'Посетил';
  }
  if (['не погашен', 'не погашено', 'непогашен', 'непогашено'].includes(normalizedForCompare)) {
    return 'Не погашен';
  }
  return value;
}

function findStatusMeta(statusMap, status) {
  const value = String(status || '').trim();
  if (!value) return { label: '—', className: '' };
  if (statusMap[value]) return statusMap[value];
  const caseInsensitiveKey = Object.keys(statusMap).find((key) => key.toLowerCase() === value.toLowerCase());
  if (caseInsensitiveKey) return statusMap[caseInsensitiveKey];
  return { label: value, className: '' };
}

function statusHtml(statusMap, status, labelOverride = null) {
  const meta = findStatusMeta(statusMap, status);
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
          <button class="button certificate-list-action" type="button" data-certificate-accept-id="${escapeHtml(certificate.id)}">Принять в работу</button>
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
  return `<span class="services-open-price">${escapeHtml(label)}</span>`;
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
      <td><button class="button services-edit-button" type="button" data-service-edit-id="${escapeHtml(item.id)}" data-service-name="${escapeHtml(item.name)}" data-service-contact-id="${escapeHtml(item.partnerId || '')}">Изменить</button></td>
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
        <button class="button services-edit-button" type="button" data-service-edit-id="${escapeHtml(item.id)}" data-service-name="${escapeHtml(item.name)}" data-service-contact-id="${escapeHtml(item.partnerId || '')}">Изменить</button>
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

function serviceDescriptionFormHtml(item = {}, { noticeId = 'serviceDescriptionNotice', formId = 'serviceDescriptionForm' } = {}) {
  return `
    <form id="${escapeHtml(formId)}" class="schedule-form service-description-form" novalidate>
      <div class="schedule-field schedule-field-full">
        <label for="serviceDescriptionText">Описание для заявки</label>
        <textarea id="serviceDescriptionText" name="description" rows="5" placeholder="Введите описание"></textarea>
        <p class="service-description-helper">При сохранении к описанию автоматически добавится название услуги.</p>
      </div>
      <div id="${escapeHtml(noticeId)}" class="hidden"></div>
      <div class="schedule-actions service-description-actions">
        <button class="button secondary schedule-cancel" type="button" data-close-service-description>Отмена</button>
        <button class="button schedule-submit" type="submit">Сохранить</button>
      </div>
    </form>
  `;
}

function serviceDescriptionDialogHtml(item = {}) {
  const serviceName = String(item.name || 'Услуга').trim() || 'Услуга';
  return `
    <div id="serviceDescriptionModal" class="schedule-modal service-description-modal" role="dialog" aria-modal="true" aria-labelledby="serviceDescriptionTitle">
      <button class="schedule-modal-backdrop" type="button" data-close-service-description aria-label="Закрыть"></button>
      <section class="schedule-panel service-description-panel">
        <header class="schedule-header">
          <div>
            <h2 id="serviceDescriptionTitle">Редактирование описания</h2>
            <p class="service-description-subtitle">${escapeHtml(serviceName)}</p>
          </div>
          <button class="icon-button schedule-close" type="button" data-close-service-description aria-label="Закрыть">×</button>
        </header>
        ${serviceDescriptionFormHtml(item)}
      </section>
    </div>
  `;
}

function serviceCreateFormHtml({ noticeId = 'serviceCreateNotice', formId = 'serviceCreateForm' } = {}) {
  return `
    <form id="${escapeHtml(formId)}" class="schedule-form service-create-form" novalidate>
      <div class="schedule-field schedule-field-full">
        <label for="serviceCreateName">Название товара</label>
        <input id="serviceCreateName" name="productName" placeholder="Название товара" autocomplete="off" required />
      </div>
      <div class="schedule-field schedule-field-full">
        <label for="serviceCreatePrice">Цена</label>
        <input id="serviceCreatePrice" name="price" inputmode="decimal" placeholder="Цена" autocomplete="off" required />
      </div>
      <div class="schedule-field schedule-field-full">
        <label for="serviceCreateDescription">Описание</label>
        <textarea id="serviceCreateDescription" name="description" rows="5" placeholder="Описание" required></textarea>
      </div>
      <div id="${escapeHtml(noticeId)}" class="hidden"></div>
      <div class="schedule-actions service-create-actions">
        <button class="button secondary schedule-cancel" type="button" data-close-service-create>Отмена</button>
        <button class="button schedule-submit service-create-submit" type="submit">Отправить заявку</button>
      </div>
    </form>
  `;
}

function serviceCreateDialogHtml() {
  return `
    <div id="serviceCreateModal" class="schedule-modal service-create-modal" role="dialog" aria-modal="true" aria-labelledby="serviceCreateTitle">
      <button class="schedule-modal-backdrop" type="button" data-close-service-create aria-label="Закрыть"></button>
      <section class="schedule-panel service-create-panel">
        <header class="schedule-header">
          <h2 id="serviceCreateTitle">Заявка на новый товар</h2>
          <button class="icon-button schedule-close" type="button" data-close-service-create aria-label="Закрыть">×</button>
        </header>
        ${serviceCreateFormHtml()}
      </section>
    </div>
  `;
}

function closeServiceDescriptionDialog() {
  document.querySelector('#serviceDescriptionModal')?.remove();
}

function closeServiceCreateDialog() {
  document.querySelector('#serviceCreateModal')?.remove();
}

function showServicesNotice(message, type = 'info') {
  const notice = document.querySelector('#servicesNotice');
  if (!notice) return;
  notice.className = type === 'error' ? 'notice error' : 'notice';
  notice.textContent = message;
}

function openServiceDescriptionDialog(item = {}) {
  if (shouldUseServicesDialogScreen()) {
    navigate(serviceDescriptionScreenPath(item.id, '/services'));
    return;
  }

  closeServiceDescriptionDialog();
  document.body.insertAdjacentHTML('beforeend', serviceDescriptionDialogHtml(item));

  document.querySelectorAll('[data-close-service-description]').forEach((button) => {
    button.addEventListener('click', closeServiceDescriptionDialog);
  });

  const textarea = document.querySelector('#serviceDescriptionText');
  if (textarea) textarea.focus();

  document.querySelector('#serviceDescriptionForm')?.addEventListener('submit', (event) => {
    handleServiceDescriptionSubmit(event, item);
  });
}

function openServiceCreateDialog() {
  if (shouldUseServicesDialogScreen()) {
    navigate(serviceCreateScreenPath('/services'));
    return;
  }

  closeServiceCreateDialog();
  document.body.insertAdjacentHTML('beforeend', serviceCreateDialogHtml());

  document.querySelectorAll('[data-close-service-create]').forEach((button) => {
    button.addEventListener('click', closeServiceCreateDialog);
  });

  const input = document.querySelector('#serviceCreateName');
  if (input) input.focus();

  document.querySelector('#serviceCreateForm')?.addEventListener('submit', handleServiceCreateSubmit);
}

async function handleServiceDescriptionSubmit(event, item = {}, options = {}) {
  event.preventDefault();
  const form = event.currentTarget;
  const notice = form.querySelector('#serviceDescriptionNotice, #serviceDescriptionScreenNotice');
  const textarea = form.querySelector('#serviceDescriptionText');
  const submit = form.querySelector('[type="submit"]');
  const description = String(textarea?.value || '').trim();

  if (!description) {
    if (notice) {
      notice.className = 'notice error';
      notice.textContent = 'Введите описание для заявки на модерацию.';
    }
    textarea?.focus();
    return;
  }

  if (submit) {
    submit.disabled = true;
    submit.textContent = 'Сохраняем...';
  }

  try {
    await api(`/api/services/${encodeURIComponent(item.id)}/description`, {
      method: 'POST',
      body: JSON.stringify({
        description,
        productName: item.name,
        partnerId: item.partnerId,
        contactId: item.partnerId
      })
    });
    closeServiceDescriptionDialog();
    if (typeof options.onSuccess === 'function') {
      await options.onSuccess();
    } else {
      showServicesNotice('Заявка на модерацию товара отправлена.');
    }
  } catch (error) {
    if (notice) {
      notice.className = 'notice error';
      notice.textContent = error.message || 'Не удалось сохранить описание.';
    }
  } finally {
    if (submit) {
      submit.disabled = false;
      submit.textContent = 'Сохранить';
    }
  }
}

async function handleServiceCreateSubmit(event, options = {}) {
  event.preventDefault();
  const form = event.currentTarget;
  const notice = form.querySelector('#serviceCreateNotice, #serviceCreateScreenNotice');
  const submit = form.querySelector('[type="submit"]');
  const formData = new FormData(form);
  const productName = String(formData.get('productName') || '').trim();
  const price = String(formData.get('price') || '').trim();
  const description = String(formData.get('description') || '').trim();

  if (notice) {
    notice.className = 'hidden';
    notice.textContent = '';
  }

  if (!productName || !price || !description) {
    if (notice) {
      notice.className = 'notice error';
      notice.textContent = 'Заполните название товара, цену и описание.';
    }
    const firstEmpty = !productName ? '#serviceCreateName' : !price ? '#serviceCreatePrice' : '#serviceCreateDescription';
    form.querySelector(firstEmpty)?.focus();
    return;
  }

  if (submit) {
    submit.disabled = true;
    submit.textContent = 'Отправляем...';
  }

  try {
    await api('/api/services/create', {
      method: 'POST',
      body: JSON.stringify({ productName, price, description })
    });
    closeServiceCreateDialog();
    if (typeof options.onSuccess === 'function') {
      await options.onSuccess();
    } else {
      showServicesNotice('Заявка на новый товар отправлена.');
    }
  } catch (error) {
    if (notice) {
      notice.className = 'notice error';
      notice.textContent = error.message || 'Не удалось отправить заявку на новый товар.';
    }
  } finally {
    if (submit) {
      submit.disabled = false;
      submit.textContent = 'Отправить заявку';
    }
  }
}

function bindProductsActions(items = []) {
  const itemsById = new Map(items.map((item) => [String(item.id), item]));

  document.querySelector('#createServiceButton')?.addEventListener('click', openServiceCreateDialog);

  document.querySelectorAll('[data-service-edit-id]').forEach((button) => {
    button.addEventListener('click', () => {
      const itemId = String(button.dataset.serviceEditId || '');
      const item = itemsById.get(itemId) || {
        id: itemId,
        name: button.dataset.serviceName || 'Услуга',
        partnerId: button.dataset.serviceContactId || ''
      };
      openServiceDescriptionDialog(item);
    });
  });
}

async function getServiceItemById(id) {
  const { items = [] } = await api('/api/services');
  return items.find((item) => String(item.id) === String(id)) || null;
}

async function renderServiceDescriptionScreen(id) {
  const backTo = serviceScreenBackPath();
  setHeader('Редактирование описания', { backTo });
  setActiveNavigation('services');
  showLoading();

  try {
    const item = await getServiceItemById(id);
    if (!item) {
      app.innerHTML = `
        <section class="card pad form-card">
          <h2>Услуга не найдена</h2>
          <p class="muted-text">Вернитесь к списку услуг и попробуйте открыть редактирование ещё раз.</p>
          <div class="actions">
            <button id="backToServices" class="button" type="button">Вернуться</button>
          </div>
        </section>
      `;
      document.querySelector('#backToServices')?.addEventListener('click', () => navigate(backTo));
      return;
    }

    app.innerHTML = `
      <section class="card schedule-screen-card service-dialog-screen-card">
        <header class="schedule-header schedule-screen-header">
          <div>
            <h2>Редактирование описания</h2>
            <p class="service-description-subtitle">${escapeHtml(item.name || 'Услуга')}</p>
          </div>
        </header>
        ${serviceDescriptionFormHtml(item, { noticeId: 'serviceDescriptionScreenNotice' })}
      </section>
    `;

    document.querySelectorAll('[data-close-service-description]').forEach((button) => {
      button.addEventListener('click', () => navigate(backTo));
    });

    document.querySelector('#serviceDescriptionForm')?.addEventListener('submit', (event) => {
      handleServiceDescriptionSubmit(event, item, {
        onSuccess: () => navigate(backTo, { replace: true })
      });
    });
  } catch (error) {
    showError(error);
  }
}

function renderServiceCreateScreen() {
  const backTo = serviceScreenBackPath();
  setHeader('Заявка на новый товар', { backTo });
  setActiveNavigation('services');

  app.innerHTML = `
    <section class="card schedule-screen-card service-dialog-screen-card service-create-screen-card">
      <header class="schedule-header schedule-screen-header">
        <h2>Заявка на новый товар</h2>
      </header>
      ${serviceCreateFormHtml({ noticeId: 'serviceCreateScreenNotice' })}
    </section>
  `;

  document.querySelectorAll('[data-close-service-create]').forEach((button) => {
    button.addEventListener('click', () => navigate(backTo));
  });

  document.querySelector('#serviceCreateForm')?.addEventListener('submit', (event) => {
    handleServiceCreateSubmit(event, {
      onSuccess: () => navigate(backTo, { replace: true })
    });
  });

  document.querySelector('#serviceCreateName')?.focus();
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
          <div class="table-header services-table-header">
            <div>
              <h2>Услуги</h2>
              <p>${items.length} ${declension(items.length, ['услуга', 'услуги', 'услуг'])}</p>
            </div>
            <div class="services-header-actions">
              <button id="createServiceButton" class="button services-create-button" type="button">Создать услугу</button>
            </div>
          </div>
          ${productsTable(items)}
        </section>
      </div>
    `;
    bindProductsActions(items);
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


async function acceptCertificateWork(button, item, options = {}) {
  if (!button || !item?.id) return;
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = 'Отправляем...';

  try {
    await api(`/api/certificates/${encodeURIComponent(item.id)}/accept-work`, {
      method: 'POST',
      body: JSON.stringify({
        dealId: item.externalId || item.id,
        stageId: 'C2:NEW'
      })
    });

    if (typeof options.onSuccess === 'function') {
      await options.onSuccess();
    } else if (item.id) {
      await renderCertificateDetail(item.id);
    }
  } catch (error) {
    alert(error.message || 'Не удалось принять сертификат в работу.');
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

function bindCertificateListActions(list, options = {}) {
  const reloadList = typeof options.onSuccess === 'function'
    ? options.onSuccess
    : () => loadFilteredCertificates(certificatesListState.page);
  const nextPath = options.nextPath || '/certificates';
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

  list.querySelectorAll('[data-certificate-accept-id]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();

      const item = certificatesListState.itemsById.get(String(button.dataset.certificateAcceptId));
      if (item) {
        acceptCertificateWork(button, item, {
          onSuccess: reloadList
        });
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
          nextPath,
          onSuccess: reloadList
        });
      }
    });
  });
}

function renderCertificatesResult(data, emptyText = 'Погашенных сертификатов пока нет.', options = {}) {
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
          <h2>${escapeHtml(options.title || 'Сертификаты')}</h2>
        </div>
      </div>
      ${certificatesTable(items, { selectable: false, linkNumbers: true, scheduleActions: true, rowLinks: true })}
    `;
  } else {
    list.className = 'card table-card certificates-table-card';
    list.innerHTML = `<div class="empty-state">${escapeHtml(emptyText)}</div>`;
  }

  bindCertificateListActions(list, options);

  if (pagination) {
    pagination.innerHTML = certificatesPaginationHtml(data.pagination);
    pagination.querySelectorAll('[data-page]').forEach((button) => {
      button.addEventListener('click', () => {
        const page = Number(button.dataset.page || 1);
        if (Number.isFinite(page) && page > 0) {
          const loadPage = typeof options.onPage === 'function' ? options.onPage : loadFilteredCertificates;
          loadPage(page);
        }
      });
    });
  }
}

async function renderCertificates() {
  setHeader('Сертификаты');
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
                  <input type="checkbox" value="new" data-label="Новый" />
                  <span class="multiselect-check" aria-hidden="true">✓</span>
                  <span>Новый</span>
                </label>
                <label class="multiselect-option" role="option" aria-selected="false">
                  <input type="checkbox" value="waiting" data-label="Принять заявку в работу" />
                  <span class="multiselect-check" aria-hidden="true">✓</span>
                  <span>Принять заявку в работу</span>
                </label>
                <label class="multiselect-option" role="option" aria-selected="false">
                  <input type="checkbox" value="confirmed" data-label="Записан" />
                  <span class="multiselect-check" aria-hidden="true">✓</span>
                  <span>Записан</span>
                </label>
                <label class="multiselect-option" role="option" aria-selected="false">
                  <input type="checkbox" value="visited" data-label="Посетил / Погашен" />
                  <span class="multiselect-check" aria-hidden="true">✓</span>
                  <span>Посетил / Погашен</span>
                </label>
                <label class="multiselect-option" role="option" aria-selected="false">
                  <input type="checkbox" value="notrepaid" data-label="Не погашен" />
                  <span class="multiselect-check" aria-hidden="true">✓</span>
                  <span>Не погашен</span>
                </label>
                <label class="multiselect-option" role="option" aria-selected="false">
                  <input type="checkbox" value="verification" data-label="Ожидает оплаты" />
                  <span class="multiselect-check" aria-hidden="true">✓</span>
                  <span>Ожидает оплаты</span>
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


async function renderNewRequests() {
  setHeader('Новые заявки');
  setActiveNavigation('new-requests');
  showLoading();
  certificatesListState.page = 1;

  app.innerHTML = `
    <div class="stack">
      <div class="card pad filters-card">
        <div class="filters certificate-filters">
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
          <button id="applyNewRequestsFilters" class="button filter-apply certificate-apply-button" type="button">Применить</button>
        </div>
      </div>
      <section id="certificatesList" class="card table-card certificates-table-card"><div class="loading-card">Загрузка...</div></section>
      <div id="certificatesPagination"></div>
    </div>
  `;

  document.querySelector('#applyNewRequestsFilters')?.addEventListener('click', () => loadNewRequests(1));
  await loadNewRequests(1);
}

async function loadNewRequests(page = 1, emptyText = 'Новых заявок пока нет.') {
  const params = new URLSearchParams();
  const from = document.querySelector('#fromFilter')?.value || '';
  const to = document.querySelector('#toFilter')?.value || '';

  certificatesListState.page = page;
  params.append('status', 'new');
  params.append('status', 'waiting');
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
    const data = await api(`/api/certificates/new-requests?${params.toString()}`);
    renderCertificatesResult(data, emptyText, {
      title: 'Новые заявки',
      nextPath: '/new-requests',
      onSuccess: () => loadNewRequests(certificatesListState.page),
      onPage: loadNewRequests
    });
  } catch (error) {
    if (list) list.innerHTML = `<div class="error-state">${escapeHtml(error.message)}</div>`;
  }
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
        <select id="scheduleAddress" name="address">${addressOptions}</select>
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
      <section class="card detail-card certificate-detail-card">
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
              <button id="acceptCertificateWorkButton" class="button detail-action-button" type="button">Принять в работу</button>
              <button id="openScheduleDialog" class="button detail-action-button" type="button">Записать</button>
            </div>
          ` : ''}
        </div>
      </section>
    `;

    document.querySelector('#acceptCertificateWorkButton')?.addEventListener('click', (event) => {
      acceptCertificateWork(event.currentTarget, item, {
        onSuccess: () => renderCertificateDetail(item.id)
      });
    });

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

function profileRequisiteItemHtml(requisite = {}, index = 0, showTitle = false) {
  const rows = [
    profileField('Название юридического лица', requisite.legalName),
    profileField('ИНН', requisite.inn),
    profileField('ОГРНИП', requisite.ogrnip),
    profileField('КПП', requisite.kpp),
    profileField('ОГРН', requisite.ogrn),
    requisite.bankName ? profileField('Банк', requisite.bankName) : '',
    requisite.accountNumber ? profileField('Расчетный счет', requisite.accountNumber) : '',
    profileField('Корр. счет', requisite.correspondentAccount),
    requisite.bik ? profileField('БИК', requisite.bik) : ''
  ].filter(Boolean).join('');

  return `
    <div class="profile-requisite-item">
      ${showTitle ? `<div class="profile-block-label">Реквизиты ${index + 1}</div>` : ''}
      ${rows}
    </div>
  `;
}

function profileRequisitesHtml(requisites = {}) {
  const items = Array.isArray(requisites.items) && requisites.items.length > 0
    ? requisites.items
    : [requisites];

  return items.map((item, index) => (
    profileRequisiteItemHtml(item, index, items.length > 1)
  )).join('') || profileEmpty('Реквизиты не указаны');
}

function notificationLink(url, label, extraAttrs = '') {
  return `<a href="${escapeHtml(url)}" ${extraAttrs} rel="noopener noreferrer">${escapeHtml(label)}</a>`;
}

function profileNotificationChannelNoteHtml(channel = {}) {
  const note = String(channel.note || '');
  if (!note) return '';

  const channelKey = String(channel.id || channel.title || '').trim().toLowerCase();

  if (channelKey === 'max' || channelKey === 'tg') {
    const botUrl = channelKey === 'max'
      ? 'https://max.ru/id471610095635_1_bot'
      : 'https://t.me/wowlifepartner_bot';
    const linkText = 'нужно написать в бот';
    const linkStart = note.indexOf(linkText);

    if (linkStart >= 0) {
      const before = note.slice(0, linkStart);
      const after = note.slice(linkStart + linkText.length);

      return `${escapeHtml(before)}${notificationLink(botUrl, linkText, 'target="_blank"')}${escapeHtml(after)}`;
    }
  }

  if (channelKey === 'email') {
    return escapeHtml(note)
      .replace(
        '@wowlifepartners',
        notificationLink('https://t.me/wowlifepartners', '@wowlifepartners', 'target="_blank"')
      )
      .replace(
        'oplata@wowlife.club',
        notificationLink('mailto:oplata@wowlife.club', 'oplata@wowlife.club')
      );
  }

  return escapeHtml(note);
}

function profileNotificationChannelKey(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return '';
  if (['telegram', 'телеграм', 'тг'].includes(normalized)) return 'tg';
  if (['mail', 'e-mail', 'email', 'почта'].includes(normalized)) return 'email';
  if (normalized === 'max' || normalized === 'макс') return 'max';
  if (['whatsapp', 'wa', 'ватсап', 'вацап', 'вотсап'].includes(normalized)) return 'wa';
  if (normalized === 'sms' || normalized === 'смс') return 'sms';
  return normalized.replace(/[^a-zа-я0-9]/gi, '');
}

function profileNotificationChannelPayloadName(channel = {}) {
  const key = profileNotificationChannelKey(channel.id || channel.title || channel.name);
  const names = {
    max: 'Max',
    wa: 'WA',
    tg: 'TG',
    sms: 'SMS',
    email: 'email'
  };
  return names[key] || String(channel.title || channel.id || '').trim();
}

function cloneProfileNotificationChannels(channels = []) {
  return (Array.isArray(channels) ? channels : []).map((channel) => ({
    ...channel,
    enabled: Boolean(channel?.enabled)
  }));
}

function updateProfileNotificationChannelsState(channels = []) {
  profileNotificationChannelsState.channels = cloneProfileNotificationChannels(channels);
  profileNotificationChannelsState.isEditing = false;
}

function profileNotificationChannelsActionHtml(isEditing = false) {
  if (isEditing) {
    return '<button id="profileNotificationChannelsSaveButton" class="button secondary profile-notification-channels-action" type="submit" form="profileNotificationChannelsForm">Сохранить</button>';
  }

  return '<button id="profileNotificationChannelsEditButton" class="button secondary profile-notification-channels-action" type="button">Изменить</button>';
}

function profileNotificationChannelsHtml(channels = [], options = {}) {
  const items = Array.isArray(channels) ? channels : [];
  if (items.length === 0) return profileEmpty('Каналы не настроены');

  const editable = Boolean(options.editable);
  const listHtml = `
    <div class="profile-channels ${editable ? 'profile-channels-editing' : ''}">
      ${items.map((channel, index) => {
        const key = profileNotificationChannelKey(channel.id || channel.title || channel.name) || `channel-${index}`;
        const title = channel.title || channel.name || channel.id || '';
        const inputId = `profileNotificationChannel-${key}`;
        const activeClass = channel.enabled ? 'active' : '';
        const noteHtml = channel.note ? `<small>${profileNotificationChannelNoteHtml(channel)}</small>` : '';

        if (editable) {
          return `
            <div class="profile-channel profile-channel-editable ${activeClass}">
              <input
                id="${escapeHtml(inputId)}"
                class="profile-channel-input"
                type="checkbox"
                name="channels"
                value="${escapeHtml(profileNotificationChannelPayloadName(channel))}"
                ${channel.enabled ? 'checked' : ''}
                aria-label="${escapeHtml(title)}"
              />
              <label class="profile-channel-body" for="${escapeHtml(inputId)}">
                <strong>${escapeHtml(title)}</strong>
                ${noteHtml}
              </label>
            </div>
          `;
        }

        return `
          <label class="profile-channel ${activeClass}">
            <span class="profile-checkbox" aria-hidden="true">${channel.enabled ? '✓' : ''}</span>
            <span class="profile-channel-body">
              <strong>${escapeHtml(title)}</strong>
              ${noteHtml}
            </span>
          </label>
        `;
      }).join('')}
    </div>
  `;

  if (!editable) return listHtml;

  return `
    <form id="profileNotificationChannelsForm" class="profile-notification-channels-form" novalidate>
      ${listHtml}
      <div id="profileNotificationChannelsNotice" class="hidden"></div>
    </form>
  `;
}

function updateProfileNotificationChannelsSection() {
  const card = document.querySelector('.profile-notification-channels-card');
  if (!card) return false;

  const action = card.querySelector('.profile-notification-channels-action');
  const body = card.querySelector('.profile-section-body');
  if (action) action.outerHTML = profileNotificationChannelsActionHtml(profileNotificationChannelsState.isEditing);
  if (body) {
    body.innerHTML = profileNotificationChannelsHtml(profileNotificationChannelsState.channels, {
      editable: profileNotificationChannelsState.isEditing
    });
  }
  setupProfileNotificationChannelsPanel();
  return true;
}

async function handleProfileNotificationChannelsSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const notice = form.querySelector('#profileNotificationChannelsNotice');
  const submit = document.querySelector('#profileNotificationChannelsSaveButton');
  const checkedValues = Array.from(form.querySelectorAll('input[name="channels"]:checked'))
    .map((input) => String(input.value || '').trim())
    .filter(Boolean);
  const selectedKeys = new Set(checkedValues.map(profileNotificationChannelKey).filter(Boolean));

  profileNotificationChannelsState.channels = profileNotificationChannelsState.channels.map((channel) => ({
    ...channel,
    enabled: selectedKeys.has(profileNotificationChannelKey(channel.id || channel.title || channel.name))
  }));

  if (notice) {
    notice.className = 'hidden';
    notice.textContent = '';
  }

  if (submit) {
    submit.disabled = true;
    submit.textContent = 'Сохраняем...';
  }

  try {
    const result = await api('/api/profile/notification-channels', {
      method: 'POST',
      body: JSON.stringify({ channels: checkedValues })
    });

    if (result?.result === false) {
      throw new Error(result.error || 'Сервис WOWlife не подтвердил сохранение каналов уведомлений.');
    }

    profileNotificationChannelsState.isEditing = false;
    updateProfileNotificationChannelsSection();
  } catch (error) {
    if (notice) {
      notice.className = 'notice error';
      notice.textContent = error.message || 'Не удалось сохранить каналы уведомлений.';
    }
  } finally {
    if (submit) {
      submit.disabled = false;
      submit.textContent = 'Сохранить';
    }
  }
}

function setupProfileNotificationChannelsPanel() {
  document.querySelector('#profileNotificationChannelsEditButton')?.addEventListener('click', () => {
    profileNotificationChannelsState.isEditing = true;
    updateProfileNotificationChannelsSection();
  });

  document.querySelector('#profileNotificationChannelsForm')?.addEventListener('submit', handleProfileNotificationChannelsSubmit);
}

function profileSection(title, body, extraClass = '') {
  return `
    <section class="card profile-section ${extraClass}">
      <h2>${escapeHtml(title)}</h2>
      <div class="profile-section-body">${body}</div>
    </section>
  `;
}

function profileSectionWithAction(title, body, actionHtml = '', extraClass = '') {
  return `
    <section class="card profile-section ${extraClass}">
      <div class="profile-section-header">
        <h2>${escapeHtml(title)}</h2>
        ${actionHtml || ''}
      </div>
      <div class="profile-section-body">${body}</div>
    </section>
  `;
}

function profilePasswordFormHtml({ notice = '' } = {}) {
  return `
    <form id="profilePasswordForm" class="auth-form auth-form-wakesurf profile-password-form">
      <div id="profilePasswordNotice" class="${notice ? 'notice error' : 'hidden'}">${escapeHtml(notice)}</div>
      <div class="auth-input-stack">
        <label>
          <span>Новый пароль</span>
          <span class="auth-password-field">
            <input
              id="profilePasswordInput"
              name="password"
              type="password"
              autocomplete="new-password"
              placeholder="••••••"
              value="${escapeHtml(profilePasswordState.password)}"
              required
            />
            <button class="auth-password-toggle" type="button" aria-controls="profilePasswordInput" aria-label="Показать пароль">
              ${passwordVisibilityIconSvg(false)}
            </button>
          </span>
        </label>
        <button class="button auth-submit" type="submit">Установить пароль</button>
      </div>
    </form>
  `;
}

function toggleProfilePasswordVisibility(event) {
  const button = event.currentTarget;
  const input = document.querySelector('#profilePasswordInput');
  if (!input) return;

  const shouldShow = input.type === 'password';
  input.type = shouldShow ? 'text' : 'password';
  button.innerHTML = passwordVisibilityIconSvg(shouldShow);
  button.setAttribute('aria-label', shouldShow ? 'Скрыть пароль' : 'Показать пароль');
  button.classList.toggle('is-visible', shouldShow);
}

function closeProfilePasswordModal() {
  document.querySelector('#profilePasswordModal')?.remove();
}

function closeProfilePasswordSuccessDialog() {
  document.querySelector('#profilePasswordSuccessModal')?.remove();
}

function showProfilePasswordSuccessDialog() {
  closeProfilePasswordSuccessDialog();
  document.body.insertAdjacentHTML('beforeend', `
    <div id="profilePasswordSuccessModal" class="schedule-modal profile-password-success-modal" role="dialog" aria-modal="true" aria-labelledby="profilePasswordSuccessTitle">
      <button class="schedule-modal-backdrop" type="button" aria-label="Закрыть"></button>
      <div class="schedule-panel profile-password-success-panel">
        <div class="schedule-header">
          <h2 id="profilePasswordSuccessTitle">Готово</h2>
          <button class="icon-button schedule-close" type="button" aria-label="Закрыть">×</button>
        </div>
        <div class="profile-password-success-body">
          <p>Пароль успешно установлен</p>
          <button id="profilePasswordSuccessOk" class="button" type="button">ОК</button>
        </div>
      </div>
    </div>
  `);

  const modal = document.querySelector('#profilePasswordSuccessModal');
  modal?.querySelector('.schedule-modal-backdrop')?.addEventListener('click', closeProfilePasswordSuccessDialog);
  modal?.querySelector('.schedule-close')?.addEventListener('click', closeProfilePasswordSuccessDialog);
  modal?.querySelector('#profilePasswordSuccessOk')?.addEventListener('click', closeProfilePasswordSuccessDialog);
}

async function handleProfilePasswordSubmit(event, options = {}) {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector('button[type="submit"]');
  const notice = form.querySelector('#profilePasswordNotice');
  const formData = new FormData(form);
  const password = String(formData.get('password') || '').trim();
  profilePasswordState.password = password;

  if (!password) {
    if (notice) {
      notice.className = 'notice error';
      notice.textContent = 'Введите пароль.';
    }
    return;
  }

  if (submit) {
    submit.disabled = true;
    submit.textContent = 'Сохраняем...';
  }
  if (notice) {
    notice.className = 'hidden';
    notice.textContent = '';
  }

  try {
    await api('/api/profile/password', {
      method: 'POST',
      body: JSON.stringify({ password })
    });

    profilePasswordState.password = '';
    form.reset();
    if (options.closeModal) closeProfilePasswordModal();
    showProfilePasswordSuccessDialog();
  } catch (error) {
    if (notice) {
      notice.className = 'notice error';
      notice.textContent = error.message || 'Не удалось установить пароль.';
    }
  } finally {
    if (submit) {
      submit.disabled = false;
      submit.textContent = 'Установить пароль';
    }
  }
}

function setupProfilePasswordForm(options = {}) {
  const form = document.querySelector('#profilePasswordForm');
  form?.querySelector('.auth-password-toggle')?.addEventListener('click', toggleProfilePasswordVisibility);
  form?.addEventListener('submit', (event) => handleProfilePasswordSubmit(event, options));
}

function openProfilePasswordDialog() {
  closeProfilePasswordModal();
  document.body.insertAdjacentHTML('beforeend', `
    <div id="profilePasswordModal" class="schedule-modal profile-password-modal" role="dialog" aria-modal="true" aria-labelledby="profilePasswordTitle">
      <button class="schedule-modal-backdrop" type="button" aria-label="Закрыть"></button>
      <div class="schedule-panel profile-password-panel">
        <div class="schedule-header">
          <h2 id="profilePasswordTitle">Установить пароль</h2>
          <button class="icon-button schedule-close" type="button" aria-label="Закрыть">×</button>
        </div>
        <div class="profile-password-dialog-body">
          ${profilePasswordFormHtml()}
        </div>
      </div>
    </div>
  `);

  const modal = document.querySelector('#profilePasswordModal');
  modal?.querySelector('.schedule-modal-backdrop')?.addEventListener('click', closeProfilePasswordModal);
  modal?.querySelector('.schedule-close')?.addEventListener('click', closeProfilePasswordModal);
  setupProfilePasswordForm({ closeModal: true });
}

function openProfilePasswordFlow() {
  if (shouldUseDialogScreen()) {
    navigate('/profile/password');
    return;
  }
  openProfilePasswordDialog();
}

function updateProfileAgentReportState(agentReport = {}) {
  profileAgentReportState.legalAddress = String(agentReport.legalAddress || '').trim();
  profileAgentReportState.contractNumber = String(agentReport.contractNumber || '').trim();
}

function profileAgentReportBodyHtml(agentReport = profileAgentReportState) {
  return `
    ${profileField('Юридический адрес', agentReport.legalAddress)}
    ${profileField('Номер договора', agentReport.contractNumber)}
  `;
}

function updateProfileAgentReportSection(agentReport = profileAgentReportState) {
  const body = document.querySelector('.profile-agent-report-card .profile-section-body');
  if (!body) return false;
  body.innerHTML = profileAgentReportBodyHtml(agentReport);
  return true;
}

function profileAgentReportFormHtml({ noticeId = 'profileAgentReportNotice', formId = 'profileAgentReportForm' } = {}) {
  return `
    <form id="${escapeHtml(formId)}" class="schedule-form profile-agent-report-form" novalidate>
      <div class="schedule-field schedule-field-full profile-agent-report-field">
        <label for="profileAgentReportLegalAddress">Юридический адрес</label>
        <input id="profileAgentReportLegalAddress" name="legalAddress" autocomplete="off" placeholder="Юридический адрес" value="${escapeHtml(profileAgentReportState.legalAddress)}" />
      </div>
      <div class="schedule-field schedule-field-full profile-agent-report-field">
        <label for="profileAgentReportContractNumber">Номер договора</label>
        <input id="profileAgentReportContractNumber" name="contractNumber" autocomplete="off" placeholder="Номер договора" value="${escapeHtml(profileAgentReportState.contractNumber)}" />
      </div>
      <div id="${escapeHtml(noticeId)}" class="hidden"></div>
      <div class="schedule-actions profile-agent-report-form-actions">
        <button class="button secondary schedule-cancel" type="button" data-close-profile-agent-report>Отмена</button>
        <button class="button schedule-submit profile-agent-report-submit" type="submit">Сохранить</button>
      </div>
    </form>
  `;
}

function closeProfileAgentReportDialog() {
  document.querySelector('#profileAgentReportModal')?.remove();
}

function profileAgentReportDialogHtml() {
  return `
    <div id="profileAgentReportModal" class="schedule-modal profile-agent-report-modal" role="dialog" aria-modal="true" aria-labelledby="profileAgentReportTitle">
      <button class="schedule-modal-backdrop" type="button" data-close-profile-agent-report aria-label="Закрыть"></button>
      <section class="schedule-panel profile-agent-report-panel">
        <header class="schedule-header">
          <h2 id="profileAgentReportTitle">Отчет агента</h2>
          <button class="icon-button schedule-close" type="button" data-close-profile-agent-report aria-label="Закрыть">×</button>
        </header>
        ${profileAgentReportFormHtml()}
      </section>
    </div>
  `;
}

async function handleProfileAgentReportSubmit(event, options = {}) {
  event.preventDefault();
  const form = event.currentTarget;
  const notice = form.querySelector('#profileAgentReportNotice, #profileAgentReportScreenNotice');
  const submit = form.querySelector('[type="submit"]');
  const formData = new FormData(form);
  const legalAddress = String(formData.get('legalAddress') || '').trim();
  const contractNumber = String(formData.get('contractNumber') || '').trim();

  profileAgentReportState.legalAddress = legalAddress;
  profileAgentReportState.contractNumber = contractNumber;

  if (notice) {
    notice.className = 'hidden';
    notice.textContent = '';
  }

  if (submit) {
    submit.disabled = true;
    submit.textContent = 'Сохраняем...';
  }

  try {
    await api('/api/profile/agent-report', {
      method: 'POST',
      body: JSON.stringify({ legalAddress, contractNumber })
    });

    closeProfileAgentReportDialog();
    updateProfileAgentReportSection({ legalAddress, contractNumber });
    if (typeof options.onSuccess === 'function') {
      await options.onSuccess({ legalAddress, contractNumber });
    }
  } catch (error) {
    if (notice) {
      notice.className = 'notice error';
      notice.textContent = error.message || 'Не удалось сохранить отчет агента.';
    }
  } finally {
    if (submit) {
      submit.disabled = false;
      submit.textContent = 'Сохранить';
    }
  }
}

function setupProfileAgentReportForm(options = {}) {
  const form = document.querySelector('#profileAgentReportForm');
  form?.addEventListener('submit', (event) => handleProfileAgentReportSubmit(event, options));
}

function openProfileAgentReportDialog(agentReport = {}) {
  updateProfileAgentReportState(agentReport);

  if (shouldUseDialogScreen()) {
    navigate(`/profile/agent-report?next=${encodeURIComponent('/profile')}`);
    return;
  }

  closeProfileAgentReportDialog();
  document.body.insertAdjacentHTML('beforeend', profileAgentReportDialogHtml());
  document.querySelectorAll('[data-close-profile-agent-report]').forEach((button) => {
    button.addEventListener('click', closeProfileAgentReportDialog);
  });
  setupProfileAgentReportForm();
  document.querySelector('#profileAgentReportLegalAddress')?.focus();
}

async function renderProfileAgentReportScreen() {
  const backTo = profileAgentReportBackPath();
  setHeader('Отчет агента', { backTo });
  setActiveNavigation('profile');
  showLoading();

  try {
    const { item } = await api('/api/profile?refresh=1');
    updateProfileAgentReportState(item?.agentReport || {});

    app.innerHTML = `
      <section class="card schedule-screen-card service-dialog-screen-card profile-agent-report-screen-card">
        <header class="schedule-header schedule-screen-header">
          <h2>Отчет агента</h2>
        </header>
        ${profileAgentReportFormHtml({ noticeId: 'profileAgentReportScreenNotice' })}
      </section>
    `;

    document.querySelectorAll('[data-close-profile-agent-report]').forEach((button) => {
      button.addEventListener('click', () => navigate(backTo));
    });
    setupProfileAgentReportForm({
      onSuccess: () => navigate(backTo, { replace: true })
    });
  } catch (error) {
    showError(error);
  }
}


function profileModerationAttachIconSvg() {
  return `
    <svg class="profile-moderation-attach-icon" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
      <path d="M8.75 17.35 16.9 9.2a3.1 3.1 0 0 0-4.38-4.38L4.38 12.96a5.2 5.2 0 0 0 7.35 7.35l8.14-8.14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="m8.35 13.45 6.72-6.72" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>
  `;
}

function profileModerationFormHtml({ noticeId = 'profileModerationNotice', formId = 'profileModerationForm' } = {}) {
  const fileName = profileModerationState.file?.name || '';
  return `
    <form id="${escapeHtml(formId)}" class="schedule-form profile-moderation-form" novalidate>
      <div class="schedule-field schedule-field-full profile-moderation-field">
        <label for="profileModerationName">Заголовок</label>
        <input id="profileModerationName" name="name" autocomplete="off" placeholder="Заголовок" value="${escapeHtml(profileModerationState.name)}" required />
      </div>
      <div class="schedule-field schedule-field-full profile-moderation-field">
        <label for="profileModerationInfo">Описание</label>
        <textarea id="profileModerationInfo" name="info" rows="5" placeholder="Описание" required>${escapeHtml(profileModerationState.info)}</textarea>
      </div>
      <div class="profile-moderation-file-row">
        <input id="profileModerationFile" class="visually-hidden" name="file" type="file" />
        <button class="profile-moderation-file-button" type="button" data-profile-moderation-file-button>
          ${profileModerationAttachIconSvg()}
          <span>Прикрепить файл</span>
        </button>
        <span id="profileModerationFileName" class="profile-moderation-file-name">${fileName ? escapeHtml(fileName) : ''}</span>
      </div>
      <div id="${escapeHtml(noticeId)}" class="hidden"></div>
      <div class="schedule-actions profile-moderation-actions">
        <button class="button secondary schedule-cancel" type="button" data-close-profile-moderation>Отмена</button>
        <button class="button schedule-submit profile-moderation-submit" type="submit">Отправить</button>
      </div>
    </form>
  `;
}

function profileModerationDialogHtml() {
  return `
    <div id="profileModerationModal" class="schedule-modal profile-moderation-modal" role="dialog" aria-modal="true" aria-labelledby="profileModerationTitle">
      <button class="schedule-modal-backdrop" type="button" data-close-profile-moderation aria-label="Закрыть"></button>
      <section class="schedule-panel profile-moderation-panel">
        <header class="schedule-header">
          <h2 id="profileModerationTitle">Создать заявку на модерацию</h2>
          <button class="icon-button schedule-close" type="button" data-close-profile-moderation aria-label="Закрыть">×</button>
        </header>
        ${profileModerationFormHtml()}
      </section>
    </div>
  `;
}

function resetProfileModerationState() {
  profileModerationState.name = '';
  profileModerationState.info = '';
  profileModerationState.file = null;
}

function updateProfileModerationStateFromForm(form) {
  if (!form) return;
  const formData = new FormData(form);
  profileModerationState.name = String(formData.get('name') || '').trim();
  profileModerationState.info = String(formData.get('info') || '').trim();
}

function closeProfileModerationDialog() {
  document.querySelector('#profileModerationModal')?.remove();
}

function closeProfileModerationSuccessDialog() {
  document.querySelector('#profileModerationSuccessModal')?.remove();
}

function showProfileModerationSuccessDialog() {
  closeProfileModerationSuccessDialog();
  document.body.insertAdjacentHTML('beforeend', `
    <div id="profileModerationSuccessModal" class="schedule-modal profile-moderation-success-modal" role="dialog" aria-modal="true" aria-labelledby="profileModerationSuccessTitle">
      <button class="schedule-modal-backdrop" type="button" aria-label="Закрыть"></button>
      <div class="schedule-panel profile-moderation-success-panel">
        <div class="schedule-header">
          <h2 id="profileModerationSuccessTitle">Готово</h2>
          <button class="icon-button schedule-close" type="button" aria-label="Закрыть">×</button>
        </div>
        <div class="profile-moderation-success-body">
          <p>Заявка на модерацию создана!</p>
          <button id="profileModerationSuccessOk" class="button" type="button">ОК</button>
        </div>
      </div>
    </div>
  `);

  const modal = document.querySelector('#profileModerationSuccessModal');
  const close = () => {
    closeProfileModerationSuccessDialog();
    if (window.location.pathname === '/profile/moderation') navigate('/profile');
  };
  modal?.querySelector('.schedule-modal-backdrop')?.addEventListener('click', close);
  modal?.querySelector('.schedule-close')?.addEventListener('click', close);
  modal?.querySelector('#profileModerationSuccessOk')?.addEventListener('click', close);
}

function fileToBase64Content(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      resolve(null);
      return;
    }

    const reader = new FileReader();
    reader.addEventListener('load', () => {
      const result = String(reader.result || '');
      const marker = 'base64,';
      const markerIndex = result.indexOf(marker);
      resolve(markerIndex >= 0 ? result.slice(markerIndex + marker.length) : result);
    });
    reader.addEventListener('error', () => reject(reader.error || new Error('Не удалось прочитать файл.')));
    reader.readAsDataURL(file);
  });
}

function setupProfileModerationForm(options = {}) {
  const form = document.querySelector('#profileModerationForm');
  const fileInput = form?.querySelector('#profileModerationFile');
  const fileName = form?.querySelector('#profileModerationFileName');

  form?.querySelector('[data-profile-moderation-file-button]')?.addEventListener('click', () => {
    fileInput?.click();
  });

  fileInput?.addEventListener('change', () => {
    const file = fileInput.files?.[0] || null;
    profileModerationState.file = file;
    if (fileName) fileName.textContent = file?.name || '';
  });

  form?.addEventListener('submit', (event) => handleProfileModerationSubmit(event, options));
}

async function handleProfileModerationSubmit(event, options = {}) {
  event.preventDefault();
  const form = event.currentTarget;
  const notice = form.querySelector('#profileModerationNotice, #profileModerationScreenNotice');
  const submit = form.querySelector('[type="submit"]');
  const nameInput = form.querySelector('#profileModerationName');
  const infoInput = form.querySelector('#profileModerationInfo');
  updateProfileModerationStateFromForm(form);

  if (notice) {
    notice.className = 'hidden';
    notice.textContent = '';
  }

  if (!profileModerationState.name || !profileModerationState.info) {
    if (notice) {
      notice.className = 'notice error';
      notice.textContent = 'Заполните заголовок и описание заявки.';
    }
    (!profileModerationState.name ? nameInput : infoInput)?.focus();
    return;
  }

  if (submit) {
    submit.disabled = true;
    submit.textContent = 'Отправляем...';
  }

  try {
    const selectedFile = profileModerationState.file || form.querySelector('#profileModerationFile')?.files?.[0] || null;
    const fileContent = await fileToBase64Content(selectedFile);
    const payload = {
      name: profileModerationState.name,
      info: profileModerationState.info
    };

    if (selectedFile && fileContent) {
      payload.file = {
        fileName: selectedFile.name,
        fileContent
      };
    }

    await api('/api/profile/moderation', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    resetProfileModerationState();
    form.reset();
    if (typeof options.onSuccess === 'function') {
      await options.onSuccess();
    } else {
      closeProfileModerationDialog();
      showProfileModerationSuccessDialog();
    }
  } catch (error) {
    if (notice) {
      notice.className = 'notice error';
      notice.textContent = error.message || 'Не удалось отправить заявку на модерацию.';
    }
  } finally {
    if (submit) {
      submit.disabled = false;
      submit.textContent = 'Отправить';
    }
  }
}

function openProfileModerationDialog() {
  if (shouldUseDialogScreen()) {
    updateProfileModerationStateFromForm(document.querySelector('#profileModerationForm'));
    navigate(`/profile/moderation?next=${encodeURIComponent('/profile')}`);
    return;
  }

  closeProfileModerationDialog();
  document.body.insertAdjacentHTML('beforeend', profileModerationDialogHtml());
  document.querySelectorAll('[data-close-profile-moderation]').forEach((button) => {
    button.addEventListener('click', closeProfileModerationDialog);
  });
  setupProfileModerationForm();
  document.querySelector('#profileModerationName')?.focus();
}

function renderProfileModerationScreen() {
  const backTo = profileModerationBackPath();
  setHeader('Заявка на модерацию', { backTo });
  setActiveNavigation('profile');

  app.innerHTML = `
    <section class="card schedule-screen-card service-dialog-screen-card profile-moderation-screen-card">
      <header class="schedule-header schedule-screen-header">
        <h2>Создать заявку на модерацию</h2>
      </header>
      ${profileModerationFormHtml({ noticeId: 'profileModerationScreenNotice' })}
    </section>
  `;

  document.querySelectorAll('[data-close-profile-moderation]').forEach((button) => {
    button.addEventListener('click', () => navigate(backTo));
  });
  setupProfileModerationForm({
    onSuccess: async () => {
      showProfileModerationSuccessDialog();
    }
  });
}

function renderProfilePasswordScreen() {
  setHeader('Установить пароль', { backTo: '/profile' });
  setActiveNavigation('profile');
  profilePasswordState.password = '';

  app.innerHTML = `
    <section class="profile-password-screen auth-screen-wakesurf">
      <div class="auth-brand-panel" aria-hidden="true">
        <img src="/assets/wowlife-logo.svg" alt="" />
      </div>

      <div class="auth-panel">
        <div class="auth-panel-inner">
          <div class="auth-heading">
            <img class="auth-mobile-logo" src="/assets/wowlife-logo.svg" alt="" />
            <h1>Установить пароль</h1>
            <p>Введите новый пароль для входа в кабинет партнёра</p>
          </div>
          ${profilePasswordFormHtml()}
        </div>
      </div>
    </section>
  `;

  setupProfilePasswordForm({ closeModal: false });
}


function updateCrmDataState(item = {}) {
  crmDataState.bookingName = CRM_BOOKING_NAME_OPTIONS.includes(item.bookingName) ? item.bookingName : 'Нет данных';
  crmDataState.bookingUrl = String(item.bookingUrl || '').trim();
  crmDataState.authType = CRM_AUTH_TYPE_OPTIONS.includes(item.authType) ? item.authType : 'Нет данных';
  crmDataState.login = String(item.login || '').trim();
  crmDataState.password = String(item.password || '').trim();
}

function crmDataOptionHtml(value, selectedValue) {
  const selected = value === selectedValue ? ' selected' : '';
  return `<option value="${escapeHtml(value)}"${selected}>${escapeHtml(value)}</option>`;
}

function crmDataFormHtml() {
  return `
    <form id="crmDataForm" class="schedule-form crm-data-form" novalidate>
      <div id="crmDataNotice" class="hidden"></div>

      <div class="schedule-grid-2 crm-data-grid">
        <div class="schedule-field crm-data-field">
          <label for="crmBookingName">Название Booking</label>
          <select id="crmBookingName" name="bookingName">
            ${CRM_BOOKING_NAME_OPTIONS.map((value) => crmDataOptionHtml(value, crmDataState.bookingName)).join('')}
          </select>
        </div>

        <div class="schedule-field crm-data-field">
          <label for="crmAuthType">Тип авторизации</label>
          <select id="crmAuthType" name="authType">
            ${CRM_AUTH_TYPE_OPTIONS.map((value) => crmDataOptionHtml(value, crmDataState.authType)).join('')}
          </select>
        </div>

        <div class="schedule-field schedule-field-full crm-data-field">
          <label for="crmBookingUrl">Ссылка на Booking сервис</label>
          <input id="crmBookingUrl" name="bookingUrl" type="url" inputmode="url" autocomplete="url" placeholder="https://" value="${escapeHtml(crmDataState.bookingUrl)}" />
        </div>

        <div class="schedule-field crm-data-field">
          <label for="crmLogin">Логин</label>
          <input id="crmLogin" name="login" autocomplete="username" placeholder="Логин" value="${escapeHtml(crmDataState.login)}" />
        </div>

        <div class="schedule-field crm-data-field">
          <label for="crmPassword">Пароль</label>
          <input id="crmPassword" name="password" type="text" autocomplete="off" placeholder="Пароль" value="${escapeHtml(crmDataState.password)}" />
        </div>
      </div>

      <div class="schedule-actions crm-data-actions">
        <button id="crmDataOpenIframeButton" class="button secondary" type="button">iFrame</button>
        <button id="crmDataOpenBookingButton" class="button secondary" type="button">Открыть Booking</button>
        <button id="crmDataSaveButton" class="button schedule-submit" type="submit">Сохранить</button>
      </div>
    </form>
  `;
}

function updateCrmDataStateFromForm(form) {
  if (!form) return;
  const formData = new FormData(form);
  updateCrmDataState({
    bookingName: formData.get('bookingName'),
    bookingUrl: formData.get('bookingUrl'),
    authType: formData.get('authType'),
    login: formData.get('login'),
    password: formData.get('password')
  });
}

function buildCrmBookingRequestPayload() {
  return {
    bookingName: crmDataState.bookingName,
    bookingUrl: crmDataState.bookingUrl,
    authType: crmDataState.authType,
    login: crmDataState.login,
    password: crmDataState.password
  };
}

function setCrmDataNotice(type, message) {
  const notice = document.querySelector('#crmDataNotice');
  if (!notice) return;

  if (!message) {
    notice.className = 'hidden';
    notice.textContent = '';
    return;
  }

  notice.className = type === 'success' ? 'notice success' : 'notice error';
  notice.textContent = message;
}

function updateCrmBookingUrlField(value) {
  const bookingUrl = String(value || '').trim();
  if (!bookingUrl) return;

  crmDataState.bookingUrl = bookingUrl;
  const input = document.querySelector('#crmBookingUrl');
  if (input) input.value = bookingUrl;
}

function writeOpeningPlaceholder(bookingWindow) {
  if (!bookingWindow?.document) return;
  bookingWindow.document.open();
  bookingWindow.document.write(`
    <!doctype html>
    <html lang="ru">
      <head>
        <meta charset="utf-8" />
        <title>Открытие Booking</title>
        <style>
          body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: Inter, Arial, sans-serif; color: #101828; background: #f5f7fb; }
          main { width: min(520px, calc(100vw - 40px)); padding: 28px; border: 1px solid #dbe3ef; border-radius: 24px; background: #fff; box-shadow: 0 18px 50px rgba(15, 23, 42, .12); }
          h1 { margin: 0 0 10px; font-size: 24px; }
          p { margin: 0; color: #64748b; line-height: 1.5; }
        </style>
      </head>
      <body>
        <main>
          <h1>Открываем Booking</h1>
          <p>Проверяем данные авторизации и переходим к сервису.</p>
        </main>
      </body>
    </html>
  `);
  bookingWindow.document.close();
}

function crmBookingSuccessMessage(result = {}) {
  if (result.message) return result.message;
  if (result.authMode === 'yclients-api-env-user-token') {
    return 'YCLIENTS API-авторизация выполнена по env-токенам. Booking открыт в новой вкладке.';
  }
  if (result.authMode === 'yclients-api-crm-login-password') {
    return 'YCLIENTS API-авторизация выполнена по логину и паролю с экрана «Данные CRM». Booking открыт в новой вкладке.';
  }
  if (result.authMode === 'yclients-web-login-post') {
    return 'Открываем YCLIENTS в новой вкладке: сначала пробуем скрытый вход, затем выполняем прямой вход через домен YCLIENTS для установки cookies и открываем расписание.';
  }
  if (result.authMode === 'yclients-login-password-only') {
    return 'YCLIENTS открыт в новой вкладке.';
  }
  return 'Booking открыт в новой вкладке.';
}


function isYclientsLoginBridgeResult(result = {}) {
  return typeof result.openUrl === 'string'
    && result.openUrl.includes('/api/crm-data/yclients-login/')
    && Boolean(result.externalUrl);
}

function scheduleYclientsBookingRedirect(bookingWindow, result = {}) {
  if (!bookingWindow || bookingWindow.closed || !result.externalUrl) return null;

  let redirected = false;
  let cleanupTimer = null;
  const afterFormSubmitDelayMs = Number(result.browserAuthRedirectAfterSubmitMs || 3500);

  function cleanup() {
    window.removeEventListener('message', handleBridgeMessage);
    if (cleanupTimer) {
      clearTimeout(cleanupTimer);
      cleanupTimer = null;
    }
  }

  function redirectOpenedWindow() {
    if (redirected) return;
    redirected = true;
    cleanup();
    try {
      if (bookingWindow && !bookingWindow.closed) {
        bookingWindow.location.replace(result.externalUrl);
        window.setTimeout(() => {
          try { bookingWindow.opener = null; } catch (_error) {}
        }, 1000);
      }
    } catch (_error) {
      try {
        if (bookingWindow && !bookingWindow.closed) {
          bookingWindow.location.href = result.externalUrl;
        }
      } catch (_hrefError) {}
    }
  }

  function handleBridgeMessage(event) {
    if (event.source !== bookingWindow) return;
    if (event.origin !== window.location.origin) return;
    if (event.data?.type !== 'wowlife-yclients-login-submitted') return;

    window.setTimeout(redirectOpenedWindow, afterFormSubmitDelayMs);
  }

  window.addEventListener('message', handleBridgeMessage);
  cleanupTimer = window.setTimeout(cleanup, 120000);

  return cleanup;
}

async function openCrmBookingExternal() {
  const form = document.querySelector('#crmDataForm');
  const openButton = document.querySelector('#crmDataOpenBookingButton');
  updateCrmDataStateFromForm(form);

  let bookingWindow = null;
  try {
    bookingWindow = window.open('', '_blank');
    writeOpeningPlaceholder(bookingWindow);
  } catch (_error) {
    bookingWindow = null;
  }

  if (openButton) {
    openButton.disabled = true;
    openButton.textContent = 'Открываем...';
  }

  let result;
  try {
    result = await api('/api/crm-data/open-booking', {
      method: 'POST',
      body: JSON.stringify(buildCrmBookingRequestPayload())
    });
  } catch (error) {
    try { bookingWindow?.close(); } catch (_closeError) {}
    setCrmDataNotice('error', error.message || 'Не удалось открыть Booking сервис.');
    if (openButton) {
      openButton.disabled = false;
      openButton.textContent = 'Открыть Booking';
    }
    return;
  }

  if (result.item) {
    updateCrmDataState(result.item);
    updateCrmBookingUrlField(result.item.bookingUrl);
  } else if (result.savedBookingUrl || result.externalUrl) {
    updateCrmBookingUrlField(result.savedBookingUrl || result.externalUrl);
  }

  const targetUrl = result.openUrl || result.externalUrl;
  if (!targetUrl) {
    try { bookingWindow?.close(); } catch (_closeError) {}
    setCrmDataNotice('error', 'Не удалось получить ссылку Booking сервиса.');
    if (openButton) {
      openButton.disabled = false;
      openButton.textContent = 'Открыть Booking';
    }
    return;
  }

  if (bookingWindow && !bookingWindow.closed) {
    if (isYclientsLoginBridgeResult(result)) {
      scheduleYclientsBookingRedirect(bookingWindow, result);
      bookingWindow.location.replace(targetUrl);
    } else {
      bookingWindow.location.replace(targetUrl);
      try { bookingWindow.opener = null; } catch (_error) {}
    }
    setCrmDataNotice('success', crmBookingSuccessMessage(result));
  } else {
    setCrmDataNotice('error', 'Браузер заблокировал новую вкладку. Разрешите всплывающие окна и нажмите «Открыть Booking» ещё раз.');
  }

  if (openButton) {
    openButton.disabled = false;
    openButton.textContent = 'Открыть Booking';
  }
}


function closeCrmBookingIframeModal() {
  const modal = document.querySelector('#crmBookingIframeModal');
  if (modal) modal.remove();
  document.body.classList.remove('modal-open');
}

function setCrmIframeStatus(tone, badge, message, detail = '') {
  const box = document.querySelector('#crmBookingIframeStatus');
  const badgeNode = document.querySelector('#crmBookingIframeStatusBadge');
  const messageNode = document.querySelector('#crmBookingIframeStatusText');
  const detailNode = document.querySelector('#crmBookingIframeStatusDetail');
  if (!box || !badgeNode || !messageNode || !detailNode) return;

  box.className = `crm-booking-iframe-status ${tone || 'info'}`;
  badgeNode.textContent = badge || 'статус';
  messageNode.textContent = message || '';
  detailNode.textContent = detail || '';
  detailNode.classList.toggle('hidden', !detail);
}

function openCrmBookingResultInNewTab(result = {}) {
  const targetUrl = result.openUrl || result.externalUrl;
  if (!targetUrl) return;

  let bookingWindow = null;
  try {
    bookingWindow = window.open('', '_blank');
    writeOpeningPlaceholder(bookingWindow);
  } catch (_error) {
    bookingWindow = null;
  }

  if (!bookingWindow || bookingWindow.closed) {
    setCrmIframeStatus('error', 'popup blocked', 'Браузер заблокировал новую вкладку.', 'Разрешите всплывающие окна или используйте прямую ссылку ниже.');
    return;
  }

  if (isYclientsLoginBridgeResult(result)) {
    scheduleYclientsBookingRedirect(bookingWindow, result);
    bookingWindow.location.replace(targetUrl);
  } else {
    bookingWindow.location.replace(targetUrl);
    try { bookingWindow.opener = null; } catch (_error) {}
  }
}

function yclientsLoginBridgeUrlForIframe(openUrl = '') {
  const value = String(openUrl || '').trim();
  if (!value) return '';
  return `${value}${value.includes('?') ? '&' : '?'}mode=top-level`;
}

function renderCrmBookingIframeModal(result = {}, payload = {}, iframeLoginWindow = null) {
  closeCrmBookingIframeModal();

  const targetUrl = result.externalUrl || payload.bookingUrl || '';
  const isYclients = result.authMode === 'yclients-web-login-post' || isYclientsLoginBridgeResult(result);
  const iframeTitle = isYclients ? 'YCLIENTS в iFrame' : 'Booking в iFrame';
  const loginBridgeUrl = isYclients ? yclientsLoginBridgeUrlForIframe(result.openUrl) : '';
  const intro = isYclients
    ? 'Для iFrame сначала открываем служебное окно YCLIENTS как top-level страницу: только так браузер получает cookies домена yclients.com. После этого расписание загружается внутри iFrame.'
    : 'Открываем Booking сервис внутри iFrame.';

  document.body.insertAdjacentHTML('beforeend', `
    <div id="crmBookingIframeModal" class="schedule-modal crm-booking-iframe-modal" role="dialog" aria-modal="true" aria-labelledby="crmBookingIframeTitle">
      <button class="schedule-modal-backdrop" type="button" aria-label="Закрыть iFrame"></button>
      <div class="schedule-panel crm-booking-iframe-panel">
        <header class="schedule-header crm-booking-iframe-header">
          <div>
            <h2 id="crmBookingIframeTitle">${escapeHtml(iframeTitle)}</h2>
            <p>${escapeHtml(intro)}</p>
          </div>
          <button id="crmBookingIframeClose" class="button icon-button schedule-close" type="button" aria-label="Закрыть">×</button>
        </header>

        <div class="crm-booking-iframe-body">
          <div id="crmBookingIframeStatus" class="crm-booking-iframe-status info" aria-live="polite">
            <div class="crm-booking-iframe-status-row">
              <strong>Статус iFrame</strong>
              <span id="crmBookingIframeStatusBadge" class="crm-booking-iframe-badge">подготовка</span>
            </div>
            <span id="crmBookingIframeStatusText">Готовим авторизацию и окно Booking.</span>
            <pre id="crmBookingIframeStatusDetail" class="hidden"></pre>
          </div>

          <div class="crm-booking-iframe-target-row">
            <span>Итоговая ссылка</span>
            <code>${escapeHtml(targetUrl || 'ссылка не получена')}</code>
          </div>

          <div class="crm-booking-iframe-frame-wrap">
            <iframe id="crmBookingIframeFrame" class="crm-booking-iframe-frame" title="${escapeHtml(iframeTitle)}" src="about:blank" allow="clipboard-read; clipboard-write"></iframe>
          </div>

          <div class="crm-booking-iframe-actions">
            <button id="crmBookingIframeRetry" class="button secondary" type="button">Повторить вход для iFrame</button>
            <button id="crmBookingIframeExternal" class="button secondary" type="button">Открыть в новой вкладке</button>
            ${targetUrl ? `<a class="button secondary" href="${escapeHtml(targetUrl)}" target="_blank" rel="noreferrer">Открыть ссылку</a>` : ''}
          </div>
        </div>
      </div>
    </div>
  `);

  document.body.classList.add('modal-open');

  const modal = document.querySelector('#crmBookingIframeModal');
  const bookingFrame = document.querySelector('#crmBookingIframeFrame');
  let bookingFrameHasTarget = false;
  let authMessageCleanup = null;
  let authRedirectCleanup = null;
  let authTimeout = null;
  let iframeOpenTimer = null;
  let helperCloseTimer = null;
  let flowStarted = false;

  function clearIframeAuthTimers() {
    if (authTimeout) {
      window.clearTimeout(authTimeout);
      authTimeout = null;
    }
    if (iframeOpenTimer) {
      window.clearTimeout(iframeOpenTimer);
      iframeOpenTimer = null;
    }
    if (helperCloseTimer) {
      window.clearTimeout(helperCloseTimer);
      helperCloseTimer = null;
    }
  }

  function cleanupIframeAuthFlow() {
    clearIframeAuthTimers();
    if (authMessageCleanup) {
      authMessageCleanup();
      authMessageCleanup = null;
    }
    if (authRedirectCleanup) {
      authRedirectCleanup();
      authRedirectCleanup = null;
    }
  }

  function closeHelperWindow(delay = 0) {
    if (!iframeLoginWindow || iframeLoginWindow.closed) return;
    const close = () => {
      try { iframeLoginWindow.close(); } catch (_error) {}
    };
    if (delay > 0) helperCloseTimer = window.setTimeout(close, delay);
    else close();
  }

  function closeModalAndHelper() {
    cleanupIframeAuthFlow();
    closeHelperWindow();
    closeCrmBookingIframeModal();
  }

  const closeButtons = [
    document.querySelector('#crmBookingIframeClose'),
    modal?.querySelector('.schedule-modal-backdrop')
  ];
  closeButtons.forEach((button) => button?.addEventListener('click', closeModalAndHelper));
  document.querySelector('#crmBookingIframeExternal')?.addEventListener('click', () => openCrmBookingResultInNewTab(result));

  function openTargetInIframe(source) {
    if (!bookingFrame || !targetUrl) {
      setCrmIframeStatus('error', 'нет ссылки', 'Не удалось получить ссылку для iFrame.', 'Проверьте поле «Ссылка на Booking сервис».');
      return;
    }

    setCrmIframeStatus(
      'info',
      'загрузка',
      'Открываем YCLIENTS внутри iFrame после top-level авторизации.',
      source ? `Источник перехода: ${source}. Если внутри снова появится экран входа, браузер блокирует third-party cookies для iframe — используйте кнопку «Открыть в новой вкладке».` : ''
    );
    bookingFrameHasTarget = true;
    bookingFrame.src = targetUrl;
  }

  function ensureIframeLoginWindow() {
    if (iframeLoginWindow && !iframeLoginWindow.closed) return iframeLoginWindow;

    try {
      iframeLoginWindow = window.open('', 'wowlifeYclientsIframeAuth', 'popup,width=560,height=720,left=120,top=80');
      writeOpeningPlaceholder(iframeLoginWindow);
    } catch (_error) {
      iframeLoginWindow = null;
    }

    return iframeLoginWindow && !iframeLoginWindow.closed ? iframeLoginWindow : null;
  }

  function startIframeAuthFlow() {
    cleanupIframeAuthFlow();

    if (!isYclients) {
      openTargetInIframe('прямая ссылка');
      return;
    }

    if (!loginBridgeUrl) {
      setCrmIframeStatus('error', 'нет bridge', 'Не удалось подготовить служебную страницу авторизации YCLIENTS.', 'Нажмите «Открыть в новой вкладке» или повторите попытку.');
      return;
    }

    const authWindow = ensureIframeLoginWindow();
    if (!authWindow) {
      setCrmIframeStatus(
        'warning',
        'popup blocked',
        'Браузер заблокировал служебное окно авторизации.',
        'Для iFrame нужна короткая top-level авторизация на домене yclients.com. Разрешите всплывающие окна и нажмите «Повторить вход для iFrame».'
      );
      return;
    }

    flowStarted = true;
    setCrmIframeStatus(
      'info',
      'top-level auth',
      'Открыли служебное окно YCLIENTS для установки cookies браузера.',
      'Служебное окно выполнит POST на yclients.com/auth/login/1. После получения cookies это окно будет закрыто, а расписание загрузится в iFrame.'
    );

    const openAfterSubmitDelay = Number(result.browserAuthRedirectAfterSubmitMs || 5000) + 2500;
    const handleAuthMessage = (event) => {
      if (event.source !== authWindow) return;
      if (event.origin !== window.location.origin) return;
      if (event.data?.type !== 'wowlife-yclients-login-submitted') return;

      if (authTimeout) {
        window.clearTimeout(authTimeout);
        authTimeout = null;
      }
      window.removeEventListener('message', handleAuthMessage);
      authMessageCleanup = null;

      setCrmIframeStatus(
        'info',
        'cookies',
        'YCLIENTS login-запрос отправлен как top-level страница.',
        `Ждём ${Math.round(openAfterSubmitDelay / 1000)} сек., чтобы браузер успел сохранить cookies, затем загружаем расписание в iFrame.`
      );

      iframeOpenTimer = window.setTimeout(() => {
        openTargetInIframe('top-level авторизация YCLIENTS');
        closeHelperWindow(3000);
      }, openAfterSubmitDelay);
    };

    window.addEventListener('message', handleAuthMessage);
    authMessageCleanup = () => window.removeEventListener('message', handleAuthMessage);
    authRedirectCleanup = scheduleYclientsBookingRedirect(authWindow, result);

    try {
      authWindow.location.replace(loginBridgeUrl);
      authWindow.focus?.();
    } catch (error) {
      setCrmIframeStatus('error', 'auth error', 'Не удалось открыть служебное окно авторизации.', error && error.message ? error.message : String(error));
      return;
    }

    authTimeout = window.setTimeout(() => {
      setCrmIframeStatus(
        'warning',
        'auth timeout',
        'Не получили подтверждение отправки login-запроса из служебного окна.',
        'Проверьте, не заблокировал ли браузер всплывающее окно. Можно повторить вход для iFrame или открыть YCLIENTS в новой вкладке.'
      );
    }, Number(result.browserAuthFallbackRedirectMs || 18000));
  }

  bookingFrame?.addEventListener('load', () => {
    if (!bookingFrameHasTarget) return;
    setCrmIframeStatus(
      'success',
      'iframe loaded',
      'iFrame загрузился после top-level авторизации.',
      'Из-за cross-origin политики браузер не даёт проверить содержимое YCLIENTS. Если внутри отображается экран входа, значит браузер блокирует third-party cookies для iframe — используйте «Открыть в новой вкладке».'
    );
  });

  document.querySelector('#crmBookingIframeRetry')?.addEventListener('click', startIframeAuthFlow);
  window.setTimeout(startIframeAuthFlow, 300);
}

async function openCrmBookingIframe() {
  const form = document.querySelector('#crmDataForm');
  const iframeButton = document.querySelector('#crmDataOpenIframeButton');
  updateCrmDataStateFromForm(form);
  const payload = buildCrmBookingRequestPayload();
  const isYclientsIframe = String(payload.bookingName || '').trim().toLowerCase() === 'yclients'
    && payload.authType === 'Базовый';
  let iframeLoginWindow = null;

  if (isYclientsIframe) {
    try {
      iframeLoginWindow = window.open('', 'wowlifeYclientsIframeAuth', 'popup,width=560,height=720,left=120,top=80');
      writeOpeningPlaceholder(iframeLoginWindow);
    } catch (_error) {
      iframeLoginWindow = null;
    }
  }

  if (iframeButton) {
    iframeButton.disabled = true;
    iframeButton.textContent = 'Открываем iFrame...';
  }

  setCrmDataNotice('success', isYclientsIframe
    ? 'Готовим iFrame: сначала нужна короткая top-level авторизация YCLIENTS для cookies браузера.'
    : 'Готовим iFrame для Booking сервиса.');

  let result;
  try {
    result = await api('/api/crm-data/open-booking', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  } catch (error) {
    try { iframeLoginWindow?.close(); } catch (_closeError) {}
    setCrmDataNotice('error', error.message || 'Не удалось подготовить iFrame для Booking сервиса.');
    if (iframeButton) {
      iframeButton.disabled = false;
      iframeButton.textContent = 'iFrame';
    }
    return;
  }

  if (result.item) {
    updateCrmDataState(result.item);
    updateCrmBookingUrlField(result.item.bookingUrl);
  } else if (result.savedBookingUrl || result.externalUrl) {
    updateCrmBookingUrlField(result.savedBookingUrl || result.externalUrl);
  }

  renderCrmBookingIframeModal(result, payload, iframeLoginWindow);
  setCrmDataNotice('success', 'Открываем Booking в iFrame. Для YCLIENTS служебное окно сначала установит cookies браузера, затем расписание загрузится внутри iFrame.');

  if (iframeButton) {
    iframeButton.disabled = false;
    iframeButton.textContent = 'iFrame';
  }
}

async function handleCrmDataSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const notice = form.querySelector('#crmDataNotice');
  const submit = form.querySelector('#crmDataSaveButton');
  updateCrmDataStateFromForm(form);

  if (notice) {
    notice.className = 'hidden';
    notice.textContent = '';
  }

  if (submit) {
    submit.disabled = true;
    submit.textContent = 'Сохраняем...';
  }

  try {
    const result = await api('/api/crm-data', {
      method: 'POST',
      body: JSON.stringify({
        bookingName: crmDataState.bookingName,
        bookingUrl: crmDataState.bookingUrl,
        authType: crmDataState.authType,
        login: crmDataState.login,
        password: crmDataState.password
      })
    });

    updateCrmDataState(result.item || crmDataState);
    if (notice) {
      notice.className = 'notice success';
      notice.textContent = 'Данные CRM сохранены.';
    }
  } catch (error) {
    if (notice) {
      notice.className = 'notice error';
      notice.textContent = error.message || 'Не удалось сохранить данные CRM.';
    }
  } finally {
    if (submit) {
      submit.disabled = false;
      submit.textContent = 'Сохранить';
    }
  }
}

function setupCrmDataForm() {
  document.querySelector('#crmDataForm')?.addEventListener('submit', handleCrmDataSubmit);
  document.querySelector('#crmDataOpenBookingButton')?.addEventListener('click', openCrmBookingExternal);
  document.querySelector('#crmDataOpenIframeButton')?.addEventListener('click', openCrmBookingIframe);
}

async function renderCrmData() {
  setHeader('Данные CRM');
  setActiveNavigation('crm-data');
  showLoading();

  try {
    const { item } = await api('/api/crm-data');
    updateCrmDataState(item || {});

    app.innerHTML = `
      <div class="crm-data-page">
        <section class="card crm-data-card">
          <header class="profile-section-header crm-data-header">
            <div>
              <h2>Данные CRM</h2>
              <p>Настройки Booking-системы, связанные с текущим профилем партнёра.</p>
            </div>
          </header>
          ${crmDataFormHtml()}
        </section>
      </div>
    `;

    setupCrmDataForm();
  } catch (error) {
    showError(error);
  }
}

async function renderProfile() {
  setHeader('Профиль');
  setActiveNavigation('profile');
  showLoading();

  try {
    const { item } = await api('/api/profile?refresh=1');
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
    const requisitesBody = profileRequisitesHtml(requisites);
    const notificationChannels = profile.notificationChannels || [];
    updateProfileNotificationChannelsState(notificationChannels);
    const notificationChannelsAction = profileNotificationChannelsActionHtml(false);
    const agentReport = profile.agentReport || {};
    updateProfileAgentReportState(agentReport);
    const agentReportBody = profileAgentReportBodyHtml(agentReport);
    const agentReportAction = '<button id="profileAgentReportEditButton" class="button secondary profile-agent-report-edit" type="button">Изменить</button>';

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
            <button id="profileModerationButton" class="button secondary" type="button">Заявка на модерацию</button>
            <button id="profileSetPasswordButton" class="button secondary" type="button">Установить пароль</button>
          </div>
        </section>

        <div class="profile-grid">
          ${profileSection('Контакты', contactsBody)}
          ${profileSectionWithAction('Канал связи для уведомлений', profileNotificationChannelsHtml(profileNotificationChannelsState.channels), notificationChannelsAction, 'profile-notification-channels-card')}
          ${profileSection('Локация и рабочее время', workItems.length ? workItems.join('') : profileEmpty('Информация не указана'))}
          ${profileSection('Документы', documentsBody)}
          ${profileSection('Реквизиты компании / Банковские реквизиты', requisitesBody)}
          ${profileSection('Дополнительная информация', profile.additionalInfo ? `<p>${profileMultilineText(profile.additionalInfo)}</p>` : profileEmpty('Информация не указана'))}
          ${profileSectionWithAction('Отчет агента', agentReportBody, agentReportAction, 'profile-agent-report-card')}
        </div>
      </div>
    `;

    document.querySelector('#profileModerationButton')?.addEventListener('click', openProfileModerationDialog);
    document.querySelector('#profileSetPasswordButton')?.addEventListener('click', openProfilePasswordFlow);
    setupProfileNotificationChannelsPanel();
    document.querySelector('#profileAgentReportEditButton')?.addEventListener('click', () => openProfileAgentReportDialog(agentReport));
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
  setHeader('Оплаты');
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
      <div class="stack payment-detail-page">
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

    return `
      <div class="table-action-stack">
        <button class="button certificate-list-action table-action-button" type="button" data-certificate-accept-id="${escapeHtml(certificate.id)}">Принять в работу</button>
        <button class="button certificate-list-action table-action-button" type="button" data-certificate-schedule-id="${escapeHtml(certificate.id)}">Записать</button>
      </div>
    `;
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
              <button class="button certificate-list-action" type="button" data-certificate-accept-id="${escapeHtml(certificate.id)}">Принять в работу</button>
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

  const currentPath = window.location.pathname === '/' ? DEFAULT_APP_PATH : window.location.pathname;
  const parts = currentPath.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
  const [root, id, action] = parts;

  if (root === 'admin') {
    stopQrScanner({ keepModalOpen: false });
    if (id === 'register') return renderAdminRegister();
    if (!currentAdmin) return renderAdminSignIn();
    if (!id || id === 'push') {
      if (action === 'campaigns') return renderAdminPushCampaigns();
      if (action === 'devices') return renderAdminPushDevices();
      if (action === 'logs') return renderAdminPushLogs();
      return renderAdminPush();
    }
    navigate(ADMIN_PUSH_PATH, { replace: true });
    return;
  }

  resetAppNavigation();
  document.body.classList.remove('is-admin', 'is-admin-auth');

  if (!currentUser) {
    renderSignIn();
    return;
  }

  if (window.location.pathname === SIGN_IN_PATH) {
    leaveSignInPathAfterAuth();
  }

  stopQrScanner({ keepModalOpen: false });

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
  if (root === 'new-requests') return renderNewRequests();
  if (root === 'services' && id === 'create') return renderServiceCreateScreen();
  if (root === 'services' && id && action === 'description') return renderServiceDescriptionScreen(id);
  if (root === 'services') return renderServices();
  if (root === 'reconciliations') return renderReconciliations();
  if (root === 'profile' && id === 'moderation') return renderProfileModerationScreen();
  if (root === 'profile' && id === 'password') return renderProfilePasswordScreen();
  if (root === 'profile' && id === 'agent-report') return renderProfileAgentReportScreen();
  if (root === 'profile') return renderProfile();
  if (root === 'crm-data') return renderCrmData();
  if (root === 'payments' && id === 'create') return renderCreatePayment();
  if (root === 'payments' && id) return renderPaymentDetail(id);
  if (root === 'payments') return renderPayments();

  navigate(DEFAULT_APP_PATH, { replace: true });
}

window.addEventListener('beforeunload', () => stopQrScanner());
window.addEventListener('popstate', () => {
  closeMobileMenu();
  route();
});
logoutButton?.addEventListener('click', signOut);
mobileMenuButton?.addEventListener('click', openMobileMenu);
mobileMenuCloseButton?.addEventListener('click', closeMobileMenu);
mobileMenuOverlay?.addEventListener('click', (event) => {
  if (event.target.closest?.('[data-mobile-menu-close]')) closeMobileMenu();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeMobileMenu();
});
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
  closeMobileMenu();
  navigate(`${url.pathname}${url.search}`);
});
window.addEventListener('DOMContentLoaded', async () => {
  if (isAdminRoutePath()) {
    await initializeAdminAuth();
    return;
  }

  const authenticated = await initializeAuth();
  if (authenticated) {
    route();
    initializePushClient();
  }
});
