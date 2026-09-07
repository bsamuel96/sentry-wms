import { describe, expect, it } from 'vitest';
import { normalizeScannedBarcode } from '../barcodes.js';

describe('normalizarea codurilor scanate', () => {
  it('extrage bin-ul complet din eticheta Autosav ASL1', () => {
    expect(normalizeScannedBarcode('ASL1*negoesti-1*A-a-1*Negoesti-1')).toBe('A-a-1');
  });

  it('acceptă separatorul ASL1 păstrat ca escaped de scanner', () => {
    expect(normalizeScannedBarcode(String.raw`ASL1*negoesti-1*A-a-1\*Negoesti-1`)).toBe('A-a-1');
  });

  it('reconstruiește bin-ul din eticheta Autosav ASL2', () => {
    expect(normalizeScannedBarcode('ASL2*negoesti-1*A*a*1*Negoesti-1')).toBe('A-a-1');
  });

  it('nu transformă o etichetă ASL1 care conține doar un rând', () => {
    expect(normalizeScannedBarcode('ASL1*negoesti-1*A*Negoesti-1'))
      .toBe('ASL1*negoesti-1*A*Negoesti-1');
  });

  it('lasă codurile de produs și bin-urile native neschimbate', () => {
    expect(normalizeScannedBarcode('FT38079')).toBe('FT38079');
    expect(normalizeScannedBarcode('A-a-1')).toBe('A-a-1');
  });
});
