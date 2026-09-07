import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  SafeAreaView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import Text from './LocalizedText';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { colors, fonts, radii } from '../theme/styles';

const BARCODE_TYPES = [
  'code128',
  'code39',
  'code93',
  'codabar',
  'ean13',
  'ean8',
  'upc_a',
  'upc_e',
  'itf14',
  'qr',
  'datamatrix',
  'pdf417',
  'aztec',
];

export default function CameraScannerModal({ visible, onClose, onScan }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [torchEnabled, setTorchEnabled] = useState(false);
  const [scanLocked, setScanLocked] = useState(false);
  const scanLockedRef = useRef(false);
  const permissionRequestedRef = useRef(false);

  useEffect(() => {
    if (!visible) {
      permissionRequestedRef.current = false;
      scanLockedRef.current = false;
      setScanLocked(false);
      setTorchEnabled(false);
      return;
    }

    if (permission && !permission.granted && permission.canAskAgain && !permissionRequestedRef.current) {
      permissionRequestedRef.current = true;
      requestPermission().catch(() => {});
    }
  }, [permission, requestPermission, visible]);

  const handleBarcodeScanned = useCallback(({ data }) => {
    const cleaned = String(data || '').replace(/[\r\n\s]+/g, '').trim();
    if (!cleaned || scanLockedRef.current) return;

    scanLockedRef.current = true;
    setScanLocked(true);
    onClose();
    onScan(cleaned);
  }, [onClose, onScan]);

  const retryPermission = useCallback(() => {
    permissionRequestedRef.current = true;
    requestPermission().catch(() => {});
  }, [requestPermission]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.screen}>
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>SCANEAZĂ ETICHETA</Text>
            <Text style={styles.subtitle}>Încadrează complet codul în chenar.</Text>
          </View>
          <TouchableOpacity
            style={styles.closeButton}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Închide camera"
          >
            <Text style={styles.closeButtonText}>×</Text>
          </TouchableOpacity>
        </View>

        {!permission ? (
          <View style={styles.permissionState}>
            <ActivityIndicator size="large" color={colors.accentRed} />
            <Text style={styles.permissionText}>Se pregătește camera…</Text>
          </View>
        ) : permission.granted ? (
          <View style={styles.cameraFrame}>
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              enableTorch={torchEnabled}
              barcodeScannerSettings={{ barcodeTypes: BARCODE_TYPES }}
              onBarcodeScanned={scanLocked ? undefined : handleBarcodeScanned}
            />
            <View pointerEvents="none" style={styles.guideOverlay}>
              <View style={styles.scanGuide} />
              <Text style={styles.guideText}>Cod de bare produs, bin, rând sau document</Text>
            </View>
            <View style={styles.cameraActions}>
              <TouchableOpacity
                style={[styles.torchButton, torchEnabled && styles.torchButtonActive]}
                onPress={() => setTorchEnabled((current) => !current)}
                accessibilityRole="button"
                accessibilityLabel={torchEnabled ? 'Oprește lanterna' : 'Pornește lanterna'}
              >
                <Text style={[styles.torchButtonText, torchEnabled && styles.torchButtonTextActive]}>
                  {torchEnabled ? 'OPREȘTE LANTERNA' : 'PORNEȘTE LANTERNA'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <Pressable style={styles.permissionState}>
            <Text style={styles.permissionTitle}>Camera nu are permisiune</Text>
            <Text style={styles.permissionText}>
              Permite accesul la cameră pentru a scana etichetele din depozit.
            </Text>
            {permission.canAskAgain ? (
              <TouchableOpacity style={styles.permissionButton} onPress={retryPermission}>
                <Text style={styles.permissionButtonText}>ACORDĂ PERMISIUNEA</Text>
              </TouchableOpacity>
            ) : (
              <Text style={styles.settingsHint}>
                Deschide Setări Android → Aplicații → Sentry WMS → Permisiuni → Cameră.
              </Text>
            )}
          </Pressable>
        )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: {
    minHeight: 76,
    paddingHorizontal: 18,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
  },
  title: {
    fontFamily: fonts.mono,
    fontSize: 16,
    fontWeight: '800',
    color: colors.accentRed,
    letterSpacing: 0.5,
  },
  subtitle: { marginTop: 4, fontSize: 12, color: colors.textSecondary },
  closeButton: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: radii.button,
    backgroundColor: colors.cardBg,
  },
  closeButtonText: { fontSize: 28, lineHeight: 30, color: colors.accentRed },
  cameraFrame: { flex: 1, backgroundColor: '#020617' },
  guideOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  scanGuide: {
    width: '100%',
    maxWidth: 440,
    height: 180,
    borderWidth: 3,
    borderColor: '#ffffff',
    borderRadius: 18,
    backgroundColor: 'transparent',
  },
  guideText: {
    marginTop: 18,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radii.badge,
    overflow: 'hidden',
    backgroundColor: 'rgba(15, 23, 42, 0.78)',
    color: '#ffffff',
    fontWeight: '700',
    textAlign: 'center',
  },
  cameraActions: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 28,
    alignItems: 'center',
  },
  torchButton: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: 20,
    borderWidth: 2,
    borderColor: '#ffffff',
    borderRadius: radii.button,
    backgroundColor: 'rgba(15, 23, 42, 0.78)',
  },
  torchButtonActive: { backgroundColor: '#ffffff', borderColor: colors.accentRed },
  torchButtonText: {
    fontFamily: fonts.mono,
    fontSize: 12,
    fontWeight: '800',
    color: '#ffffff',
  },
  torchButtonTextActive: { color: colors.accentRed },
  permissionState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
  },
  permissionTitle: {
    fontFamily: fonts.mono,
    fontSize: 18,
    fontWeight: '800',
    color: colors.textPrimary,
    textAlign: 'center',
  },
  permissionText: {
    marginTop: 12,
    maxWidth: 360,
    fontSize: 14,
    lineHeight: 21,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  permissionButton: {
    marginTop: 22,
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: 20,
    borderRadius: radii.button,
    backgroundColor: colors.accentRed,
  },
  permissionButtonText: { fontFamily: fonts.mono, fontWeight: '800', color: '#ffffff' },
  settingsHint: {
    marginTop: 20,
    maxWidth: 380,
    fontSize: 13,
    lineHeight: 20,
    color: colors.accentRed,
    textAlign: 'center',
  },
});
