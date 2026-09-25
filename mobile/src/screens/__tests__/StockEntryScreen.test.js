import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(__dirname, '..', 'StockEntryScreen.js'), 'utf8');

describe('instant stock-entry feedback', () => {
  it('adds an optimistic session row before starting the network request', () => {
    const optimisticIndex = source.indexOf('setLastEntries((current) => [optimisticEntry');
    const clearIndex = source.indexOf('clearProduct();', optimisticIndex);
    const syncIndex = source.indexOf('syncEntry(optimisticEntry);', optimisticIndex);
    expect(optimisticIndex).toBeGreaterThan(-1);
    expect(clearIndex).toBeGreaterThan(optimisticIndex);
    expect(syncIndex).toBeGreaterThan(clearIndex);
  });

  it('reuses the idempotency key and exposes a failed-row retry', () => {
    expect(source).toMatch(/idempotency_key: entry\.entryKey/);
    expect(source).toMatch(/syncingKeysRef\.current\.has\(entry\.entryKey\)/);
    expect(source).toMatch(/onPress=\{\(\) => syncEntry\(entry\)\}/);
    expect(source).toMatch(/Salvare eșuată · REÎNCEARCĂ/);
  });

  it('shows TecDoc product images in the active card and session history', () => {
    expect(source).toMatch(/itemPreview\.image_url \|\| itemPreview\.images\[0\]/);
    expect(source).toMatch(/accessibilityLabel=\{`Imagine/);
    expect(source).toMatch(/entry\.imageUrl/);
  });

  it('renders a TecDoc row for matched EANs and an explicit no-match state otherwise', () => {
    expect(source).toMatch(/itemPreview\?\.catalog_status === 'MATCHED'/);
    expect(source).toMatch(/itemPreview\?\.tecdoc_brand/);
    expect(source).toMatch(/itemPreview\?\.tecdoc_name/);
    expect(source).toMatch(/itemPreview\?\.tecdoc_code/);
    expect(source).toContain('ECHIVALAT TECDOC');
    expect(source).toContain('FĂRĂ ECHIVALARE · SE SALVEAZĂ PENTRU MAI TÂRZIU');
  });

  it('can remove a synced session row and reverse its stock entry', () => {
    expect(source).toMatch(/client\.delete\(`\/api\/inventory\/stock-entry\/\$\{entry\.serverId\}`\)/);
    expect(source).toMatch(/confirmRemoveEntry\(entry\)/);
    expect(source).toContain('Scoți produsul din sesiune?');
    expect(source).toContain("'🗑︎'");
  });
});
