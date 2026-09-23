"""Resolve unknown scanned products through the AutoSav-owned catalogue."""
import json
import math

from flask import Blueprint, g, jsonify, request
from sqlalchemy import text
from middleware.auth_middleware import (
    require_auth,
    check_warehouse_access,
    require_admin_or_page_permission,
)
from middleware.db import with_db
from services.catalog_discovery import catalog_request, CatalogDiscoveryError

catalog_discovery_bp = Blueprint("catalog_discovery", __name__)


def _serialize_discovery(row):
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
               d.tecdoc_name, d.tecdoc_match_type,
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
    if match.get("matchType") != "ean" and body.get("confirmEquivalent") is not True:
        return jsonify({"error": "Confirmă manual că produsul fizic corespunde acestei referințe."}), 422

    brand = str(match.get("brand") or "").strip()
    name = str(match.get("name") or "").strip()
    matched_code = str(match.get("code") or "").strip()
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
    actor = str(g.current_user.get("username") or "unknown")
    g.db.execute(text("""
        UPDATE item_catalog_discoveries
        SET status = 'MATCHED', tecdoc_article_id = :article_id,
            tecdoc_code = :code, tecdoc_brand = :brand, tecdoc_name = :name,
            tecdoc_match_type = :match_type, tecdoc_payload = CAST(:payload AS jsonb),
            reviewed_by = :actor, reviewed_at = NOW(), updated_at = NOW()
        WHERE discovery_id = :id
    """), {
        "id": discovery_id,
        "article_id": article_id,
        "code": matched_code,
        "brand": brand,
        "name": name,
        "match_type": str(match.get("matchType") or ""),
        "payload": json.dumps(match),
        "actor": actor,
    })
    g.db.commit()
    return jsonify({"ok": True, "item_id": discovery.item_id, "status": "MATCHED"})


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
