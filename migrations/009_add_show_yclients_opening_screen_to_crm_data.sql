ALTER TABLE profile_booking_crm_data
  ADD COLUMN IF NOT EXISTS show_yclients_opening_screen BOOLEAN NOT NULL DEFAULT TRUE;
