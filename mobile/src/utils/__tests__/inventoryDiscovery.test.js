import { describe, it, expect, vi } from 'vitest';
import { addDiscoveredCountItem, findOrDiscoverCountItem, validInventoryEan } from '../inventoryDiscovery';
const ean = '4006381333931';
const item = { item_id: 12, sku: 'F1', item_name: 'Filter', upc: ean };
describe('unknown inventory EAN', () => {
  it('asks for discovery only for a valid unknown EAN; known items bypass the notice', async () => {
    const discover = vi.fn().mockResolvedValue(item);
    expect(await findOrDiscoverCountItem({ get: async () => ({ data: { item } }) }, ean, discover)).toEqual(item);
    expect(discover).not.toHaveBeenCalled();
    const missing = { get: async () => { throw { response: { status: 404 } }; } };
    expect(await findOrDiscoverCountItem(missing, ean, discover)).toEqual(item);
    expect(discover).toHaveBeenCalledWith(ean);
    expect(validInventoryEan('4006381333932')).toBe(false);
    await expect(findOrDiscoverCountItem(missing, 'invalid', discover)).rejects.toThrow('EAN valid');
  });
  it('network errors do not open a misleading unknown-product notice', async () => {
    const discover = vi.fn();
    await expect(findOrDiscoverCountItem({ get: async () => { throw new Error('offline'); } }, ean, discover)).rejects.toThrow('offline');
    expect(discover).not.toHaveBeenCalled();
  });
  it('cancel does not add an item; repeated queued scans merge into one count line', async () => {
    const client = { get: async () => ({ data: {} }) };
    expect(await findOrDiscoverCountItem(client, ean, async () => null)).toBeNull();
    let lines = addDiscoveredCountItem([], item, 1);
    lines = addDiscoveredCountItem(lines, item, 1);
    expect(lines).toHaveLength(1);
    expect(lines[0].counted_quantity).toBe('2');
    expect(addDiscoveredCountItem([], item, 0)[0].counted_quantity).toBe('0');
  });
});
