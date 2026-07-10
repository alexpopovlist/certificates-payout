# Приложение для погашенных сертификатов и заявок на оплату

Проект сделан на **Node.js + Express** и **PostgreSQL**. Интерфейс — адаптивная web-версия: на мобильной ширине повторяет структуру экранов из скриншотов, на desktop использует боковую навигацию, широкие карточки и таблицы.

## Что реализовано

- Погашение сертификата вручную по номеру и секретному коду.
- Экран **«Погашенные сертификаты»** со списком сертификатов.
- Детальная карточка погашения сертификата.
- Экран **«Заявки на оплату»** со сформированными заявками в статусах «В обработке» и «Оплачено».
- Детальная карточка заявки со списком сертификатов внутри заявки.
- Экран **«Создать заявку»**:
  - по умолчанию выбраны все погашенные, но ранее не выплаченные сертификаты;
  - есть фильтр по периоду;
  - в заголовке отображаются сумма к оплате и количество выбранных сертификатов;
  - после создания сертификаты переходят в статус «В процессе оплаты».
- Миграции PostgreSQL для создания структуры БД и демо-данных.

## Статусы

### Сертификат

- `REDEEMED` — Погашено
- `PAYMENT_PROCESSING` — В процессе оплаты
- `PAID` — Оплачено

В БД также есть технический статус `NEW` для сертификатов, которые еще можно погасить вручную.

### Заявка на оплату

- `PROCESSING` — Заявка в обработке
- `PAID` — Оплачено

## Быстрый старт

```bash
cp .env.example .env
docker compose up -d
npm install
npm run db:migrate
npm run dev
```

Откройте приложение: `http://localhost:3000`.

## Демо для ручного погашения

В миграции с демо-данными создан сертификат:

- номер: `S00000001`
- секретный код: `123456`

После погашения он появится в списке погашенных сертификатов и будет доступен для новой заявки на оплату.

## Структура проекта

```text
certificates-payout-app/
  migrations/             SQL-миграции PostgreSQL
  public/                 HTML/CSS/JS web-интерфейса
  src/                    Node.js backend
    routes/               API-маршруты
    db.js                 подключение к PostgreSQL
    migrate.js            простой migration runner
    server.js             Express-приложение
  docker-compose.yml      PostgreSQL для локального запуска
  package.json
```


## PUSH-уведомления для ярлыка на телефоне

Добавлен PWA-сервис для PUSH-уведомлений:

- приложение получает `manifest.webmanifest`, `sw.js` и иконки для установки как ярлык на телефон;
- если пользователь открыл приложение из ярлыка и выдал разрешение на уведомления, браузер создаёт PUSH-подписку;
- подписка сохраняется в PostgreSQL в таблицу `push_subscriptions`;
- отправка уведомлений выполняется всем активным подпискам, где приложение было запущено из ярлыка (`installed = true`);
- автоматические PUSH отправляются при погашении сертификата, создании заявки на оплату и переводе заявки в статус «Оплачено»;
- также доступен ручной broadcast endpoint для отправки произвольного уведомления.

### Env-переменные для PUSH

Сначала сгенерируйте VAPID-ключи:

```bash
npm run push:keys
```

Добавьте значения в `.env` или Railway Variables:

```env
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:admin@example.com
PUSH_ADMIN_TOKEN=change-me
```

`PUSH_ADMIN_TOKEN` опционален, но для production лучше задать его. Если токен задан, отправка PUSH требует заголовок `X-Push-Admin-Token` или `Authorization: Bearer`.

### Отправка PUSH всем установленным ярлыкам

```bash
curl -X POST https://YOUR_DOMAIN/api/push/broadcast \
  -H "Content-Type: application/json" \
  -H "X-Push-Admin-Token: change-me" \
  -d '{
    "title": "WowLife",
    "body": "Новая заявка или обновление по сертификатам",
    "url": "/certificates"
  }'
```

По умолчанию отправка идёт только клиентам, которые открыли приложение из ярлыка. Для отправки всем активным PUSH-подпискам можно передать:

```json
{
  "installedOnly": false
}
```

### Проверка количества подписок

```bash
curl https://YOUR_DOMAIN/api/push/subscriptions/summary \
  -H "X-Push-Admin-Token: change-me"
```

Важно: PUSH и установка ярлыка в production работают через HTTPS. На Railway публичный домен уже работает по HTTPS.

## API

### Сертификаты

- `GET /api/certificates/redeemed?page=1&limit=20` — список сертификатов. Источник задаётся `CERTIFICATES_USE_SERVICE`: `true` — WOWlife, `false` — локальная PostgreSQL БД.
- `GET /api/certificates/:id` — детальная информация по сертификату. При `CERTIFICATES_USE_SERVICE=true` запрашивается WOWlife с фильтром `certificate_id = :id`, при `false` — локальная БД.
- `POST /api/certificates/redeem` — погасить сертификат вручную.

По умолчанию страница `/certificates` читает данные из WOWlife. Чтобы переключиться на локальную БД, задайте `CERTIFICATES_USE_SERVICE=false`. При `CERTIFICATES_USE_SERVICE=true` backend вызывает:

```text
POST https://partner-wowlife.ru/restapi/certificate.getPartnerCertificates
```

Базовый payload формируется так:

```json
{
  "page": 1,
  "limit": 20,
  "order": "DESC",
  "groupIds": ["new", "waiting", "confirmed", "visited", "verification", "paid", "canceled"],
  "allIds": ["485"],
  "filters": {}
}
```

Для детальной карточки сертификата backend вызывает тот же метод с точным фильтром:

```json
{
  "page": 1,
  "limit": 20,
  "order": "DESC",
  "groupIds": ["new", "waiting", "confirmed", "visited", "verification", "paid", "canceled"],
  "allIds": ["485"],
  "filters": {
    "certificate_id": {
      "=": "197181"
    }
  }
}
```

`allIds` берётся из сессии авторизации WOWlife: сначала из `allIds`, затем fallback на `contactId`.

Env-переменные источника сертификатов:

```env
# true — брать сертификаты из WOWlife, false — из локальной PostgreSQL БД
CERTIFICATES_USE_SERVICE=true
CERTIFICATES_SERVICE_URL=https://partner-wowlife.ru/restapi/certificate.getPartnerCertificates
CERTIFICATES_GROUP_IDS=new,waiting,confirmed,visited,verification,paid,canceled
```

### Заявки на оплату

- `GET /api/payment-requests` — список заявок и общая сумма выплат.
- `GET /api/payment-requests/:id` — детальная информация по заявке.
- `GET /api/payment-requests/candidates?from=YYYY-MM-DD&to=YYYY-MM-DD` — сертификаты для новой заявки.
- `POST /api/payment-requests` — создать заявку.
- `PATCH /api/payment-requests/:id/pay` — отметить заявку оплаченной.



## Обновления интерфейса

- Интерфейс переведён на стиль проекта WowLife: шрифт Manrope, светлая админ-тема, обновлённый фон, карточки, навигация и логотип.
- Кнопка «Сканировать по QR коду» открывает модальное окно с камерой через `navigator.mediaDevices.getUserMedia`.
- Автораспознавание QR работает через браузерный `BarcodeDetector`, если он поддерживается устройством/браузером.
- Поддерживаемые форматы QR:
  - JSON: `{"certificateNumber":"S00000001","secretCode":"123456"}`
  - URL query: `...?certificateNumber=S00000001&secretCode=123456`
  - простая строка: `S00000001 123456`
- Доступ к камере в production работает только по HTTPS. На локальной машине работает через `localhost`.

## Авторизация через WOWlife

Приложение защищает API и интерфейс локальной сессией. Пользователь вводит логин и пароль на форме входа, а backend выполняет двухшаговую авторизацию WOWlife.

1. Первый запрос:

```http
POST https://partner-wowlife.ru/restapi/auth.goPassword
```

Тело запроса формируется сервером из введённых пользователем данных:

```json
{
  "domain": "wowlife-crm.ru",
  "cabinet": "partner",
  "method": "password",
  "login": "значение_из_формы",
  "password": "значение_из_формы"
}
```

2. Если первый шаг вернул `contactId` и `token`, сервер выполняет второй запрос:

```http
POST https://partner-wowlife.ru/restapi/auth.authorization
```

```json
{
  "domain": "wowlife-crm.ru",
  "cabinet": "partner",
  "contactId": "contactId_из_первого_шага",
  "token": "token_из_первого_шага"
}
```

После успешного второго шага backend создаёт локальную `HttpOnly` session-cookie. Пароль пользователя в сессию не сохраняется.

Для SMS-авторизации backend использует цепочку:

1. `POST /restapi/auth.getCode` с `contact` и `method: "phone"`;
2. `POST /restapi/auth.authentication` с `contact`, `code` и `method: "phone"`;
3. `POST /restapi/auth.authorization` с `contactId` и `token`.

Если первый ответ WOWlife содержит `contactId` и `token` не на верхнем уровне, backend теперь ищет эти поля рекурсивно и без учёта регистра (`contactId`, `contact_id`, `CONTACT_ID`, `id`, `ID`, `token`, `TOKEN`). Для редкой нестандартной структуры можно явно указать пути через `AUTH_PASSWORD_CONTACT_ID_PATH` и `AUTH_PASSWORD_TOKEN_PATH`.

Переменные окружения:

```env
AUTH_BASE_URL=https://partner-wowlife.ru
AUTH_PASSWORD_URL=https://partner-wowlife.ru/restapi/auth.goPassword
AUTH_CODE_URL=https://partner-wowlife.ru/restapi/auth.getCode
AUTH_AUTHENTICATION_URL=https://partner-wowlife.ru/restapi/auth.authentication
AUTH_AUTHORIZATION_URL=https://partner-wowlife.ru/restapi/auth.authorization
AUTH_DOMAIN=wowlife-crm.ru
AUTH_CABINET=partner
AUTH_METHOD=password
AUTH_PHONE_METHOD=phone
# Optional: only if WOWlife returns contactId/token in a non-standard nested shape.
# Examples: data.contact.id, result.contact.ID, data.token
AUTH_PASSWORD_CONTACT_ID_PATH=
AUTH_PASSWORD_TOKEN_PATH=
AUTH_SESSION_SECRET=replace-with-long-random-string
AUTH_SESSION_TTL_SECONDS=604800
```

Для локальной разработки без внешней авторизации можно временно поставить:

```env
AUTH_DISABLED=true
```

Для production это значение использовать нельзя.

## PUSH-уведомления для ярлыка на телефоне

Добавлен PWA-сервис для PUSH-уведомлений:

- приложение получает `manifest.webmanifest`, `sw.js` и иконки для установки как ярлык на телефон;
- если пользователь открыл приложение из ярлыка и выдал разрешение на уведомления, браузер создаёт PUSH-подписку;
- подписка сохраняется в PostgreSQL в таблицу `push_subscriptions`;
- отправка уведомлений выполняется всем активным подпискам, где приложение было запущено из ярлыка (`installed = true`);
- автоматические PUSH отправляются при погашении сертификата, создании заявки на оплату и переводе заявки в статус «Оплачено»;
- также доступен ручной broadcast endpoint для отправки произвольного уведомления.

### Env-переменные для PUSH

Сначала сгенерируйте VAPID-ключи:

```bash
npm run push:keys
```

Добавьте значения в `.env` или Railway Variables:

```env
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:admin@example.com
PUSH_ADMIN_TOKEN=change-me
```

`PUSH_ADMIN_TOKEN` опционален, но для production лучше задать его. Если токен задан, отправка PUSH требует заголовок `X-Push-Admin-Token` или `Authorization: Bearer`.

### Отправка PUSH всем установленным ярлыкам

```bash
curl -X POST https://YOUR_DOMAIN/api/push/broadcast \
  -H "Content-Type: application/json" \
  -H "X-Push-Admin-Token: change-me" \
  -d '{
    "title": "WowLife",
    "body": "Новая заявка или обновление по сертификатам",
    "url": "/certificates"
  }'
```

По умолчанию отправка идёт только клиентам, которые открыли приложение из ярлыка. Для отправки всем активным PUSH-подпискам можно передать:

```json
{
  "installedOnly": false
}
```

### Проверка количества подписок

```bash
curl https://YOUR_DOMAIN/api/push/subscriptions/summary \
  -H "X-Push-Admin-Token: change-me"
```

Важно: PUSH и установка ярлыка в production работают через HTTPS. На Railway публичный домен уже работает по HTTPS.

## API

### Сертификаты

- `GET /api/certificates/redeemed?page=1&limit=20` — список сертификатов. Источник задаётся `CERTIFICATES_USE_SERVICE`: `true` — WOWlife, `false` — локальная PostgreSQL БД.
- `GET /api/certificates/:id` — детальная информация по сертификату. При `CERTIFICATES_USE_SERVICE=true` запрашивается WOWlife с фильтром `certificate_id = :id`, при `false` — локальная БД.
- `POST /api/certificates/redeem` — погасить сертификат вручную.

По умолчанию страница `/certificates` читает данные из WOWlife. Чтобы переключиться на локальную БД, задайте `CERTIFICATES_USE_SERVICE=false`. При `CERTIFICATES_USE_SERVICE=true` backend вызывает:

```text
POST https://partner-wowlife.ru/restapi/certificate.getPartnerCertificates
```

Базовый payload формируется так:

```json
{
  "page": 1,
  "limit": 20,
  "order": "DESC",
  "groupIds": ["new", "waiting", "confirmed", "visited", "verification", "paid", "canceled"],
  "allIds": ["485"],
  "filters": {}
}
```

Для детальной карточки сертификата backend вызывает тот же метод с точным фильтром:

```json
{
  "page": 1,
  "limit": 20,
  "order": "DESC",
  "groupIds": ["new", "waiting", "confirmed", "visited", "verification", "paid", "canceled"],
  "allIds": ["485"],
  "filters": {
    "certificate_id": {
      "=": "197181"
    }
  }
}
```

`allIds` берётся из сессии авторизации WOWlife: сначала из `allIds`, затем fallback на `contactId`.

Env-переменные источника сертификатов:

```env
# true — брать сертификаты из WOWlife, false — из локальной PostgreSQL БД
CERTIFICATES_USE_SERVICE=true
CERTIFICATES_SERVICE_URL=https://partner-wowlife.ru/restapi/certificate.getPartnerCertificates
CERTIFICATES_GROUP_IDS=new,waiting,confirmed,visited,verification,paid,canceled
```

### Заявки на оплату

- `GET /api/payment-requests` — список заявок и общая сумма выплат.
- `GET /api/payment-requests/:id` — детальная информация по заявке.
- `GET /api/payment-requests/candidates?from=YYYY-MM-DD&to=YYYY-MM-DD` — сертификаты для новой заявки.
- `POST /api/payment-requests` — создать заявку.
- `PATCH /api/payment-requests/:id/pay` — отметить заявку оплаченной.



## Обновления интерфейса

- Интерфейс переведён на стиль проекта WowLife: шрифт Manrope, светлая админ-тема, обновлённый фон, карточки, навигация и логотип.
- Кнопка «Сканировать по QR коду» открывает модальное окно с камерой через `navigator.mediaDevices.getUserMedia`.
- Автораспознавание QR работает через браузерный `BarcodeDetector`, если он поддерживается устройством/браузером.
- Поддерживаемые форматы QR:
  - JSON: `{"certificateNumber":"S00000001","secretCode":"123456"}`
  - URL query: `...?certificateNumber=S00000001&secretCode=123456`
  - простая строка: `S00000001 123456`
- Доступ к камере в production работает только по HTTPS. На локальной машине работает через `localhost`.

### Роут экрана авторизации

Экран авторизации доступен по прямому URL:

```text
/authentication/sign-in
```

Если пользователь не авторизован и открывает любой защищённый раздел, приложение переводит его на `/authentication/sign-in` и сохраняет исходный путь в `next`.

## Профиль партнёра

Добавлен экран `/profile`. Данные профиля берутся из WOWlife:

```http
POST https://partner-wowlife.ru/restapi/profile.getProfile
```

Backend отправляет `cabinet`, `contactId` и `token` из текущей авторизационной сессии партнёра. URL можно переопределить через переменную окружения:

```env

### Источник заявок на оплату

Для экрана `/payments` используется та же env-переменная, что и для сертификатов:

```env
CERTIFICATES_USE_SERVICE=true
```

- `true` — список заявок и детальная карточка заявки берутся из WOWlife через `POST /restapi/certificate.getVerifications`; кнопка создания локальной заявки скрывается, потому что модель создания заявки в WOWlife пока не задана;
- `false` — данные берутся из локальной PostgreSQL БД.

Для WOWlife-заявок настройте URL сервиса:

```env
VERIFICATIONS_SERVICE_URL=https://partner-wowlife.ru/restapi/certificate.getVerifications
```

Backend формирует payload из текущей авторизационной сессии:

```json
{"allIds":["485"]}
```

```env
PROFILE_SERVICE_URL=https://partner-wowlife.ru/restapi/profile.getProfile
PROFILE_CABINET=partnerLow
PROFILE_CACHE_TTL_MS=300000
```

Для адресов записи используется поле `UF_CRM_1692176867840` из ответа `profile.getProfile`; запрос к профилю кешируется на клиенте и на backend, поэтому при повторном открытии диалога «Записать» уже загруженные адреса не запрашиваются повторно. `contactId` и `token` для `/api/profile` всегда берутся из текущей авторизационной сессии партнёра, без env-fallback и без хардкода. Если `/api/profile` получает пустой профиль, backend повторно выполняет `auth.authorization` по текущим данным сессии и затем повторяет `profile.getProfile`; пустой ответ WOWlife не кешируется.

На экране отображаются блоки: контакты, каналы связи для уведомлений, локация и рабочее время, документы, финансовые реквизиты и дополнительная информация.

## Запись сертификата из статуса «Новая заявка»

Если `CERTIFICATES_USE_SERVICE=true`, на детальной странице сертификата `/certificates/:id` для статуса `new` / «Новая заявка» отображается кнопка **«Записать»**. По нажатию открывается диалог «Редактирование услуги» с полями:

- название услуги;
- дата;
- время;
- телефон для связи;
- адрес проведения;
- примечание.

После подтверждения backend вызывает WOWlife:

```http
POST https://partner-wowlife.ru/restapi/certificate.changeCertificateStage
```

Payload формируется в формате:

```json
{
  "dealId": 206729,
  "title": "Тест",
  "date": "2026-05-09",
  "time": "00:00",
  "phone": "+79523925520",
  "address": "Москва, ул. Гончарная набережная, д. 9/16, с. 2 (Гончарная студия &quot;Pause&quot;)|0;0|31738",
  "addressArray": [
    "Москва, ул. Гончарная набережная, д. 9/16, с. 2 (Гончарная студия &quot;Pause&quot;)|0;0|31738"
  ],
  "notes": "",
  "cancel": "",
  "datetime": "2026-05-09T00:00:00",
  "stageId": "C2:UC_4Q05NY"
}
```

Настройки:

```env
CERTIFICATE_STAGE_CHANGE_URL=https://partner-wowlife.ru/restapi/certificate.changeCertificateStage
CERTIFICATE_SCHEDULE_STAGE_ID=C2:UC_4Q05NY
CERTIFICATE_NEW_STAGE_ID=C2:UC_MCMFWK
CERTIFICATE_SCHEDULE_TIME_ZONE=Europe/Moscow
```

### Просмотр данных сертификата перед погашением

На странице `/redeem` кнопка **«Показать информацию»** вызывает WOWlife-сервис:

```env
CERTIFICATE_REDEEM_INFO_URL=https://partner-wowlife.ru/restapi/certificate.getCertificateForRedeem
CERTIFICATE_REDEEM_URL=https://partner-wowlife.ru/restapi/certificate.redeemCertificate
```

Backend формирует payload из номера сертификата, секретного кода и `allIds` текущей авторизованной сессии, например:

```json
{
  "number": "F3",
  "code": "3",
  "allIds": ["485"]
}
```

В ответе отображаются номер сертификата, имя получателя, услуга, сумма, дата, email и телефон.

## Сверки

Добавлена вкладка `/reconciliations` — **Сверки**. В ней отображаются сертификаты в статусе `visited` / «Посетил».

При `CERTIFICATES_USE_SERVICE=true` таблица загружается через WOWlife:

```http
POST https://partner-wowlife.ru/restapi/certificate.getPartnerCertificates
```

Payload:

```json
{
  "page": 1,
  "limit": 1000,
  "groupIds": ["visited"],
  "allIds": ["<id партнера из сессии>"]
}
```

Кнопка **«Создать сверку»** добавлена в интерфейс. Перед отображением доступности кнопки выполняется проверка через WOWlife:

```http
POST https://partner-wowlife.ru/restapi/certificate.getLastVerificationDate
```

Payload:

```json
{
  "allIds": ["<id партнера из сессии>"]
}
```

Если сервис возвращает `daysLeft > 0`, кнопка блокируется и выводится сообщение вида: **«Новая сверка будет доступна через 13 дней»**.

При нажатии на доступную кнопку **«Создать сверку»** выполняется запрос:

```http
POST https://partner-wowlife.ru/restapi/certificate.createVerification
```

Payload:

```json
{
  "allIds": ["<id партнера из сессии>"]
}
```


## Services page

Added `/services` — **Услуги**. The page loads partner services from WOWlife:

```http
POST https://partner-wowlife.ru/restapi/product.getPartnerProducts
```

Payload `allIds` формируется из данных профиля партнёра, полученных через `profile.getProfile`:

```json
{"allIds":["<id партнёра из профиля>"]}
```

Displayed columns:
- Название
- Цена
- Открытая цена
- Дата начала
- Сайт
- Действия

Configuration:

```env
PRODUCTS_SERVICE_URL=https://partner-wowlife.ru/restapi/product.getPartnerProducts
```

`PRODUCTS_ALL_IDS` больше не используется: идентификаторы для `product.getPartnerProducts` берутся из профиля партнёра.
