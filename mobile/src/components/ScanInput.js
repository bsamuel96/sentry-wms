import React, { useCallback, useRef, useState, useEffect } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import Text, { TextInput } from './LocalizedText';
import { colors, fonts, radii } from '../theme/styles';
import { useScanSettingsContext } from '../context/ScanSettingsContext';
import CameraScannerModal from './CameraScannerModal';
import { normalizeScannedBarcode } from '../utils/barcodes';

export default function ScanInput({ placeholder = 'SCAN BARCODE', onScan, disabled = false, autoFocus = true, suppressRefocus = false }) {
  const inputRef = useRef(null);
  const [value, setValue] = useState('');
  const bufferRef = useRef('');
  const [processing, setProcessing] = useState(false);
  // True only while the user is manually typing. Keeps the soft keyboard
  // hidden during auto-focus and the 1-second refocus loop (hardware scan
  // flow), while still letting a tap open the keyboard for manual fallback.
  const [softInput, setSoftInput] = useState(false);
  const [cameraVisible, setCameraVisible] = useState(false);
  const scanSettings = useScanSettingsContext();
  const scanMode = scanSettings?.mode;
  const registerScanHandler = scanSettings?.registerScanHandler;
  const unregisterScanHandler = scanSettings?.unregisterScanHandler;
  const scanInFlightRef = useRef(false);

  const processBarcode = useCallback((raw, refocusAfter = false) => {
    const trimmed = normalizeScannedBarcode(raw);

    setValue('');
    bufferRef.current = '';
    setSoftInput(false);
    if (!trimmed || !onScan || scanInFlightRef.current) {
      if (refocusAfter) setTimeout(() => inputRef.current?.focus(), 50);
      return Promise.resolve();
    }

    scanInFlightRef.current = true;
    setProcessing(true);
    return Promise.resolve(onScan(trimmed)).finally(() => {
      scanInFlightRef.current = false;
      setProcessing(false);
      if (refocusAfter) setTimeout(() => inputRef.current?.focus(), 50);
    });
  }, [onScan]);

  // Register this ScanInput's onScan as the active intent handler
  // when the component is mounted and not disabled
  useEffect(() => {
    if (scanMode !== 'intent' || !registerScanHandler || !unregisterScanHandler || disabled) return;
    const handler = (barcode) => {
      if (disabled || processing) return;
      processBarcode(barcode);
    };
    registerScanHandler(handler);
    return () => unregisterScanHandler(handler);
  }, [scanMode, registerScanHandler, unregisterScanHandler, disabled, processing, processBarcode]);

  useEffect(() => {
    if (autoFocus && !disabled && !processing && !suppressRefocus) {
      const timer = setTimeout(() => inputRef.current?.focus(), 100);
      return () => clearTimeout(timer);
    }
  }, [autoFocus, disabled, processing, suppressRefocus]);

  // Re-focus input when it loses focus (hardware scanner can steal focus)
  // Suppressed when another input (e.g. qty field) has focus
  useEffect(() => {
    if (disabled || processing || suppressRefocus) return;
    const interval = setInterval(() => {
      try {
        if (inputRef.current && typeof inputRef.current.isFocused === 'function' && !inputRef.current.isFocused()) {
          inputRef.current.focus();
        }
      } catch {
        // Swallow focus errors on hardware scanner devices
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [disabled, processing, suppressRefocus]);

  const handleSubmit = () => {
    // Use bufferRef (synchronous) instead of value (async React state)
    // to avoid the C6000 race where Enter fires before the last onChangeText flushes
    // Drop out of manual-entry mode so the post-submit refocus stays silent.
    setSoftInput(false);
    processBarcode(bufferRef.current, true);
  };

  const handleCameraScan = useCallback((barcode) => {
    processBarcode(barcode, true);
  }, [processBarcode]);

  const openCamera = useCallback(() => {
    inputRef.current?.blur();
    setCameraVisible(true);
  }, []);

  const closeCamera = useCallback(() => {
    setCameraVisible(false);
  }, []);

  const handlePressIn = () => {
    if (softInput) return;
    setSoftInput(true);
    // Force a focus cycle so the updated showSoftInputOnFocus prop applies
    // and the keyboard actually opens on this tap.
    setTimeout(() => {
      inputRef.current?.blur();
      setTimeout(() => inputRef.current?.focus(), 0);
    }, 0);
  };

  const handleBlur = () => {
    setSoftInput(false);
  };

  const handleChangeText = (text) => {
    // Strip control characters that hardware scanners may inject (keep printable chars only)
    const cleaned = text.replace(/[\r\n\t]/g, '');
    bufferRef.current = cleaned;
    setValue(cleaned);
    // NO auto-submit timer. Only process on Enter/Submit (onSubmitEditing).
    // C6000 scanners send characters one at a time; a timer causes partial submits.
  };

  const IGNORED_KEYS = ['Escape', 'GoBack', 'F1', 'F2', 'F3', 'F4', 'F5',
    'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12', 'Tab'];

  return (
    <>
      <View style={[styles.container, (disabled || processing) && styles.disabled]}>
        <TextInput
          ref={inputRef}
          style={styles.input}
          placeholder={processing ? 'SE PROCESEAZĂ...' : placeholder}
          placeholderTextColor={colors.textPlaceholder}
          value={value}
          onChangeText={handleChangeText}
          onSubmitEditing={handleSubmit}
          onKeyPress={(e) => {
            if (IGNORED_KEYS.includes(e.nativeEvent.key)) {
              e.preventDefault?.();
              e.stopPropagation?.();
            }
          }}
          onPressIn={handlePressIn}
          onBlur={handleBlur}
          editable={!disabled && !processing}
          autoFocus={autoFocus && !disabled}
          autoCapitalize="characters"
          autoCorrect={false}
          blurOnSubmit={false}
          returnKeyType="done"
          showSoftInputOnFocus={softInput}
          selectTextOnFocus
        />
        <TouchableOpacity
          style={styles.cameraButton}
          onPress={openCamera}
          disabled={disabled || processing}
          accessibilityRole="button"
          accessibilityLabel="Scanează cu camera"
          accessibilityHint="Deschide camera telefonului pentru citirea codului de bare"
        >
          <Text style={styles.cameraIcon}>▣</Text>
          <Text style={styles.cameraLabel}>CAMERĂ</Text>
        </TouchableOpacity>
      </View>
      <CameraScannerModal
        visible={cameraVisible}
        onClose={closeCamera}
        onScan={handleCameraScan}
      />
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.inputBg,
    borderWidth: 1.5,
    borderColor: colors.inputBorder,
    borderRadius: radii.input,
    paddingHorizontal: 12,
    minHeight: 44,
    marginBottom: 16,
  },
  disabled: {
    backgroundColor: '#eaf0f7',
    borderColor: colors.cardBorder,
  },
  input: {
    flex: 1,
    fontFamily: fonts.mono,
    fontSize: 12,
    color: colors.textPrimary,
    letterSpacing: 1,
    paddingVertical: 10,
  },
  cameraButton: {
    minWidth: 82,
    minHeight: 44,
    marginRight: -8,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    borderLeftWidth: 1,
    borderLeftColor: colors.inputBorder,
  },
  cameraIcon: { fontSize: 18, color: colors.accentRed },
  cameraLabel: {
    fontFamily: fonts.mono,
    fontSize: 9,
    fontWeight: '800',
    color: colors.accentRed,
  },
});
