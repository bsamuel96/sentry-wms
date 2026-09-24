export function canSearchScannedCodeInTecDoc(value) {
  return /^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(String(value || '').trim());
}
