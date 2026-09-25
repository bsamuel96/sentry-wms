export function normalizeScannedProductCode(value) {
  return String(value || '').trim();
}

export function validScannedProductCode(value) {
  return /^[A-Za-z0-9][A-Za-z0-9._/+*-]{5,49}$/.test(normalizeScannedProductCode(value));
}
export function addDiscoveredCountItem(lines, item, quantity) {
  const found = lines.findIndex(line => line.item_id === item.item_id);
  if (found !== -1) return lines.map((line, i) => i === found ? { ...line, counted_quantity: String((Number(line.counted_quantity) || 0) + quantity) } : line);
  return [...lines, {
    count_line_id: null,
    item_id: item.item_id,
    sku: item.sku,
    item_name: item.item_name,
    upc: item.upc,
    catalog_status: item.catalog_status,
    tecdoc_article_id: item.tecdoc_article_id,
    tecdoc_code: item.tecdoc_code,
    tecdoc_brand: item.tecdoc_brand,
    tecdoc_name: item.tecdoc_name,
    tecdoc_match_type: item.tecdoc_match_type,
    image_url: item.image_url || item.images?.[0] || null,
    images: item.images || [],
    expected_quantity: 0,
    counted_quantity: String(quantity),
    unexpected: true,
  }];
}
export async function findKnownCountItem(client, barcode) {
  try {
    const { data } = await client.get(`/api/lookup/item/${encodeURIComponent(barcode)}`);
    if (data?.item) return data.item;
  } catch (error) {
    if (error.response?.status !== 404) throw error;
  }
  throw new Error('Produs necunoscut. Introdu-l mai întâi din „Locații și stoc”; echivalarea TecDoc se face ulterior în Sentry Web.');
}
