import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const componentSource = readFileSync(resolve(__dirname, '..', 'CameraScannerModal.js'), 'utf8');
const mobileRoot = resolve(__dirname, '..', '..', '..');
const appConfig = JSON.parse(readFileSync(resolve(mobileRoot, 'app.json'), 'utf8'));
const packageJson = JSON.parse(readFileSync(resolve(mobileRoot, 'package.json'), 'utf8'));

describe('phone camera scanner', () => {
  it('uses Expo Camera with the rear camera and warehouse barcode formats', () => {
    expect(componentSource).toMatch(/CameraView/);
    expect(componentSource).toMatch(/facing="back"/);
    expect(componentSource).toMatch(/'code128'/);
    expect(componentSource).toMatch(/'code39'/);
    expect(componentSource).toMatch(/'ean13'/);
    expect(componentSource).toMatch(/'qr'/);
  });

  it('locks after the first result so a label is not submitted twice', () => {
    expect(componentSource).toMatch(/if \(!cleaned \|\| scanLockedRef\.current\) return/);
    expect(componentSource).toMatch(/scanLockedRef\.current = true/);
    expect(componentSource).toMatch(/setScanLocked\(true\)/);
  });

  it('declares the native dependency and camera permission', () => {
    expect(packageJson.dependencies['expo-camera']).toBe('~17.0.10');
    expect(appConfig.expo.android.permissions).toContain('CAMERA');
    expect(appConfig.expo.plugins).toEqual(expect.arrayContaining([
      expect.arrayContaining(['expo-camera']),
    ]));
  });
});
