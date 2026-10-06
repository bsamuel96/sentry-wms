import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, '..', 'CatalogDetailsScreen.js'), 'utf8');

describe('manual catalogue product photos', () => {
  it('prefills the TecDoc reference from the product code captured during stock entry', () => {
    expect(source).toMatch(/useState\(discovery\.product_code \|\| ''\)/);
    expect(source).toContain('Cod produs: {discovery.product_code}');
  });

  it('offers camera and gallery uploads through the authenticated Sentry API', () => {
    expect(source).toMatch(/launchCameraAsync/);
    expect(source).toMatch(/launchImageLibraryAsync/);
    expect(source).toMatch(/catalog-images/);
    expect(source).toMatch(/title="Cameră"/);
    expect(source).toMatch(/title="Upload"/);
  });

  it('previews and removes selected product images before manual save', () => {
    expect(source).toMatch(/<ExpandableProductImage uri=\{imageUrl\}/);
    expect(source).toMatch(/removeImage\(imageUrl\)/);
    expect(source).toMatch(/maximum 10/);
  });

  it('shows an image-shaped loading skeleton while a photo uploads', () => {
    expect(source).toMatch(/setUploadingImage\(true\)/);
    expect(source).toMatch(/uploadingImage \? <CatalogPhotoSkeleton \/>/);
    expect(source).toMatch(/setUploadingImage\(false\)/);
  });
});
