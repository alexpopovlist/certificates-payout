CREATE TABLE IF NOT EXISTS admin_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  login TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',
  is_super_admin BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_users_login_lower
  ON admin_users (lower(login));

DROP TRIGGER IF EXISTS trg_admin_users_updated_at ON admin_users;
CREATE TRIGGER trg_admin_users_updated_at
BEFORE UPDATE ON admin_users
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DO $$
DECLARE
  super_login TEXT := NULLIF(current_setting('app.admin_super_login', true), '');
  super_password TEXT := NULLIF(current_setting('app.admin_super_password', true), '');
BEGIN
  IF super_login IS NOT NULL AND super_password IS NOT NULL THEN
    INSERT INTO admin_users (login, password_hash, role, is_super_admin, is_active)
    SELECT super_login, crypt(super_password, gen_salt('bf')), 'super_admin', TRUE, TRUE
    WHERE NOT EXISTS (
      SELECT 1 FROM admin_users WHERE lower(login) = lower(super_login)
    );
  END IF;
END $$;

ALTER TABLE push_subscriptions
  ADD COLUMN IF NOT EXISTS profile_id TEXT,
  ADD COLUMN IF NOT EXISTS profile_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS user_id TEXT,
  ADD COLUMN IF NOT EXISTS user_name TEXT,
  ADD COLUMN IF NOT EXISTS user_email TEXT,
  ADD COLUMN IF NOT EXISTS subscribed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_profile_id
  ON push_subscriptions(profile_id);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_profile_ids
  ON push_subscriptions USING GIN(profile_ids);

CREATE TABLE IF NOT EXISTS push_subscription_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  push_subscription_id UUID REFERENCES push_subscriptions(id) ON DELETE SET NULL,
  endpoint TEXT NOT NULL,
  event_type TEXT NOT NULL DEFAULT 'subscribe',
  profile_id TEXT,
  profile_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  user_id TEXT,
  user_name TEXT,
  user_email TEXT,
  user_agent TEXT,
  platform TEXT,
  installed BOOLEAN NOT NULL DEFAULT FALSE,
  permission TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_push_subscription_logs_created_at
  ON push_subscription_logs(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_push_subscription_logs_profile_id
  ON push_subscription_logs(profile_id);

CREATE TABLE IF NOT EXISTS push_notification_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  url TEXT,
  profile_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  installed_only BOOLEAN NOT NULL DEFAULT TRUE,
  total_count INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_push_notification_campaigns_created_at
  ON push_notification_campaigns(created_at DESC);
