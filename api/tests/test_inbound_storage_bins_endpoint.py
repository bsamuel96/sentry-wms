"""End-to-end coverage for the inbound storage-bin mirror."""

import hashlib
import json
import os
import sys
import uuid

import pytest

os.environ.setdefault("DATABASE_URL", "postgresql://sentry:sentry@localhost:5432/sentry")
os.environ.setdefault("JWT_SECRET", "NEVER_USE_THIS_IN_PRODUCTION_32!")
os.environ.setdefault("SENTRY_ENCRYPTION_KEY", "t5hPIEVn_O41qfiMqAiPEnwzQh68o3Es46YfSOBvEK8=")
os.environ.setdefault("SENTRY_TOKEN_PEPPER", "NEVER_USE_THIS_PEPPER_IN_PRODUCTION")

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import db_test_context
from _wms_token_helpers import PEPPER
from services import token_cache


def _query(sql, params=()):
    conn = db_test_context.get_raw_connection()
    cur = conn.cursor()
    try:
        cur.execute(sql, params)
        return cur.fetchall() if cur.description is not None else None
    finally:
        cur.close()


def _insert_token(plaintext, inbound_resources=("inventory_update",)):
    source_system = f"bins-{uuid.uuid4().hex[:8]}"
    _query(
        "INSERT INTO inbound_source_systems_allowlist (source_system, kind) "
        "VALUES (%s, 'internal_tool') ON CONFLICT DO NOTHING",
        (source_system,),
    )
    token_hash = hashlib.sha256((PEPPER + plaintext).encode()).hexdigest()
    _query(
        "INSERT INTO wms_tokens "
        "(token_name, token_hash, status, warehouse_ids, event_types, endpoints, "
        "source_system, inbound_resources, mapping_override) "
        "VALUES (%s, %s, 'active', %s, %s, %s, %s, %s, FALSE)",
        (
            f"bins-test-{uuid.uuid4().hex[:6]}", token_hash, [1], [], [],
            source_system, list(inbound_resources),
        ),
    )


def _body(bin_code, *, dry_run, row_num="a", position_num="1"):
    return {
        "external_id": f"autosav-storage-bins:{uuid.uuid4()}",
        "external_version": "2026-09-07T00:00:00Z",
        "source_payload": {
            "warehouse_id": 1,
            "zone_code": "PICK",
            "zone_name": "Pick Zone",
            "dry_run": dry_run,
            "bins": [{
                "warehouse_id": 1,
                "zone": "PICK",
                "bin_code": bin_code,
                "bin_barcode": bin_code,
                "bin_type": "Pickable",
                "aisle": "A",
                "row_num": row_num,
                "position_num": position_num,
                "pick_sequence": 9001,
                "putaway_sequence": 9001,
            }],
        },
    }


def _post(client, plaintext, body):
    return client.post(
        "/api/v1/inbound/storage_bins",
        headers={"X-WMS-Token": plaintext, "Content-Type": "application/json"},
        data=json.dumps(body),
    )


@pytest.fixture(autouse=True)
def _clear_token_cache():
    token_cache.clear()
    yield
    token_cache.clear()


class TestInboundStorageBins:
    def test_dry_run_then_idempotent_create_and_update(self, client):
        plaintext = f"bins-{uuid.uuid4().hex}"
        _insert_token(plaintext)
        bin_code = f"AUTOSAV-{uuid.uuid4().hex[:8]}"

        preview = _post(client, plaintext, _body(bin_code, dry_run=True))
        assert preview.status_code == 200, preview.get_data(as_text=True)
        assert preview.get_json()["created"] == 1
        assert not _query(
            "SELECT 1 FROM bins WHERE warehouse_id = 1 AND bin_code = %s",
            (bin_code,),
        )

        created = _post(client, plaintext, _body(bin_code, dry_run=False))
        assert created.status_code == 200, created.get_data(as_text=True)
        assert created.get_json()["created"] == 1

        unchanged = _post(client, plaintext, _body(bin_code, dry_run=False))
        assert unchanged.status_code == 200
        assert unchanged.get_json()["unchanged"] == 1

        updated = _post(
            client,
            plaintext,
            _body(bin_code, dry_run=False, row_num="b", position_num="2"),
        )
        assert updated.status_code == 200
        assert updated.get_json()["updated"] == 1
        row = _query(
            "SELECT row_num, position_num FROM bins "
            "WHERE warehouse_id = 1 AND bin_code = %s",
            (bin_code,),
        )[0]
        assert row == ("b", "2")

    def test_inventory_update_scope_is_required(self, client):
        plaintext = f"bins-{uuid.uuid4().hex}"
        _insert_token(plaintext, inbound_resources=("items",))
        response = _post(
            client,
            plaintext,
            _body(f"AUTOSAV-{uuid.uuid4().hex[:8]}", dry_run=True),
        )
        assert response.status_code == 403

