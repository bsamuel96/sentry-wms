import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, '..', 'ExpandableProductImage.js'), 'utf8');

describe('expandable product image', () => {
  it('opens a full image modal and supports Android back and an explicit close action', () => {
    expect(source).toMatch(/setOpen\(true\)/);
    expect(source).toMatch(/<Modal visible=\{open\}/);
    expect(source).toMatch(/onRequestClose=\{\(\) => setOpen\(false\)\}/);
    expect(source).toContain('Închide imaginea mărită');
    expect(source).toMatch(/style=\{styles\.fullImage\}/);
  });
});
