"""Safe extraction of product media persisted in TecDoc discovery payloads."""
import json
import re
import unicodedata
from urllib.parse import urlparse


def catalog_image_mime(data):
    """Identify the browser-native image set from trusted file signatures."""
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if len(data) >= 12 and data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def _safe_image_url(value):
    text = str(value or "").strip()
    if not text:
        return None
    parsed = urlparse(text)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        return None
    return text


def _media_value(value):
    if isinstance(value, str):
        return value
    if not isinstance(value, dict):
        return None
    for key in ("url", "imageUrl", "image_url", "uri", "src", "original", "thumbnail"):
        candidate = value.get(key)
        if isinstance(candidate, str) and candidate.strip():
            return candidate
    return None


def catalog_image_urls(payload, *, limit=10):
    if isinstance(payload, str):
        try:
            payload = json.loads(payload)
        except (TypeError, ValueError):
            return []
    if not isinstance(payload, dict):
        return []

    candidates = []
    for key in ("imageUrl", "image_url", "thumbnailUrl", "thumbnail_url"):
        if payload.get(key):
            candidates.append(payload[key])
    for key in ("images", "imageUrls", "image_urls", "articleImages"):
        values = payload.get(key) or []
        candidates.extend(values if isinstance(values, list) else [values])

    result = []
    seen = set()
    for candidate in candidates:
        url = _safe_image_url(_media_value(candidate))
        if not url or url in seen:
            continue
        seen.add(url)
        result.append(url)
        if len(result) >= limit:
            break
    return result


def _plain_key(value):
    return ''.join(
        char for char in unicodedata.normalize('NFD', str(value or '').lower())
        if unicodedata.category(char) != 'Mn'
    )


def _format_viscosity(value):
    text = re.sub(r'\s+', ' ', str(value or '').strip()).upper()
    match = re.fullmatch(r'(\d{1,3})\s*W\s*[- ]?\s*(\d{1,3})', text)
    if match:
        return f'{match.group(1)}W-{match.group(2)}'
    return text or None


def catalog_oil_viscosity(payload, *fallback_texts):
    """Extract the oil viscosity without classifying unrelated products as oil."""
    if isinstance(payload, str):
        try:
            payload = json.loads(payload)
        except (TypeError, ValueError):
            payload = {}
    payload = payload if isinstance(payload, dict) else {}
    direct = []
    searchable = []

    def visit(value):
        if isinstance(value, dict):
            for key, child in value.items():
                normalized_key = _plain_key(key)
                if normalized_key in ('viscosity', 'viscozitate', 'vascozitate') and not isinstance(child, (dict, list)):
                    direct.append(child)
                visit(child)
            label = next((value.get(key) for key in (
                'name', 'label', 'criteriaName', 'criteriaDescription', 'description', 'propertyName', 'ProductPropertyName'
            ) if value.get(key)), None)
            if label and any(word in _plain_key(label) for word in ('viscosity', 'viscozitate', 'vascozitate')):
                candidate = next((value.get(key) for key in (
                    'formattedValue', 'value', 'displayValue', 'criteriaValue', 'rawValue', 'PropertyValue'
                ) if value.get(key) not in (None, '')), None)
                if candidate is not None:
                    direct.append(candidate)
        elif isinstance(value, list):
            for child in value:
                visit(child)
        elif isinstance(value, str):
            searchable.append(value)

    visit(payload)
    for value in direct:
        formatted = _format_viscosity(value)
        if formatted:
            return formatted
    text = ' '.join([*searchable, *(str(value or '') for value in fallback_texts)])
    match = re.search(r'(?<![A-Z0-9])(\d{1,3})\s*W\s*[- ]?\s*(\d{1,3})(?!\d)', text, re.IGNORECASE)
    return _format_viscosity(f'{match.group(1)}W-{match.group(2)}') if match else None


def catalog_is_oil_product(payload, *fallback_texts):
    """Identify lubricants while excluding parts whose names merely mention oil."""
    if isinstance(payload, str):
        try:
            payload = json.loads(payload)
        except (TypeError, ValueError):
            payload = {}
    payload = payload if isinstance(payload, dict) else {}
    if catalog_oil_viscosity(payload, *fallback_texts):
        return True
    values = []

    def visit(value):
        if isinstance(value, dict):
            for child in value.values():
                visit(child)
        elif isinstance(value, list):
            for child in value:
                visit(child)
        elif isinstance(value, str):
            values.append(value)

    visit(payload)
    plain = _plain_key(' '.join([*values, *(str(value or '') for value in fallback_texts)]))
    excluded = r'(?:filtru|filter|baie|pompa|senzor|buson|racitor)'
    oil = r'(?:ulei(?:uri)?|oil|lubrifiant(?:i)?)'
    if re.search(fr'{excluded}.{{0,16}}{oil}|{oil}.{{0,16}}{excluded}', plain):
        return False
    return bool(re.search(fr'\b{oil}\b', plain))
