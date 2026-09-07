import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildCheckoutPayload,
  checkoutTotals,
  createUuidV4,
  locationsForWarehouse,
  moneyToCents,
  upsertCartLine,
} from '../pos.js';

describe('utilitare POS mobil', () => {
  it('parsează sume românești și produce UUID v4', () => {
    expect(moneyToCents('12,34')).toBe(1234);
    expect(moneyToCents('12.345')).toBeNull();
    expect(createUuidV4(() => 0.5)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('păstrează doar locațiile cu stoc din depozitul selectat', () => {
    const locations = locationsForWarehouse([
      { warehouse_id: 'NEG', warehouse_name: 'Negoiești', bins: [{ bin_id: 'A-1', qty: 2 }, { bin_id: 'A-2', qty: 5 }] },
      { warehouse_id: 'ALT', warehouse_name: 'Altul', bins: [{ bin_id: 'B-1', qty: 99 }] },
    ], 'NEG');
    expect(locations.map((item) => item.binId)).toEqual(['A-2', 'A-1']);
  });

  it('adaugă sau incrementează articolul fără a depăși stocul', () => {
    const item = { sku: 'W79', name: 'Filtru', barcode: '123' };
    const location = { warehouseId: 'NEG', warehouseName: 'Negoiești', binId: 'A-1', binName: 'A-1', available: 2 };
    const once = upsertCartLine([], item, location);
    const twice = upsertCartLine(once, item, location);
    const capped = upsertCartLine(twice, item, location);
    expect(capped[0].quantity).toBe(2);
  });

  it('calculează TVA inclus și construiește plata numerar', () => {
    const cart = [{
      sku: 'W79', warehouseId: 'NEG', binId: 'A-1', available: 5,
      quantity: 2, price: '121.00',
    }];
    expect(checkoutTotals(cart)).toEqual({ subtotalCents: 20000, taxCents: 4200, totalCents: 24200 });
    const payload = buildCheckoutPayload({
      cart,
      paymentMethod: 'cash',
      cashTendered: '250',
      cashierId: 'sam',
      terminalId: 'mobil-1',
      idempotencyKey: '11111111-1111-4111-8111-111111111111',
      completedAt: '2026-09-07T10:00:00.000Z',
    });
    expect(payload.payment_summary.total_cents).toBe(24200);
    expect(payload.payment_summary.tenders[0].change_cents).toBe(800);
    expect(payload.lines[0]).toMatchObject({ unit_price_cents: 10000, tax_cents: 4200, line_total_cents: 24200 });
  });

  it('leagă ecranul mobil de endpointurile POS fără a include un token WMS în APK', () => {
    const screen = readFileSync(new URL('../../screens/PosScreen.js', import.meta.url), 'utf8');
    const navigator = readFileSync(new URL('../../navigation/AppNavigator.js', import.meta.url), 'utf8');
    const home = readFileSync(new URL('../../screens/HomeScreen.js', import.meta.url), 'utf8');

    expect(screen).toContain('/api/v1/pos/availability');
    expect(screen).toContain('/api/v1/pos/validate-cart');
    expect(screen).toContain('/api/v1/pos/checkout');
    expect(screen).not.toContain('X-WMS-Token');
    expect(navigator).toContain('name="Pos"');
    expect(home).toContain("key: 'sell'");
  });
});
