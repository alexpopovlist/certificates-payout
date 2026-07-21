const { query } = require('../db');

const BOOKING_NAME_OPTIONS = ['yclients', 'dikidi Business', 'Собственная', 'Отсутствует', 'Нет данных'];
const AUTH_TYPE_OPTIONS = ['Базовый', 'Нет данных'];

function normalizeText(value) {
  return String(value ?? '').trim();
}

function getSessionProfileId(session) {
  const candidates = [
    session?.upstream?.contactId,
    session?.upstream?.profileContactId,
    session?.user?.id,
    session?.upstream?.allIds?.[0]
  ];

  const profileId = candidates
    .map((value) => normalizeText(value))
    .find(Boolean);

  if (!profileId) {
    const error = new Error('No profile id in session');
    error.statusCode = 401;
    error.publicMessage = 'В сессии не найден ID профиля. Войдите в приложение заново.';
    throw error;
  }

  return profileId;
}

function normalizeOption(value, options, fallback) {
  const text = normalizeText(value);
  return options.includes(text) ? text : fallback;
}

function normalizeBookingCrmData(value = {}) {
  return {
    bookingName: normalizeOption(value.bookingName ?? value.booking_name, BOOKING_NAME_OPTIONS, 'Нет данных'),
    bookingUrl: normalizeText(value.bookingUrl ?? value.booking_url),
    authType: normalizeOption(value.authType ?? value.auth_type, AUTH_TYPE_OPTIONS, 'Нет данных'),
    login: normalizeText(value.login),
    password: normalizeText(value.password)
  };
}

function mapRow(row = {}, profileId = '') {
  return {
    profileId: normalizeText(row.profile_id || profileId),
    bookingName: row.booking_name || 'Нет данных',
    bookingUrl: row.booking_url || '',
    authType: row.auth_type || 'Нет данных',
    login: row.login || '',
    password: row.password || '',
    updatedAt: row.updated_at || null
  };
}

function defaultBookingCrmData(profileId) {
  return {
    profileId,
    bookingName: 'Нет данных',
    bookingUrl: '',
    authType: 'Нет данных',
    login: '',
    password: '',
    updatedAt: null
  };
}

async function getBookingCrmData({ session } = {}) {
  const profileId = getSessionProfileId(session);
  const { rows } = await query(
    `SELECT profile_id, booking_name, booking_url, auth_type, login, password, updated_at
       FROM profile_booking_crm_data
      WHERE profile_id = $1`,
    [profileId]
  );

  return rows[0] ? mapRow(rows[0], profileId) : defaultBookingCrmData(profileId);
}

async function saveBookingCrmData({ session, data } = {}) {
  const profileId = getSessionProfileId(session);
  const normalized = normalizeBookingCrmData(data || {});

  const { rows } = await query(
    `INSERT INTO profile_booking_crm_data (
        profile_id,
        booking_name,
        booking_url,
        auth_type,
        login,
        password
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (profile_id) DO UPDATE SET
        booking_name = EXCLUDED.booking_name,
        booking_url = EXCLUDED.booking_url,
        auth_type = EXCLUDED.auth_type,
        login = EXCLUDED.login,
        password = EXCLUDED.password,
        updated_at = now()
      RETURNING profile_id, booking_name, booking_url, auth_type, login, password, updated_at`,
    [
      profileId,
      normalized.bookingName,
      normalized.bookingUrl,
      normalized.authType,
      normalized.login,
      normalized.password
    ]
  );

  return mapRow(rows[0], profileId);
}

module.exports = {
  BOOKING_NAME_OPTIONS,
  AUTH_TYPE_OPTIONS,
  getBookingCrmData,
  saveBookingCrmData,
  normalizeBookingCrmData
};
