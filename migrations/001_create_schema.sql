CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'certificate_status') THEN
    CREATE TYPE certificate_status AS ENUM ('NEW', 'REDEEMED', 'PAYMENT_PROCESSING', 'PAID');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_request_status') THEN
    CREATE TYPE payment_request_status AS ENUM ('PROCESSING', 'PAID');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS certificates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  certificate_number VARCHAR(32) NOT NULL UNIQUE,
  secret_code VARCHAR(32) NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  service_duration_minutes INTEGER CHECK (service_duration_minutes > 0),
  image_url TEXT,
  status certificate_status NOT NULL DEFAULT 'NEW',
  service_date DATE,
  service_time TIME,
  customer_full_name TEXT,
  customer_phone TEXT,
  redeemed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT certificates_redeemed_fields_chk CHECK (
    status = 'NEW'
    OR (redeemed_at IS NOT NULL AND customer_full_name IS NOT NULL AND customer_phone IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_certificates_status ON certificates(status);
CREATE INDEX IF NOT EXISTS idx_certificates_redeemed_at ON certificates(redeemed_at DESC);
CREATE INDEX IF NOT EXISTS idx_certificates_service_date ON certificates(service_date DESC);

CREATE TABLE IF NOT EXISTS payment_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_number VARCHAR(32) NOT NULL UNIQUE,
  period_from DATE,
  period_to DATE,
  status payment_request_status NOT NULL DEFAULT 'PROCESSING',
  certificate_count INTEGER NOT NULL DEFAULT 0 CHECK (certificate_count >= 0),
  total_amount_cents INTEGER NOT NULL DEFAULT 0 CHECK (total_amount_cents >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_requests_status ON payment_requests(status);
CREATE INDEX IF NOT EXISTS idx_payment_requests_created_at ON payment_requests(created_at DESC);

CREATE TABLE IF NOT EXISTS payment_request_items (
  payment_request_id UUID NOT NULL REFERENCES payment_requests(id) ON DELETE CASCADE,
  certificate_id UUID NOT NULL REFERENCES certificates(id) ON DELETE RESTRICT,
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (payment_request_id, certificate_id),
  UNIQUE (certificate_id)
);

CREATE INDEX IF NOT EXISTS idx_payment_request_items_certificate_id ON payment_request_items(certificate_id);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_certificates_updated_at ON certificates;
CREATE TRIGGER trg_certificates_updated_at
BEFORE UPDATE ON certificates
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_payment_requests_updated_at ON payment_requests;
CREATE TRIGGER trg_payment_requests_updated_at
BEFORE UPDATE ON payment_requests
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();
