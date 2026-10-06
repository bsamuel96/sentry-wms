"""Discovery proxy tests use only the dedicated fixture database and mocked AutoSav."""
from io import BytesIO
import uuid
from types import SimpleNamespace
from urllib.parse import urlparse
import requests
from sqlalchemy import text
from services.catalog_discovery import catalog_request, CatalogDiscoveryError
from routes import catalog_discovery as routes
from routes.admin import admin_local_catalog
import db_test_context
import pytest


def query(sql, params=()):
    cur = db_test_context.get_raw_connection().cursor()
    try:
        cur.execute(sql, params)
        return cur.fetchall() if cur.description else []
    finally:
        cur.close()


def new_count():
    return query("INSERT INTO cycle_counts(warehouse_id,bin_id,status,assigned_to,external_id) VALUES(1,3,'PENDING','admin',%s) RETURNING count_id", (str(uuid.uuid4()),))[0][0]


def test_lookup_requires_login_and_preserves_results(client, auth_headers, monkeypatch):
    calls = []
    monkeypatch.setattr(routes, 'catalog_request', lambda path, **kw: calls.append((path, kw)) or {'ean': '4006381333931', 'matches': []})
    assert client.get('/api/catalog-discovery/lookup?ean=4006381333931').status_code == 401
    result = client.get('/api/catalog-discovery/lookup?ean=4006381333931&reference=OE1', headers=auth_headers)
    assert result.status_code == 200
    assert calls[0][1]['params'] == {'ean': '4006381333931', 'reference': 'OE1'}


def test_registration_validates_count_and_returns_existing_synced_item(client, auth_headers, monkeypatch):
    calls = []
    canonical = str(query('SELECT external_id FROM items WHERE item_id=1')[0][0])
    monkeypatch.setattr(routes, 'catalog_request', lambda path, **kw: calls.append((path, kw)) or {'canonicalId': canonical})
    invalid = client.post('/api/catalog-discovery/register', headers=auth_headers, json={'countId': 'bad'})
    assert invalid.status_code == 422
    count = new_count()
    result = client.post('/api/catalog-discovery/register', headers=auth_headers, json={'countId': count, 'ean': '4006381333931', 'articleId': '123', 'code': 'F1', 'actor': 'spoofed'})
    assert result.status_code == 200, result.get_data(as_text=True)
    assert result.get_json()['item']['item_id'] == 1
    assert calls[0][1]['payload']['actor'] == 'admin'
    query("UPDATE cycle_counts SET status='COMPLETED' WHERE count_id=%s", (count,))
    assert client.post('/api/catalog-discovery/register', headers=auth_headers, json={'countId': count}).status_code == 409
    assert len(calls) == 1


def test_registration_denies_other_warehouses_before_forwarding(client, auth_headers, monkeypatch):
    count = new_count()
    monkeypatch.setattr(routes, 'check_warehouse_access', lambda _: (False, ({'error': 'Denied'}, 403)))
    def forbidden(*args, **kwargs):
        raise AssertionError('Denied request reached AutoSav')
    monkeypatch.setattr(routes, 'catalog_request', forbidden)
    assert client.post('/api/catalog-discovery/register', headers=auth_headers, json={'countId': count}).status_code == 403


def test_proxy_keeps_keys_server_side_and_upstream_401_does_not_log_out_user(monkeypatch):
    monkeypatch.setenv('AUTOSAV_CATALOG_API_URL', 'https://catalog.example.test')
    monkeypatch.setenv('AUTOSAV_CATALOG_BRIDGE_KEY', 'fixture-key-' * 4)
    calls = []
    def upstream(method, url, **kwargs):
        calls.append((method, url, kwargs))
        return SimpleNamespace(ok=False, status_code=401, json=lambda: {'error': 'unauthorized'})
    monkeypatch.setattr(requests, 'request', upstream)
    with pytest.raises(CatalogDiscoveryError) as failure:
        catalog_request('/api/integrations/sentry/catalog/register', payload={'ean': '4006381333931'})
    assert failure.value.status == 502
    assert calls[0][2]['headers']['Authorization'] == 'Bearer ' + 'fixture-key-' * 4
    assert calls[0][2]['allow_redirects'] is False


def create_discovery(ean="4006381333931"):
    item_id = query(
        "INSERT INTO items(sku,item_name,upc,category,external_id) VALUES(%s,%s,%s,'În așteptare TecDoc',%s) RETURNING item_id",
        (f"SCAN-{ean}-{uuid.uuid4().hex[:4]}", f"Produs nou – {ean}", ean, str(uuid.uuid4())),
    )[0][0]
    discovery_id = query(
        "INSERT INTO item_catalog_discoveries(item_id,scanned_ean,created_by) VALUES(%s,%s,'admin') RETURNING discovery_id",
        (item_id, ean),
    )[0][0]
    return discovery_id, item_id


def test_admin_queue_lists_and_matches_scanned_items(client, auth_headers, monkeypatch):
    discovery_id, item_id = create_discovery()
    query("UPDATE items SET mpn=%s WHERE item_id=%s", ("ATK 03.03.054", item_id))
    monkeypatch.setattr(routes, 'catalog_request', lambda *_args, **_kwargs: {
        'ean': '4006381333931',
        'searchedBy': 'ean',
        'matches': [{
            'id': '123', 'code': 'C113', 'brand': 'DOLZ', 'name': 'Pompă apă',
            'matchType': 'ean', 'eans': ['4006381333931'],
            'imageUrl': 'https://cdn.example.test/c113.jpg',
            'images': ['https://cdn.example.test/c113.jpg'],
        }],
    })
    listed = client.get('/api/catalog-discovery/queue?status=PENDING&per_page=25', headers=auth_headers)
    assert listed.status_code == 200
    assert listed.get_json()['discoveries'][0]['discovery_id'] == discovery_id
    assert listed.get_json()['discoveries'][0]['product_code'] == 'ATK 03.03.054'
    searched = client.get('/api/catalog-discovery/queue?status=PENDING&q=03.03.054', headers=auth_headers)
    assert searched.status_code == 200
    assert searched.get_json()['discoveries'][0]['discovery_id'] == discovery_id
    pending_products = client.get('/api/admin/items?q=4006381333931', headers=auth_headers)
    assert pending_products.status_code == 200
    assert pending_products.get_json()['items'] == []

    matches = client.get(f'/api/catalog-discovery/queue/{discovery_id}/matches', headers=auth_headers)
    assert matches.status_code == 200
    assert matches.get_json()['matches'][0]['code'] == 'C113'

    saved = client.post(
        f'/api/catalog-discovery/queue/{discovery_id}/match',
        headers=auth_headers,
        json={'articleId': '123', 'code': 'C113'},
    )
    assert saved.status_code == 200, saved.get_data(as_text=True)
    assert query('SELECT status,tecdoc_code FROM item_catalog_discoveries WHERE item_id=%s', (item_id,)) == [('MATCHED', 'C113')]
    assert query('SELECT mpn,category FROM items WHERE item_id=%s', (item_id,)) == [('C113', 'TecDoc')]
    mobile_lookup = client.get('/api/lookup/item/4006381333931', headers=auth_headers)
    assert mobile_lookup.status_code == 200
    mobile_item = mobile_lookup.get_json()['item']
    assert mobile_item['image_url'] == 'https://cdn.example.test/c113.jpg'
    assert mobile_item['catalog_status'] == 'MATCHED'
    assert mobile_item['tecdoc_code'] == 'C113'
    assert mobile_item['tecdoc_brand'] == 'DOLZ'
    assert mobile_item['tecdoc_name'] == 'Pompă apă'
    products = client.get('/api/admin/items?q=4006381333931', headers=auth_headers)
    assert products.status_code == 200
    product = products.get_json()['items'][0]
    assert product['tecdoc_code'] == 'C113'
    assert product['tecdoc_brand'] == 'DOLZ'
    assert product['tecdoc_name'] == 'Pompă apă'
    assert product['image_url'] == 'https://cdn.example.test/c113.jpg'
    detail = client.get(f'/api/admin/items/{item_id}', headers=auth_headers)
    assert detail.status_code == 200
    assert detail.get_json()['item']['image_url'] == 'https://cdn.example.test/c113.jpg'


def test_reference_match_requires_explicit_confirmation(client, auth_headers, monkeypatch):
    discovery_id, _ = create_discovery("5901234123457")
    monkeypatch.setattr(routes, 'catalog_request', lambda *_args, **_kwargs: {
        'matches': [{'id': '55', 'code': 'OE-55', 'brand': 'TEST', 'name': 'Produs', 'matchType': 'reference'}],
    })
    denied = client.post(
        f'/api/catalog-discovery/queue/{discovery_id}/match',
        headers=auth_headers,
        json={'articleId': '55', 'code': 'OE-55', 'reference': 'OE-55'},
    )
    assert denied.status_code == 422
    accepted = client.post(
        f'/api/catalog-discovery/queue/{discovery_id}/match',
        headers=auth_headers,
        json={'articleId': '55', 'code': 'OE-55', 'reference': 'OE-55', 'confirmEquivalent': True},
    )
    assert accepted.status_code == 200


def test_bulk_match_saves_only_one_unique_exact_ean(client, auth_headers, monkeypatch):
    exact_id, exact_item_id = create_discovery("4006381333931")
    ambiguous_id, ambiguous_item_id = create_discovery("5901234123457")
    invalid_id, invalid_item_id = create_discovery("PRIVATE-CODE")

    def lookup(_path, **kwargs):
        ean = kwargs["params"]["ean"]
        if ean == "4006381333931":
            return {"matches": [
                {"id": "123", "code": "C113", "brand": "DOLZ", "name": "Pompă apă", "matchType": "ean"},
                # Provider duplicates of the same article must not make the result ambiguous.
                {"id": "123", "code": "C113", "brand": "DOLZ", "name": "Pompă apă", "matchType": "ean"},
            ]}
        return {"matches": [
            {"id": "201", "code": "A1", "brand": "A", "name": "Produs A", "matchType": "ean"},
            {"id": "202", "code": "B1", "brand": "B", "name": "Produs B", "matchType": "ean"},
        ]}

    monkeypatch.setattr(routes, "catalog_request", lookup)
    response = client.post(
        "/api/catalog-discovery/queue/bulk-match",
        headers=auth_headers,
        json={"discovery_ids": [exact_id, ambiguous_id, invalid_id]},
    )
    assert response.status_code == 200, response.get_data(as_text=True)
    assert response.get_json()["summary"] == {
        "requested": 3,
        "matched": 1,
        "ambiguous": 1,
        "not_found": 0,
        "skipped": 1,
        "failed": 0,
    }
    assert query("SELECT status,tecdoc_code FROM item_catalog_discoveries WHERE item_id=%s", (exact_item_id,)) == [("MATCHED", "C113")]
    assert query("SELECT status FROM item_catalog_discoveries WHERE item_id=%s", (ambiguous_item_id,)) == [("PENDING",)]
    assert query("SELECT status FROM item_catalog_discoveries WHERE item_id=%s", (invalid_item_id,)) == [("PENDING",)]


def test_bulk_match_accepts_one_unique_ean_reference_fallback(client, auth_headers, monkeypatch):
    discovery_id, item_id = create_discovery("3276426982559")
    monkeypatch.setattr(routes, "catalog_request", lambda *_args, **_kwargs: {
        "searchedBy": "ean_then_reference",
        "matches": [{
            "id": "777", "code": "698255", "brand": "VALEO",
            "name": "Produs identificat", "matchType": "reference",
            "imageUrl": "https://cdn.example.test/698255.jpg",
        }],
    })

    response = client.post(
        "/api/catalog-discovery/queue/bulk-match",
        headers=auth_headers,
        json={"discovery_ids": [discovery_id]},
    )

    assert response.status_code == 200, response.get_data(as_text=True)
    assert response.get_json()["summary"]["matched"] == 1
    assert query(
        "SELECT status,tecdoc_code,tecdoc_match_type FROM item_catalog_discoveries WHERE item_id=%s",
        (item_id,),
    ) == [("MATCHED", "698255", "reference")]


def test_bulk_match_skips_checksum_invalid_numeric_code_without_calling_catalog(client, auth_headers, monkeypatch):
    discovery_id, item_id = create_discovery("12345678")
    monkeypatch.setattr(routes, "catalog_request", lambda *_args, **_kwargs: pytest.fail("invalid GTIN reached TecDoc"))

    response = client.post(
        "/api/catalog-discovery/queue/bulk-match",
        headers=auth_headers,
        json={"discovery_ids": [discovery_id]},
    )

    assert response.status_code == 200
    assert response.get_json()["summary"]["skipped"] == 1
    assert response.get_json()["results"] == [{
        "discovery_id": discovery_id,
        "status": "skipped",
        "reason": "invalid_ean",
    }]
    assert query("SELECT status FROM item_catalog_discoveries WHERE item_id=%s", (item_id,)) == [("PENDING",)]


def connex_match(ean="4006381333931", product_id="987"):
    return {
        "id": product_id,
        "source": "connex",
        "matchType": "connex_ean",
        "code": "ATK 03.03.054",
        "brand": "ATK AUTOTECHNIK",
        "name": "Filtru combustibil",
        "description": "Filtru combustibil identificat în Connex",
        "category": "Filtre",
        "ean": ean,
        "eans": [ean],
        "images": ["https://cdn.example.test/atk.jpg"],
        "references": [{"code": "OE1", "type": "OE", "manufacturer": "VW"}],
    }


def test_connex_ean_lookup_and_choice_store_local_catalog(client, auth_headers, monkeypatch):
    discovery_id, item_id = create_discovery()
    calls = []

    def lookup(path, **kwargs):
        calls.append((path, kwargs))
        assert path == "/api/integrations/sentry/connex-catalog"
        assert kwargs["payload"]["ean"] == "4006381333931"
        return {"searchedBy": "connex_ean", "matches": [connex_match()]}

    monkeypatch.setattr(routes, "catalog_request", lookup)
    matches = client.get(
        f"/api/catalog-discovery/queue/{discovery_id}/connex-matches",
        headers=auth_headers,
    )
    assert matches.status_code == 200, matches.get_data(as_text=True)
    assert matches.get_json()["matches"][0]["code"] == "ATK 03.03.054"

    saved = client.post(
        f"/api/catalog-discovery/queue/{discovery_id}/connex-match",
        headers=auth_headers,
        json={"productId": "987", "code": "ATK 03.03.054"},
    )
    assert saved.status_code == 200, saved.get_data(as_text=True)
    assert calls[-1][1]["payload"]["product_id"] == "987"
    assert query(
        "SELECT status,tecdoc_code,tecdoc_match_type FROM item_catalog_discoveries WHERE item_id=%s",
        (item_id,),
    ) == [("MANUAL", "ATK 03.03.054", "connex_ean")]
    assert query(
        "SELECT item_name,mpn,category,upc FROM items WHERE item_id=%s",
        (item_id,),
    ) == [("Filtru combustibil", "ATK 03.03.054", "Filtre", "4006381333931")]
    local_catalog = client.get(f"/api/admin/items/{item_id}/local-catalog", headers=auth_headers)
    assert local_catalog.status_code == 200
    assert local_catalog.get_json()["catalog"]["references"][0]["code"] == "OE1"


def test_connex_manufacturer_code_lookup_does_not_store_the_scanned_code_as_ean(client, auth_headers, monkeypatch):
    discovery_id, item_id = create_discovery("LOCAL-SCAN-42")
    query("UPDATE items SET mpn=%s, upc=NULL WHERE item_id=%s", ("ATK 03.03.054", item_id))
    match = {**connex_match("5901234123457"), "matchType": "connex_reference"}
    calls = []

    def lookup(path, **kwargs):
        calls.append((path, kwargs))
        return {"searchedBy": "connex_reference", "matches": [match]}

    monkeypatch.setattr(routes, "catalog_request", lookup)
    matches = client.get(
        f"/api/catalog-discovery/queue/{discovery_id}/connex-matches?reference=ATK%2003.03.054",
        headers=auth_headers,
    )
    assert matches.status_code == 200, matches.get_data(as_text=True)
    assert calls[-1][0] == "/api/integrations/sentry/connex-prices"
    assert calls[-1][1]["payload"] == {"reference": "ATK 03.03.054"}

    saved = client.post(
        f"/api/catalog-discovery/queue/{discovery_id}/connex-match",
        headers=auth_headers,
        json={"productId": "987", "code": "ATK 03.03.054", "reference": "ATK 03.03.054"},
    )
    assert saved.status_code == 200, saved.get_data(as_text=True)
    assert query("SELECT upc,mpn FROM items WHERE item_id=%s", (item_id,)) == [("5901234123457", "ATK 03.03.054")]
    assert query(
        "SELECT status,tecdoc_match_type FROM item_catalog_discoveries WHERE item_id=%s",
        (item_id,),
    ) == [("MANUAL", "connex_reference")]


def test_bulk_connex_ean_match_applies_only_one_exact_candidate(client, auth_headers, monkeypatch):
    exact_id, exact_item_id = create_discovery("4006381333931")
    ambiguous_id, ambiguous_item_id = create_discovery("5901234123457")

    def lookup(_path, **kwargs):
        payload = kwargs["payload"]
        if payload["ean"] == "4006381333931":
            assert not payload.get("product_id") or payload["product_id"] == "987"
            return {"matches": [connex_match()]}
        return {"matches": [
            connex_match("5901234123457", "201"),
            {**connex_match("5901234123457", "202"), "code": "ATK 03.03.055"},
        ]}

    monkeypatch.setattr(routes, "catalog_request", lookup)
    response = client.post(
        "/api/catalog-discovery/queue/bulk-match-connex",
        headers=auth_headers,
        json={"discovery_ids": [exact_id, ambiguous_id]},
    )
    assert response.status_code == 200, response.get_data(as_text=True)
    assert response.get_json()["summary"] == {
        "requested": 2,
        "matched": 1,
        "ambiguous": 1,
        "not_found": 0,
        "skipped": 0,
        "failed": 0,
    }
    assert query(
        "SELECT status,tecdoc_match_type FROM item_catalog_discoveries WHERE item_id=%s",
        (exact_item_id,),
    ) == [("MANUAL", "connex_ean")]
    assert query(
        "SELECT status FROM item_catalog_discoveries WHERE item_id=%s",
        (ambiguous_item_id,),
    ) == [("PENDING",)]


def test_manual_catalog_photo_upload_is_persistent_and_saveable(client, auth_headers):
    discovery_id, item_id = create_discovery()
    uploaded = client.post(
        f"/api/admin/items/{item_id}/catalog-images",
        headers=auth_headers,
        data={"file": (BytesIO(b"\xff\xd8\xff\xe0product-photo"), "product.jpg")},
        content_type="multipart/form-data",
    )
    assert uploaded.status_code == 201, uploaded.get_data(as_text=True)
    image_url = uploaded.get_json()["image_url"]
    assert image_url.startswith("https://")
    image_path = urlparse(image_url).path
    served = client.get(image_path)
    assert served.status_code == 200
    assert served.mimetype == "image/jpeg"
    assert served.data == b"\xff\xd8\xff\xe0product-photo"

    saved = client.put(
        f"/api/admin/items/{item_id}/local-catalog",
        headers=auth_headers,
        json={
            "name": "Filtru", "brand": "Marca", "code": "ABC",
            "eans": ["4006381333931"], "images": [image_url], "references": [],
        },
    )
    assert saved.status_code == 200, saved.get_data(as_text=True)
    assert saved.get_json()["catalog"]["images"] == [image_url]
    assert query(
        "SELECT file_size FROM catalog_product_images WHERE item_id=%s",
        (item_id,),
    ) == [(len(b"\xff\xd8\xff\xe0product-photo"),)]


def test_pasted_catalog_image_is_downloaded_and_replaced_with_server_url(client, auth_headers, monkeypatch):
    _, item_id = create_discovery()
    content = b"\xff\xd8\xff\xe0downloaded-product-photo"

    class ImageResponse:
        status_code = 200
        headers = {"Content-Length": str(len(content)), "Content-Type": "image/jpeg"}

        def iter_content(self, chunk_size):
            return iter((content[:8], content[8:]))

        def close(self):
            pass

    calls = []
    monkeypatch.setattr(admin_local_catalog, 'resolve_url_addresses', lambda _url: ['93.184.216.34'])
    monkeypatch.setattr(admin_local_catalog.requests, 'get', lambda url, **kwargs: calls.append((url, kwargs)) or ImageResponse())
    external_url = 'https://images.example.test/catalog/filter.jpg'
    saved = client.put(
        f"/api/admin/items/{item_id}/local-catalog",
        headers=auth_headers,
        json={"name": "Filtru", "brand": "Marca", "code": "ABC", "images": [external_url]},
    )
    assert saved.status_code == 200, saved.get_data(as_text=True)
    stored_url = saved.get_json()['catalog']['images'][0]
    assert stored_url.startswith('https://')
    assert stored_url != external_url
    assert urlparse(stored_url).path.startswith('/api/admin/catalog-images/')
    assert calls[0][1]['allow_redirects'] is False
    assert calls[0][1]['verify'] is True
    stored = query(
        "SELECT mime_type,file_size,content FROM catalog_product_images WHERE item_id=%s", (item_id,),
    )
    assert [(stored[0][0], stored[0][1], bytes(stored[0][2]))] == [('image/jpeg', len(content), content)]
    served = client.get(urlparse(stored_url).path)
    assert served.status_code == 200
    assert served.data == content


def test_pasted_catalog_image_rejects_private_addresses_without_changing_product(client, auth_headers, monkeypatch):
    _, item_id = create_discovery()
    original = query("SELECT item_name FROM items WHERE item_id=%s", (item_id,))[0][0]
    monkeypatch.setattr(admin_local_catalog, 'resolve_url_addresses', lambda _url: ['127.0.0.1'])
    called = []
    monkeypatch.setattr(admin_local_catalog.requests, 'get', lambda *_args, **_kwargs: called.append(True))
    result = client.put(
        f"/api/admin/items/{item_id}/local-catalog",
        headers=auth_headers,
        json={"name": "Nu trebuie salvat", "brand": "Marca", "code": "ABC", "images": ['https://example.test/photo.jpg']},
    )
    assert result.status_code == 422
    assert called == []
    assert query("SELECT item_name FROM items WHERE item_id=%s", (item_id,)) == [(original,)]
    assert query("SELECT COUNT(*) FROM catalog_product_images WHERE item_id=%s", (item_id,)) == [(0,)]


def test_mobile_can_create_a_complete_manual_product_with_price_photo_and_audit(client, auth_headers):
    ean = f"594{uuid.uuid4().int % 10**10:010d}"
    created = client.post(
        "/api/admin/local-catalog/products",
        headers=auth_headers,
        data={
            "name": "Produs introdus manual",
            "ean": ean,
            "price": "59,90",
            "brand": "Marca locală",
            "code": "MAN-001",
            "category": "Filtre",
            "description": "Creat din APK",
            "file": (BytesIO(b"\xff\xd8\xff\xe0manual-product-photo"), "manual.jpg"),
        },
        content_type="multipart/form-data",
    )
    assert created.status_code == 201, created.get_data(as_text=True)
    payload = created.get_json()
    assert payload["status"] == "MANUAL"
    assert payload["catalog"]["name"] == "Produs introdus manual"
    assert payload["catalog"]["eans"] == [ean]
    assert payload["pricing"]["price"] == 59.9
    assert payload["pricing"]["includes_vat"] is True
    assert payload["audit"]["created_by"] == "admin"
    assert payload["audit"]["saved_by"] == "admin"
    assert payload["audit"]["created_at"]
    assert payload["audit"]["saved_at"]
    assert len(payload["catalog"]["images"]) == 1

    item_id = payload["item_id"]
    assert query(
        "SELECT item_name,upc,mpn,category FROM items WHERE item_id=%s",
        (item_id,),
    ) == [("Produs introdus manual", ean, "MAN-001", "Filtre")]
    assert query(
        "SELECT status,created_by,reviewed_by FROM item_catalog_discoveries WHERE item_id=%s",
        (item_id,),
    ) == [("MANUAL", "admin", "admin")]
    assert query(
        "SELECT action_type,user_id FROM audit_log WHERE entity_type='ITEM' AND entity_id=%s ORDER BY log_id DESC LIMIT 1",
        (item_id,),
    ) == [("LOCAL_CATALOG_CREATE", "admin")]

    lookup = client.get(f"/api/lookup/item/{ean}", headers=auth_headers)
    assert lookup.status_code == 200, lookup.get_data(as_text=True)
    lookup_item = lookup.get_json()["item"]
    assert lookup_item["item_name"] == "Produs introdus manual"
    assert lookup_item["local_pricing"]["price"] == 59.9
    assert lookup_item["image_url"] == payload["catalog"]["images"][0]
    assert lookup_item["created_by"] == "admin"

    duplicate = client.post(
        "/api/admin/local-catalog/products",
        headers=auth_headers,
        json={"name": "Duplicat", "ean": ean, "price": 10},
    )
    assert duplicate.status_code == 409
    assert duplicate.get_json()["item_id"] == item_id


def test_delete_unused_scanned_product_removes_stock_and_keeps_audit(client, auth_headers):
    discovery_id, item_id = create_discovery("5941234567890")
    query(
        "INSERT INTO inventory(item_id,bin_id,warehouse_id,quantity_on_hand,quantity_allocated) VALUES(%s,3,1,4,0)",
        (item_id,),
    )
    query(
        "INSERT INTO inventory_adjustments(item_id,bin_id,warehouse_id,quantity_change,reason_code,reason_detail,status,adjusted_by,external_id) VALUES(%s,3,1,4,'FOUND','scan','APPROVED','admin',%s)",
        (item_id, str(uuid.uuid4())),
    )
    query(
        "INSERT INTO mobile_stock_entries(idempotency_key,item_id,bin_id,warehouse_id,quantity,entered_by) VALUES(%s,%s,3,1,4,'admin')",
        (str(uuid.uuid4()), item_id),
    )

    response = client.delete(f"/api/catalog-discovery/queue/{discovery_id}", headers=auth_headers)
    assert response.status_code == 200, response.get_data(as_text=True)
    assert response.get_json()["quantity_removed"] == 4
    assert query("SELECT 1 FROM items WHERE item_id=%s", (item_id,)) == []
    assert query("SELECT 1 FROM inventory WHERE item_id=%s", (item_id,)) == []
    assert query("SELECT 1 FROM mobile_stock_entries WHERE item_id=%s", (item_id,)) == []
    assert query(
        "SELECT action_type FROM audit_log WHERE entity_type='ITEM' AND entity_id=%s ORDER BY log_id DESC LIMIT 1",
        (item_id,),
    ) == [("PROVISIONAL_ITEM_DELETE",)]


def test_delete_scanned_product_is_blocked_once_used_in_order(client, auth_headers):
    discovery_id, item_id = create_discovery("8712345678906")
    so_id = query(
        "INSERT INTO sales_orders(so_number,warehouse_id,created_by,external_id) VALUES(%s,1,'admin',%s) RETURNING so_id",
        (f"TEST-{uuid.uuid4().hex[:8]}", str(uuid.uuid4())),
    )[0][0]
    query(
        "INSERT INTO sales_order_lines(so_id,item_id,quantity_ordered,line_number) VALUES(%s,%s,1,1)",
        (so_id, item_id),
    )

    response = client.delete(f"/api/catalog-discovery/queue/{discovery_id}", headers=auth_headers)
    assert response.status_code == 409
    assert response.get_json()["code"] == "provisional_item_in_use"
    assert query("SELECT 1 FROM items WHERE item_id=%s", (item_id,)) == [(1,)]


def test_catalog_draft_stays_pending_until_explicit_completion(client, auth_headers):
    discovery_id, item_id = create_discovery("4006381333931")
    path = f"/api/admin/items/{item_id}/local-catalog"
    draft = client.put(path, headers=auth_headers, json={"name": "Produs început", "complete": False})
    assert draft.status_code == 200, draft.get_data(as_text=True)
    assert draft.get_json()["status"] == "PENDING"
    assert draft.get_json()["completed"] is False
    assert query("SELECT status, reviewed_at FROM item_catalog_discoveries WHERE discovery_id=%s", (discovery_id,)) == [("PENDING", None)]
    queue = client.get("/api/catalog-discovery/queue?status=PENDING", headers=auth_headers).get_json()
    assert discovery_id in [row["discovery_id"] for row in queue["discoveries"]]
    invalid = client.put(path, headers=auth_headers, json={"name": "Produs început", "complete": True})
    assert invalid.status_code == 422
    assert query("SELECT status FROM item_catalog_discoveries WHERE discovery_id=%s", (discovery_id,)) == [("PENDING",)]
    saved = client.put(path, headers=auth_headers, json={"name": "Produs complet", "brand": "Marca", "code": "ABC", "complete": True})
    assert saved.status_code == 200, saved.get_data(as_text=True)
    assert saved.get_json()["completed"] is True
    assert saved.get_json()["status"] == "MANUAL"
    assert "scos" in saved.get_json()["message"]
    pending = client.get("/api/catalog-discovery/queue?status=PENDING", headers=auth_headers).get_json()
    assert discovery_id not in [row["discovery_id"] for row in pending["discoveries"]]
    assert query("SELECT item_name FROM items WHERE item_id=%s", (item_id,)) == [("Produs complet",)]


def test_item_edit_saves_price_atomically_and_preserves_connex_reference(client, auth_headers):
    _, item_id = create_discovery("4006381333931")
    query("UPDATE items SET local_pricing=%s::jsonb WHERE item_id=%s", ('{"source":"connex","price":100,"connex":{"price":100,"id":"123"}}', item_id))
    path = f"/api/admin/items/{item_id}"
    old_name = query("SELECT item_name FROM items WHERE item_id=%s", (item_id,))[0][0]
    for price in [None, "", "-1", "0.001", "NaN", "100000001"]:
        result = client.put(path, headers=auth_headers, json={"item_name": "Invalid edit", "local_price": price})
        assert result.status_code == (422 if price == "0.001" else 400), result.get_data(as_text=True)
        assert query("SELECT item_name,local_pricing->>'price' FROM items WHERE item_id=%s", (item_id,)) == [(old_name, '100')]
    result = client.put(path, headers=auth_headers, json={"item_name": "Produs actualizat", "local_price": "135,50"})
    assert result.status_code == 200, result.get_data(as_text=True)
    pricing = result.get_json()['local_pricing']
    assert pricing['price'] == 135.5
    assert pricing['source'] == 'manual'
    assert pricing['includes_vat'] is True
    assert pricing['connex']['id'] == '123'
    assert query("SELECT item_name FROM items WHERE item_id=%s", (item_id,)) == [('Produs actualizat',)]
    audit = query("SELECT details->'after'->>'price' FROM audit_log WHERE entity_type='item' AND entity_id=%s AND action_type='LOCAL_PRICE_UPDATE'", (item_id,))
    assert audit == [('135.5',)]
    result = client.put(path, headers=auth_headers, json={"item_name": "Alt nume"})
    assert result.status_code == 200
    assert result.get_json()['local_pricing'] == pricing
