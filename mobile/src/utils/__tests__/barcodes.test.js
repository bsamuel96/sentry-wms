import { describe, expect, it } from 'vitest';
import { normalizeScannedBarcode, parseWarehouseHierarchyBarcode } from '../barcodes.js';

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

describe('etichetele ierarhiei depozitului', () => {
  it('recunoaște zona, culoarul și raftul tipărite din Admin', () => {
    expect(parseWarehouseHierarchyBarcode('ZONE:PICK')).toMatchObject({ kind: 'ZONE', title: 'ZONĂ PICK' });
    expect(parseWarehouseHierarchyBarcode('AISLE:PICK:A')).toMatchObject({ kind: 'AISLE', title: 'CULOAR A' });
    expect(parseWarehouseHierarchyBarcode('SHELF:PICK:A:B')).toMatchObject({ kind: 'SHELF', title: 'RAFT B' });
  });

  it('păstrează compatibilitatea cu etichetele ROW existente', () => {
    expect(parseWarehouseHierarchyBarcode('ROW-A')).toMatchObject({ kind: 'AISLE', title: 'CULOAR A' });
  });

  it('nu confundă produsele și bin-urile cu etichete ierarhice', () => {
    expect(parseWarehouseHierarchyBarcode('FT38079')).toBeNull();
    expect(parseWarehouseHierarchyBarcode('A-a-1')).toBeNull();
  });
});
