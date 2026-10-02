import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, '..', 'ManualProductScreen.js'), 'utf8');

describe('manual product entry', () => {
  it('collects the required name, barcode, VAT price and product photo', () => {
    expect(source).toMatch(/Nume produs \*/);
    expect(source).toMatch(/EAN \*/);
    expect(source).toMatch(/Preț cu TVA \(RON\) \*/);
    expect(source).toMatch(/launchCameraAsync/);
    expect(source).toMatch(/launchImageLibraryAsync/);
  });

  it('submits one authenticated multipart request and keeps an undoable draft', () => {
    expect(source).toMatch(/\/api\/admin\/local-catalog\/products/);
    expect(source).toMatch(/new FormData\(\)/);
    expect(source).toMatch(/recordDraft/);
    expect(source).toMatch(/clearDraft/);
  });

  it('shows the server-recorded operator and timestamp after save', () => {
    expect(source).toMatch(/saved\.audit\?\.saved_by/);
    expect(source).toMatch(/savedAtLabel\(saved\.audit\?\.saved_at\)/);
  });
});
