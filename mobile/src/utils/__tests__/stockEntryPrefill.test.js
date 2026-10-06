import { describe, expect, it } from 'vitest';
import { stockEntryPrefill } from '../stockEntryPrefill';

describe('placement after saving a manual product', () => {
  it('carries the saved identity and photo into shelf placement without another product save', () => {
    const saved = { item_id: 42, sku: 'MANUAL-12345678', pricing: { price: 149.9, source: 'manual' }, catalog: {
      name: 'Ulei motor', code: 'OIL-5', eans: ['12345678'], images: ['https://example.test/photo.jpg'],
    } };
    const result = stockEntryPrefill(saved);
    expect(result.barcode).toBe('12345678');
    expect(result.code).toBe('OIL-5');
    expect(result.price).toBe('149.9');
    expect(result.item.local_pricing).toEqual(saved.pricing);
    expect(result.item).toMatchObject({ item_id: 42, item_name: 'Ulei motor', catalog_status: 'MANUAL', provisional: false, image_url: 'https://example.test/photo.jpg' });
    expect(result).not.toHaveProperty('quantity');
    expect(result).not.toHaveProperty('bin_id');
  });
  it('does not create a placement draft from an unsaved or unidentified product', () => {
    expect(stockEntryPrefill(null)).toBeNull();
    expect(stockEntryPrefill({ catalog: { eans: ['12345678'] } })).toBeNull();
    expect(stockEntryPrefill({ item_id: 42, catalog: {} })).toBeNull();
  });
});
