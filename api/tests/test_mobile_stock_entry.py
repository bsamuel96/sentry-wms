"""Mobile location + EAN stock-entry workflow."""
import uuid

import db_test_context


def query(sql, params=()):
    cursor = db_test_context.get_raw_connection().cursor()
    try:
        cursor.execute(sql, params)
        return cursor.fetchall() if cursor.description else []
    finally:
        cursor.close()


def first_bin():
    return query(
        "SELECT bin_id, warehouse_id, bin_code FROM bins WHERE warehouse_id=1 ORDER BY bin_id LIMIT 1"
    )[0]


def test_unknown_supplier_barcode_creates_provisional_item_queue_and_inventory_once(client, auth_headers):
    bin_id, warehouse_id, _ = first_bin()
    key = str(uuid.uuid4())
    body = {
        "warehouse_id": warehouse_id,
        "bin_id": bin_id,
        "barcode": "1654644071",
        "quantity": 4,
        "idempotency_key": key,
    }

    created = client.post("/api/inventory/stock-entry", headers=auth_headers, json=body)
    assert created.status_code == 201, created.get_data(as_text=True)
    payload = created.get_json()
    assert payload["quantity_added"] == 4
    assert payload["quantity_in_bin"] == 4
    assert payload["catalog_status"] == "PENDING"
    assert payload["created_provisional_item"] is True

    replay = client.post("/api/inventory/stock-entry", headers=auth_headers, json=body)
    assert replay.status_code == 200
    assert replay.get_json()["idempotent_replay"] is True
    item_id = payload["item"]["item_id"]
    assert query(
        "SELECT quantity_on_hand FROM inventory WHERE item_id=%s AND bin_id=%s",
        (item_id, bin_id),
    ) == [(4,)]
    assert query(
        "SELECT scanned_ean,status FROM item_catalog_discoveries WHERE item_id=%s",
        (item_id,),
    ) == [("1654644071", "PENDING")]


def test_known_ean_adds_inventory_without_catalog_queue(client, auth_headers):
    bin_id, warehouse_id, _ = first_bin()
    external_id = str(uuid.uuid4())
    item_id = query(
        "INSERT INTO items(sku,item_name,upc,external_id) VALUES(%s,%s,%s,%s) RETURNING item_id",
        (f"KNOWN-{uuid.uuid4().hex[:8]}", "Produs cunoscut", "5901234123457", external_id),
    )[0][0]
    response = client.post("/api/inventory/stock-entry", headers=auth_headers, json={
        "warehouse_id": warehouse_id,
        "bin_id": bin_id,
        "ean": "5901234123457",
        "quantity": 2,
        "idempotency_key": str(uuid.uuid4()),
    })
    assert response.status_code == 201, response.get_data(as_text=True)
    assert response.get_json()["created_provisional_item"] is False
    assert response.get_json()["catalog_status"] == "KNOWN"
    assert query("SELECT 1 FROM item_catalog_discoveries WHERE item_id=%s", (item_id,)) == []


def test_location_can_be_registered_by_scan_and_replayed(client, auth_headers):
    code = f"Z-z-{uuid.uuid4().hex[:5]}"
    body = {"warehouse_id": 1, "bin_code": code, "zone_code": "PICK"}
    created = client.post("/api/inventory/stock-entry/bin", headers=auth_headers, json=body)
    assert created.status_code == 201, created.get_data(as_text=True)
    payload = created.get_json()
    assert payload["created"] is True
    assert payload["bin"]["bin_code"] == code
    assert payload["bin"]["aisle"] == "Z"
    assert payload["bin"]["row_num"] == "z"

    repeated = client.post("/api/inventory/stock-entry/bin", headers=auth_headers, json=body)
    assert repeated.status_code == 200
    assert repeated.get_json()["created"] is False
    assert repeated.get_json()["bin"]["bin_id"] == payload["bin"]["bin_id"]


def test_stock_entry_rejects_invalid_product_code(client, auth_headers):
    bin_id, warehouse_id, _ = first_bin()
    response = client.post("/api/inventory/stock-entry", headers=auth_headers, json={
        "warehouse_id": warehouse_id,
        "bin_id": bin_id,
        "ean": "1234",
        "quantity": 1,
        "idempotency_key": str(uuid.uuid4()),
    })
    assert response.status_code == 422
