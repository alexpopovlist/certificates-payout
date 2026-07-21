CREATE TABLE IF NOT EXISTS profile_booking_crm_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id TEXT NOT NULL UNIQUE,
  booking_name TEXT NOT NULL DEFAULT 'Нет данных' CHECK (booking_name IN ('yclients', 'dikidi Business', 'Собственная', 'Отсутствует', 'Нет данных')),
  booking_url TEXT NOT NULL DEFAULT '',
  auth_type TEXT NOT NULL DEFAULT 'Нет данных' CHECK (auth_type IN ('Базовый', 'Нет данных')),
  login TEXT NOT NULL DEFAULT '',
  password TEXT NOT NULL DEFAULT '',
  yclients_partner_token TEXT NOT NULL DEFAULT '',
  show_yclients_opening_screen BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_profile_booking_crm_data_profile_id ON profile_booking_crm_data(profile_id);

DROP TRIGGER IF EXISTS trg_profile_booking_crm_data_updated_at ON profile_booking_crm_data;
CREATE TRIGGER trg_profile_booking_crm_data_updated_at
BEFORE UPDATE ON profile_booking_crm_data
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();
