export const BULK_BATCH_SIZE = 6;
export const CATALOG_TIMEOUT = 90000;

// Snapshot first: paging a shrinking PENDING list would skip products.
// Stop on transport failure: a timed-out batch may already have committed.
export async function matchPendingCatalog({ getIds, matchBatch, onProgress, shouldStop = () => false }) {
  const ids = [...new Set(await getIds())];
  const progress = { total: ids.length, processed: 0, matched: 0, ambiguous: 0, not_found: 0, skipped: 0, failed: 0 };
  onProgress({ ...progress });
  for (let offset = 0; offset < ids.length && !shouldStop(); offset += BULK_BATCH_SIZE) {
    const batch = ids.slice(offset, offset + BULK_BATCH_SIZE);
    const payload = await matchBatch(batch);
    const results = payload?.results;
    if (!Array.isArray(results) || results.length !== batch.length
      || new Set(results.map(row => row.discovery_id)).size !== batch.length
      || results.some(row => !batch.includes(row.discovery_id)
        || !['matched', 'ambiguous', 'not_found', 'skipped', 'error'].includes(row.status))) {
      throw new Error('Răspuns incomplet. Reîncarcă lista înainte să reîncerci.');
    }
    for (const result of results) progress[result.status === 'error' ? 'failed' : result.status] += 1;
    progress.processed += batch.length;
    onProgress({ ...progress });
  }
  return { ...progress, stopped: progress.processed < progress.total };
}

export function catalogToForm(catalog = {}) {
  return {
    name: catalog.name || '', brand: catalog.brand || '', code: catalog.code || '',
    category: catalog.category || '', description: catalog.description || '',
    eans: (catalog.eans || []).join('\n'),
    images: (catalog.images?.length ? catalog.images : catalog.imageUrl ? [catalog.imageUrl] : []).join('\n'),
    references: (catalog.references || []).map(row => ({ code: row.code || '', type: row.type || '', manufacturer: row.manufacturer || '' })),
  };
}

export function formToCatalog(form) {
  const list = value => [...new Set(value.split(/\r?\n/).map(row => row.trim()).filter(Boolean))];
  const catalog = {
    ...form, name: form.name.trim(), brand: form.brand.trim(), code: form.code.trim(),
    category: form.category.trim(), description: form.description.trim(),
    eans: list(form.eans), images: list(form.images),
    references: form.references.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value.trim()]))),
  };
  if (!catalog.name || !catalog.brand || !catalog.code) throw new Error('Completează denumirea, marca și codul producătorului.');
  if (catalog.eans.length > 50 || catalog.images.length > 10 || catalog.references.length > 40) throw new Error('Maximum 50 coduri EAN, 10 imagini și 40 referințe.');
  if (catalog.images.some(value => !/^https:\/\/[^/\s]+(?:\/[^\s]*)?$/.test(value))) throw new Error('Imaginile trebuie să fie adrese HTTPS valide, câte una pe linie.');
  if (catalog.references.some(row => !row.code)) throw new Error('Completează codul fiecărei referințe sau elimină referința goală.');
  return catalog;
}
