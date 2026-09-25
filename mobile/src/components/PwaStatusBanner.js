import React, { useCallback, useEffect, useState } from 'react';
import { Platform, StyleSheet, TouchableOpacity, View } from 'react-native';
import Text from './LocalizedText';
import { colors, fonts, radii } from '../theme/styles';

function isStandalone() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(display-mode: standalone)').matches
    || window.navigator?.standalone === true;
}

function isIosBrowser() {
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export default function PwaStatusBanner() {
  const [online, setOnline] = useState(
    Platform.OS !== 'web' || typeof navigator === 'undefined' ? true : navigator.onLine,
  );
  const [installPrompt, setInstallPrompt] = useState(
    Platform.OS === 'web' && typeof window !== 'undefined'
      ? window.__sentryPwaInstallPrompt || null
      : null,
  );
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return undefined;
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    const handleInstallReady = () => setInstallPrompt(window.__sentryPwaInstallPrompt || null);
    const handleInstalled = () => {
      window.__sentryPwaInstallPrompt = null;
      setInstallPrompt(null);
      setDismissed(true);
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('sentry-pwa-install-ready', handleInstallReady);
    window.addEventListener('appinstalled', handleInstalled);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('sentry-pwa-install-ready', handleInstallReady);
      window.removeEventListener('appinstalled', handleInstalled);
    };
  }, []);

  const install = useCallback(async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice.catch(() => null);
    if (typeof window !== 'undefined') window.__sentryPwaInstallPrompt = null;
    setInstallPrompt(null);
  }, [installPrompt]);

  if (Platform.OS !== 'web') return null;

  if (!online) {
    return (
      <View style={[styles.banner, styles.offlineBanner]} accessibilityRole="alert">
        <Text style={styles.offlineText}>EȘTI OFFLINE · Operațiile WMS necesită internet.</Text>
      </View>
    );
  }

  if (dismissed || isStandalone()) return null;
  const ios = isIosBrowser();
  if (!ios && !installPrompt) return null;

  return (
    <View style={styles.banner}>
      <View style={styles.copy}>
        <Text style={styles.title}>INSTALEAZĂ SENTRY WMS</Text>
        <Text style={styles.message}>
          {ios
            ? 'Pe iPhone: Partajare → Adaugă la ecranul principal.'
            : 'Instalează aplicația pentru acces rapid de pe telefon.'}
        </Text>
      </View>
      {installPrompt ? (
        <TouchableOpacity style={styles.installButton} onPress={install}>
          <Text style={styles.installButtonText}>INSTALEAZĂ</Text>
        </TouchableOpacity>
      ) : null}
      <TouchableOpacity
        style={styles.closeButton}
        onPress={() => setDismissed(true)}
        accessibilityRole="button"
        accessibilityLabel="Ascunde instrucțiunile de instalare"
      >
        <Text style={styles.closeText}>×</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    marginHorizontal: 16,
    marginBottom: 10,
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: radii.button,
    backgroundColor: '#eff6ff',
  },
  offlineBanner: { borderColor: '#fca5a5', backgroundColor: '#fef2f2' },
  copy: { flex: 1 },
  title: {
    fontFamily: fonts.mono,
    fontSize: 11,
    fontWeight: '800',
    color: colors.accentRed,
  },
  message: { marginTop: 3, fontSize: 12, lineHeight: 17, color: colors.textSecondary },
  offlineText: { flex: 1, fontSize: 12, fontWeight: '800', color: '#b91c1c' },
  installButton: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: radii.button,
    backgroundColor: colors.accentRed,
  },
  installButtonText: { fontFamily: fonts.mono, fontSize: 10, fontWeight: '800', color: '#ffffff' },
  closeButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  closeText: { fontSize: 24, lineHeight: 26, color: colors.textMuted },
});
