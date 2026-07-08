const app = document.querySelector('#app');
const pageTitle = document.querySelector('#pageTitle');
const backButton = document.querySelector('#backButton');

const createRequestState = {
  items: [],
  selectedIds: new Set(),
  periodFrom: '',
  periodTo: ''
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
        window.location.hash = options.backTo;
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
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    ...options
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || 'Ошибка запроса');
  }

  return payload;
}

function statusHtml(statusMap, status) {
  const meta = statusMap[status] || { label: status || '—', className: '' };
  return `<span class="status ${meta.className}">${escapeHtml(meta.label)}</span>`;
}

let qrStream = null;
let qrScanFrame = null;
let qrDetector = null;
let qrDetectionBusy = false;

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

async function detectQrLoop(video) {
  if (!qrDetector || !qrStream || video.readyState < 2) {
    qrScanFrame = window.requestAnimationFrame(() => detectQrLoop(video));
    return;
  }

  if (!qrDetectionBusy) {
    qrDetectionBusy = true;
    try {
      const codes = await qrDetector.detect(video);
      const qrCode = codes.find((code) => code.rawValue);
      if (qrCode) {
        setQrStatus('QR код найден. Заполняю данные...', 'success');
        applyQrPayload(qrCode.rawValue);
        return;
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

  if ('BarcodeDetector' in window) {
    try {
      qrDetector = new BarcodeDetector({ formats: ['qr_code'] });
      setQrStatus('Наведите камеру на QR код сертификата.');
      detectQrLoop(video);
    } catch (_error) {
      setQrStatus('Камера открыта. Автораспознавание QR недоступно в этом браузере — используйте ручной ввод ниже.', 'error');
    }
  } else {
    setQrStatus('Камера открыта. Автораспознавание QR недоступно в этом браузере — используйте ручной ввод ниже.', 'error');
  }
}


function certificateCard(certificate) {
  return `
    <a class="card certificate-card" href="#certificates/${certificate.id}">
      <div class="card-topline">
        <div class="card-title">${escapeHtml(certificate.certificateNumber)}</div>
        <div class="money">${formatPlainMoney(certificate.amountCents)}</div>
      </div>
      <div class="dashed-line"></div>
      <div class="card-subtitle">${escapeHtml(certificate.title)}</div>
      <div class="status-row">
        <span>${formatDate(certificate.serviceDate)} · ${formatTime(certificate.serviceTime)}</span>
        ${statusHtml(certificateStatus, certificate.status)}
      </div>
    </a>
  `;
}

function paymentCard(paymentRequest) {
  return `
    <a class="card payment-card" href="#payments/${paymentRequest.id}">
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
          <span class="scan-icon">▦</span>
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
            <p class="qr-hint">Разрешите доступ к камере и наведите объектив на QR код сертификата. Камера работает на телефоне и на компьютере при открытии приложения по HTTPS или на localhost.</p>
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
            <div class="field">
              <label for="customerFullName">Ф.И.О.:</label>
              <input id="customerFullName" name="customerFullName" placeholder="Ф.И.О. клиента" />
            </div>
            <div class="field">
              <label for="customerPhone">Телефон:</label>
              <input id="customerPhone" name="customerPhone" placeholder="Телефон" />
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
      window.location.hash = `#certificates/${result.item.id}`;
    } catch (error) {
      notice.className = 'notice error';
      notice.textContent = error.message;
    } finally {
      submit.disabled = false;
    }
  });
}

async function renderCertificates() {
  setHeader('Погашенные сертификаты');
  setActiveNavigation('certificates');
  showLoading();

  try {
    const data = await api('/api/certificates/redeemed');
    const itemsHtml = data.items.length
      ? data.items.map(certificateCard).join('')
      : '<div class="empty-state">Погашенных сертификатов пока нет.</div>';

    app.innerHTML = `
      <div class="stack">
        <div class="card pad">
          <div class="filters">
            <div class="filter-field">
              <label for="statusFilter">Статус</label>
              <select id="statusFilter">
                <option value="">Все</option>
                <option value="REDEEMED">Погашено</option>
                <option value="PAYMENT_PROCESSING">В процессе оплаты</option>
                <option value="PAID">Оплачено</option>
              </select>
            </div>
            <div class="filter-field">
              <label for="fromFilter">С даты</label>
              <input id="fromFilter" type="date" />
            </div>
            <div class="filter-field">
              <label for="toFilter">По дату</label>
              <input id="toFilter" type="date" />
            </div>
            <button id="applyCertificateFilters" class="button secondary" type="button">Применить</button>
          </div>
        </div>
        <div id="certificatesList" class="list">${itemsHtml}</div>
      </div>
    `;

    document.querySelector('#applyCertificateFilters').addEventListener('click', loadFilteredCertificates);
  } catch (error) {
    showError(error);
  }
}

async function loadFilteredCertificates() {
  const params = new URLSearchParams();
  const status = document.querySelector('#statusFilter').value;
  const from = document.querySelector('#fromFilter').value;
  const to = document.querySelector('#toFilter').value;

  if (status) params.set('status', status);
  if (from) params.set('from', from);
  if (to) params.set('to', to);

  const list = document.querySelector('#certificatesList');
  list.innerHTML = '<div class="loading-card">Загрузка...</div>';

  try {
    const data = await api(`/api/certificates/redeemed?${params.toString()}`);
    list.innerHTML = data.items.length
      ? data.items.map(certificateCard).join('')
      : '<div class="empty-state">По выбранным фильтрам сертификатов нет.</div>';
  } catch (error) {
    list.innerHTML = `<div class="error-state">${escapeHtml(error.message)}</div>`;
  }
}

async function renderCertificateDetail(id) {
  setHeader('Информация о сертификате', { backTo: '#certificates' });
  setActiveNavigation('certificates');
  showLoading();

  try {
    const { item } = await api(`/api/certificates/${id}`);
    app.innerHTML = `
      <section class="card detail-card">
        <img class="hero-image" src="${escapeHtml(item.imageUrl || '/assets/quad.svg')}" alt="${escapeHtml(item.title)}" />
        <div class="detail-body">
          <h2 class="detail-title">${escapeHtml(item.title)}</h2>
          <div class="detail-table">
            <div class="detail-row"><span>Сертификат №</span><strong>${escapeHtml(item.certificateNumber)}</strong></div>
            <div class="detail-row"><span>Дата записи на услугу:</span><strong>${formatDate(item.serviceDate)}</strong></div>
            <div class="detail-row"><span>Время записи:</span><strong>${formatTime(item.serviceTime)}</strong></div>
            <div class="detail-row"><span>Ф.И.О.</span><strong>${escapeHtml(item.customerFullName || '—')}</strong></div>
            <div class="detail-row"><span>Телефон:</span><strong>${escapeHtml(item.customerPhone || '—')}</strong></div>
            <div class="detail-row total"><span>Сумма:</span><strong>${formatMoney(item.amountCents)}</strong></div>
            <div class="detail-row"><span>Статус:</span><strong>${statusHtml(certificateStatus, item.status)}</strong></div>
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
          <a class="button" href="#payments/create">Создать заявку</a>
        </section>
        <div class="list">${itemsHtml}</div>
      </div>
    `;
  } catch (error) {
    showError(error);
  }
}

async function renderPaymentDetail(id) {
  setHeader('Информация по заявке', { backTo: '#payments' });
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
  setHeader('Создать заявку', { backTo: '#payments' });
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
    window.location.hash = `#payments/${result.item.id}`;
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
        <td>${statusHtml(certificateStatus, certificate.status)}</td>
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
            ${statusHtml(certificateStatus, certificate.status)}
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
  stopQrScanner({ keepModalOpen: false });
  const hash = window.location.hash || '#redeem';
  const [root, id] = hash.replace(/^#/, '').split('/');

  if (!window.location.hash) {
    window.location.hash = '#redeem';
    return;
  }

  if (root === 'redeem') return renderRedeem();
  if (root === 'certificates' && id) return renderCertificateDetail(id);
  if (root === 'certificates') return renderCertificates();
  if (root === 'payments' && id === 'create') return renderCreatePayment();
  if (root === 'payments' && id) return renderPaymentDetail(id);
  if (root === 'payments') return renderPayments();

  window.location.hash = '#redeem';
}

window.addEventListener('beforeunload', () => stopQrScanner());
window.addEventListener('hashchange', route);
window.addEventListener('DOMContentLoaded', route);
