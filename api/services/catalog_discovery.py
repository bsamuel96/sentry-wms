"""Server-to-server TecDoc discovery. No provider or bridge secrets reach the APK."""
import os
from urllib.parse import urlparse
import requests


class CatalogDiscoveryError(Exception):
    def __init__(self, message, status=502):
        super().__init__(message)
        self.status = status


def catalog_request(path, *, params=None, payload=None):
    base = os.environ.get("AUTOSAV_CATALOG_API_URL", "").rstrip("/")
    parsed = urlparse(base)
    if not base or (parsed.scheme != "https" and parsed.hostname not in ("localhost", "127.0.0.1")):
        raise CatalogDiscoveryError("Legătura TecDoc–AutoSav nu este configurată.", 503)
    headers = {"Accept": "application/json"}
    if payload is not None:
        key = os.environ.get("AUTOSAV_CATALOG_BRIDGE_KEY", "")
        if len(key) < 32:
            raise CatalogDiscoveryError("Înregistrarea produselor AutoSav nu este configurată.", 503)
        headers["Authorization"] = f"Bearer {key}"
    try:
        response = requests.request("POST" if payload is not None else "GET", base + path, params=params, json=payload, headers=headers, timeout=(5, 90 if payload is not None else 45), allow_redirects=False)
        data = response.json()
    except (requests.RequestException, ValueError) as exc:
        raise CatalogDiscoveryError("AutoSav nu a răspuns. Reîncearcă identificarea produsului.") from exc
    if response.status_code in (401, 403):
        raise CatalogDiscoveryError("Legătura AutoSav–Sentry nu este autorizată. Verifică configurarea serverelor.", 502)
    if not response.ok or not isinstance(data, dict):
        message = data.get("error") if isinstance(data, dict) else None
        raise CatalogDiscoveryError(message or "Cererea de catalog a eșuat.", response.status_code if 400 <= response.status_code < 600 else 502)
    return data
