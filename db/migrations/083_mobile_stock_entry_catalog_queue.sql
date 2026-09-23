-- Mobile bin-first stock entry and deferred TecDoc matching.
--
-- Warehouse operators can register physically received stock immediately,
-- even when an EAN is not yet present in the item master.  Unknown products
-- are created as clearly marked provisional items and queued for an admin to
-- compare with TecDoc later.  The stock entry table supplies an idempotency
-- boundary so a retried mobile request never adds the quantity twice.

CREATE TABLE IF NOT EXISTS item_catalog_discoveries (
    discovery_id BIGSERIAL PRIMARY KEY,
    item_id INT NOT NULL UNIQUE REFERENCES items(item_id) ON DELETE CASCADE,
    scanned_ean VARCHAR(50) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'MATCHED', 'IGNORED')),
    tecdoc_article_id VARCHAR(100),
    tecdoc_code VARCHAR(100),
    tecdoc_brand VARCHAR(200),
    tecdoc_name VARCHAR(300),
    tecdoc_match_type VARCHAR(30),
    tecdoc_payload JSONB,
    created_by VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reviewed_by VARCHAR(100),
    reviewed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_item_catalog_discoveries_status_created
    ON item_catalog_discoveries(status, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_item_catalog_discoveries_ean
    ON item_catalog_discoveries(scanned_ean);

CREATE TABLE IF NOT EXISTS mobile_stock_entries (
    stock_entry_id BIGSERIAL PRIMARY KEY,
    idempotency_key UUID NOT NULL UNIQUE,
    item_id INT NOT NULL REFERENCES items(item_id),
    bin_id INT NOT NULL REFERENCES bins(bin_id),
    warehouse_id INT NOT NULL REFERENCES warehouses(warehouse_id),
    quantity INT NOT NULL CHECK (quantity > 0),
    entered_by VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_mobile_stock_entries_item_created
    ON mobile_stock_entries(item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_mobile_stock_entries_bin_created
    ON mobile_stock_entries(bin_id, created_at DESC);
