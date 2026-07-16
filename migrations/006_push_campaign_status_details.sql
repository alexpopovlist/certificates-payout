ALTER TABLE push_notification_campaigns
  ADD COLUMN IF NOT EXISTS delivery_status TEXT NOT NULL DEFAULT 'success',
  ADD COLUMN IF NOT EXISTS result_details JSONB NOT NULL DEFAULT '[]'::jsonb;

UPDATE push_notification_campaigns
SET delivery_status = CASE
  WHEN failed_count > 0 THEN 'error'
  ELSE 'success'
END
WHERE delivery_status IS NULL OR delivery_status = '';

CREATE INDEX IF NOT EXISTS idx_push_notification_campaigns_delivery_status
  ON push_notification_campaigns(delivery_status);

CREATE INDEX IF NOT EXISTS idx_push_notification_campaigns_profile_ids
  ON push_notification_campaigns USING GIN(profile_ids);

CREATE INDEX IF NOT EXISTS idx_push_notification_campaigns_search
  ON push_notification_campaigns USING GIN(to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(body, '')));
