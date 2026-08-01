#!/usr/bin/env bash
set -euo pipefail

APP_NAME="${APP_NAME:-weather}"
TABLE_NAME="${APP_NAME}_config"

case "$APP_NAME" in
  ""|*[!a-z0-9_-]*)
    echo "Invalid APP_NAME: $APP_NAME" >&2
    exit 1
    ;;
esac

case "$TABLE_NAME" in
  ""|*[!a-z0-9_]*|[0-9]*)
    echo "Invalid derived table name: $TABLE_NAME" >&2
    exit 1
    ;;
esac

psql -v ON_ERROR_STOP=1 <<SQL
CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
  user_id TEXT,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  principal_type TEXT NOT NULL DEFAULT 'user',
  principal_id TEXT NOT NULL DEFAULT 'default',
  key TEXT NOT NULL,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, principal_type, principal_id, key)
);

ALTER TABLE ${TABLE_NAME}
  ADD COLUMN IF NOT EXISTS tenant_id TEXT;

ALTER TABLE ${TABLE_NAME}
  ADD COLUMN IF NOT EXISTS principal_type TEXT;

ALTER TABLE ${TABLE_NAME}
  ADD COLUMN IF NOT EXISTS principal_id TEXT;

ALTER TABLE ${TABLE_NAME}
  ADD COLUMN IF NOT EXISTS user_id TEXT;

UPDATE ${TABLE_NAME}
SET tenant_id = COALESCE(NULLIF(trim(tenant_id), ''), 'default')
WHERE tenant_id IS NULL OR trim(tenant_id) = '';

UPDATE ${TABLE_NAME}
SET principal_type = COALESCE(NULLIF(trim(principal_type), ''), 'user')
WHERE principal_type IS NULL OR trim(principal_type) = '';

UPDATE ${TABLE_NAME}
SET principal_id = COALESCE(NULLIF(trim(principal_id), ''), NULLIF(trim(user_id), ''), 'default')
WHERE principal_id IS NULL OR trim(principal_id) = '';

UPDATE ${TABLE_NAME}
SET user_id = COALESCE(NULLIF(trim(user_id), ''), principal_id)
WHERE user_id IS NULL OR trim(user_id) = '';

ALTER TABLE ${TABLE_NAME}
  ALTER COLUMN tenant_id SET DEFAULT 'default';

ALTER TABLE ${TABLE_NAME}
  ALTER COLUMN tenant_id SET NOT NULL;

ALTER TABLE ${TABLE_NAME}
  ALTER COLUMN principal_type SET DEFAULT 'user';

ALTER TABLE ${TABLE_NAME}
  ALTER COLUMN principal_type SET NOT NULL;

ALTER TABLE ${TABLE_NAME}
  ALTER COLUMN principal_id SET DEFAULT 'default';

ALTER TABLE ${TABLE_NAME}
  ALTER COLUMN principal_id SET NOT NULL;

ALTER TABLE ${TABLE_NAME}
  DROP CONSTRAINT IF EXISTS ${TABLE_NAME}_pkey;

ALTER TABLE ${TABLE_NAME}
  ADD CONSTRAINT ${TABLE_NAME}_pkey PRIMARY KEY (tenant_id, principal_type, principal_id, key);

CREATE INDEX IF NOT EXISTS ${TABLE_NAME}_key_idx ON ${TABLE_NAME} (key);

INSERT INTO ${TABLE_NAME} (user_id, key, value)
VALUES
  ('default', 'weather.defaults.units', '"metric"'),
  ('default', 'weather.defaults.lang', '"en"'),
  ('default', 'weather.cache.maxMinutes', '10'),
  ('default', 'weather.pagination.defaultCnt', '10'),
  ('default', 'vault.agent.auth.mode', '"file"'),
  ('default', 'vault.agent.tokenFilePath', '"/tmp/vault-agent-token"')
ON CONFLICT (tenant_id, principal_type, principal_id, key) DO NOTHING;
SQL
