"""Sentry-owned Local catalogue and Connex reference pricing."""
from io import BytesIO
import json
import re
import uuid
from urllib.parse import unquote, urlparse

import requests
from flask import g, jsonify, request, send_file, url_for
from sqlalchemy import text
from werkzeug.utils import secure_filename

from middleware.auth_middleware import require_auth, require_admin_or_page_permission
from middleware.db import with_db
from routes.admin import admin_bp
from services.catalog_discovery import catalog_request, CatalogDiscoveryError
from services.catalog_media import catalog_image_mime
from services.local_catalog import update_pricing, validate_catalog, catalog_review_status
from services.audit_service import write_audit_log
from services.webhook_dispatcher.ssrf_guard import resolve_url_addresses, is_private_address, SsrfRejected


_CATALOG_IMAGE_MAX_BYTES = 4 * 1024 * 1024
_CATALOG_IMAGE_DOWNLOAD_TIMEOUT = (5, 15)
_CATALOG_IMAGE_PATH = re.compile(r'^/api/admin/catalog-images/([0-9a-fA-F-]{36})$')


def _item(item_id, lock=False):
    if lock:
        # Same lock order as TecDoc matching; re-read status after waiting.
        g.db.execute(text('SELECT discovery_id FROM item_catalog_discoveries WHERE item_id = :id FOR UPDATE'), {'id': item_id})
    return g.db.execute(text('''
        SELECT i.item_id, i.external_id, i.sku, i.item_name, i.upc, i.mpn,
               i.category, i.description, i.local_pricing,
               i.created_at AS item_created_at, i.updated_at AS item_updated_at,
               d.status, d.tecdoc_payload, d.created_by,
               d.created_at AS catalog_created_at, d.reviewed_by, d.reviewed_at
        FROM items i LEFT JOIN item_catalog_discoveries d ON d.item_id = i.item_id
        WHERE i.item_id = :id
    ''' + (' FOR UPDATE OF i' if lock else '')), {'id': item_id}).fetchone()


def _serialize(item):
    catalog = dict(item.tecdoc_payload or {
        'name': item.item_name, 'code': item.mpn or '', 'brand': '',
        'eans': [item.upc] if item.upc else [], 'images': [], 'references': [],
        'category': item.category or '', 'description': item.description or '',
    })
    stored_images = [url_for(
        'admin.get_catalog_image', image_id=row.image_id,
        _external=True, _scheme='https',
    ) for row in g.db.execute(text('''
        SELECT image_id FROM catalog_product_images
        WHERE item_id = :id ORDER BY created_at, image_id
    '''), {'id': item.item_id}).fetchall()]
    catalog['images'] = list(dict.fromkeys([*(catalog.get('images') or []), *stored_images]))
    catalog['imageUrl'] = next(iter(catalog['images']), None)
    return {
        'item_id': item.item_id, 'external_id': str(item.external_id),
        'sku': item.sku, 'status': item.status,
        'catalog': catalog,
        'pricing': item.local_pricing or {},
        'audit': {
            'created_by': item.created_by,
            'created_at': item.catalog_created_at.isoformat() if item.catalog_created_at else (
                item.item_created_at.isoformat() if item.item_created_at else None
            ),
            'saved_by': item.reviewed_by or item.created_by,
            'saved_at': item.reviewed_at.isoformat() if item.reviewed_at else (
                item.item_updated_at.isoformat() if item.item_updated_at else None
            ),
        },
    }


def _audit(item_id, action, details):
    write_audit_log(g.db, action, 'item', item_id,
                    g.current_user.get('username') or 'unknown', None, details=details)


def _catalog_image_upload(upload):
    if not upload:
        return None
    content = upload.stream.read(_CATALOG_IMAGE_MAX_BYTES + 1)
    if not content:
        raise ValueError('Fotografia este goală.')
    if len(content) > _CATALOG_IMAGE_MAX_BYTES:
        raise OverflowError('Fotografia poate avea maximum 4 MB.')
    mime_type = catalog_image_mime(content)
    if not mime_type:
        raise TypeError('Folosește o imagine JPEG, PNG sau WebP.')
    extension = {'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp'}[mime_type]
    file_name = secure_filename(upload.filename or '')[:240] or f'produs.{extension}'
    return {
        'content': content,
        'mime_type': mime_type,
        'file_name': file_name,
        'file_size': len(content),
    }


def _insert_catalog_image(item_id, image, actor):
    image_id = g.db.execute(text('''
        INSERT INTO catalog_product_images
            (item_id, mime_type, file_name, file_size, content, created_by)
        VALUES (:item_id, :mime_type, :file_name, :file_size, :content, :actor)
        RETURNING image_id
    '''), {'item_id': item_id, 'actor': actor, **image}).scalar()
    image_url = url_for(
        'admin.get_catalog_image', image_id=image_id,
        _external=True, _scheme='https',
    )
    return image_id, image_url


def _download_catalog_image(url):
    """Download one public HTTPS image without allowing an SSRF redirect hop."""
    parsed = urlparse(url)
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError('Linkul imaginii trebuie să fie o adresă HTTPS publică.')
    try:
        addresses = resolve_url_addresses(url)
    except SsrfRejected as exc:
        raise ValueError('Adresa imaginii nu poate fi accesată de server.') from exc
    if any(is_private_address(address) for address in addresses):
        raise ValueError('Adresa imaginii trebuie să fie publică; rețelele locale nu sunt permise.')

    response = None
    try:
        response = requests.get(
            url,
            stream=True,
            timeout=_CATALOG_IMAGE_DOWNLOAD_TIMEOUT,
            allow_redirects=False,
            verify=True,
            headers={'User-Agent': 'Autosav-WMS-Image-Importer/1.0'},
        )
        if 300 <= response.status_code < 400:
            raise ValueError('Linkul imaginii redirecționează. Introdu adresa finală a imaginii.')
        if response.status_code != 200:
            raise ValueError(f'Imaginea nu a putut fi descărcată (HTTP {response.status_code}).')
        declared_size = response.headers.get('Content-Length')
        if declared_size:
            try:
                if int(declared_size) > _CATALOG_IMAGE_MAX_BYTES:
                    raise OverflowError('Fotografia poate avea maximum 4 MB.')
            except ValueError:
                pass
        chunks = []
        size = 0
        for chunk in response.iter_content(chunk_size=64 * 1024):
            if not chunk:
                continue
            size += len(chunk)
            if size > _CATALOG_IMAGE_MAX_BYTES:
                raise OverflowError('Fotografia poate avea maximum 4 MB.')
            chunks.append(chunk)
        content = b''.join(chunks)
    except (ValueError, OverflowError):
        raise
    except requests.RequestException as exc:
        raise ValueError('Imaginea nu a putut fi descărcată de server.') from exc
    finally:
        if response is not None:
            response.close()

    if not content:
        raise ValueError('Imaginea descărcată este goală.')
    mime_type = catalog_image_mime(content)
    if not mime_type:
        raise TypeError('Linkul trebuie să indice o imagine JPEG, PNG sau WebP.')
    extension = {'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp'}[mime_type]
    file_name = secure_filename(unquote(parsed.path.rsplit('/', 1)[-1]))[:240] or f'produs.{extension}'
    return {'content': content, 'mime_type': mime_type, 'file_name': file_name, 'file_size': len(content)}


def _persist_catalog_image_links(item_id, catalog, actor):
    """Replace external image links with immutable WMS-owned image URLs."""
    entries = []
    pending_count = 0
    for url in catalog.get('images', []):
        path_match = _CATALOG_IMAGE_PATH.match(urlparse(url).path)
        owned_image_id = path_match.group(1) if path_match else None
        if owned_image_id:
            owned = g.db.execute(text('''
                SELECT image_id FROM catalog_product_images
                WHERE image_id = :image_id AND item_id = :item_id
            '''), {'image_id': owned_image_id, 'item_id': item_id}).scalar()
            if owned:
                entries.append(('url', url_for('admin.get_catalog_image', image_id=owned, _external=True, _scheme='https')))
                continue
        entries.append(('image', _download_catalog_image(url)))
        pending_count += 1

    stored_count = int(g.db.execute(
        text('SELECT COUNT(*) FROM catalog_product_images WHERE item_id = :id'), {'id': item_id},
    ).scalar() or 0)
    if stored_count + pending_count > 10:
        raise ValueError('Produsul poate avea maximum 10 fotografii stocate pe server.')
    resolved = []
    for kind, value in entries:
        if kind == 'url':
            resolved.append(value)
            continue
        _, image_url = _insert_catalog_image(item_id, value, actor)
        resolved.append(image_url)
    catalog['images'] = list(dict.fromkeys(resolved))
    catalog['imageUrl'] = next(iter(catalog['images']), None)
    return catalog


@admin_bp.route('/local-catalog/products', methods=['POST'])
@require_auth
@require_admin_or_page_permission('items')
@with_db
def create_manual_catalog_product():
    """Create a Sentry-owned manual product, including price and audit data."""
    body = request.form.to_dict() if request.form else (request.get_json(silent=True) or {})
    if not isinstance(body, dict):
        return jsonify({'error': 'Date de produs invalide.'}), 422

    name = str(body.get('name') or '').strip()
    ean = str(body.get('ean') or '').strip()
    brand = str(body.get('brand') or '').strip() or 'LOCAL'
    code = str(body.get('code') or '').strip() or ean
    category = str(body.get('category') or '').strip() or 'Produs manual'
    description = str(body.get('description') or '').strip()
    if not name or len(name) > 200:
        return jsonify({'error': 'Numele produsului este obligatoriu și poate avea maximum 200 de caractere.'}), 422
    if not ean or len(ean) > 50 or any(ord(char) < 32 for char in ean):
        return jsonify({'error': 'EAN-ul este obligatoriu și poate avea maximum 50 de caractere.'}), 422

    try:
        catalog = validate_catalog({
            'name': name,
            'brand': brand,
            'code': code,
            'category': category,
            'description': description,
            'eans': [ean],
            'images': [],
            'references': [],
        })
        actor = str(g.current_user.get('username') or 'unknown')
        pricing = update_pricing({}, 'manual', price=body.get('price'), actor=actor)
        image = _catalog_image_upload(request.files.get('file'))
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 422
    except OverflowError as exc:
        return jsonify({'error': str(exc)}), 413
    except TypeError as exc:
        return jsonify({'error': str(exc)}), 415

    duplicate = g.db.execute(text('''
        SELECT item_id FROM items
        WHERE upc = :ean OR barcode_aliases @> CAST(:aliases AS jsonb)
        LIMIT 1
    '''), {'ean': ean, 'aliases': json.dumps([ean])}).fetchone()
    if duplicate:
        return jsonify({
            'error': 'Există deja un produs cu acest EAN.',
            'item_id': duplicate.item_id,
        }), 409

    sku_fragment = re.sub(r'[^A-Z0-9]+', '-', ean.upper()).strip('-')[:34] or uuid.uuid4().hex[:12].upper()
    sku = f'MANUAL-{sku_fragment}'[:50]
    if g.db.execute(text('SELECT 1 FROM items WHERE sku = :sku'), {'sku': sku}).fetchone():
        sku = f'{sku[:41]}-{uuid.uuid4().hex[:8].upper()}'

    item_id = g.db.execute(text('''
        INSERT INTO items
            (sku, item_name, description, upc, mpn, category,
             barcode_aliases, local_pricing, external_id)
        VALUES
            (:sku, :name, :description, :ean, :code, :category,
             CAST(:aliases AS jsonb), CAST(:pricing AS jsonb), :external_id)
        RETURNING item_id
    '''), {
        'sku': sku,
        'name': catalog['name'],
        'description': catalog['description'],
        'ean': ean,
        'code': catalog['code'],
        'category': catalog['category'],
        'aliases': json.dumps(catalog['eans']),
        'pricing': json.dumps(pricing),
        'external_id': str(uuid.uuid4()),
    }).scalar()

    if image:
        _, image_url = _insert_catalog_image(item_id, image, actor)
        catalog['images'] = [image_url]
        catalog['imageUrl'] = image_url

    g.db.execute(text('''
        INSERT INTO item_catalog_discoveries
            (item_id, scanned_ean, status, tecdoc_code, tecdoc_brand,
             tecdoc_name, tecdoc_match_type, tecdoc_payload,
             created_by, reviewed_by, reviewed_at)
        VALUES
            (:item_id, :ean, 'MANUAL', :code, :brand,
             :name, 'manual', CAST(:payload AS jsonb),
             :actor, :actor, NOW())
    '''), {
        'item_id': item_id,
        'ean': ean,
        'code': catalog['code'],
        'brand': catalog['brand'],
        'name': catalog['name'],
        'payload': json.dumps(catalog),
        'actor': actor,
    })
    _audit(item_id, 'LOCAL_CATALOG_CREATE', {
        'catalog': catalog,
        'pricing': pricing,
        'origin': 'mobile_manual_entry',
    })
    g.db.commit()
    return jsonify(_serialize(_item(item_id))), 201


@admin_bp.route('/items/<int:item_id>/local-catalog', methods=['GET'])
@require_auth
@require_admin_or_page_permission('items')
@with_db
def get_local_catalog(item_id):
    item = _item(item_id)
    if not item:
        return jsonify({'error': 'Produsul nu există.'}), 404
    return jsonify(_serialize(item))


@admin_bp.route('/items/<int:item_id>/catalog-images', methods=['POST'])
@require_auth
@require_admin_or_page_permission('items')
@with_db
def upload_catalog_image(item_id):
    """Persist one product photo and return its immutable HTTPS URL."""
    item = _item(item_id)
    if not item:
        return jsonify({'error': 'Produsul nu există.'}), 404
    upload = request.files.get('file')
    if not upload:
        return jsonify({'error': 'Alege o fotografie a produsului.'}), 422
    try:
        image = _catalog_image_upload(upload)
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 422
    except OverflowError as exc:
        return jsonify({'error': str(exc)}), 413
    except TypeError as exc:
        return jsonify({'error': str(exc)}), 415
    image_count = g.db.execute(
        text('SELECT COUNT(*) FROM catalog_product_images WHERE item_id = :id'),
        {'id': item_id},
    ).scalar()
    if int(image_count or 0) >= 10:
        return jsonify({'error': 'Produsul poate avea maximum 10 fotografii încărcate.'}), 409
    image_id, image_url = _insert_catalog_image(
        item_id,
        image,
        str(g.current_user.get('username') or 'unknown'),
    )
    g.db.commit()
    return jsonify({
        'image_id': str(image_id),
        'image_url': image_url,
        'mime_type': image['mime_type'],
        'file_size': image['file_size'],
    }), 201


@admin_bp.route('/items/<int:item_id>/catalog-images/batch', methods=['POST'])
@require_auth
@require_admin_or_page_permission('items')
@with_db
def add_catalog_images(item_id):
    """Store uploaded and linked images without changing catalogue review state."""
    item = _item(item_id)
    if not item:
        return jsonify({'error': 'Produsul nu există.'}), 404
    uploads = request.files.getlist('files')
    try:
        links = json.loads(request.form.get('links') or '[]')
    except (TypeError, ValueError):
        return jsonify({'error': 'Lista linkurilor de imagini este invalidă.'}), 422
    if not isinstance(links, list) or any(not isinstance(link, str) for link in links):
        return jsonify({'error': 'Lista linkurilor de imagini este invalidă.'}), 422
    existing_count = int(g.db.execute(
        text('SELECT COUNT(*) FROM catalog_product_images WHERE item_id = :id'),
        {'id': item_id},
    ).scalar() or 0)
    if not uploads and not links:
        return jsonify({'error': 'Adaugă cel puțin o imagine.'}), 422
    if existing_count + len(uploads) + len(links) > 10:
        return jsonify({'error': 'Produsul poate avea maximum 10 fotografii stocate pe server.'}), 409
    try:
        images = [_catalog_image_upload(upload) for upload in uploads]
        images.extend(_download_catalog_image(link.strip()) for link in links)
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 422
    except OverflowError as exc:
        return jsonify({'error': str(exc)}), 413
    except TypeError as exc:
        return jsonify({'error': str(exc)}), 415
    actor = str(g.current_user.get('username') or 'unknown')
    for image in images:
        _insert_catalog_image(item_id, image, actor)
    _audit(item_id, 'CATALOG_IMAGES_ADD', {'count': len(images)})
    g.db.commit()
    return jsonify(_serialize(_item(item_id))), 201


@admin_bp.route('/catalog-images/<uuid:image_id>', methods=['GET'])
@with_db
def get_catalog_image(image_id):
    """Serve an immutable product photo by unguessable UUID."""
    row = g.db.execute(text('''
        SELECT mime_type, file_name, content
        FROM catalog_product_images WHERE image_id = :id
    '''), {'id': str(image_id)}).fetchone()
    if not row:
        return jsonify({'error': 'Fotografia nu există.'}), 404
    response = send_file(
        BytesIO(bytes(row.content)), mimetype=row.mime_type,
        download_name=row.file_name, max_age=31536000, conditional=False,
        etag=False,
    )
    response.headers['Cache-Control'] = 'public, max-age=31536000, immutable'
    return response


@admin_bp.route('/items/<int:item_id>/local-catalog', methods=['PUT'])
@require_auth
@require_admin_or_page_permission('items')
@with_db
def save_local_catalog(item_id):
    try:
        body = request.get_json(silent=True)
        # Older APKs keep their existing final-save behavior. The web sends
        # an explicit flag to distinguish saving work from completing review.
        complete = body.get('complete', True) if isinstance(body, dict) else True
        catalog_review_status(None, complete)
        catalog = validate_catalog(body, require_complete=complete)
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 422
    item = _item(item_id, lock=True)
    if not item:
        return jsonify({'error': 'Produsul nu există.'}), 404
    if item.status == 'MATCHED':
        return jsonify({'error': 'Produsul are deja o identitate TecDoc.'}), 409
    actor = str(g.current_user.get('username') or 'unknown')
    try:
        catalog = _persist_catalog_image_links(item_id, catalog, actor)
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 422
    except OverflowError as exc:
        return jsonify({'error': str(exc)}), 413
    except TypeError as exc:
        return jsonify({'error': str(exc)}), 415
    params = {'id': item_id, 'name': catalog['name'], 'code': catalog['code'],
              'brand': catalog['brand'], 'description': catalog['description'],
              'category': catalog['category'], 'ean': next(iter(catalog['eans']), item.upc),
              'aliases': json.dumps(list(dict.fromkeys(catalog['eans'] + ([item.upc] if item.upc else [])))), 'payload': json.dumps(catalog),
              'scan': (item.upc or item.sku)[:50], 'actor': actor,
              'status': catalog_review_status(item.status, complete), 'complete': complete}
    g.db.execute(text('''
        UPDATE items SET item_name = COALESCE(NULLIF(:name, ''), item_name), mpn = :code, upc = :ean,
            description = :description, category = :category,
            barcode_aliases = CAST(:aliases AS jsonb), updated_at = NOW()
        WHERE item_id = :id
    '''), params)
    g.db.execute(text('''
        INSERT INTO item_catalog_discoveries
            (item_id, scanned_ean, status, tecdoc_code, tecdoc_brand, tecdoc_name,
             tecdoc_match_type, tecdoc_payload, created_by, reviewed_by, reviewed_at)
        VALUES (:id, :scan, :status, :code, :brand, :name, 'manual', CAST(:payload AS jsonb), :actor,
                CASE WHEN :complete THEN :actor ELSE NULL END, CASE WHEN :complete THEN NOW() ELSE NULL END)
        ON CONFLICT (item_id) DO UPDATE SET status = :status,
            tecdoc_code = :code, tecdoc_brand = :brand, tecdoc_name = :name,
            tecdoc_article_id = NULL, tecdoc_match_type = 'manual',
            tecdoc_payload = CAST(:payload AS jsonb),
            reviewed_by = CASE WHEN :complete THEN :actor ELSE item_catalog_discoveries.reviewed_by END,
            reviewed_at = CASE WHEN :complete THEN NOW() ELSE item_catalog_discoveries.reviewed_at END,
            updated_at = NOW()
    '''), params)
    old = item.tecdoc_payload or {}
    if (old.get('code'), old.get('brand')) != (catalog['code'], catalog['brand']):
        pricing = dict(item.local_pricing or {})
        if 'manual_price' in pricing:
            pricing = update_pricing({}, 'manual', price=pricing['manual_price'], actor=actor)
        else:
            pricing = {}
        g.db.execute(text('UPDATE items SET local_pricing = CAST(:pricing AS jsonb) WHERE item_id = :id'),
                     {'id': item_id, 'pricing': json.dumps(pricing)})
    _audit(item_id, 'LOCAL_CATALOG_UPDATE', {'catalog': catalog, 'completed': complete})
    g.db.commit()
    result = _serialize(_item(item_id))
    result['completed'] = complete
    result['message'] = ('Produsul este complet și a fost scos din lista de produse neechivalate.' if complete
                         else 'Datele au fost salvate. Produsul rămâne în lista de produse neechivalate.' if result['status'] == 'PENDING'
                         else 'Modificările produsului au fost salvate.')
    return jsonify(result)


@admin_bp.route('/items/<int:item_id>/connex-prices', methods=['POST'])
@require_auth
@require_admin_or_page_permission('items')
@with_db
def find_connex_prices(item_id):
    item = _item(item_id)
    if not item:
        return jsonify({'error': 'Produsul nu există.'}), 404
    body = request.get_json(silent=True) or {}
    if not isinstance(body, dict):
        return jsonify({'error': 'Cerere invalidă.'}), 422
    reference = str(body.get('reference') or item.mpn or item.upc or '').strip()
    try:
        return jsonify(catalog_request('/api/integrations/sentry/connex-prices', payload={'reference': reference}))
    except CatalogDiscoveryError as exc:
        return jsonify({'error': str(exc)}), exc.status


@admin_bp.route('/items/<int:item_id>/local-price', methods=['POST'])
@require_auth
@require_admin_or_page_permission('items')
@with_db
def save_local_price(item_id):
    body = request.get_json(silent=True) or {}
    if not isinstance(body, dict):
        return jsonify({'error': 'Cerere invalidă.'}), 422
    item = _item(item_id, lock=True)
    if not item:
        return jsonify({'error': 'Produsul nu există.'}), 404
    action = body.get('action')
    quote = None
    reference = None
    try:
        if action == 'refresh':
            previous = item.local_pricing or {}
            reference = str(body.get('reference') or previous.get('reference') or item.mpn or item.upc or '').strip()
            product_id = str(body.get('product_id') or (previous.get('connex') or {}).get('id') or '')
            lookup = catalog_request('/api/integrations/sentry/connex-prices', payload={'reference': reference, 'product_id': product_id})
            quote = next((row for row in lookup.get('matches', []) if str(row.get('id')) == product_id), None)
            if not quote:
                return jsonify({'error': 'Produsul Connex nu mai este disponibil. Repetă echivalarea.'}), 409
        pricing = update_pricing(item.local_pricing, action, price=body.get('price'),
                                 quote=quote, reference=reference,
                                 actor=str(g.current_user.get('username') or 'unknown'))
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 422
    except CatalogDiscoveryError as exc:
        return jsonify({'error': str(exc)}), exc.status
    g.db.execute(text('UPDATE items SET local_pricing = CAST(:pricing AS jsonb), updated_at = NOW() WHERE item_id = :id'),
                 {'id': item_id, 'pricing': json.dumps(pricing)})
    _audit(item_id, 'LOCAL_PRICE_UPDATE', {'action': action, 'before': item.local_pricing, 'after': pricing})
    g.db.commit()
    return jsonify({'pricing': pricing})
