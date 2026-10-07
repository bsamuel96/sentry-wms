-- Persist the normalized viscosity supplied by Connex/TecDoc ProductDetails.
-- Keeping it on the item makes catalogue rows searchable and avoids parsing
-- a large provider payload every time the Products grid is opened.

ALTER TABLE items
    ADD COLUMN IF NOT EXISTS viscosity VARCHAR(32);

CREATE INDEX IF NOT EXISTS ix_items_viscosity
    ON items (viscosity)
    WHERE viscosity IS NOT NULL;
