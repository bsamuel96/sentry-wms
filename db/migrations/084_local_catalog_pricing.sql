-- Sentry owns Local selling prices. Connex references and manual overrides
-- are stored separately so refreshing a reference cannot erase an override.
ALTER TABLE items ADD COLUMN IF NOT EXISTS local_pricing JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE item_catalog_discoveries DROP CONSTRAINT IF EXISTS item_catalog_discoveries_status_check;
ALTER TABLE item_catalog_discoveries ADD CONSTRAINT item_catalog_discoveries_status_check
    CHECK (status IN ('PENDING', 'MATCHED', 'MANUAL', 'IGNORED'));
