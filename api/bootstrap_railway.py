"""Initialize a fresh Railway PostgreSQL database exactly once.

The normal container deployment initializes PostgreSQL from db/schema.sql and
db/seed.sh. Railway-managed PostgreSQL does not run those image init hooks, so
the API service uses this pre-deploy command instead. All DDL and the minimal
seed run in one transaction behind a PostgreSQL advisory lock.
"""

from __future__ import annotations

import os
from pathlib import Path

import psycopg2


REPO_ROOT = Path(__file__).resolve().parent.parent
SCHEMA_PATH = REPO_ROOT / "db" / "schema.sql"
BOOTSTRAP_LOCK_ID = 7_493_367_791


def _required_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} is required for the Railway database bootstrap")
    return value


def _schema_is_initialized(cursor) -> bool:
    cursor.execute(
        """
        SELECT
            to_regclass('public.warehouses') IS NOT NULL
            AND to_regclass('public.users') IS NOT NULL
        """
    )
    return bool(cursor.fetchone()[0])


def _ensure_runtime_indexes(cursor) -> None:
    """Apply small idempotent indexes needed by current runtime worklists.

    Railway's database bootstrap intentionally skips the full schema on an
    existing installation, so additive performance indexes must still be
    ensured during deploy.
    """
    cursor.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_sales_orders_mobile_worklists
            ON sales_orders (
                warehouse_id, status, packed_at, picked_at, created_at, so_id
            )
        """
    )


def _seed_minimal_install(cursor, admin_password: str) -> None:
    cursor.execute(
        """
        INSERT INTO warehouses (warehouse_code, warehouse_name, address)
        VALUES ('WH-01', 'My Warehouse', '')
        RETURNING warehouse_id
        """
    )
    warehouse_id = cursor.fetchone()[0]

    zone_ids: dict[str, int] = {}
    for code, name, zone_type in (
        ("RCV", "Receiving", "RECEIVING"),
        ("PICK", "Picking", "PICKING"),
        ("STAGE", "Staging", "STAGING"),
    ):
        cursor.execute(
            """
            INSERT INTO zones (warehouse_id, zone_code, zone_name, zone_type)
            VALUES (%s, %s, %s, %s)
            RETURNING zone_id
            """,
            (warehouse_id, code, name, zone_type),
        )
        zone_ids[code] = cursor.fetchone()[0]

    receiving_bin_id = None
    for zone_code, bin_code, bin_type, pick_sequence, description in (
        ("RCV", "RECV-01", "Staging", 0, "Default receiving bin"),
        ("PICK", "PICK-01", "Pickable", 100, "Default pick bin"),
        ("STAGE", "BULK-01", "Pickable", 0, "Default bulk bin"),
    ):
        cursor.execute(
            """
            INSERT INTO bins (
                zone_id,
                warehouse_id,
                bin_code,
                bin_barcode,
                bin_type,
                pick_sequence,
                putaway_sequence,
                description,
                external_id
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, gen_random_uuid())
            RETURNING bin_id
            """,
            (
                zone_ids[zone_code],
                warehouse_id,
                bin_code,
                bin_code,
                bin_type,
                pick_sequence,
                pick_sequence,
                description,
            ),
        )
        bin_id = cursor.fetchone()[0]
        if zone_code == "RCV":
            receiving_bin_id = bin_id

    cursor.execute(
        """
        INSERT INTO users (
            username,
            password_hash,
            full_name,
            role,
            warehouse_id,
            allowed_functions,
            must_change_password,
            external_id
        )
        VALUES (
            'admin',
            crypt(%s, gen_salt('bf')),
            'Admin User',
            'ADMIN',
            %s,
            '{}',
            FALSE,
            gen_random_uuid()
        )
        """,
        (admin_password, warehouse_id),
    )

    cursor.executemany(
        "INSERT INTO app_settings (key, value) VALUES (%s, %s)",
        (
            ("session_timeout_hours", "8"),
            ("require_packing_before_shipping", "true"),
            ("default_receiving_bin", str(receiving_bin_id)),
            ("allow_over_receiving", "true"),
        ),
    )


def main() -> None:
    database_url = _required_env("DATABASE_URL")
    admin_password = _required_env("ADMIN_PASSWORD")
    if len(admin_password) < 12:
        raise RuntimeError("ADMIN_PASSWORD must contain at least 12 characters")
    if not SCHEMA_PATH.is_file():
        raise RuntimeError(f"Schema file is missing: {SCHEMA_PATH}")

    connection = psycopg2.connect(database_url)
    try:
        with connection:
            with connection.cursor() as cursor:
                cursor.execute("SELECT pg_advisory_xact_lock(%s)", (BOOTSTRAP_LOCK_ID,))
                if _schema_is_initialized(cursor):
                    _ensure_runtime_indexes(cursor)
                    print("Sentry WMS database is already initialized; runtime indexes verified.")
                    return

                cursor.execute(SCHEMA_PATH.read_text(encoding="utf-8"))
                _seed_minimal_install(cursor, admin_password)
                _ensure_runtime_indexes(cursor)
                print("Sentry WMS schema and minimal admin setup initialized.")
    finally:
        connection.close()


if __name__ == "__main__":
    main()
