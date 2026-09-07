const COMPLETE_BIN_CODE = /^[^-*|]+-[^-*|]+-[^-*|]+(?:-[^-*|]+)*$/;

/**
 * Convert an Autosav storage-label envelope to the Sentry bin code it carries.
 * Product, PO, SO and native Sentry barcodes pass through unchanged.
 */
export function normalizeScannedBarcode(rawValue = '') {
  const raw = String(rawValue || '')
    .replace(/[\r\n\s]+/g, '')
    .replace(/\\\*/g, '*')
    .trim();
  const separator = raw.includes('*') ? '*' : (raw.includes('|') ? '|' : '');
  if (!separator) return raw;

  const parts = raw.split(separator).map((part) => part.trim());
  const prefix = String(parts[0] || '').toUpperCase();
  if (prefix === 'ASL1') {
    const candidate = parts[2] || '';
    return COMPLETE_BIN_CODE.test(candidate) ? candidate : raw;
  }
  if (prefix === 'ASL2' && parts.length >= 5) {
    const addressParts = parts.slice(2, 5);
    if (addressParts.every(Boolean)) return addressParts.join('-');
  }
  return raw;
}
