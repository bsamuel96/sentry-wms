"""Sentry-owned Local catalogue and Connex reference pricing."""
from io import BytesIO
import json

from flask import g, jsonify, request, send_file, url_for
from sqlalchemy import text
from werkzeug.utils import secure_filename

from middleware.auth_middleware import require_auth, require_admin_or_page_permission
from middleware.db import with_db
from routes.admin import admin_bp
from services.catalog_discovery import catalog_request, CatalogDiscoveryError
from services.catalog_media import catalog_image_mime
from services.local_catalog import update_pricing, validate_catalog
from services.audit_service import write_audit_log


_CATALOG_IMAGE_MAX_BYTES = 4 * 1024 * 1024


def _item(item_id, lock=False):
    if lock:
        # Same lock order as TecDoc matching; re-read status after waiting.
        g.db.execute(text('SELECT discovery_id FROM item_catalog_discoveries WHERE item_id = :id FOR UPDATE'), {'id': item_id})
    return g.db.execute(text('''
        SELECT i.item_id, i.sku, i.item_name, i.upc, i.mpn, i.category,
               i.description, i.local_pricing, d.status, d.tecdoc_payload
        FROM items i LEFT JOIN item_catalog_discoveries d ON d.item_id = i.item_id
        WHERE i.item_id = :id
    ''' + (' FOR UPDATE OF i' if lock else '')), {'id': item_id}).fetchone()


def _serialize(item):
    return {
        'item_id': item.item_id, 'status': item.status,
        'catalog': item.tecdoc_payload or {
            'name': item.item_name, 'code': item.mpn or '', 'brand': '',
            'eans': [item.upc] if item.upc else [], 'images': [], 'references': [],
            'category': item.category or '', 'description': item.description or '',
        },
        'pricing': item.local_pricing or {},
    }


def _audit(item_id, action, details):
    write_audit_log(g.db, action, 'item', item_id,
                    g.current_user.get('username') or 'unknown', None, details=details)


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
    content = upload.stream.read(_CATALOG_IMAGE_MAX_BYTES + 1)
    if not content:
        return jsonify({'error': 'Fotografia este goală.'}), 422
    if len(content) > _CATALOG_IMAGE_MAX_BYTES:
        return jsonify({'error': 'Fotografia poate avea maximum 4 MB.'}), 413
    mime_type = catalog_image_mime(content)
    if not mime_type:
        return jsonify({'error': 'Folosește o imagine JPEG, PNG sau WebP.'}), 415
    image_count = g.db.execute(
        text('SELECT COUNT(*) FROM catalog_product_images WHERE item_id = :id'),
        {'id': item_id},
    ).scalar()
    if int(image_count or 0) >= 10:
        return jsonify({'error': 'Produsul poate avea maximum 10 fotografii încărcate.'}), 409
    extension = {'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp'}[mime_type]
    file_name = secure_filename(upload.filename or '')[:240] or f'produs-{item_id}.{extension}'
    image_id = g.db.execute(text('''
        INSERT INTO catalog_product_images
            (item_id, mime_type, file_name, file_size, content, created_by)
        VALUES (:item_id, :mime_type, :file_name, :file_size, :content, :actor)
        RETURNING image_id
    '''), {
        'item_id': item_id,
        'mime_type': mime_type,
        'file_name': file_name,
        'file_size': len(content),
        'content': content,
        'actor': str(g.current_user.get('username') or 'unknown'),
    }).scalar()
    g.db.commit()
    image_url = url_for(
        'admin.get_catalog_image', image_id=image_id,
        _external=True, _scheme='https',
    )
    return jsonify({
        'image_id': str(image_id),
        'image_url': image_url,
        'mime_type': mime_type,
        'file_size': len(content),
    }), 201


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
        catalog = validate_catalog(request.get_json(silent=True))
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 422
    item = _item(item_id, lock=True)
    if not item:
        return jsonify({'error': 'Produsul nu există.'}), 404
    if item.status == 'MATCHED':
        return jsonify({'error': 'Produsul are deja o identitate TecDoc.'}), 409
    actor = str(g.current_user.get('username') or 'unknown')
    params = {'id': item_id, 'name': catalog['name'], 'code': catalog['code'],
              'brand': catalog['brand'], 'description': catalog['description'],
              'category': catalog['category'], 'ean': next(iter(catalog['eans']), item.upc),
              'aliases': json.dumps(list(dict.fromkeys(catalog['eans'] + ([item.upc] if item.upc else [])))), 'payload': json.dumps(catalog),
              'scan': (item.upc or item.sku)[:50], 'actor': actor}
    g.db.execute(text('''
        UPDATE items SET item_name = :name, mpn = :code, upc = :ean,
            description = :description, category = :category,
            barcode_aliases = CAST(:aliases AS jsonb), updated_at = NOW()
        WHERE item_id = :id
    '''), params)
    g.db.execute(text('''
        INSERT INTO item_catalog_discoveries
            (item_id, scanned_ean, status, tecdoc_code, tecdoc_brand, tecdoc_name,
             tecdoc_match_type, tecdoc_payload, created_by, reviewed_by, reviewed_at)
        VALUES (:id, :scan, 'MANUAL', :code, :brand, :name, 'manual', CAST(:payload AS jsonb), :actor, :actor, NOW())
        ON CONFLICT (item_id) DO UPDATE SET status = 'MANUAL',
            tecdoc_code = :code, tecdoc_brand = :brand, tecdoc_name = :name,
            tecdoc_article_id = NULL, tecdoc_match_type = 'manual',
            tecdoc_payload = CAST(:payload AS jsonb), reviewed_by = :actor,
            reviewed_at = NOW(), updated_at = NOW()
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
    _audit(item_id, 'LOCAL_CATALOG_UPDATE', {'catalog': catalog})
    g.db.commit()
    return jsonify(_serialize(_item(item_id)))


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
