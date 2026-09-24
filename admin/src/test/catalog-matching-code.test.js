import { describe, expect, it } from 'vitest';
import { canSearchScannedCodeInTecDoc } from '../utils/catalogMatching.js';

describe('TecDoc catalog matching scanned codes', () => {
  it('auto-searches only EAN/GTIN values with a valid check digit', () => {
    expect(canSearchScannedCodeInTecDoc('4006381333931')).toBe(true);
    expect(canSearchScannedCodeInTecDoc('12345670')).toBe(true);
    expect(canSearchScannedCodeInTecDoc('12345678')).toBe(false);
    expect(canSearchScannedCodeInTecDoc('1654644071')).toBe(false);
    expect(canSearchScannedCodeInTecDoc('ATK-03.01/031')).toBe(false);
  });
});
