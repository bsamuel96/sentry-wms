"""Validation and price transitions, independent of database and providers."""
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from urllib.parse import urlparse


def positive_price(value):
    try:
        price = Decimal(str(value).replace(',', '.'))
        if not price.is_finite() or price <= 0 or price > 100000000:
            raise ValueError('Introdu un preț între 0 și 100.000.000 RON, mai mare decât zero.')
        rounded = price.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
        if rounded <= 0:
            raise ValueError('Prețul minim este 0,01 RON.')
        return float(rounded)
    except (InvalidOperation, TypeError):
        raise ValueError('Prețul nu este valid.')


def update_pricing(current, action, *, price=None, quote=None, reference=None, actor=''):
    result = dict(current or {})
    if action == 'manual':
        result['manual_price'] = positive_price(price)
    elif action == 'refresh':
        if not quote or quote.get('currency') != 'RON':
            raise ValueError('Alege un preț Connex disponibil în RON.')
        quote = {**quote, 'price': positive_price(quote.get('price'))}
        result['connex'] = quote
        result['reference'] = reference
    elif action == 'use_connex':
        if not result.get('connex'):
            raise ValueError('Echivalează mai întâi prețul cu Connex.')
        result.pop('manual_price', None)
    else:
        raise ValueError('Acțiune de preț invalidă.')
    result['price'] = result.get('manual_price', (result.get('connex') or {}).get('price'))
    result['source'] = 'manual' if 'manual_price' in result else 'connex'
    result['currency'] = 'RON'
    result['includes_vat'] = True
    result['updated_by'] = actor
    result['updated_at'] = datetime.now(timezone.utc).isoformat()
    return result


def validate_catalog(body):
    if not isinstance(body, dict):
        raise ValueError('Date de produs invalide.')
    result = {'matchType': 'manual'}
    for field, limit in [('name', 200), ('code', 64), ('brand', 200), ('category', 100), ('description', 1000)]:
        value = str(body.get(field) or '').strip()
        if len(value) > limit or (field in ('name', 'code', 'brand') and not value):
            raise ValueError(f'Câmpul {field} este obligatoriu sau prea lung (maximum {limit}).')
        result[field] = value
    for field, limit in [('eans', 50), ('images', 10)]:
        values = body.get(field, [])
        if not isinstance(values, list) or len(values) > limit:
            raise ValueError(f'Lista {field} nu este validă (maximum {limit}).')
        values = list(dict.fromkeys(str(value).strip() for value in values if str(value).strip()))
        if any(len(value) > (2000 if field == 'images' else 50) for value in values):
            raise ValueError(f'Valoare prea lungă în {field}.')
        if field == 'images' and any(urlparse(value).scheme != 'https' or not urlparse(value).netloc for value in values):
            raise ValueError('Imaginile trebuie să aibă adrese HTTPS complete.')
        result[field] = values
    result['imageUrl'] = next(iter(result['images']), None)
    references = body.get('references', [])
    if not isinstance(references, list) or len(references) > 40:
        raise ValueError('Poți introduce maximum 40 de referințe.')
    result['references'] = []
    for row in references:
        if not isinstance(row, dict):
            raise ValueError('Referință invalidă.')
        reference = {key: str(row.get(key) or '').strip() for key in ('code', 'type', 'manufacturer')}
        if not reference['code'] or any(len(value) > 200 for value in reference.values()):
            raise ValueError('Codul referinței este obligatoriu; maximum 200 de caractere per câmp.')
        result['references'].append(reference)
    return result
