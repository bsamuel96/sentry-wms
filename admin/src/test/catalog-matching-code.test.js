import { describe, expect, it } from 'vitest';
import { canSearchScannedCodeInTecDoc } from '../pages/CatalogMatching.jsx';

describe('TecDoc catalog matching scanned codes', () => {
  it('auto-searches only standard EAN/GTIN lengths', () => {
    expect(canSearchScannedCodeInTecDoc('4006381333931')).toBe(true);
    expect(canSearchScannedCodeInTecDoc('12345678')).toBe(true);
    expect(canSearchScannedCodeInTecDoc('1654644071')).toBe(false);
    expect(canSearchScannedCodeInTecDoc('ATK-03.01/031')).toBe(false);
  });
});
