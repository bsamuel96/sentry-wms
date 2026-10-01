-- Persistent product photos captured while completing a manual catalogue match.
-- Bytes live in PostgreSQL because Railway application filesystems are ephemeral.

CREATE TABLE IF NOT EXISTS catalog_product_images (
    image_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id INT NOT NULL REFERENCES items(item_id) ON DELETE CASCADE,
    mime_type VARCHAR(50) NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    file_size INT NOT NULL,
    content BYTEA NOT NULL,
    created_by VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE catalog_product_images
    DROP CONSTRAINT IF EXISTS ck_catalog_product_images_file_size;
ALTER TABLE catalog_product_images
    ADD CONSTRAINT ck_catalog_product_images_file_size
    CHECK (file_size > 0 AND file_size <= 4194304);

CREATE INDEX IF NOT EXISTS ix_catalog_product_images_item_created
    ON catalog_product_images(item_id, created_at DESC);
