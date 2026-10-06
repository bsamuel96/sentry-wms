// Only prefill a product already confirmed by the catalogue save response.
// Opening the placement screen never writes stock or repeats product creation.
export function stockEntryPrefill(saved) {
  const barcode = String(saved?.catalog?.eans?.[0] || '').trim();
  if (!saved?.item_id || !barcode) return null;
  return {
    barcode,
    code: String(saved.catalog.code || ''),
    price: saved.pricing?.price == null ? '' : String(saved.pricing.price),
    item: {
      item_id: saved.item_id,
      sku: saved.sku || barcode,
      item_name: saved.catalog.name || '',
      mpn: saved.catalog.code || '',
      catalog_status: 'MANUAL',
      image_url: saved.catalog.imageUrl || saved.catalog.images?.[0] || null,
      images: saved.catalog.images || [],
      provisional: false,
      local_pricing: saved.pricing || {},
    },
  };
}
