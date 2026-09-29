import { describe, expect, it, vi } from 'vitest';
import { catalogToForm, formToCatalog, matchPendingCatalog } from '../catalogReview';

describe('matching the complete pending catalog', () => {
  it('visits every snapshot ID exactly once across pages and the old 100-item limit', async () => {
    const ids = Array.from({ length: 137 }, (_, i) => i + 1);
    const getIds = vi.fn(async () => [...ids, 1]);
    const matchBatch = vi.fn(async batch => ({ results: batch.map(id => ({ discovery_id: id, status: id % 2 ? 'matched' : 'not_found' })) }));
    const onProgress = vi.fn();
    const result = await matchPendingCatalog({ getIds, matchBatch, onProgress });
    expect(getIds).toHaveBeenCalledTimes(1);
    expect(matchBatch.mock.calls.flatMap(([batch]) => batch)).toEqual(ids);
    expect(matchBatch.mock.calls.every(([batch]) => batch.length <= 6)).toBe(true);
    expect(result).toMatchObject({ total: 137, processed: 137, matched: 69, not_found: 68, stopped: false });
    expect(onProgress.mock.calls[0][0].processed).toBe(0);
    expect(onProgress.mock.calls.at(-1)[0].processed).toBe(137);
  });

  it('counts ambiguous, invalid, failed and already reviewed rows without retry loops', async () => {
    const statuses = ['matched', 'ambiguous', 'skipped', 'error', 'not_found', 'skipped'];
    const result = await matchPendingCatalog({
      getIds: async () => statuses.map((_, i) => i + 1),
      matchBatch: async ids => ({ results: ids.map(id => ({ discovery_id: id, status: statuses[id - 1] })) }),
      onProgress: () => {},
    });
    expect(result).toMatchObject({ processed: 6, matched: 1, ambiguous: 1, skipped: 2, failed: 1, not_found: 1 });
  });

  it('stops after the in-flight batch and reports incomplete progress', async () => {
    let stop = false;
    const result = await matchPendingCatalog({
      getIds: async () => [1, 2, 3, 4, 5, 6, 7],
      matchBatch: async ids => { stop = true; return { results: ids.map(id => ({ discovery_id: id, status: 'matched' })) }; },
      onProgress: () => {}, shouldStop: () => stop,
    });
    expect(result).toMatchObject({ total: 7, processed: 6, stopped: true });
  });

  it('does not report a timed-out batch as processed or retry a possibly committed request', async () => {
    const onProgress = vi.fn();
    const matchBatch = vi.fn().mockRejectedValue(new Error('timeout'));
    await expect(matchPendingCatalog({ getIds: async () => [1, 2], matchBatch, onProgress })).rejects.toThrow('timeout');
    expect(matchBatch).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(onProgress.mock.calls[0][0].processed).toBe(0);
  });

  it('rejects missing or duplicate result IDs instead of displaying false completion', async () => {
    for (const results of [[], [{ discovery_id: 1, status: 'matched' }, { discovery_id: 1, status: 'matched' }]]) {
      await expect(matchPendingCatalog({ getIds: async () => [1, 2], matchBatch: async () => ({ results }), onProgress: () => {} })).rejects.toThrow('Răspuns incomplet');
    }
  });

  it('finishes an empty queue without making write requests', async () => {
    const matchBatch = vi.fn();
    expect(await matchPendingCatalog({ getIds: async () => [], matchBatch, onProgress: () => {} })).toMatchObject({ total: 0, processed: 0, stopped: false });
    expect(matchBatch).not.toHaveBeenCalled();
  });
});

describe('manual product details', () => {
  const catalog = { name: 'Filtru', brand: 'Marca', code: 'ABC', category: 'Filtre', description: 'Descriere', eans: ['4006381333931'], images: ['https://example.com/filter.jpg'], references: [{ code: 'OE-1', type: 'OE', manufacturer: 'Producător' }] };
  it('preserves every editable TecDoc field through the mobile form', () => {
    expect(formToCatalog(catalogToForm(catalog))).toEqual(catalog);
  });
  it('preserves legacy primary image and deduplicates multiline EANs', () => {
    const form = catalogToForm({ ...catalog, images: [], imageUrl: catalog.images[0] });
    form.eans = ' 4006381333931\r\n4006381333931\n';
    expect(formToCatalog(form)).toEqual(catalog);
  });
  it('requires product identity, reference codes and HTTPS image URLs', () => {
    expect(() => formToCatalog({ ...catalogToForm(catalog), name: ' ' })).toThrow('denumirea');
    expect(() => formToCatalog({ ...catalogToForm(catalog), images: 'http://example.com/a.jpg' })).toThrow('HTTPS');
    expect(() => formToCatalog({ ...catalogToForm(catalog), references: [{ code: '', type: 'OE', manufacturer: '' }] })).toThrow('referințe');
  });
});
