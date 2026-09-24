"""Safe extraction of product media persisted in TecDoc discovery payloads."""
import json
from urllib.parse import urlparse


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
