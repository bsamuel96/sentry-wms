"""Resolve unknown scanned products through the AutoSav-owned catalogue."""
import json
import math
import re
from concurrent.futures import ThreadPoolExecutor, as_completed

from flask import Blueprint, current_app, g, jsonify, request
from sqlalchemy import text
from middleware.auth_middleware import (
    require_auth,
    check_warehouse_access,
    require_admin_or_page_permission,
)
from middleware.db import with_db
from services.catalog_discovery import catalog_request, CatalogDiscoveryError
from services.catalog_media import catalog_image_urls
from services.audit_service import write_audit_log

catalog_discovery_bp = Blueprint("catalog_discovery", __name__)

_EAN_PATTERN = re.compile(r"^(?:\d{8}|\d{12}|\d{13}|\d{14})$")


def _is_searchable_ean(value):
    code = str(value or "").strip()
    if not _EAN_PATTERN.fullmatch(code):
        return False
    digits = [int(value) for value in code]
    check_digit = digits.pop()
    total = sum(
        digit * (3 if index % 2 == 0 else 1)
        for index, digit in enumerate(reversed(digits))
    )
    return (10 - total % 10) % 10 == check_digit


def _unique_auto_ean_matches(payload):
    """Return candidates that are safe to auto-apply for an EAN-led lookup.

    TecDoc sometimes fails its dedicated EAN search and then finds the same
    barcode through the article/reference index.  The AutoSav lookup marks
    that successful fallback as ``searchedBy=ean_then_reference`` and the
    candidate as ``matchType=reference``.  It is still an EAN-led search: no
    operator reference was supplied.  Accept one unique, complete candidate;
    multiple candidates remain ambiguous and require a human choice.
    """
    if not isinstance(payload, dict):
        return []
    searched_by = payload.get("searchedBy")
    unique = {}
    for candidate in payload.get("matches", []):
        # Older bridge builds omitted ``searchedBy`` but still identified
        # exact EAN candidates explicitly. Preserve that compatible path.
        if searched_by not in ("ean", "ean_then_reference") and candidate.get("matchType") != "ean":
            continue
        key = (str(candidate.get("id") or ""), str(candidate.get("code") or ""))
        if all(key):
            unique[key] = candidate
    return list(unique.values())


def _apply_match(discovery, match, actor):
    brand = str(match.get("brand") or "").strip()
    name = str(match.get("name") or "").strip()
    matched_code = str(match.get("code") or "").strip()
    article_id = str(match.get("id") or "").strip()
    item_name = " · ".join(value for value in (brand, name) if value)[:200] or f"Produs {discovery.scanned_ean}"
    g.db.execute(text("""
        UPDATE items
        SET item_name = :name,
            description = :description,
            mpn = NULLIF(:code, ''),
            category = 'TecDoc',
            updated_at = NOW()
        WHERE item_id = :iid
    """), {
        "iid": discovery.item_id,
        "name": item_name,
        "description": f"Identificat în TecDoc: {brand} {matched_code}".strip(),
        "code": matched_code,
    })
    g.db.execute(text("""
        UPDATE item_catalog_discoveries
        SET status = 'MATCHED', tecdoc_article_id = :article_id,
            tecdoc_code = :code, tecdoc_brand = :brand, tecdoc_name = :name,
            tecdoc_match_type = :match_type, tecdoc_payload = CAST(:payload AS jsonb),
            reviewed_by = :actor, reviewed_at = NOW(), updated_at = NOW()
        WHERE discovery_id = :id
    """), {
        "id": discovery.discovery_id,
        "article_id": article_id,
        "code": matched_code,
        "brand": brand,
        "name": name,
        "match_type": str(match.get("matchType") or ""),
        "payload": json.dumps(match),
        "actor": actor,
    })


def _serialize_discovery(row):
    images = catalog_image_urls(row.tecdoc_payload)
    return {
        "discovery_id": row.discovery_id,
        "item_id": row.item_id,
        "sku": row.sku,
        "item_name": row.item_name,
        "ean": row.scanned_ean,
        "status": row.status,
        "created_by": row.created_by,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "reviewed_by": row.reviewed_by,
        "reviewed_at": row.reviewed_at.isoformat() if row.reviewed_at else None,
        "tecdoc_article_id": row.tecdoc_article_id,
        "tecdoc_code": row.tecdoc_code,
        "tecdoc_brand": row.tecdoc_brand,
        "tecdoc_name": row.tecdoc_name,
        "tecdoc_match_type": row.tecdoc_match_type,
        "image_url": images[0] if images else None,
        "images": images,
        "quantity_on_hand": int(row.quantity_on_hand or 0),
        "locations": row.locations or [],
    }


@catalog_discovery_bp.route("/queue", methods=["GET"])
@require_auth
@require_admin_or_page_permission("items")
@with_db
def queue():
    page = max(1, request.args.get("page", 1, type=int))
    per_page = min(100, max(1, request.args.get("per_page", 25, type=int)))
    status = str(request.args.get("status") or "PENDING").strip().upper()
    query = str(request.args.get("q") or "").strip()
    if status not in ("PENDING", "MATCHED", "IGNORED", "ALL"):
        return jsonify({"error": "Stare invalidă."}), 422
    conditions = []
    params = {}
    if status != "ALL":
        conditions.append("d.status = :status")
        params["status"] = status
    if query:
        conditions.append("(d.scanned_ean ILIKE :query OR i.sku ILIKE :query OR i.item_name ILIKE :query)")
        params["query"] = f"%{query}%"
    where_sql = "WHERE " + " AND ".join(conditions) if conditions else ""
    total = g.db.execute(text(f"""
        SELECT COUNT(*)
        FROM item_catalog_discoveries d
        JOIN items i ON i.item_id = d.item_id
        {where_sql}
    """), params).scalar()
    rows = g.db.execute(text(f"""
        SELECT d.discovery_id, d.item_id, d.scanned_ean, d.status,
               d.created_by, d.created_at, d.reviewed_by, d.reviewed_at,
               d.tecdoc_article_id, d.tecdoc_code, d.tecdoc_brand,
               d.tecdoc_name, d.tecdoc_match_type, d.tecdoc_payload,
               i.sku, i.item_name,
               COALESCE(SUM(inv.quantity_on_hand), 0) AS quantity_on_hand,
               COALESCE(
                   jsonb_agg(
                       jsonb_build_object(
                           'bin_id', b.bin_id,
                           'bin_code', b.bin_code,
                           'quantity', inv.quantity_on_hand
                       ) ORDER BY b.bin_code
                   ) FILTER (WHERE inv.inventory_id IS NOT NULL),
                   '[]'::jsonb
               ) AS locations
        FROM item_catalog_discoveries d
        JOIN items i ON i.item_id = d.item_id
        LEFT JOIN inventory inv ON inv.item_id = i.item_id AND inv.quantity_on_hand <> 0
        LEFT JOIN bins b ON b.bin_id = inv.bin_id
        {where_sql}
        GROUP BY d.discovery_id, i.item_id
        ORDER BY CASE d.status WHEN 'PENDING' THEN 0 ELSE 1 END, d.created_at DESC
        LIMIT :limit OFFSET :offset
    """), {**params, "limit": per_page, "offset": (page - 1) * per_page}).fetchall()
    return jsonify({
        "discoveries": [_serialize_discovery(row) for row in rows],
        "total": total,
        "page": page,
        "per_page": per_page,
        "pages": max(1, math.ceil(total / per_page)),
    })


@catalog_discovery_bp.route("/queue/<int:discovery_id>/matches", methods=["GET"])
@require_auth
@require_admin_or_page_permission("items")
@with_db
def queue_matches(discovery_id):
    row = g.db.execute(
        text("SELECT scanned_ean FROM item_catalog_discoveries WHERE discovery_id = :id"),
        {"id": discovery_id},
    ).fetchone()
    if not row:
        return jsonify({"error": "Produsul de verificat nu există."}), 404
    reference = str(request.args.get("reference") or "").strip()
    try:
        return jsonify(catalog_request(
            "/api/catalog/tecdoc/inventory-lookup",
            params={"ean": row.scanned_ean, "reference": reference},
        ))
    except CatalogDiscoveryError as exc:
        return jsonify({"error": str(exc)}), exc.status


@catalog_discovery_bp.route("/queue/<int:discovery_id>/match", methods=["POST"])
@require_auth
@require_admin_or_page_permission("items")
@with_db
def queue_match(discovery_id):
    body = request.get_json(silent=True) or {}
    discovery = g.db.execute(text("""
        SELECT discovery_id, item_id, scanned_ean, status
        FROM item_catalog_discoveries
        WHERE discovery_id = :id
        FOR UPDATE
    """), {"id": discovery_id}).fetchone()
    if not discovery:
        return jsonify({"error": "Produsul de verificat nu există."}), 404
    if discovery.status != "PENDING":
        return jsonify({"error": "Produsul a fost deja verificat."}), 409

    reference = str(body.get("reference") or "").strip()
    try:
        lookup = catalog_request(
            "/api/catalog/tecdoc/inventory-lookup",
            params={"ean": discovery.scanned_ean, "reference": reference},
        )
    except CatalogDiscoveryError as exc:
        return jsonify({"error": str(exc)}), exc.status
    article_id = str(body.get("articleId") or "")
    code = str(body.get("code") or "")
    match = next((candidate for candidate in lookup.get("matches", [])
                  if str(candidate.get("id") or "") == article_id
                  and str(candidate.get("code") or "") == code), None)
    if not match:
        return jsonify({"error": "Rezultatul TecDoc nu mai este disponibil. Repetă căutarea."}), 409
    ean_led_lookup = not reference and lookup.get("searchedBy") in ("ean", "ean_then_reference")
    if match.get("matchType") != "ean" and not ean_led_lookup and body.get("confirmEquivalent") is not True:
        return jsonify({"error": "Confirmă manual că produsul fizic corespunde acestei referințe."}), 422

    actor = str(g.current_user.get("username") or "unknown")
    _apply_match(discovery, match, actor)
    g.db.commit()
    return jsonify({"ok": True, "item_id": discovery.item_id, "status": "MATCHED"})


@catalog_discovery_bp.route("/queue/bulk-match", methods=["POST"])
@require_auth
@require_admin_or_page_permission("items")
@with_db
def queue_bulk_match():
    """Match provisional items when an EAN-led lookup has one unique result.

    AutoSav/TecDoc may resolve an EAN through its reference fallback and mark
    the candidate ``reference``.  That is still automatic when the operator
    supplied no separate reference. Manual reference searches and ambiguous
    results remain a human decision. A failed upstream lookup does not roll
    back successful rows from the same operator batch.
    """
    body = request.get_json(silent=True) or {}
    raw_ids = body.get("discovery_ids")
    if not isinstance(raw_ids, list) or not raw_ids:
        return jsonify({"error": "Selectează cel puțin un produs."}), 422
    if len(raw_ids) > 100:
        return jsonify({"error": "Poți echivala maximum 100 de produse într-un lot."}), 422
    try:
        discovery_ids = list(dict.fromkeys(int(value) for value in raw_ids))
    except (TypeError, ValueError):
        return jsonify({"error": "Selecția conține identificatori invalizi."}), 422
    if any(value < 1 for value in discovery_ids):
        return jsonify({"error": "Selecția conține identificatori invalizi."}), 422

    current_app.logger.info("catalog bulk match started requested=%d", len(discovery_ids))

    discoveries = []
    for discovery_id in discovery_ids:
        row = g.db.execute(text("""
            SELECT discovery_id, item_id, scanned_ean, status
            FROM item_catalog_discoveries
            WHERE discovery_id = :id
        """), {"id": discovery_id}).fetchone()
        if row:
            discoveries.append(row)

    results = []
    resolved = []
    lookup_candidates = []
    for discovery in discoveries:
        if discovery.status != "PENDING":
            results.append({"discovery_id": discovery.discovery_id, "ean": discovery.scanned_ean, "status": "skipped", "reason": "already_reviewed"})
            continue
        if not _is_searchable_ean(discovery.scanned_ean):
            results.append({"discovery_id": discovery.discovery_id, "ean": discovery.scanned_ean, "status": "skipped", "reason": "invalid_ean"})
            continue
        lookup_candidates.append(discovery)

    def lookup_ean(discovery):
        return catalog_request(
            "/api/catalog/tecdoc/inventory-lookup",
            params={"ean": discovery.scanned_ean, "reference": ""},
        )

    if lookup_candidates:
        # Catalogue calls are independent and network-bound. A small bounded
        # pool keeps a page-sized bulk action responsive without flooding the
        # AutoSav/TecDoc bridge.
        with ThreadPoolExecutor(max_workers=min(6, len(lookup_candidates))) as executor:
            pending = {executor.submit(lookup_ean, row): row for row in lookup_candidates}
            for future in as_completed(pending):
                discovery = pending[future]
                try:
                    lookup = future.result()
                except CatalogDiscoveryError as exc:
                    results.append({
                        "discovery_id": discovery.discovery_id,
                        "ean": discovery.scanned_ean,
                        "status": "error",
                        "reason": "lookup_failed",
                        "error": str(exc),
                    })
                    continue
                candidates = _unique_auto_ean_matches(lookup)
                if not candidates:
                    results.append({"discovery_id": discovery.discovery_id, "ean": discovery.scanned_ean, "status": "not_found", "reason": "no_exact_ean"})
                    continue
                if len(candidates) > 1:
                    results.append({"discovery_id": discovery.discovery_id, "ean": discovery.scanned_ean, "status": "ambiguous", "reason": "multiple_exact_ean"})
                    continue
                resolved.append((discovery, candidates[0]))

    actor = str(g.current_user.get("username") or "unknown")
    for discovery, match in resolved:
        locked = g.db.execute(text("""
            SELECT discovery_id, item_id, scanned_ean, status
            FROM item_catalog_discoveries
            WHERE discovery_id = :id
            FOR UPDATE
        """), {"id": discovery.discovery_id}).fetchone()
        if not locked or locked.status != "PENDING":
            results.append({"discovery_id": discovery.discovery_id, "ean": discovery.scanned_ean, "status": "skipped", "reason": "already_reviewed"})
            continue
        _apply_match(locked, match, actor)
        results.append({
            "discovery_id": discovery.discovery_id,
            "ean": discovery.scanned_ean,
            "item_id": discovery.item_id,
            "status": "matched",
            "tecdoc_code": str(match.get("code") or ""),
        })

    missing = set(discovery_ids) - {row.discovery_id for row in discoveries}
    results.extend({"discovery_id": value, "status": "not_found", "reason": "missing_discovery"} for value in sorted(missing))
    g.db.commit()
    summary = {
        "requested": len(discovery_ids),
        "matched": sum(result["status"] == "matched" for result in results),
        "ambiguous": sum(result["status"] == "ambiguous" for result in results),
        "not_found": sum(result["status"] == "not_found" for result in results),
        "skipped": sum(result["status"] == "skipped" for result in results),
        "failed": sum(result["status"] == "error" for result in results),
    }
    current_app.logger.info(
        "catalog bulk match completed requested=%d matched=%d ambiguous=%d not_found=%d skipped=%d failed=%d",
        summary["requested"], summary["matched"], summary["ambiguous"],
        summary["not_found"], summary["skipped"], summary["failed"],
    )
    return jsonify({"ok": True, "summary": summary, "results": results})


@catalog_discovery_bp.route("/queue/<int:discovery_id>", methods=["DELETE"])
@require_auth
@require_admin_or_page_permission("items")
@with_db
def queue_delete(discovery_id):
    """Delete an unused provisional scan and its derived stock projection."""
    discovery = g.db.execute(text("""
        SELECT d.discovery_id, d.item_id, d.scanned_ean, d.status,
               i.sku, i.item_name, i.category
        FROM item_catalog_discoveries d
        JOIN items i ON i.item_id = d.item_id
        WHERE d.discovery_id = :id
        FOR UPDATE OF d, i
    """), {"id": discovery_id}).fetchone()
    if not discovery:
        return jsonify({"error": "Produsul scanat nu există."}), 404
    if not str(discovery.sku or "").startswith("SCAN-"):
        return jsonify({"error": "Doar produsele provizorii create prin scanare pot fi șterse aici."}), 409

    blockers = g.db.execute(text("""
        SELECT
            EXISTS(SELECT 1 FROM purchase_order_lines WHERE item_id = :iid) OR
            EXISTS(SELECT 1 FROM item_receipts WHERE item_id = :iid) OR
            EXISTS(SELECT 1 FROM sales_order_lines WHERE item_id = :iid) OR
            EXISTS(SELECT 1 FROM pick_tasks WHERE item_id = :iid) OR
            EXISTS(SELECT 1 FROM bin_transfers WHERE item_id = :iid) OR
            EXISTS(SELECT 1 FROM cycle_count_lines WHERE item_id = :iid) OR
            EXISTS(SELECT 1 FROM item_fulfillment_lines WHERE item_id = :iid) OR
            EXISTS(SELECT 1 FROM transfer_order_lines WHERE item_id = :iid)
    """), {"iid": discovery.item_id}).scalar()
    allocated = g.db.execute(
        text("SELECT COALESCE(SUM(quantity_allocated), 0) FROM inventory WHERE item_id = :iid"),
        {"iid": discovery.item_id},
    ).scalar()
    if blockers or int(allocated or 0) != 0:
        return jsonify({
            "error": "Produsul este deja folosit într-o operație de depozit sau comandă și nu poate fi șters.",
            "code": "provisional_item_in_use",
        }), 409

    stock_rows = g.db.execute(text("""
        SELECT inv.warehouse_id, inv.bin_id, b.bin_code,
               inv.quantity_on_hand, inv.quantity_allocated
        FROM inventory inv
        JOIN bins b ON b.bin_id = inv.bin_id
        WHERE inv.item_id = :iid
        ORDER BY inv.warehouse_id, b.bin_code
    """), {"iid": discovery.item_id}).fetchall()
    actor = str(g.current_user.get("username") or "unknown")
    warehouse_ids = sorted({row.warehouse_id for row in stock_rows})
    if g.current_user.get("role") != "ADMIN":
        allowed = set(g.current_user.get("warehouse_ids") or [])
        if any(warehouse_id not in allowed for warehouse_id in warehouse_ids):
            return jsonify({"error": "Nu ai acces la toate depozitele în care există acest produs."}), 403

    total_quantity = sum(int(row.quantity_on_hand or 0) for row in stock_rows)
    audit_warehouse_id = warehouse_ids[0] if warehouse_ids else None
    if audit_warehouse_id is None:
        audit_warehouse_id = g.db.execute(text("SELECT warehouse_id FROM warehouses ORDER BY warehouse_id LIMIT 1")).scalar()
    if audit_warehouse_id is not None:
        write_audit_log(
            g.db,
            action_type="PROVISIONAL_ITEM_DELETE",
            entity_type="ITEM",
            entity_id=discovery.item_id,
            user_id=actor,
            warehouse_id=audit_warehouse_id,
            details={
                "operation": "delete_scanned_provisional_item",
                "discovery_id": discovery.discovery_id,
                "ean": discovery.scanned_ean,
                "sku": discovery.sku,
                "item_name": discovery.item_name,
                "catalog_status": discovery.status,
                "quantity_removed": total_quantity,
                "locations": [dict(row._mapping) for row in stock_rows],
            },
        )

    # These rows exist only because the provisional scan created the item.
    # Operational references above deliberately block deletion instead of
    # erasing warehouse history.
    g.db.execute(text("DELETE FROM channel_availability WHERE item_id = :iid"), {"iid": discovery.item_id})
    g.db.execute(text("DELETE FROM preferred_bins WHERE item_id = :iid"), {"iid": discovery.item_id})
    g.db.execute(text("DELETE FROM mobile_stock_entries WHERE item_id = :iid"), {"iid": discovery.item_id})
    g.db.execute(text("DELETE FROM inventory_adjustments WHERE item_id = :iid"), {"iid": discovery.item_id})
    g.db.execute(text("DELETE FROM inventory WHERE item_id = :iid"), {"iid": discovery.item_id})
    g.db.execute(text("DELETE FROM items WHERE item_id = :iid"), {"iid": discovery.item_id})
    g.db.commit()
    return jsonify({
        "ok": True,
        "deleted_item_id": discovery.item_id,
        "quantity_removed": total_quantity,
        "status": "DELETED",
    })


@catalog_discovery_bp.route("/queue/<int:discovery_id>/ignore", methods=["POST"])
@require_auth
@require_admin_or_page_permission("items")
@with_db
def queue_ignore(discovery_id):
    result = g.db.execute(text("""
        UPDATE item_catalog_discoveries
        SET status = 'IGNORED', reviewed_by = :actor,
            reviewed_at = NOW(), updated_at = NOW()
        WHERE discovery_id = :id AND status = 'PENDING'
        RETURNING item_id
    """), {"id": discovery_id, "actor": str(g.current_user.get("username") or "unknown")}).fetchone()
    if not result:
        return jsonify({"error": "Produsul nu există sau a fost deja verificat."}), 409
    g.db.commit()
    return jsonify({"ok": True, "item_id": result.item_id, "status": "IGNORED"})


@catalog_discovery_bp.route("/lookup", methods=["GET"])
@require_auth
def lookup():
    try:
        data = catalog_request("/api/catalog/tecdoc/inventory-lookup", params={"ean": request.args.get("ean", ""), "reference": request.args.get("reference", "")})
        return jsonify(data)
    except CatalogDiscoveryError as exc:
        return jsonify({"error": str(exc)}), exc.status


@catalog_discovery_bp.route("/register", methods=["POST"])
@require_auth
@with_db
def register():
    body = request.get_json(silent=True) or {}
    count_id = body.get("countId")
    if not isinstance(count_id, int) or isinstance(count_id, bool):
        return jsonify({"error": "Inventar invalid."}), 422
    count = g.db.execute(text("SELECT warehouse_id,status FROM cycle_counts WHERE count_id=:id"), {"id": count_id}).fetchone()
    if not count:
        return jsonify({"error": "Inventarul nu există."}), 404
    allowed, denied = check_warehouse_access(count.warehouse_id)
    if not allowed:
        return denied
    if count.status not in ("PENDING", "IN_PROGRESS"):
        return jsonify({"error": "Inventarul este deja trimis."}), 409
    payload = {key: body.get(key) for key in ("ean", "reference", "articleId", "code", "confirmEquivalent")}
    payload["actor"] = str(g.current_user["username"])
    try:
        result = catalog_request("/api/integrations/sentry/catalog/register", payload=payload)
    except CatalogDiscoveryError as exc:
        return jsonify({"error": str(exc)}), exc.status
    item = g.db.execute(text("SELECT item_id,sku,item_name,upc FROM items WHERE external_id=CAST(:id AS uuid) AND is_active"), {"id": result["canonicalId"]}).fetchone()
    if not item:
        return jsonify({"error": "Produsul nu este încă disponibil în Sentry. Reîncearcă."}), 409
    return jsonify({"item": dict(item._mapping)})
