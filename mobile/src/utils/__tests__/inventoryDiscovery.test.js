import { describe, it, expect } from 'vitest';
import {
  addDiscoveredCountItem,
  findKnownCountItem,
  normalizeScannedProductCode,
  validScannedProductCode,
} from '../inventoryDiscovery';
const ean = '4006381333931';
const item = {
  item_id: 12,
  sku: 'F1',
  item_name: 'Filter',
  upc: ean,
  catalog_status: 'MATCHED',
  tecdoc_code: 'C113',
  tecdoc_brand: 'DOLZ',
  tecdoc_name: 'Pompă apă',
  image_url: 'https://cdn.example.test/c113.jpg',
  images: ['https://cdn.example.test/c113.jpg'],
};
describe('unknown inventory EAN', () => {
  it('accepts supplier barcodes for deferred matching without forcing GTIN length', () => {
    expect(normalizeScannedProductCode(' 1654644071 ')).toBe('1654644071');
    expect(validScannedProductCode('1654644071')).toBe(true);
    expect(validScannedProductCode('ATK-03.01/031')).toBe(true);
    expect(validScannedProductCode('1234')).toBe(false);
    expect(validScannedProductCode('bad code')).toBe(false);
  });
  it('uses known items and defers unknown products to Locații și stoc', async () => {
    expect(await findKnownCountItem({ get: async () => ({ data: { item } }) }, ean)).toEqual(item);
    const missing = { get: async () => { throw { response: { status: 404 } }; } };
    await expect(findKnownCountItem(missing, ean)).rejects.toThrow('Locații și stoc');
  });
  it('network errors do not open a misleading unknown-product notice', async () => {
    await expect(findKnownCountItem({ get: async () => { throw new Error('offline'); } }, ean)).rejects.toThrow('offline');
  });
  it('cancel does not add an item; repeated queued scans merge into one count line', async () => {
    let lines = addDiscoveredCountItem([], item, 1);
    lines = addDiscoveredCountItem(lines, item, 1);
    expect(lines).toHaveLength(1);
    expect(lines[0].counted_quantity).toBe('2');
    expect(lines[0]).toMatchObject({
      catalog_status: 'MATCHED',
      tecdoc_code: 'C113',
      tecdoc_brand: 'DOLZ',
      tecdoc_name: 'Pompă apă',
      image_url: 'https://cdn.example.test/c113.jpg',
    });
    expect(addDiscoveredCountItem([], item, 0)[0].counted_quantity).toBe('0');
  });
});
