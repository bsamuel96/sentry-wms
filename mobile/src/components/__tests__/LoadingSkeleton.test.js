import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(__dirname, '..', 'LoadingSkeleton.js'), 'utf8');

describe('mobile skeleton geometry', () => {
  it('matches all eight operation cards and keeps shipping full width', () => {
    expect(source).toMatch(/Array\.from\(\{ length: 8 \}\)/);
    expect(source).toMatch(/index === 7 && styles\.fullCard/);
    expect(source).toMatch(/operationStripe/);
  });

  it('matches the 92px order card and its 36px action pill', () => {
    expect(source).toMatch(/minHeight: 92/);
    expect(source).toMatch(/width=\{92\} height=\{36\}/);
    expect(source).toMatch(/orderAction: \{ borderRadius: 18 \}/);
  });
});
