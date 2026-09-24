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

  it('captures one photo on demand and processes that stable frame', () => {
    expect(componentSource).toMatch(/takePictureAsync/);
    expect(componentSource).toMatch(/scanFromURLAsync\(photo\.uri, BARCODE_TYPES\)/);
    expect(componentSource).toMatch(/withOperationTimeout/);
    expect(componentSource).toMatch(/CAPTURE_TIMEOUT_MS/);
    expect(componentSource).toMatch(/DECODE_TIMEOUT_MS/);
    expect(componentSource).toMatch(/accessibilityLabel="Fotografiază și procesează codul"/);
  });

  it('arms the native Android detector only after the capture button is pressed', () => {
    expect(componentSource).toMatch(/barcodeScannerSettings=\{\{ barcodeTypes: BARCODE_TYPES \}\}/);
    expect(componentSource).toMatch(
      /onBarcodeScanned=\{processing && !scanLocked \? handleBarcodeScanned : undefined\}/,
    );
  });

  it('waits for the camera preview and unlocks stalled processing for a retry', () => {
    expect(componentSource).toMatch(/onCameraReady=\{handleCameraReady\}/);
    expect(componentSource).toMatch(/disabled=\{processing \|\| scanLocked \|\| !cameraReady\}/);
    expect(componentSource).toMatch(/Camera a fost deblocată; fotografiază din nou/);
    expect(componentSource).toMatch(/processingRef\.current = false/);
  });

  it('declares the native dependency and camera permission', () => {
    expect(packageJson.dependencies['expo-camera']).toBe('~17.0.10');
    expect(appConfig.expo.android.permissions).toContain('CAMERA');
    expect(appConfig.expo.plugins).toEqual(expect.arrayContaining([
      expect.arrayContaining(['expo-camera']),
    ]));
  });
});
