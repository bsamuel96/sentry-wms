"""
Inventory management endpoints: cycle count creation, retrieval, and submission.
"""

import json
import re
import uuid

from flask import Blueprint, g, jsonify, request
from sqlalchemy import text

from constants import (
    COUNT_PENDING, COUNT_IN_PROGRESS, COUNT_COMPLETED, COUNT_VARIANCE,
    ADJ_PENDING, ACTION_ADJUST, ACTION_COUNT,
)
from middleware.auth_middleware import require_auth, check_warehouse_access
from middleware.db import with_db
from schemas.cycle_count import CreateCycleCountRequest, SubmitCycleCountRequest
from services.audit_service import write_audit_log
from services.inventory_service import (
    add_inventory,
    release_satisfiable_backorders,
    RELEASE_SOURCE_ADJUSTMENT,
)
from services.webhook_dispatcher.backorder_notifier import dispatch_backorder_notification
from utils.validation import validate_body

inventory_bp = Blueprint("inventory", __name__)


def _valid_gtin(value):
    """Validate EAN-8, UPC-A, EAN-13 and GTIN-14 without provider calls."""
    barcode = str(value or "").strip()
    if len(barcode) not in (8, 12, 13, 14) or not barcode.isdigit():
        return False
    digits = [int(char) for char in barcode]
    check_digit = digits.pop()
    total = sum(
        digit * (3 if index % 2 == 0 else 1)
        for index, digit in enumerate(reversed(digits))
    )
    return (10 - (total % 10)) % 10 == check_digit


def _stock_entry_payload(db, row, *, repeated=False):
    current = db.execute(
        text("""
            SELECT COALESCE(SUM(quantity_on_hand), 0)
            FROM inventory
            WHERE item_id = :iid AND bin_id = :bid
        """),
        {"iid": row.item_id, "bid": row.bin_id},
    ).scalar()
    item = db.execute(
        text("SELECT sku, item_name, upc FROM items WHERE item_id = :iid"),
        {"iid": row.item_id},
    ).fetchone()
    discovery = db.execute(
        text("SELECT status FROM item_catalog_discoveries WHERE item_id = :iid"),
        {"iid": row.item_id},
    ).fetchone()
    return {
        "stock_entry_id": row.stock_entry_id,
        "idempotent_replay": repeated,
        "item": {
            "item_id": row.item_id,
            "sku": item.sku,
            "item_name": item.item_name,
            "upc": item.upc,
        },
        "bin_id": row.bin_id,
        "warehouse_id": row.warehouse_id,
        "quantity_added": row.quantity,
        "quantity_in_bin": int(current or 0),
        "catalog_status": discovery.status if discovery else "KNOWN",
    }


def _bin_coordinates(value):
    parts = [part.strip() for part in str(value or "").split("-") if part.strip()]
    return {
        "aisle": parts[0] if len(parts) > 0 else None,
        "row_num": parts[1] if len(parts) > 1 else None,
        "position_num": "-".join(parts[2:]) if len(parts) > 2 else None,
    }


@inventory_bp.route("/stock-entry/bin", methods=["POST"])
@require_auth
@with_db
def register_stock_entry_bin():
    """Register one physical location from its printed/scanned code."""
    body = request.get_json(silent=True) or {}
    try:
        warehouse_id = int(body.get("warehouse_id"))
    except (TypeError, ValueError):
        return jsonify({"error": "Depozitul este obligatoriu."}), 422
    bin_code = str(body.get("bin_code") or body.get("barcode") or "").strip()
    zone_code = str(body.get("zone_code") or "PICK").strip().upper()
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._/-]{0,49}", bin_code):
        return jsonify({"error": "Codul locației este invalid sau prea lung."}), 422
    if not re.fullmatch(r"[A-Z0-9_-]{1,20}", zone_code):
        return jsonify({"error": "Codul zonei este invalid."}), 422

    user = g.current_user or {}
    if user.get("role") != "ADMIN" and "receive" not in set(user.get("allowed_functions") or []):
        return jsonify({"error": "Nu ai permisiunea Recepție pentru această operație."}), 403
    allowed, denied = check_warehouse_access(warehouse_id)
    if not allowed:
        return denied

    g.db.execute(
        text("SELECT pg_advisory_xact_lock(hashtext(:key))"),
        {"key": f"mobile-bin:{warehouse_id}:{bin_code.casefold()}"},
    )
    existing = g.db.execute(text("""
        SELECT bin_id, warehouse_id, bin_code, bin_barcode, bin_type,
               aisle, row_num, level_num, position_num
        FROM bins
        WHERE warehouse_id = :wid
          AND (LOWER(bin_code) = LOWER(:code) OR LOWER(bin_barcode) = LOWER(:code))
        LIMIT 1
    """), {"wid": warehouse_id, "code": bin_code}).fetchone()
    if existing:
        return jsonify({"bin": dict(existing._mapping), "created": False})

    zone = g.db.execute(text("""
        SELECT zone_id FROM zones
        WHERE warehouse_id = :wid AND LOWER(zone_code) = LOWER(:code) AND is_active = TRUE
        LIMIT 1
    """), {"wid": warehouse_id, "code": zone_code}).fetchone()
    if not zone:
        zone = g.db.execute(text("""
            INSERT INTO zones (warehouse_id, zone_code, zone_name, zone_type)
            VALUES (:wid, :code, :name, 'PICKING')
            RETURNING zone_id
        """), {
            "wid": warehouse_id,
            "code": zone_code,
            "name": "Zonă colectare" if zone_code == "PICK" else zone_code,
        }).fetchone()

    coordinates = _bin_coordinates(bin_code)
    sequence = g.db.execute(text("""
        SELECT COALESCE(MAX(GREATEST(pick_sequence, putaway_sequence)), 0) + 1
        FROM bins WHERE warehouse_id = :wid
    """), {"wid": warehouse_id}).scalar()
    created = g.db.execute(text("""
        INSERT INTO bins (
            zone_id, warehouse_id, bin_code, bin_barcode, bin_type,
            aisle, row_num, position_num, pick_sequence, putaway_sequence,
            description, external_id
        ) VALUES (
            :zone_id, :wid, :code, :code, 'Pickable',
            :aisle, :row_num, :position_num, :sequence, :sequence,
            'Locație introdusă prin scanare în aplicația mobilă', :external_id
        )
        RETURNING bin_id, warehouse_id, bin_code, bin_barcode, bin_type,
                  aisle, row_num, level_num, position_num
    """), {
        "zone_id": zone.zone_id,
        "wid": warehouse_id,
        "code": bin_code,
        "sequence": int(sequence or 1),
        "external_id": str(uuid.uuid4()),
        **coordinates,
    }).fetchone()
    actor = str(user.get("username") or "unknown")
    write_audit_log(
        g.db,
        action_type=ACTION_ADJUST,
        entity_type="BIN",
        entity_id=created.bin_id,
        user_id=actor,
        warehouse_id=warehouse_id,
        details={"operation": "mobile_bin_registration", "bin_code": bin_code, "zone_code": zone_code},
    )
    g.db.commit()
    return jsonify({"bin": dict(created._mapping), "created": True}), 201


@inventory_bp.route("/stock-entry", methods=["POST"])
@require_auth
@with_db
def stock_entry():
    """Add a scanned EAN to a scanned bin and queue unknown items for review.

    This deliberately does not call TecDoc.  The warehouse write remains fast
    and deterministic; an admin compares provisional items later from the web
    catalogue-review page.
    """
    body = request.get_json(silent=True) or {}
    try:
        warehouse_id = int(body.get("warehouse_id"))
        bin_id = int(body.get("bin_id"))
        quantity = int(body.get("quantity", 1))
        idempotency_key = str(uuid.UUID(str(body.get("idempotency_key") or "")))
    except (TypeError, ValueError, AttributeError):
        return jsonify({"error": "Depozitul, locația, cantitatea și cheia cererii sunt obligatorii."}), 422

    ean = str(body.get("ean") or "").strip()
    if not _valid_gtin(ean):
        return jsonify({"error": "Scanează un EAN/GTIN valid (8, 12, 13 sau 14 cifre)."}), 422
    if quantity < 1 or quantity > 100000:
        return jsonify({"error": "Cantitatea trebuie să fie între 1 și 100000."}), 422

    user = g.current_user or {}
    if user.get("role") != "ADMIN" and "receive" not in set(user.get("allowed_functions") or []):
        return jsonify({"error": "Nu ai permisiunea Recepție pentru această operație."}), 403
    allowed, denied = check_warehouse_access(warehouse_id)
    if not allowed:
        return denied

    # Serialize retries before checking the idempotency table.  Both locks are
    # transaction-scoped and disappear automatically on commit/rollback.
    g.db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:key))"), {"key": idempotency_key})
    previous = g.db.execute(
        text("""
            SELECT stock_entry_id, item_id, bin_id, warehouse_id, quantity
            FROM mobile_stock_entries WHERE idempotency_key = CAST(:key AS uuid)
        """),
        {"key": idempotency_key},
    ).fetchone()
    if previous:
        return jsonify(_stock_entry_payload(g.db, previous, repeated=True))

    bin_row = g.db.execute(
        text("""
            SELECT bin_id, bin_code, warehouse_id
            FROM bins
            WHERE bin_id = :bid AND warehouse_id = :wid AND is_active = TRUE
            FOR UPDATE
        """),
        {"bid": bin_id, "wid": warehouse_id},
    ).fetchone()
    if not bin_row:
        return jsonify({"error": "Locația nu există sau nu aparține depozitului selectat."}), 404

    # A second handheld can scan the same brand-new EAN at the same time.
    # Lock on the EAN before deciding whether the provisional item exists.
    g.db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:ean))"), {"ean": f"ean:{ean}"})
    item = g.db.execute(
        text("""
            SELECT item_id, sku, item_name, upc, external_id
            FROM items
            WHERE upc = :ean
               OR barcode_aliases @> CAST(:aliases AS jsonb)
            ORDER BY item_id
            LIMIT 1
            FOR UPDATE
        """),
        {"ean": ean, "aliases": json.dumps([ean])},
    ).fetchone()
    provisional = False
    if not item:
        provisional = True
        base_sku = f"EAN-{ean}"
        sku = base_sku
        suffix = 1
        while g.db.execute(text("SELECT 1 FROM items WHERE sku = :sku"), {"sku": sku}).fetchone():
            suffix += 1
            sku = f"{base_sku}-{suffix}"
        item = g.db.execute(
            text("""
                INSERT INTO items (
                    sku, item_name, description, upc, category,
                    default_bin_id, external_id
                ) VALUES (
                    :sku, :name, :description, :ean, :category,
                    :bin_id, :external_id
                )
                RETURNING item_id, sku, item_name, upc, external_id
            """),
            {
                "sku": sku,
                "name": f"Produs nou – {ean}",
                "description": "Creat prin scanare în depozit; identificarea TecDoc este în așteptare.",
                "ean": ean,
                "category": "În așteptare TecDoc",
                "bin_id": bin_id,
                "external_id": str(uuid.uuid4()),
            },
        ).fetchone()
        g.db.execute(
            text("""
                INSERT INTO item_catalog_discoveries (
                    item_id, scanned_ean, status, created_by
                ) VALUES (:iid, :ean, 'PENDING', :actor)
                ON CONFLICT (item_id) DO NOTHING
            """),
            {"iid": item.item_id, "ean": ean, "actor": str(user.get("username") or "unknown")},
        )

    new_quantity = add_inventory(g.db, item.item_id, bin_id, warehouse_id, quantity)
    actor = str(user.get("username") or "unknown")
    adjustment_external_id = str(uuid.uuid4())
    g.db.execute(
        text("""
            INSERT INTO inventory_adjustments (
                item_id, bin_id, warehouse_id, quantity_change, reason_code,
                reason_detail, status, adjusted_by, external_id
            ) VALUES (
                :iid, :bid, :wid, :qty, 'FOUND', :detail,
                'APPROVED', :actor, :external_id
            )
        """),
        {
            "iid": item.item_id,
            "bid": bin_id,
            "wid": warehouse_id,
            "qty": quantity,
            "detail": "Intrare stoc mobil prin scanare EAN și locație",
            "actor": actor,
            "external_id": adjustment_external_id,
        },
    )
    entry = g.db.execute(
        text("""
            INSERT INTO mobile_stock_entries (
                idempotency_key, item_id, bin_id, warehouse_id, quantity, entered_by
            ) VALUES (CAST(:key AS uuid), :iid, :bid, :wid, :qty, :actor)
            RETURNING stock_entry_id, item_id, bin_id, warehouse_id, quantity
        """),
        {
            "key": idempotency_key,
            "iid": item.item_id,
            "bid": bin_id,
            "wid": warehouse_id,
            "qty": quantity,
            "actor": actor,
        },
    ).fetchone()
    write_audit_log(
        g.db,
        action_type=ACTION_COUNT,
        entity_type="ITEM",
        entity_id=item.item_id,
        user_id=actor,
        warehouse_id=warehouse_id,
        details={
            "operation": "mobile_stock_entry",
            "ean": ean,
            "bin_id": bin_id,
            "bin_code": bin_row.bin_code,
            "quantity": quantity,
            "quantity_in_bin": new_quantity,
            "provisional_item": provisional,
            "idempotency_key": idempotency_key,
        },
    )
    notifications = []
    release_satisfiable_backorders(
        g.db,
        warehouse_id=warehouse_id,
        item_id=item.item_id,
        source_txn_id=g.source_txn_id,
        deferred_notifications=notifications,
        source=RELEASE_SOURCE_ADJUSTMENT,
    )
    g.db.commit()
    for event_type, payload, notification_warehouse_id in notifications:
        dispatch_backorder_notification(
            event_type=event_type,
            payload=payload,
            warehouse_id=notification_warehouse_id,
        )
    payload = _stock_entry_payload(g.db, entry)
    payload["created_provisional_item"] = provisional
    return jsonify(payload), 201


@inventory_bp.route("/cycle-count/create", methods=["POST"])
@require_auth
@validate_body(CreateCycleCountRequest)
@with_db
def create_cycle_count(validated):
    warehouse_id = validated.warehouse_id
    bin_ids = validated.bin_ids

    # Validate warehouse
    wh = g.db.execute(
        text("SELECT warehouse_id FROM warehouses WHERE warehouse_id = :wh"),
        {"wh": warehouse_id},
    ).fetchone()
    if not wh:
        return jsonify({"error": "Warehouse not found"}), 404

    # Validate all bins
    for bid in bin_ids:
        b = g.db.execute(
            text("SELECT bin_id FROM bins WHERE bin_id = :bid AND warehouse_id = :wh"),
            {"bid": bid, "wh": warehouse_id},
        ).fetchone()
        if not b:
            return jsonify({"error": f"Bin {bid} not found in warehouse {warehouse_id}"}), 404

    username = g.current_user["username"]
    counts = []

    for bid in bin_ids:
        # Create cycle_counts record
        result = g.db.execute(
            text(
                """
                INSERT INTO cycle_counts (warehouse_id, bin_id, status, assigned_to, external_id)
                VALUES (:wh, :bid, :status, :user, :ext_id)
                RETURNING count_id
                """
            ),
            {"wh": warehouse_id, "bid": bid, "status": COUNT_PENDING, "user": username,
             "ext_id": str(uuid.uuid4())},
        )
        count_id = result.fetchone()[0]

        # Snapshot current inventory for this bin, aggregated per item so the
        # count has exactly one line per item even when a bin holds multiple
        # inventory rows for the same item (e.g. NULL-lot / ghost rows).
        # Required for the uq_cycle_count_lines_count_item (count_id, item_id)
        # invariant added in migration 080.
        inv_rows = g.db.execute(
            text(
                """
                SELECT item_id, SUM(quantity_on_hand) AS quantity_on_hand
                FROM inventory
                WHERE bin_id = :bid AND quantity_on_hand > 0
                GROUP BY item_id
                """
            ),
            {"bid": bid},
        ).fetchall()

        line_count = 0
        for inv in inv_rows:
            g.db.execute(
                text(
                    """
                    INSERT INTO cycle_count_lines (count_id, item_id, expected_quantity)
                    VALUES (:cid, :iid, :qty)
                    """
                ),
                {"cid": count_id, "iid": inv.item_id, "qty": inv.quantity_on_hand},
            )
            line_count += 1

        bin_row = g.db.execute(
            text("SELECT bin_code FROM bins WHERE bin_id = :bid"),
            {"bid": bid},
        ).fetchone()

        counts.append({
            "count_id": count_id,
            "bin_id": bid,
            "bin_code": bin_row.bin_code,
            "status": COUNT_PENDING,
            "lines": line_count,
            "assigned_to": username,
        })

    g.db.commit()

    return jsonify({"message": "Cycle counts created", "counts": counts})


@inventory_bp.route("/cycle-count/<int:count_id>")
@require_auth
@with_db
def get_cycle_count(count_id):
    cc = g.db.execute(
        text(
            """
            SELECT cc.count_id, cc.bin_id, b.bin_code, b.bin_barcode,
                   cc.warehouse_id, cc.status, cc.assigned_to, cc.created_at
            FROM cycle_counts cc
            JOIN bins b ON b.bin_id = cc.bin_id
            WHERE cc.count_id = :cid
            """
        ),
        {"cid": count_id},
    ).fetchone()

    if not cc:
        return jsonify({"error": "Cycle count not found"}), 404

    ok, denied = check_warehouse_access(cc.warehouse_id)
    if not ok:
        return denied

    lines = g.db.execute(
        text(
            """
            SELECT ccl.count_line_id, ccl.item_id, i.sku, i.item_name, i.upc,
                   ccl.expected_quantity, ccl.counted_quantity,
                   ccl.scanned, ccl.unexpected
            FROM cycle_count_lines ccl
            JOIN items i ON i.item_id = ccl.item_id
            WHERE ccl.count_id = :cid
            ORDER BY ccl.count_line_id
            """
        ),
        {"cid": count_id},
    ).fetchall()

    # Fetch blind count setting
    show_expected_row = g.db.execute(
        text("SELECT value FROM app_settings WHERE key = 'count_show_expected'")
    ).fetchone()
    show_expected = not show_expected_row or show_expected_row.value != "false"

    return jsonify({
        "cycle_count": {
            "count_id": cc.count_id,
            "bin_id": cc.bin_id,
            "bin_code": cc.bin_code,
            "bin_barcode": cc.bin_barcode,
            "warehouse_id": cc.warehouse_id,
            "status": cc.status,
            "assigned_to": cc.assigned_to,
            "created_at": cc.created_at.isoformat() if cc.created_at else None,
        },
        "show_expected": show_expected,
        "lines": [
            {
                "count_line_id": l.count_line_id,
                "item_id": l.item_id,
                "sku": l.sku,
                "item_name": l.item_name,
                "upc": l.upc,
                "expected_quantity": l.expected_quantity,
                "counted_quantity": l.counted_quantity,
                "variance": (l.counted_quantity - l.expected_quantity) if l.counted_quantity is not None else None,
                "scanned": l.scanned,
                "unexpected": l.unexpected if hasattr(l, "unexpected") else False,
            }
            for l in lines
        ],
    })


@inventory_bp.route("/cycle-count/submit", methods=["POST"])
@require_auth
@validate_body(SubmitCycleCountRequest)
@with_db
def submit_cycle_count(validated):
    count_id = validated.count_id
    submitted_lines = validated.lines

    # Validate cycle count. Lock the count row (FOR UPDATE OF cc) for the
    # duration of the submit: two concurrent submits of the same count -- e.g.
    # a double-tapped SUBMIT button firing two POSTs -- would otherwise both
    # read an open status and each re-insert the unexpected lines, duplicating
    # them. With the lock, the second submit blocks here until the first
    # commits, then re-reads the flipped status and is rejected below.
    cc = g.db.execute(
        text(
            """
            SELECT cc.count_id, cc.bin_id, cc.status, cc.warehouse_id, b.bin_code
            FROM cycle_counts cc
            JOIN bins b ON b.bin_id = cc.bin_id
            WHERE cc.count_id = :cid
            FOR UPDATE OF cc
            """
        ),
        {"cid": count_id},
    ).fetchone()

    if not cc:
        return jsonify({"error": "Cycle count not found"}), 404

    ok, denied = check_warehouse_access(cc.warehouse_id)
    if not ok:
        return denied

    if cc.status not in (COUNT_PENDING, COUNT_IN_PROGRESS):
        return jsonify({"error": f"Cycle count status is {cc.status}, cannot submit"}), 400

    username = g.current_user["username"]
    adjustments = []
    lines_with_variance = 0
    lines_matched = 0

    for sub in submitted_lines:
        cl_id = sub.count_line_id
        counted_qty = sub.counted_quantity
        is_unexpected = sub.unexpected

        if is_unexpected:
            # Unexpected item  -  not in original snapshot. Create a new count line.
            item_id = sub.item_id
            sku = sub.sku or "UNKNOWN"
            if not item_id:
                return jsonify({"error": "item_id required for unexpected lines"}), 400

            # Idempotent per (count_id, item_id): a count covers one bin, so an
            # item belongs to exactly one line. If a line for this item already
            # exists -- a duplicate entry within this payload, or an item that
            # was already snapshotted -- skip it rather than inserting a second
            # line and a second pending adjustment (which would double-count on
            # approval). The cross-submit double is prevented by the FOR UPDATE
            # lock above; this guards a single dirty payload, and
            # uq_cycle_count_lines_count_item is the DB backstop.
            already = g.db.execute(
                text("SELECT 1 FROM cycle_count_lines WHERE count_id = :cid AND item_id = :iid"),
                {"cid": count_id, "iid": item_id},
            ).fetchone()
            if already:
                continue

            new_line = g.db.execute(
                text(
                    """
                    INSERT INTO cycle_count_lines
                        (count_id, item_id, expected_quantity, counted_quantity, scanned, unexpected, counted_by, counted_at)
                    VALUES (:cid, :iid, 0, :qty, TRUE, TRUE, :user, NOW())
                    RETURNING count_line_id
                    """
                ),
                {"cid": count_id, "iid": item_id, "qty": counted_qty, "user": username},
            )
            new_cl_id = new_line.fetchone()[0]

            lines_with_variance += 1
            reason_detail = f"Cycle count unexpected item: counted {counted_qty} (not in snapshot)"
            adj_result = g.db.execute(
                text(
                    """
                    INSERT INTO inventory_adjustments
                        (item_id, bin_id, warehouse_id, quantity_change, reason_code, reason_detail, status, adjusted_by, cycle_count_id, external_id)
                    VALUES (:iid, :bid, :wh, :change, 'CYCLE_COUNT', :detail, :adj_status, :user, :cid, :ext_id)
                    RETURNING adjustment_id
                    """
                ),
                {
                    "iid": item_id,
                    "bid": cc.bin_id,
                    "wh": cc.warehouse_id,
                    "change": counted_qty,
                    "detail": reason_detail,
                    "adj_status": ADJ_PENDING,
                    "user": username,
                    "cid": count_id,
                    "ext_id": str(uuid.uuid4()),
                },
            )
            adj_id = adj_result.fetchone()[0]
            adjustments.append({
                "sku": sku,
                "expected": 0,
                "counted": counted_qty,
                "variance": counted_qty,
                "adjustment_id": adj_id,
                "unexpected": True,
            })
            continue

        # Load the count line
        cl = g.db.execute(
            text(
                """
                SELECT ccl.count_line_id, ccl.count_id, ccl.item_id, ccl.expected_quantity,
                       i.sku
                FROM cycle_count_lines ccl
                JOIN items i ON i.item_id = ccl.item_id
                WHERE ccl.count_line_id = :cl_id AND ccl.count_id = :cid
                """
            ),
            {"cl_id": cl_id, "cid": count_id},
        ).fetchone()

        if not cl:
            return jsonify({"error": f"Count line {cl_id} not found on this cycle count"}), 400

        # 1. Update count line
        g.db.execute(
            text(
                """
                UPDATE cycle_count_lines
                SET counted_quantity = :qty, counted_by = :user, counted_at = NOW(), scanned = TRUE
                WHERE count_line_id = :cl_id
                """
            ),
            {"qty": counted_qty, "user": username, "cl_id": cl_id},
        )

        # 2. Calculate variance
        variance = counted_qty - cl.expected_quantity

        if variance != 0:
            lines_with_variance += 1

            # 3. Create pending adjustment (no inventory update  -  requires admin approval)
            reason_detail = f"Cycle count variance: expected {cl.expected_quantity}, counted {counted_qty}"
            adj_result = g.db.execute(
                text(
                    """
                    INSERT INTO inventory_adjustments
                        (item_id, bin_id, warehouse_id, quantity_change, reason_code, reason_detail, status, adjusted_by, cycle_count_id, external_id)
                    VALUES (:iid, :bid, :wh, :change, 'CYCLE_COUNT', :detail, :adj_status, :user, :cid, :ext_id)
                    RETURNING adjustment_id
                    """
                ),
                {
                    "iid": cl.item_id,
                    "bid": cc.bin_id,
                    "wh": cc.warehouse_id,
                    "change": variance,
                    "detail": reason_detail,
                    "adj_status": ADJ_PENDING,
                    "user": username,
                    "cid": count_id,
                    "ext_id": str(uuid.uuid4()),
                },
            )
            adj_id = adj_result.fetchone()[0]

            adjustments.append({
                "sku": cl.sku,
                "expected": cl.expected_quantity,
                "counted": counted_qty,
                "variance": variance,
                "adjustment_id": adj_id,
            })
        else:
            lines_matched += 1

        # 4. Update last_counted_at
        g.db.execute(
            text(
                "UPDATE inventory SET last_counted_at = NOW() WHERE item_id = :iid AND bin_id = :bid"
            ),
            {"iid": cl.item_id, "bid": cc.bin_id},
        )

    # Set final status
    final_status = COUNT_VARIANCE if lines_with_variance > 0 else COUNT_COMPLETED
    g.db.execute(
        text(
            "UPDATE cycle_counts SET status = :status, completed_at = NOW() WHERE count_id = :cid"
        ),
        {"status": final_status, "cid": count_id},
    )

    # Audit log
    write_audit_log(
        g.db,
        action_type=ACTION_COUNT,
        entity_type="BIN",
        entity_id=cc.bin_id,
        user_id=username,
        warehouse_id=cc.warehouse_id,
        details={
            "count_id": count_id,
            "bin_code": cc.bin_code,
            "lines_with_variance": lines_with_variance,
            "lines_matched": lines_matched,
        },
    )

    g.db.commit()

    return jsonify({
        "message": "Cycle count submitted",
        "count_id": count_id,
        "bin_code": cc.bin_code,
        "status": final_status,
        "summary": {
            "total_lines": len(submitted_lines),
            "lines_with_variance": lines_with_variance,
            "lines_matched": lines_matched,
            "adjustments": adjustments,
        },
    })
