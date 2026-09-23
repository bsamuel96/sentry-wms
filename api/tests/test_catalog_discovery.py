"""Discovery proxy tests use only the dedicated fixture database and mocked AutoSav."""
import uuid
from types import SimpleNamespace
import requests
from sqlalchemy import text
from services.catalog_discovery import catalog_request, CatalogDiscoveryError
from routes import catalog_discovery as routes
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
        (f"EAN-{ean}-{uuid.uuid4().hex[:4]}", f"Produs nou – {ean}", ean, str(uuid.uuid4())),
    )[0][0]
    discovery_id = query(
        "INSERT INTO item_catalog_discoveries(item_id,scanned_ean,created_by) VALUES(%s,%s,'admin') RETURNING discovery_id",
        (item_id, ean),
    )[0][0]
    return discovery_id, item_id


def test_admin_queue_lists_and_matches_scanned_items(client, auth_headers, monkeypatch):
    discovery_id, item_id = create_discovery()
    monkeypatch.setattr(routes, 'catalog_request', lambda *_args, **_kwargs: {
        'ean': '4006381333931',
        'searchedBy': 'ean',
        'matches': [{
            'id': '123', 'code': 'C113', 'brand': 'DOLZ', 'name': 'Pompă apă',
            'matchType': 'ean', 'eans': ['4006381333931'],
        }],
    })
    listed = client.get('/api/catalog-discovery/queue?status=PENDING&per_page=25', headers=auth_headers)
    assert listed.status_code == 200
    assert listed.get_json()['discoveries'][0]['discovery_id'] == discovery_id

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
