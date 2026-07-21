ALTER TABLE profile_booking_crm_data
  ADD COLUMN IF NOT EXISTS yclients_partner_token TEXT NOT NULL DEFAULT '';
