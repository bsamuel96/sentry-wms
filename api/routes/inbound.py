"""v1.7.0 Pipe B inbound surface.

Endpoints:

    GET  /api/v1/inbound/mapping-schema   -- documentation aid (unauthed)
    POST /api/v1/inbound/sales_orders     -- v1.7 first resource

The four remaining resource endpoints (items / customers / vendors /
purchase_orders) land in subsequent commits and reuse the same
register_inbound_resource() helper below.

Per-request shape:
- @require_wms_token: validates X-WMS-Token, refuses cross-direction
  bridging (V-200 + v1.7 cross_direction_scope_violation), checks the
  resource is in the token's inbound_resources scope.
- 413 Payload Too Large at request boundary if Content-Length exceeds
  SENTRY_INBOUND_MAX_BODY_KB (16-4096 KB; default 256).
- 422 on Pydantic body validation failure (extra='forbid' rejects
  typos at the wire).
- handle_inbound() in services.inbound_service runs the 10-step flow
  and returns a HandlerResult; the wrapper serialises into Flask
  responses with the X-Sentry-Canonical-Model: DRAFT-v1 header on
  every response (success or failure).
"""

import uuid
from datetime import timezone

from flask import Blueprint, current_app, g, jsonify, make_response, request
from psycopg2.errors import IntegrityError as _PsycopgIntegrityError
from pydantic import ValidationError
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError as _SAIntegrityError

from middleware.auth_middleware import require_wms_token
from middleware.db import with_db
from schemas.inbound import InboundBody
from schemas.csv_import import BinImportRow
from services.audit_service import write_audit_log
from services.events_service import emit_event, resolve_source_external_id
from services.inbound_service import (
    HandlerError,
    HandlerOK,
    get_max_body_kb,
    handle_inbound,
)
from services.inventory_service import (
    add_inventory,
    set_inventory_quantity,
    release_satisfiable_backorders,
    RELEASE_SOURCE_SYNC,
)
from services.webhook_dispatcher.backorder_notifier import (
    dispatch_backorder_notification,
)
from services.mapping_loader import MappingDocument
from services.rate_limit import limiter
from constants import ACTION_ADJUST, ADJ_APPROVED, BIN_PICKABLE


inbound_bp = Blueprint("inbound", __name__)


# ----------------------------------------------------------------------
# GET /api/v1/inbound/mapping-schema (documentation aid; unauthed)
# ----------------------------------------------------------------------


@inbound_bp.route("/mapping-schema", methods=["GET"])
def mapping_schema():
    response = make_response(jsonify(build_mapping_schema()))
    response.headers["Cache-Control"] = "public, max-age=300"
    response.headers["X-Sentry-Canonical-Model"] = "DRAFT-v1"
    return response


def build_mapping_schema() -> dict:
    """Returns the JSON Schema for the mapping document. Used by the
    route above and by the schema-regeneration script
    (tools/scripts/regenerate-mapping-schema.py) so the wire-served
    version and the committed file at
    docs/api/mapping-document-schema.json cannot drift."""
    schema = MappingDocument.model_json_schema()
    schema["$schema"] = "https://json-schema.org/draft/2020-12/schema"
    schema["title"] = "SentryWMS Inbound Mapping Document"
    return schema


# ----------------------------------------------------------------------
# POST handler shared by every resource route
# ----------------------------------------------------------------------


def _serialise(result) -> "Response":
    """Translate HandlerResult into a Flask response. Always carries the
    DRAFT-v1 header so consumers can detect the schema-stability stage
    on every response, including 4xx."""
    if isinstance(result, HandlerOK):
        body = jsonify(result.body)
        response = make_response(body, result.status_code)
    elif isinstance(result, HandlerError):
        body = jsonify(result.body)
        response = make_response(body, result.status_code)
        if result.headers:
            for k, v in result.headers.items():
                response.headers[k] = v
    else:
        raise RuntimeError(f"unknown handler result: {result!r}")
    response.headers["X-Sentry-Canonical-Model"] = "DRAFT-v1"
    return response


def _resource_post(resource_key: str):
    """Returns a Flask handler for POST /api/v1/inbound/<resource_key>.

    Body-size cap, Pydantic validation, transaction commit/rollback,
    and the DRAFT-v1 header live here so each per-resource route below
    is just a one-liner registering the right URL and Flask endpoint
    name (Flask endpoint name is what V170_INBOUND_RESOURCE_BY_ENDPOINT
    in the decorator dispatches on)."""

    def handler():
        cap_bytes = get_max_body_kb() * 1024
        if request.content_length is not None and request.content_length > cap_bytes:
            response = make_response(
                jsonify({
                    "error_kind": "body_too_large",
                    "max_body_kb": get_max_body_kb(),
                }),
                413,
            )
            response.headers["X-Sentry-Canonical-Model"] = "DRAFT-v1"
            return response

        try:
            body = InboundBody.model_validate(request.get_json(silent=False))
        except ValidationError as exc:
            response = make_response(
                jsonify({
                    "error_kind": "validation_error",
                    "details": exc.errors(include_url=False),
                }),
                422,
            )
            response.headers["X-Sentry-Canonical-Model"] = "DRAFT-v1"
            return response

        registry = current_app.config.get("MAPPING_REGISTRY")
        try:
            result = handle_inbound(
                db=g.db,
                resource_key=resource_key,
                body=body.model_dump(),
                token=g.current_token,
                registry=registry,
                source_txn_id=getattr(g, "source_txn_id", None),
            )
        except _SAIntegrityError as exc:
            g.db.rollback()
            response = make_response(
                jsonify({
                    "error_kind": "canonical_constraint_violation",
                    "message": _trim(str(exc.orig if exc.orig else exc)),
                }),
                422,
            )
            response.headers["X-Sentry-Canonical-Model"] = "DRAFT-v1"
            return response
        except _PsycopgIntegrityError as exc:
            g.db.rollback()
            response = make_response(
                jsonify({
                    "error_kind": "canonical_constraint_violation",
                    "message": _trim(str(exc)),
                }),
                422,
            )
            response.headers["X-Sentry-Canonical-Model"] = "DRAFT-v1"
            return response
        except Exception:
            g.db.rollback()
            raise

        if isinstance(result, HandlerOK):
            g.db.commit()
        else:
            g.db.rollback()
        return _serialise(result)

    return handler


def _trim(msg: str, n: int = 400) -> str:
    s = msg.replace("\n", " ").strip()
    return s if len(s) <= n else s[:n] + "..."


def register_inbound_resource(resource_key: str, endpoint_suffix: str) -> None:
    """Register POST /api/v1/inbound/<resource_key> with the wms_token
    decorator + per-token rate limit. Future per-resource commits add
    one line here per resource.

    Rate limit is env-configurable via INBOUND_RATE_LIMIT_PER_MINUTE (default 500).
    Sentry can sustain much higher than the original "100 per minute" default --
    bulk pre-cutover pushes (item master, inventory seed, customer migration)
    need higher ceilings without compromising steady-state safety. Single-
    threaded pushers max out at ~12 req/sec (RTT-limited) so 500/min gives
    ~30% headroom. Bump to 1000-2000 only if running multiple concurrent
    pushers. Lower it again per-environment if you ever see resource pressure.
    """
    import os
    rate_limit = os.getenv("INBOUND_RATE_LIMIT_PER_MINUTE", "500")
    handler = _resource_post(resource_key)
    handler = with_db(handler)
    handler = require_wms_token(handler)
    handler = limiter.limit(f"{rate_limit} per minute")(handler)
    inbound_bp.add_url_rule(
        f"/{resource_key}",
        endpoint=f"post_{endpoint_suffix}",
        view_func=handler,
        methods=["POST"],
    )


register_inbound_resource("sales_orders", "sales_orders")
register_inbound_resource("items", "items")
register_inbound_resource("customers", "customers")


# ----------------------------------------------------------------------
# POST /api/v1/inbound/items/reset
# ----------------------------------------------------------------------


def _source_item_reset_snapshot(source_system: str) -> dict:
    """Return the exact source-owned item set and any operational blockers.

    The token-bound source_system is the security boundary.  Canonical items
    are deletable only when no table has a foreign-key reference to them and
    no second source maps to the same canonical item.
    """
    source_rows = g.db.execute(
        text("""
            SELECT i.item_id, i.external_id
            FROM cross_system_mappings csm
            JOIN items i
              ON i.external_id = csm.canonical_id
            WHERE csm.source_system = :source_system
              AND csm.source_type = 'item'
              AND csm.canonical_type = 'item'
            ORDER BY i.item_id
        """),
        {"source_system": source_system},
    ).fetchall()
    item_ids = [int(row.item_id) for row in source_rows]

    inbound_count = int(g.db.execute(
        text("SELECT COUNT(*) FROM inbound_items WHERE source_system = :source_system"),
        {"source_system": source_system},
    ).scalar() or 0)
    mapping_count = int(g.db.execute(
        text("""
            SELECT COUNT(*)
            FROM cross_system_mappings
            WHERE source_system = :source_system
              AND source_type = 'item'
              AND canonical_type = 'item'
        """),
        {"source_system": source_system},
    ).scalar() or 0)

    dependency_counts = {}
    shared_item_count = 0
    if item_ids:
        fk_rows = g.db.execute(text("""
            SELECT
                child_ns.nspname AS schema_name,
                child.relname AS table_name,
                child_col.attname AS column_name
            FROM pg_constraint constraint_row
            JOIN pg_class parent
              ON parent.oid = constraint_row.confrelid
            JOIN pg_namespace parent_ns
              ON parent_ns.oid = parent.relnamespace
            JOIN pg_class child
              ON child.oid = constraint_row.conrelid
            JOIN pg_namespace child_ns
              ON child_ns.oid = child.relnamespace
            JOIN LATERAL unnest(constraint_row.conkey) WITH ORDINALITY
              AS child_key(attnum, ordinal_position) ON TRUE
            JOIN LATERAL unnest(constraint_row.confkey) WITH ORDINALITY
              AS parent_key(attnum, ordinal_position)
              ON parent_key.ordinal_position = child_key.ordinal_position
            JOIN pg_attribute child_col
              ON child_col.attrelid = child.oid
             AND child_col.attnum = child_key.attnum
            JOIN pg_attribute parent_col
              ON parent_col.attrelid = parent.oid
             AND parent_col.attnum = parent_key.attnum
            WHERE constraint_row.contype = 'f'
              AND parent_ns.nspname = 'public'
              AND parent.relname = 'items'
              AND parent_col.attname = 'item_id'
            ORDER BY child_ns.nspname, child.relname, child_col.attname
        """)).fetchall()
        for fk_row in fk_rows:
            # Names originate in PostgreSQL's own system catalog. Quote them
            # defensively before composing the identifier-only fragment.
            schema_name = str(fk_row.schema_name).replace('"', '""')
            table_name = str(fk_row.table_name).replace('"', '""')
            column_name = str(fk_row.column_name).replace('"', '""')
            count = int(g.db.execute(
                text(
                    f'SELECT COUNT(*) FROM "{schema_name}"."{table_name}" '
                    f'WHERE "{column_name}" = ANY(CAST(:item_ids AS integer[]))'
                ),
                {"item_ids": item_ids},
            ).scalar() or 0)
            if count:
                dependency_counts[f"{schema_name}.{table_name}.{column_name}"] = count

        shared_item_count = int(g.db.execute(
            text("""
                SELECT COUNT(DISTINCT i.item_id)
                FROM items i
                JOIN cross_system_mappings other
                  ON other.canonical_type = 'item'
                 AND other.canonical_id = i.external_id
                WHERE i.item_id = ANY(CAST(:item_ids AS integer[]))
                  AND other.source_system <> :source_system
            """),
            {"item_ids": item_ids, "source_system": source_system},
        ).scalar() or 0)

    return {
        "source_system": source_system,
        "item_ids": item_ids,
        "item_count": len(item_ids),
        "inbound_document_count": inbound_count,
        "mapping_count": mapping_count,
        "shared_item_count": shared_item_count,
        "dependency_counts": dependency_counts,
        "blocked": bool(dependency_counts),
    }


def _items_reset_post():
    """Preview or delete only item data owned by the token's source."""
    payload = request.get_json(silent=True) or {}
    source_system = g.current_token.get("source_system") if g.current_token else None
    expected_source_system = str(payload.get("source_system") or "").strip()
    dry_run = payload.get("dry_run") is True

    if not source_system:
        return jsonify({"error_kind": "token_missing_source_system"}), 401
    if expected_source_system != source_system:
        return jsonify({
            "error_kind": "source_system_mismatch",
            "token_source_system": source_system,
        }), 403
    if not dry_run and payload.get("confirm") != "DELETE_SOURCE_ITEMS":
        return jsonify({
            "error_kind": "confirmation_required",
            "required_confirmation": "DELETE_SOURCE_ITEMS",
        }), 422

    try:
        snapshot = _source_item_reset_snapshot(source_system)
        public_snapshot = {
            key: value for key, value in snapshot.items() if key != "item_ids"
        }
        if dry_run:
            g.db.rollback()
            return jsonify({"dry_run": True, **public_snapshot}), 200
        if snapshot["blocked"]:
            g.db.rollback()
            return jsonify({
                "error_kind": "source_items_have_operational_dependencies",
                **public_snapshot,
            }), 409

        item_ids = snapshot["item_ids"]
        deleted_inbound = int(g.db.execute(
            text("DELETE FROM inbound_items WHERE source_system = :source_system"),
            {"source_system": source_system},
        ).rowcount or 0)
        deleted_mappings = int(g.db.execute(
            text("""
                DELETE FROM cross_system_mappings
                WHERE source_system = :source_system
                  AND source_type = 'item'
                  AND canonical_type = 'item'
            """),
            {"source_system": source_system},
        ).rowcount or 0)
        deleted_items = 0
        if item_ids:
            deleted_items = int(g.db.execute(
                text("""
                    DELETE FROM items candidate
                    WHERE candidate.item_id = ANY(CAST(:item_ids AS integer[]))
                      AND NOT EXISTS (
                          SELECT 1
                          FROM cross_system_mappings remaining
                          WHERE remaining.canonical_type = 'item'
                            AND remaining.canonical_id = candidate.external_id
                      )
                """),
                {"item_ids": item_ids},
            ).rowcount or 0)
        g.db.commit()
    except Exception:
        g.db.rollback()
        raise

    response = make_response(jsonify({
        "deleted": True,
        "source_system": source_system,
        "deleted_items": deleted_items,
        "deleted_mappings": deleted_mappings,
        "deleted_inbound_documents": deleted_inbound,
        "preserved_shared_items": snapshot["item_count"] - deleted_items,
    }), 200)
    response.headers["X-Sentry-Canonical-Model"] = "DRAFT-v1"
    return response


def register_items_reset_route() -> None:
    import os
    rate_limit = os.getenv("INBOUND_RATE_LIMIT_PER_MINUTE", "500")
    handler = _items_reset_post
    handler = with_db(handler)
    handler = require_wms_token(handler)
    handler = limiter.limit(f"{rate_limit} per minute")(handler)
    inbound_bp.add_url_rule(
        "/items/reset",
        endpoint="post_items_reset",
        view_func=handler,
        methods=["POST"],
    )


register_items_reset_route()


# ----------------------------------------------------------------------
# POST /api/v1/inbound/inventory_update
# ----------------------------------------------------------------------
#
# Token-authed bulk inventory STATE-SYNC endpoint. Used for:
#   - Initial cutover seed of on-hand quantities
#   - Continuous mirror from an external marketplace / fulfillment system
#   - Drift correction (when an upstream system and Sentry disagree, push
#     the upstream's state in)
#   - Bulk corrections post-cutover
#
# State-based semantics: caller sends the DESIRED final quantity. Server
# computes the delta vs current quantity_on_hand and applies it as an
# inventory_adjustments row (so the audit trail still tells the story).
# Idempotent: pushing the same target_quantity twice is a 0-delta no-op.
#
# Body shape: standard InboundBody with source_payload containing:
#   {
#     "item_external_id": "<source-system SKU>", // resolved via cross_system_mappings
#     "bin_code": "PICK-BULK",                   // resolved within warehouse_id
#     "warehouse_id": 1,                         // target warehouse id
#     "target_quantity": 50,                     // absolute; the desired state
#     "reason_code": "cutover_seed"              // free-form, recorded in inventory_adjustments
#   }
#
# Returns 201 on apply (delta != 0) with { canonical_id, applied_delta, ... }
# Returns 200 on no-op (delta == 0) with { applied_delta: 0, current_quantity, ... }
#
# Bidirectional sync architecture:
#   upstream -> Sentry: this endpoint (state-based)
#   Sentry -> upstream: existing inventoryadjusted.completed webhook events (delta-based)


def _inventory_update_post():
    """POST /api/v1/inbound/inventory_update -- token-authed state-based sync."""
    cap_bytes = get_max_body_kb() * 1024
    if request.content_length is not None and request.content_length > cap_bytes:
        response = make_response(
            jsonify({"error_kind": "body_too_large", "max_body_kb": get_max_body_kb()}),
            413,
        )
        response.headers["X-Sentry-Canonical-Model"] = "DRAFT-v1"
        return response

    try:
        body = InboundBody.model_validate(request.get_json(silent=False))
    except ValidationError as exc:
        response = make_response(
            jsonify({"error_kind": "validation_error", "details": exc.errors(include_url=False)}),
            422,
        )
        response.headers["X-Sentry-Canonical-Model"] = "DRAFT-v1"
        return response

    sp = body.source_payload or {}
    required = ("item_external_id", "bin_code", "warehouse_id", "target_quantity", "reason_code")
    missing = [k for k in required if k not in sp]
    if missing:
        response = make_response(
            jsonify({"error_kind": "missing_source_payload_fields", "missing": missing}),
            422,
        )
        response.headers["X-Sentry-Canonical-Model"] = "DRAFT-v1"
        return response

    try:
        item_external_id = str(sp["item_external_id"])
        bin_code = str(sp["bin_code"])
        warehouse_id = int(sp["warehouse_id"])
        target_quantity = int(sp["target_quantity"])
        reason_code = str(sp["reason_code"])
    except (TypeError, ValueError) as exc:
        response = make_response(
            jsonify({"error_kind": "invalid_payload_types", "message": str(exc)[:200]}),
            422,
        )
        response.headers["X-Sentry-Canonical-Model"] = "DRAFT-v1"
        return response

    if target_quantity < 0:
        response = make_response(
            jsonify({"error_kind": "negative_target_quantity", "target_quantity": target_quantity}),
            422,
        )
        response.headers["X-Sentry-Canonical-Model"] = "DRAFT-v1"
        return response

    # Resolve the source-system SKU to Sentry's item_id via
    # cross_system_mappings -> items. The token's source_system tells us
    # which mapping namespace to look in.
    source_system = g.current_token.get("source_system") if g.current_token else None
    if not source_system:
        response = make_response(jsonify({"error_kind": "token_missing_source_system"}), 401)
        response.headers["X-Sentry-Canonical-Model"] = "DRAFT-v1"
        return response

    item_row = g.db.execute(
        text("""
            SELECT i.item_id, i.sku, i.external_id
            FROM cross_system_mappings csm
            JOIN items i ON i.external_id = csm.canonical_id
            WHERE csm.source_system = :ss
              AND csm.source_type = 'item'
              AND csm.source_id = :sid
        """),
        {"ss": source_system, "sid": item_external_id},
    ).fetchone()
    if not item_row:
        response = make_response(
            jsonify({
                "error_kind": "item_not_found",
                "item_external_id": item_external_id,
                "source_system": source_system,
            }),
            404,
        )
        response.headers["X-Sentry-Canonical-Model"] = "DRAFT-v1"
        return response
    item_id = item_row.item_id

    # Resolve bin via (warehouse_id, bin_code).
    bin_row = g.db.execute(
        text("SELECT bin_id, bin_code, external_id FROM bins WHERE warehouse_id = :wh AND bin_code = :bc"),
        {"wh": warehouse_id, "bc": bin_code},
    ).fetchone()
    if not bin_row:
        response = make_response(
            jsonify({
                "error_kind": "bin_not_found",
                "warehouse_id": warehouse_id,
                "bin_code": bin_code,
            }),
            404,
        )
        response.headers["X-Sentry-Canonical-Model"] = "DRAFT-v1"
        return response
    bin_id = bin_row.bin_id

    # Look up current state for this (item, bin) -- needed to compute delta.
    inv_row = g.db.execute(
        text("""
            SELECT inventory_id, quantity_on_hand FROM inventory
            WHERE item_id = :iid AND bin_id = :bid FOR UPDATE
        """),
        {"iid": item_id, "bid": bin_id},
    ).fetchone()
    current_quantity = inv_row.quantity_on_hand if inv_row else 0
    quantity_change = target_quantity - current_quantity

    # Idempotent no-op: target already matches current. Return 200 + current
    # state without writing an adjustment row or emitting an event.
    if quantity_change == 0:
        response = make_response(
            jsonify({
                "applied_delta": 0,
                "current_quantity": current_quantity,
                "target_quantity": target_quantity,
                "warehouse_id": warehouse_id,
                "bin_id": bin_id,
                "item_id": item_id,
                "noop": True,
            }),
            200,
        )
        response.headers["X-Sentry-Canonical-Model"] = "DRAFT-v1"
        return response

    # Apply ADD or REMOVE for the computed delta.
    _deferred_notifications = []
    try:
        if quantity_change > 0:
            adjustment_type = "ADD"
            add_inventory(g.db, item_id, bin_id, warehouse_id, quantity_change)
            # an inventory sync that raises on-hand in the backorder's
            # warehouse should release it, same as any other way the stock
            # could have landed. source="sync" rather than "adjustment" so a
            # consumer can tell an automated feed from an operator action.
            release_satisfiable_backorders(
                g.db,
                warehouse_id=warehouse_id,
                item_id=item_id,
                source_txn_id=g.source_txn_id,
                deferred_notifications=_deferred_notifications,
                source=RELEASE_SOURCE_SYNC,
            )
        else:
            adjustment_type = "REMOVE"
            qty_remove = abs(quantity_change)
            new_qty = current_quantity - qty_remove
            set_inventory_quantity(g.db, inv_row.inventory_id, new_qty)
    except Exception:
        g.db.rollback()
        raise

    # Create the adjustment record (status=APPROVED -- auto-applied via Pipe B).
    # adjusted_by is NOT NULL on inventory_adjustments. Pipe B WMS tokens are
    # system-driven and carry no user identity, so attribute the adjustment to
    # the admin user (id 1) as a last resort. The audit trail stays rich: the
    # token_name and source_external_id are recorded in audit_log.details below.
    adjusted_by_user_id = (g.current_token.get("user_id") if g.current_token else None) or 1
    adj_row = g.db.execute(
        text("""
            INSERT INTO inventory_adjustments (
                item_id, bin_id, warehouse_id, quantity_change,
                reason_code, reason_detail, status,
                adjusted_by, adjusted_at, external_id
            )
            VALUES (
                :iid, :bid, :wid, :qty_change,
                :reason_code, :reason_detail, :status,
                :user_id, NOW(), :ext_id
            )
            RETURNING adjustment_id, adjusted_at, external_id
        """),
        {
            "iid": item_id, "bid": bin_id, "wid": warehouse_id,
            "qty_change": quantity_change,
            "reason_code": reason_code[:60],
            "reason_detail": f"Pipe B inbound adjustment from upstream external_id={body.external_id}",
            "status": ADJ_APPROVED,
            "user_id": adjusted_by_user_id,
            "ext_id": str(uuid.uuid4()),
        },
    ).fetchone()

    write_audit_log(
        g.db, ACTION_ADJUST, "ITEM", item_id,
        user_id=adjusted_by_user_id,
        warehouse_id=warehouse_id,
        details={
            "adjustment_id": adj_row.adjustment_id,
            "adjustment_type": adjustment_type,
            "bin_id": bin_id,
            "quantity": quantity_change,
            "reason_code": reason_code,
            "source_external_id": body.external_id,
            "source_system": source_system,
            "token_name": g.current_token.get("token_name") if g.current_token else None,
        },
    )

    item_source_external_id = (
        resolve_source_external_id(g.db, "item", item_row.external_id)
        or str(item_row.external_id)
    )
    emit_event(
        g.db,
        event_type="inventoryadjusted.completed",
        event_version=1,
        aggregate_type="inventory_adjustment",
        aggregate_id=adj_row.adjustment_id,
        aggregate_external_id=adj_row.external_id,
        warehouse_id=warehouse_id,
        source_txn_id=getattr(g, "source_txn_id", None),
        payload={
            "adjustment_external_id": str(adj_row.external_id),
            "item_external_id": item_source_external_id,
            "bin_external_id": str(bin_row.external_id),
            "quantity_delta": quantity_change,
            "reason_code": reason_code,
            "applied_by_user_external_id": None,  # Pipe B path: no Sentry user identity
            "applied_at": adj_row.adjusted_at.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
        },
    )

    g.db.commit()

    # after the commit, matching every other release path.
    for event_type, payload, wid in _deferred_notifications:
        dispatch_backorder_notification(
            event_type=event_type, payload=payload, warehouse_id=wid,
        )

    response = make_response(
        jsonify({
            "canonical_id": str(adj_row.external_id),
            "adjustment_id": adj_row.adjustment_id,
            "applied_delta": quantity_change,
            "current_quantity": target_quantity,  # post-apply state
            "target_quantity": target_quantity,
            "warehouse_id": warehouse_id,
            "bin_id": bin_id,
            "item_id": item_id,
            "noop": False,
        }),
        201,
    )
    response.headers["X-Sentry-Canonical-Model"] = "DRAFT-v1"
    return response


def register_inventory_update_route() -> None:
    """Register POST /api/v1/inbound/inventory_update -- state-based sync."""
    import os
    rate_limit = os.getenv("INBOUND_RATE_LIMIT_PER_MINUTE", "500")
    handler = _inventory_update_post
    handler = with_db(handler)
    handler = require_wms_token(handler)
    handler = limiter.limit(f"{rate_limit} per minute")(handler)
    inbound_bp.add_url_rule(
        "/inventory_update",
        endpoint="post_inventory_update",
        view_func=handler,
        methods=["POST"],
    )


register_inventory_update_route()


# ----------------------------------------------------------------------
# POST /api/v1/inbound/storage_bins
# ----------------------------------------------------------------------

def _storage_bins_post():
    """Idempotently mirror an upstream warehouse's physical bin structure.

    The route intentionally reuses the ``inventory_update`` inbound scope:
    creating the target bins is a prerequisite of that state-sync contract.
    It never deletes bins or inventory and supports a read-only dry run.
    """
    try:
        body = InboundBody.model_validate(request.get_json(silent=False))
    except ValidationError as exc:
        response = make_response(
            jsonify({"error_kind": "validation_error", "details": exc.errors(include_url=False)}),
            422,
        )
        response.headers["X-Sentry-Canonical-Model"] = "DRAFT-v1"
        return response

    sp = body.source_payload or {}
    try:
        warehouse_id = int(sp.get("warehouse_id"))
    except (TypeError, ValueError):
        warehouse_id = 0
    zone_code = str(sp.get("zone_code") or "PICK").strip().upper()
    records = sp.get("bins")
    dry_run = bool(sp.get("dry_run", False))
    if warehouse_id <= 0 or not zone_code or not isinstance(records, list):
        response = make_response(jsonify({
            "error_kind": "invalid_storage_bins_payload",
            "required": ["warehouse_id", "zone_code", "bins[]"],
        }), 422)
        response.headers["X-Sentry-Canonical-Model"] = "DRAFT-v1"
        return response
    if len(records) > 5000:
        response = make_response(jsonify({"error_kind": "too_many_bins", "maximum": 5000}), 422)
        response.headers["X-Sentry-Canonical-Model"] = "DRAFT-v1"
        return response

    warehouse = g.db.execute(
        text("SELECT warehouse_id FROM warehouses WHERE warehouse_id = :wid"),
        {"wid": warehouse_id},
    ).fetchone()
    if not warehouse:
        response = make_response(jsonify({
            "error_kind": "warehouse_not_found", "warehouse_id": warehouse_id,
        }), 404)
        response.headers["X-Sentry-Canonical-Model"] = "DRAFT-v1"
        return response

    validated = []
    errors = []
    seen_codes = set()
    for index, raw_record in enumerate(records, 1):
        candidate = dict(raw_record) if isinstance(raw_record, dict) else {}
        candidate["warehouse_id"] = warehouse_id
        candidate["zone"] = zone_code
        try:
            row = BinImportRow.model_validate(candidate)
        except ValidationError as exc:
            errors.append({"row": index, "error": exc.errors(include_url=False)[0].get("msg", "invalid")})
            continue
        code_key = row.bin_code.casefold()
        if code_key in seen_codes:
            errors.append({"row": index, "bin_code": row.bin_code, "error": "duplicate bin_code in request"})
            continue
        seen_codes.add(code_key)
        validated.append(row)

    if errors:
        response = make_response(jsonify({
            "error_kind": "invalid_storage_bins", "errors": errors, "failed": len(errors),
        }), 422)
        response.headers["X-Sentry-Canonical-Model"] = "DRAFT-v1"
        return response

    zone = g.db.execute(
        text("""
            SELECT zone_id, zone_code FROM zones
            WHERE warehouse_id = :wid AND LOWER(zone_code) = LOWER(:code)
            LIMIT 1
        """),
        {"wid": warehouse_id, "code": zone_code},
    ).fetchone()
    zone_will_be_created = zone is None
    if zone_will_be_created and not dry_run:
        zone = g.db.execute(
            text("""
                INSERT INTO zones (warehouse_id, zone_code, zone_name, zone_type)
                VALUES (:wid, :code, :name, 'PICKING')
                RETURNING zone_id, zone_code
            """),
            {"wid": warehouse_id, "code": zone_code, "name": str(sp.get("zone_name") or "Pick Zone")[:100]},
        ).fetchone()

    existing_rows = g.db.execute(
        text("""
            SELECT bin_id, zone_id, bin_code, bin_barcode, bin_type, aisle,
                   row_num, level_num, position_num, pick_sequence, putaway_sequence
            FROM bins WHERE warehouse_id = :wid
        """),
        {"wid": warehouse_id},
    ).fetchall()
    existing_by_code = {str(row.bin_code).casefold(): row for row in existing_rows}
    desired_zone_id = zone.zone_id if zone else None
    created = updated = unchanged = 0

    def _text_value(value):
        return str(value or "").strip()

    for row in validated:
        existing = existing_by_code.get(row.bin_code.casefold())
        desired = {
            "barcode": row.bin_barcode or row.bin_code,
            "type": row.bin_type or BIN_PICKABLE,
            "aisle": row.aisle,
            "row_num": row.row_num,
            "level_num": row.level_num,
            "position_num": row.position_num,
            "pick_sequence": row.pick_sequence or 0,
            "putaway_sequence": row.putaway_sequence or 0,
        }
        if not existing:
            created += 1
            if not dry_run:
                g.db.execute(text("""
                    INSERT INTO bins (
                        zone_id, warehouse_id, bin_code, bin_barcode, bin_type,
                        aisle, row_num, level_num, position_num,
                        pick_sequence, putaway_sequence, description, external_id
                    ) VALUES (
                        :zone_id, :warehouse_id, :bin_code, :barcode, :type,
                        :aisle, :row_num, :level_num, :position_num,
                        :pick_sequence, :putaway_sequence, :description, :external_id
                    )
                """), {
                    "zone_id": desired_zone_id, "warehouse_id": warehouse_id,
                    "bin_code": row.bin_code, **desired,
                    "description": row.description, "external_id": str(uuid.uuid4()),
                })
            continue

        differs = (
            existing.zone_id != desired_zone_id
            or _text_value(existing.bin_barcode) != _text_value(desired["barcode"])
            or _text_value(existing.bin_type) != _text_value(desired["type"])
            or _text_value(existing.aisle) != _text_value(desired["aisle"])
            or _text_value(existing.row_num) != _text_value(desired["row_num"])
            or _text_value(existing.level_num) != _text_value(desired["level_num"])
            or _text_value(existing.position_num) != _text_value(desired["position_num"])
            or int(existing.pick_sequence or 0) != desired["pick_sequence"]
            or int(existing.putaway_sequence or 0) != desired["putaway_sequence"]
        )
        if not differs:
            unchanged += 1
            continue
        updated += 1
        if not dry_run:
            g.db.execute(text("""
                UPDATE bins SET
                    zone_id = :zone_id, bin_barcode = :barcode, bin_type = :type,
                    aisle = :aisle, row_num = :row_num, level_num = :level_num,
                    position_num = :position_num, pick_sequence = :pick_sequence,
                    putaway_sequence = :putaway_sequence
                WHERE bin_id = :bin_id
            """), {"zone_id": desired_zone_id, "bin_id": existing.bin_id, **desired})

    if not dry_run:
        g.db.commit()
    response = make_response(jsonify({
        "ok": True,
        "dry_run": dry_run,
        "warehouse_id": warehouse_id,
        "zone_code": zone_code,
        "zone_created": zone_will_be_created,
        "desired": len(validated),
        "created": created,
        "updated": updated,
        "unchanged": unchanged,
        "failed": 0,
        "errors": [],
    }), 200)
    response.headers["X-Sentry-Canonical-Model"] = "DRAFT-v1"
    return response


def register_storage_bins_route() -> None:
    import os
    rate_limit = os.getenv("INBOUND_RATE_LIMIT_PER_MINUTE", "500")
    handler = _storage_bins_post
    handler = with_db(handler)
    handler = require_wms_token(handler)
    handler = limiter.limit(f"{rate_limit} per minute")(handler)
    inbound_bp.add_url_rule(
        "/storage_bins",
        endpoint="post_storage_bins",
        view_func=handler,
        methods=["POST"],
    )


register_storage_bins_route()
register_inbound_resource("vendors", "vendors")
register_inbound_resource("purchase_orders", "purchase_orders")
