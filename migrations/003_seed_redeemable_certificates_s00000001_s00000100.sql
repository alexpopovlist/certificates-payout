-- Adds redeemable certificates S00000001-S00000100.
-- All generated certificates use the secret code 123456.
-- The migration is idempotent: it inserts missing certificates and only refreshes
-- already-existing certificates while they are still NEW, so previously redeemed
-- or paid certificates are not reset.

WITH generated_certificates AS (
  SELECT
    'S' || lpad(number::text, 8, '0') AS certificate_number,
    '123456' AS secret_code,
    'Поездка на квадроцикле' AS title,
    'Сертификат доступен для ручного погашения или погашения по QR коду' AS description,
    560000 AS amount_cents,
    60 AS service_duration_minutes,
    '/assets/certificate-view-hero.svg' AS image_url
  FROM generate_series(1, 100) AS number
)
INSERT INTO certificates (
  certificate_number,
  secret_code,
  title,
  description,
  amount_cents,
  service_duration_minutes,
  image_url,
  status,
  service_date,
  service_time,
  customer_full_name,
  customer_phone,
  redeemed_at
)
SELECT
  certificate_number,
  secret_code,
  title,
  description,
  amount_cents,
  service_duration_minutes,
  image_url,
  'NEW'::certificate_status,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL
FROM generated_certificates
ON CONFLICT (certificate_number) DO UPDATE
SET
  secret_code = EXCLUDED.secret_code,
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  amount_cents = EXCLUDED.amount_cents,
  service_duration_minutes = EXCLUDED.service_duration_minutes,
  image_url = EXCLUDED.image_url
WHERE certificates.status = 'NEW';
