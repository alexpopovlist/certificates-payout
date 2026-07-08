INSERT INTO certificates (
  certificate_number, secret_code, title, description, amount_cents,
  service_duration_minutes, image_url, status, service_date, service_time,
  customer_full_name, customer_phone, redeemed_at
) VALUES
  ('S00000001', '123456', 'Поездка на квадроцикле', 'Демо-сертификат для ручного погашения', 560000, 60, '/assets/quad.svg', 'NEW', NULL, NULL, NULL, NULL, NULL),
  ('S19548907', '000000', 'Катание на двух квадроциклах (От 2 до 4 чел. 30 минут)', 'Маршрут по полю и лесной дороге', 560000, 30, '/assets/quad.svg', 'PAID', '2026-06-07', '12:00', 'Ливадный Николай', '79523920364', '2026-06-07 12:15:00+03'),
  ('S52874063', '000000', 'Стальной характер', 'Подарочный сертификат на активность', 350000, 60, '/assets/quad.svg', 'PAID', '2026-06-07', '13:00', 'Павлова Мария', '79990000001', '2026-06-07 13:08:00+03'),
  ('S49317279', '000000', 'Катание на двух квадроциклах (От 2 до 4 чел. 1 час)', 'Катание на двух квадроциклах', 560000, 60, '/assets/quad.svg', 'PAID', '2026-06-07', '14:00', 'Иванов Антон', '79990000002', '2026-06-07 14:10:00+03'),
  ('S72535442', '000000', 'Поездка на квадроцикле (От 1 до 2 чел. 2 часа)', 'Длинный маршрут', 595000, 120, '/assets/quad.svg', 'PAYMENT_PROCESSING', '2026-04-27', '15:00', 'Смирнова Алина', '79990000003', '2026-04-27 15:12:00+03'),
  ('S95827401', '000000', 'Поездка на квадроцикле (От 1 до 2 чел., 2 часа)', 'Длинный маршрут', 595000, 120, '/assets/quad.svg', 'PAYMENT_PROCESSING', '2026-04-27', '16:30', 'Орлов Максим', '79990000004', '2026-04-27 16:45:00+03'),
  ('S28769767', '000000', 'Премиальная поездка на квадроцикле', 'Расширенный маршрут', 770000, 150, '/assets/quad.svg', 'REDEEMED', '2026-03-07', '11:00', 'Кузнецов Илья', '79990000005', '2026-03-07 11:20:00+03'),
  ('S32167028', '000000', 'Серфинг на искусственной волне (От 1 до 2 чел. 30 минут)', 'Серфинг на искусственной волне', 280000, 30, '/assets/quad.svg', 'REDEEMED', '2026-03-07', '12:00', 'Федорова Елена', '79990000006', '2026-03-07 12:05:00+03'),
  ('S90684173', '000000', 'Адам и Ева', 'Сертификат для двоих', 350000, 60, '/assets/quad.svg', 'REDEEMED', '2026-01-25', '18:00', 'Соловьев Артем', '79990000007', '2026-01-25 18:11:00+03'),
  ('S96945071', '000000', 'Поездка на квадроцикле (От 1 до 2 чел. 1 час)', 'Катание на квадроцикле', 314300, 60, '/assets/quad.svg', 'REDEEMED', '2026-01-25', '13:00', 'Волкова Дарья', '79990000008', '2026-01-25 13:17:00+03'),
  ('S55461419', '000000', 'Индивидуальная тренировка на питбайке (1 человек 1 час)', 'Индивидуальная тренировка', 400000, 60, '/assets/quad.svg', 'REDEEMED', '2025-12-03', '10:00', 'Никитин Роман', '79990000009', '2025-12-03 10:25:00+03'),
  ('S97284775', '000000', 'maXimum адреналина', 'Активный подарочный набор', 280000, 60, '/assets/quad.svg', 'REDEEMED', '2025-12-03', '17:00', 'Морозова Кира', '79990000010', '2025-12-03 17:31:00+03')
ON CONFLICT (certificate_number) DO NOTHING;

WITH request_1 AS (
  INSERT INTO payment_requests (
    request_number, period_from, period_to, status,
    certificate_count, total_amount_cents, created_at, paid_at
  )
  SELECT
    'PAY-2026-06-07', '2026-06-01'::date, '2026-06-07'::date, 'PAID'::payment_request_status,
    COUNT(*), COALESCE(SUM(amount_cents), 0), '2026-06-07 18:00:00+03'::timestamptz, '2026-06-07 19:00:00+03'::timestamptz
  FROM certificates
  WHERE certificate_number IN ('S19548907', 'S52874063', 'S49317279')
  ON CONFLICT (request_number) DO NOTHING
  RETURNING id
)
INSERT INTO payment_request_items (payment_request_id, certificate_id, amount_cents)
SELECT request_1.id, certificates.id, certificates.amount_cents
FROM request_1, certificates
WHERE certificates.certificate_number IN ('S19548907', 'S52874063', 'S49317279')
ON CONFLICT (certificate_id) DO NOTHING;

WITH request_2 AS (
  INSERT INTO payment_requests (
    request_number, period_from, period_to, status,
    certificate_count, total_amount_cents, created_at, paid_at
  )
  SELECT
    'PAY-2026-04-27', '2026-04-01'::date, '2026-04-27'::date, 'PROCESSING'::payment_request_status,
    COUNT(*), COALESCE(SUM(amount_cents), 0), '2026-04-27 18:00:00+03'::timestamptz, NULL
  FROM certificates
  WHERE certificate_number IN ('S72535442', 'S95827401')
  ON CONFLICT (request_number) DO NOTHING
  RETURNING id
)
INSERT INTO payment_request_items (payment_request_id, certificate_id, amount_cents)
SELECT request_2.id, certificates.id, certificates.amount_cents
FROM request_2, certificates
WHERE certificates.certificate_number IN ('S72535442', 'S95827401')
ON CONFLICT (certificate_id) DO NOTHING;
