-- 082: keep handheld packing/shipping worklists fast as order volume grows.
-- The API filters by warehouse + lifecycle status and then sorts by the
-- operational timestamps below.

CREATE INDEX IF NOT EXISTS ix_sales_orders_mobile_worklists
    ON sales_orders (warehouse_id, status, packed_at, picked_at, created_at, so_id);
