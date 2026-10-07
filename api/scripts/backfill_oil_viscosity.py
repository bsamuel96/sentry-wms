"""Populate items.viscosity and refresh legacy Connex oil ProductDetails."""

import argparse
import json

from sqlalchemy import text

from models.database import SessionLocal
from services.catalog_discovery import CatalogDiscoveryError, catalog_request
from services.catalog_media import catalog_oil_viscosity


def _payload(value):
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, dict) else {}
        except (TypeError, ValueError):
            return {}
    return {}


def run(*, dry_run=False):
    session = SessionLocal()
    summary = {"scanned": 0, "from_saved_details": 0, "refreshed": 0, "without_viscosity": 0, "failed": 0}
    try:
        rows = session.execute(text("""
            SELECT i.item_id, i.item_name, i.category, i.mpn,
                   d.discovery_id, d.tecdoc_code, d.tecdoc_name,
                   d.tecdoc_match_type, d.tecdoc_payload
            FROM items i
            JOIN item_catalog_discoveries d ON d.item_id = i.item_id
            WHERE i.viscosity IS NULL
              AND d.status IN ('MATCHED', 'MANUAL')
            ORDER BY i.item_id
        """)).fetchall()
        for row in rows:
            summary["scanned"] += 1
            saved_payload = _payload(row.tecdoc_payload)
            viscosity = catalog_oil_viscosity(saved_payload, row.tecdoc_name, row.item_name)
            refreshed_payload = None

            if viscosity:
                summary["from_saved_details"] += 1
            elif str(row.tecdoc_match_type or "").startswith("connex_"):
                product_id = str(saved_payload.get("id") or "").strip()
                reference = str(row.tecdoc_code or row.mpn or saved_payload.get("code") or "").strip()
                if product_id and reference:
                    try:
                        lookup = catalog_request(
                            "/api/integrations/sentry/connex-catalog",
                            payload={"reference": reference, "product_id": product_id},
                        )
                        match = next(
                            (candidate for candidate in lookup.get("matches", [])
                             if str(candidate.get("id") or "").strip() == product_id),
                            None,
                        )
                        if match:
                            refreshed_payload = {**saved_payload, **match}
                            viscosity = catalog_oil_viscosity(refreshed_payload, row.tecdoc_name, row.item_name)
                    except CatalogDiscoveryError:
                        summary["failed"] += 1
                        continue

            if not viscosity:
                summary["without_viscosity"] += 1
                continue
            summary["refreshed"] += 1
            if dry_run:
                continue
            session.execute(text("""
                UPDATE items SET viscosity = :viscosity, updated_at = NOW()
                WHERE item_id = :item_id
            """), {"item_id": row.item_id, "viscosity": viscosity})
            if refreshed_payload is not None:
                session.execute(text("""
                    UPDATE item_catalog_discoveries
                    SET tecdoc_payload = CAST(:payload AS jsonb), updated_at = NOW()
                    WHERE discovery_id = :discovery_id
                """), {
                    "discovery_id": row.discovery_id,
                    "payload": json.dumps(refreshed_payload),
                })
            session.commit()
        if dry_run:
            session.rollback()
        return summary
    finally:
        session.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    print(json.dumps(run(dry_run=args.dry_run), sort_keys=True))
