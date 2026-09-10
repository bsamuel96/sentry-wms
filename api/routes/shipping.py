"""
Shipping / fulfillment endpoint: records tracking info and creates fulfillment records.
"""

from flask import Blueprint, g, jsonify, request
from sqlalchemy import text

from middleware.auth_middleware import require_auth, check_warehouse_access, warehouse_scope_clause
from middleware.db import with_db
from schemas.shipping import FulfillRequest
from services.shipping_service import record_ship, require_packing_before_shipping
from constants import SO_PICKED, SO_PACKED
from utils.validation import validate_body

shipping_bp = Blueprint("shipping", __name__)


def _require_packing(db):
    """Check if packing is required before shipping."""
    return require_packing_before_shipping(db)


@shipping_bp.route("/ready-orders")
@require_auth
@with_db
def ready_orders():
    """Return the selected warehouse's orders that can be shipped now."""
    warehouse_id = request.args.get("warehouse_id", type=int)
    if not warehouse_id or warehouse_id <= 0:
        return jsonify({"error": "warehouse_id is required"}), 400

    ok, denied = check_warehouse_access(warehouse_id)
    if not ok:
        return denied

    limit = min(max(request.args.get("limit", 200, type=int) or 200, 1), 500)
    packing_required = _require_packing(g.db)
    status_filter = "so.status = :so_packed" if packing_required else "so.status IN (:so_picked, :so_packed)"
    rows = g.db.execute(
        text(
            f"""
            SELECT so.so_id,
                   so.so_number,
                   so.so_barcode,
                   so.customer_name,
                   so.status,
                   so.priority,
                   so.order_date,
                   so.picked_at,
                   so.packed_at,
                   so.created_at,
                   line_stats.line_count,
                   line_stats.unit_count,
                   COUNT(*) OVER () AS total_count
              FROM sales_orders so
              JOIN LATERAL (
                    SELECT COUNT(*)::int AS line_count,
                           COALESCE(SUM(sol.quantity_picked), 0)::int AS unit_count
                      FROM sales_order_lines sol
                     WHERE sol.so_id = so.so_id
              ) line_stats ON line_stats.line_count > 0
             WHERE so.warehouse_id = :warehouse_id
               AND {status_filter}
               AND COALESCE(so.order_type, 'sale') NOT IN ('return', 'refund')
             ORDER BY COALESCE(so.packed_at, so.picked_at, so.created_at) ASC NULLS LAST,
                      so.so_id ASC
             LIMIT :limit
            """
        ),
        {
            "warehouse_id": warehouse_id,
            "so_picked": SO_PICKED,
            "so_packed": SO_PACKED,
            "limit": limit,
        },
    ).fetchall()

    orders = [
        {
            "so_id": row.so_id,
            "so_number": row.so_number,
            "so_barcode": row.so_barcode,
            "customer_name": row.customer_name,
            "status": row.status,
            "priority": row.priority,
            "order_date": row.order_date.isoformat() if row.order_date else None,
            "picked_at": row.picked_at.isoformat() if row.picked_at else None,
            "packed_at": row.packed_at.isoformat() if row.packed_at else None,
            "created_at": row.created_at.isoformat() if row.created_at else None,
            "line_count": row.line_count,
            "unit_count": row.unit_count,
        }
        for row in rows
    ]
    total = int(rows[0].total_count) if rows else 0
    return jsonify({
        "orders": orders,
        "total": total,
        "limit": limit,
        "packing_required": packing_required,
    })


@shipping_bp.route("/order/<barcode>")
@require_auth
@with_db
def get_order(barcode):
    """Look up an order for shipping. Respects the require_packing setting."""
    if not barcode or not barcode.strip():
        return jsonify({"error": "Barcode is required"}), 400
    if len(barcode) > 100:
        return jsonify({"error": "Barcode too long (max 100 characters)"}), 400

    # V-026: scope at SELECT time so wrong-warehouse looks like not-found.
    scope_clause, scope_params = warehouse_scope_clause("warehouse_id")
    so = g.db.execute(
        text(
            f"""
            SELECT so_id, so_number, so_barcode, customer_name, status,
                   ship_method, ship_address, warehouse_id, memo
            FROM sales_orders
            WHERE (so_barcode = :barcode OR so_number = :barcode)
              {scope_clause}
            LIMIT 1
            """
        ),
        {"barcode": barcode, **scope_params},
    ).fetchone()

    if not so:
        return jsonify({"error": "Order not found"}), 404

    packing_required = _require_packing(g.db)
    allowed_statuses = [SO_PACKED] if packing_required else [SO_PICKED, SO_PACKED]

    if so.status not in allowed_statuses:
        if packing_required and so.status == SO_PICKED:
            return jsonify({"error": "Order must be packed before shipping"}), 400
        return jsonify({"error": f"Order is not ready for shipping. Current status: {so.status}"}), 400

    # Get item summary
    lines = g.db.execute(
        text(
            """
            SELECT sol.so_line_id, sol.line_number, sol.item_id,
                   i.sku, i.item_name,
                   sol.quantity_ordered, sol.quantity_picked, sol.quantity_packed
            FROM sales_order_lines sol
            JOIN items i ON i.item_id = sol.item_id
            WHERE sol.so_id = :so_id
            ORDER BY sol.line_number
            """
        ),
        {"so_id": so.so_id},
    ).fetchall()

    total_items = sum(l.quantity_picked for l in lines)

    return jsonify({
        "sales_order": {
            "so_id": so.so_id,
            "so_number": so.so_number,
            "so_barcode": so.so_barcode,
            "customer_name": so.customer_name,
            "status": so.status,
            "ship_method": so.ship_method,
            "ship_address": so.ship_address,
            "warehouse_id": so.warehouse_id,
            "memo": so.memo,
        },
        "lines": [
            {
                "so_line_id": l.so_line_id,
                "line_number": l.line_number,
                "item_id": l.item_id,
                "sku": l.sku,
                "item_name": l.item_name,
                "quantity_ordered": l.quantity_ordered,
                "quantity_picked": l.quantity_picked,
            }
            for l in lines
        ],
        "total_items": total_items,
        "total_lines": len(lines),
    })


@shipping_bp.route("/fulfill", methods=["POST"])
@require_auth
@validate_body(FulfillRequest)
@with_db
def fulfill(validated):
    so_id = validated.so_id
    carrier = validated.carrier
    tracking_number = validated.tracking_number
    ship_method = validated.ship_method
    username = g.current_user["username"]

    # Validate SO with warehouse scope at SELECT time (V-026).
    # v1.5.0 #119: FOR UPDATE locks the sales_orders row so a concurrent
    # complete_packing / fulfill on the same SO serialises and emits
    # pack.confirmed / ship.confirmed on the integration_events outbox
    # in commit order.
    scope_clause, scope_params = warehouse_scope_clause("warehouse_id")
    so = g.db.execute(
        text(
            f"""
            SELECT so_id, so_number, status, warehouse_id, external_id FROM sales_orders
            WHERE so_id = :so_id {scope_clause}
            FOR UPDATE
            """
        ),
        {"so_id": so_id, **scope_params},
    ).fetchone()

    if not so:
        return jsonify({"error": "Order not found"}), 404

    packing_required = _require_packing(g.db)
    allowed_statuses = [SO_PACKED] if packing_required else [SO_PICKED, SO_PACKED]

    if so.status not in allowed_statuses:
        if packing_required:
            return jsonify({"error": f"Order must be packed before shipping. Current status: {so.status}"}), 400
        return jsonify({"error": f"Order is not ready for shipping. Current status: {so.status}"}), 400

    try:
        result = record_ship(
            g.db,
            so_id=so_id,
            so_number=so.so_number,
            so_external_id=so.external_id,
            warehouse_id=so.warehouse_id,
            tracking_number=tracking_number,
            carrier=carrier,
            ship_method=ship_method,
            username=username,
            source_txn_id=g.source_txn_id,
        )
    except ValueError as e:
        # Layer 2C guard rejected the ship (silently under-picked lines).
        g.db.rollback()
        return jsonify({"error": str(e)}), 400

    g.db.commit()

    return jsonify({
        "message": "Shipment fulfilled",
        "fulfillment_id": result["fulfillment_id"],
        "so_number": so.so_number,
        "tracking_number": tracking_number,
        "carrier": carrier,
        "ship_method": ship_method,
        "lines_shipped": result["lines_shipped"],
        "total_quantity": result["total_quantity"],
    })
