import React, { useMemo, useRef, useState } from 'react';
import { Image, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useScrollToTop } from '@react-navigation/native';
import Text, { TextInput } from '../components/LocalizedText';
import ScanInput from '../components/ScanInput';
import ScreenHeader from '../components/ScreenHeader';
import ErrorPopup from '../components/ErrorPopup';
import useScreenError from '../hooks/useScreenError';
import { useAuth } from '../auth/AuthContext';
import client from '../api/client';
import { buttonStyles, colors, fonts, radii, screenStyles } from '../theme/styles';
import { normalizeScannedProductCode, validScannedProductCode } from '../utils/inventoryDiscovery';

function requestId() {
  const seed = `${Date.now()}-${Math.random()}-${Math.random()}`;
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = ((hash << 5) - hash + seed.charCodeAt(index)) | 0;
  }
  const tail = Math.abs(hash).toString(16).padStart(8, '0').slice(0, 8);
  const time = Date.now().toString(16).padStart(12, '0').slice(-12);
  const random = () => Math.floor(Math.random() * 0xffff).toString(16).padStart(4, '0');
  return `${random()}${random()}-${random()}-4${random().slice(1)}-a${random().slice(1)}-${time.slice(0, 4)}${tail}`;
}

export default function StockEntryScreen({ navigation }) {
  const { warehouseId } = useAuth();
  const scrollRef = React.useRef(null);
  useScrollToTop(scrollRef);
  const [bin, setBin] = useState(null);
  const [newBinCode, setNewBinCode] = useState('');
  const [ean, setEan] = useState('');
  const [entryKey, setEntryKey] = useState('');
  const [itemPreview, setItemPreview] = useState(null);
  const [quantity, setQuantity] = useState('1');
  const [registering, setRegistering] = useState(false);
  const [lastEntries, setLastEntries] = useState([]);
  const syncingKeysRef = useRef(new Set());
  const { error, scanDisabled, showError, clearError } = useScreenError();

  const quantityNumber = useMemo(() => Math.max(0, Number.parseInt(quantity, 10) || 0), [quantity]);

  async function scanBin(barcode) {
    try {
      const response = await client.get(`/api/lookup/bin/${encodeURIComponent(barcode)}`);
      const nextBin = response.data?.bin;
      if (!nextBin) throw new Error('Locația nu a fost găsită.');
      if (warehouseId && Number(nextBin.warehouse_id) !== Number(warehouseId)) {
        throw new Error('Locația nu aparține depozitului selectat.');
      }
      setBin(nextBin);
      setNewBinCode('');
    } catch (scanError) {
      if (scanError.response?.status === 404) {
        setNewBinCode(String(barcode || '').trim());
        return;
      }
      showError(scanError.response?.data?.error || scanError.message || 'Locația nu a fost găsită.');
    }
  }

  async function registerBin() {
    if (!warehouseId || !newBinCode || registering) return;
    setRegistering(true);
    try {
      const response = await client.post('/api/inventory/stock-entry/bin', {
        warehouse_id: warehouseId,
        bin_code: newBinCode,
        zone_code: 'PICK',
      });
      setBin(response.data?.bin || null);
      setNewBinCode('');
    } catch (registerError) {
      showError(registerError.response?.data?.error || 'Locația nu a putut fi înregistrată.');
    } finally {
      setRegistering(false);
    }
  }

  async function scanProduct(barcode) {
    const nextEan = normalizeScannedProductCode(barcode);
    if (!validScannedProductCode(nextEan)) {
      showError('Scanează un cod de produs de 6–50 de caractere. Sunt acceptate cifre, litere, punct, cratimă, / și +.');
      return;
    }
    setEan(nextEan);
    setEntryKey(requestId());
    setQuantity('1');
    try {
      const response = await client.get(`/api/lookup/item/${encodeURIComponent(nextEan)}`);
      setItemPreview(response.data?.item || null);
    } catch (lookupError) {
      if (lookupError.response?.status === 404) {
        setItemPreview({ sku: `SCAN-${nextEan}`, item_name: 'Produs nou · va fi echivalat ulterior în TecDoc', provisional: true });
        return;
      }
      setEan('');
      setEntryKey('');
      setItemPreview(null);
      showError(lookupError.response?.data?.error || 'Produsul nu a putut fi verificat.');
    }
  }

  function clearProduct() {
    setEan('');
    setEntryKey('');
    setItemPreview(null);
    setQuantity('1');
  }

  function changeQuantity(delta) {
    setQuantity(String(Math.max(1, quantityNumber + delta)));
  }

  async function syncEntry(entry) {
    if (syncingKeysRef.current.has(entry.entryKey)) return;
    syncingKeysRef.current.add(entry.entryKey);
    setLastEntries((current) => current.map((row) => (
      row.id === entry.id ? { ...row, syncing: true, failed: false } : row
    )));
    try {
      const response = await client.post('/api/inventory/stock-entry', {
        warehouse_id: entry.warehouseId,
        bin_id: entry.binId,
        barcode: entry.ean,
        quantity: entry.quantity,
        // Keep the same key after a timeout/error so tapping again cannot add
        // the physical pieces twice when the first request actually committed.
        idempotency_key: entry.entryKey,
      }, { timeout: 20000 });
      const result = response.data;
      setLastEntries((current) => current.map((row) => (row.id === entry.id ? {
        ...row,
        serverId: result.stock_entry_id,
        sku: result.item?.sku || row.sku,
        name: result.item?.item_name || row.name,
        quantity: result.quantity_added,
        total: result.quantity_in_bin,
        pending: result.catalog_status === 'PENDING',
        imageUrl: result.item?.image_url || row.imageUrl || null,
        syncing: false,
        failed: false,
      } : row)));
    } catch (saveError) {
      setLastEntries((current) => current.map((row) => (
        row.id === entry.id ? { ...row, syncing: false, failed: true } : row
      )));
      showError(saveError.response?.data?.error || 'Produsul nu a putut fi introdus în stoc. Apasă Reîncearcă în lista sesiunii.');
    } finally {
      syncingKeysRef.current.delete(entry.entryKey);
    }
  }

  function addToBin() {
    if (!warehouseId || !bin?.bin_id || !ean || !entryKey || !itemPreview || quantityNumber < 1) return;
    const optimisticEntry = {
      id: `pending-${entryKey}`,
      entryKey,
      warehouseId,
      binId: bin.bin_id,
      binCode: bin.bin_code,
      ean,
      sku: itemPreview.sku || ean,
      name: itemPreview.item_name || 'Produs',
      quantity: quantityNumber,
      total: null,
      pending: Boolean(itemPreview.provisional),
      imageUrl: itemPreview.image_url || itemPreview.images?.[0] || null,
      syncing: true,
      failed: false,
    };
    // Reflect the physical scan immediately. The idempotency key keeps the
    // background request and any manual retry safe against double stock.
    setLastEntries((current) => [optimisticEntry, ...current].slice(0, 12));
    clearProduct();
    syncEntry(optimisticEntry);
  }

  return (
    <View style={screenStyles.screen}>
      <ScreenHeader title="LOCAȚII ȘI STOC" onBack={() => navigation.goBack()} />
      <ScrollView ref={scrollRef} style={screenStyles.content} contentContainerStyle={screenStyles.contentInner} keyboardShouldPersistTaps="handled">
        <View style={styles.stepHeader}>
          <View style={[styles.stepNumber, bin && styles.stepDone]}><Text style={styles.stepNumberText}>{bin ? '✓' : '1'}</Text></View>
          <View style={styles.stepCopy}><Text style={styles.stepTitle}>Scanează locația</Text><Text style={styles.stepHint}>Locația rămâne activă pentru produsele următoare.</Text></View>
        </View>

        {bin ? (
          <View style={styles.selectionCard}>
            <View>
              <Text style={styles.selectionLabel}>LOCAȚIE ACTIVĂ</Text>
              <Text style={styles.selectionValue}>{bin.bin_code}</Text>
            </View>
            <TouchableOpacity style={styles.changeButton} onPress={() => { setBin(null); setNewBinCode(''); clearProduct(); }}>
              <Text style={styles.changeButtonText}>SCHIMBĂ</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <ScanInput placeholder="SCANEAZĂ LOCAȚIA / BIN-UL" onScan={scanBin} disabled={scanDisabled || registering} />
            {newBinCode ? (
              <View style={styles.newBinCard}>
                <Text style={styles.newBinTitle}>LOCAȚIE NOUĂ: {newBinCode}</Text>
                <Text style={styles.newBinHint}>Locația nu există încă în Sentry. O poți crea în zona PICK și continua imediat cu produsele.</Text>
                <TouchableOpacity style={[buttonStyles.buttonPrimary, registering && buttonStyles.buttonDisabled]} onPress={registerBin} disabled={registering}>
                  <Text style={buttonStyles.buttonPrimaryText}>{registering ? 'SE CREEAZĂ…' : 'ÎNREGISTREAZĂ LOCAȚIA'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[buttonStyles.buttonSecondary, styles.cancelButton]} onPress={() => setNewBinCode('')} disabled={registering}>
                  <Text style={buttonStyles.buttonSecondaryText}>SCANEAZĂ DIN NOU</Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </>
        )}

        <View style={[styles.stepHeader, !bin && styles.inactive]}>
          <View style={[styles.stepNumber, ean && styles.stepDone]}><Text style={styles.stepNumberText}>{ean ? '✓' : '2'}</Text></View>
          <View style={styles.stepCopy}><Text style={styles.stepTitle}>Scanează produsul</Text><Text style={styles.stepHint}>Cod cunoscut sau produs nou pentru echivalare ulterioară.</Text></View>
        </View>

        {bin && !ean ? (
          <ScanInput placeholder="SCANEAZĂ CODUL PRODUSULUI" onScan={scanProduct} disabled={scanDisabled || registering} />
        ) : null}

        {ean ? (
          <View style={styles.productCard}>
            <View style={styles.productTop}>
              {itemPreview?.image_url || itemPreview?.images?.[0] ? (
                <Image
                  source={{ uri: itemPreview.image_url || itemPreview.images[0] }}
                  style={styles.productImage}
                  resizeMode="contain"
                  accessibilityLabel={`Imagine ${itemPreview?.item_name || itemPreview?.sku || ean}`}
                />
              ) : null}
              <View style={styles.productCopy}>
                <Text style={styles.productSku}>{itemPreview?.sku || ean}</Text>
                <Text style={styles.productName}>{itemPreview?.item_name || 'Produs'}</Text>
                <Text style={styles.productEan}>COD SCANAT {ean}</Text>
              </View>
              {itemPreview?.provisional ? <Text style={styles.pendingBadge}>TECDOC ÎN AȘTEPTARE</Text> : <Text style={styles.knownBadge}>IDENTIFICAT</Text>}
            </View>

            <Text style={styles.quantityLabel}>CANTITATE</Text>
            <View style={styles.quantityRow}>
              <TouchableOpacity style={styles.quantityButton} onPress={() => changeQuantity(-1)} disabled={quantityNumber <= 1}><Text style={styles.quantityButtonText}>−</Text></TouchableOpacity>
              <TextInput
                style={styles.quantityInput}
                value={quantity}
                onChangeText={(value) => setQuantity(value.replace(/[^0-9]/g, ''))}
                keyboardType="number-pad"
                selectTextOnFocus
              />
              <TouchableOpacity style={styles.quantityButton} onPress={() => changeQuantity(1)}><Text style={styles.quantityButtonText}>+</Text></TouchableOpacity>
            </View>

            <TouchableOpacity
              style={[buttonStyles.buttonPrimary, (!itemPreview || quantityNumber < 1) && buttonStyles.buttonDisabled]}
              onPress={addToBin}
              disabled={!itemPreview || quantityNumber < 1}
            >
              <Text style={buttonStyles.buttonPrimaryText}>{`ADAUGĂ ÎN ${bin?.bin_code}`}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[buttonStyles.buttonSecondary, styles.cancelButton]} onPress={clearProduct}>
              <Text style={buttonStyles.buttonSecondaryText}>ANULEAZĂ PRODUSUL</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {lastEntries.length ? (
          <View style={styles.sessionSection}>
            <Text style={styles.sessionTitle}>ADĂUGATE ÎN SESIUNEA CURENTĂ</Text>
            {lastEntries.map((entry) => (
              <View key={entry.id} style={styles.sessionRow}>
                {entry.imageUrl ? (
                  <Image source={{ uri: entry.imageUrl }} style={styles.sessionImage} resizeMode="contain" />
                ) : null}
                <View style={styles.sessionCopy}>
                  <Text style={styles.sessionSku}>{entry.sku}</Text>
                  <Text style={styles.sessionName}>{entry.name}</Text>
                  {entry.syncing ? <Text style={styles.sessionSyncing}>Se sincronizează…</Text> : null}
                  {entry.failed ? (
                    <TouchableOpacity onPress={() => syncEntry(entry)} accessibilityRole="button" accessibilityLabel={`Reîncearcă salvarea ${entry.sku}`}>
                      <Text style={styles.sessionFailed}>Salvare eșuată · REÎNCEARCĂ</Text>
                    </TouchableOpacity>
                  ) : null}
                  {!entry.syncing && !entry.failed && entry.pending ? <Text style={styles.sessionPending}>În așteptare TecDoc</Text> : null}
                </View>
                <View style={styles.sessionQuantity}>
                  <Text style={styles.sessionAdded}>+{entry.quantity}</Text>
                  <Text style={styles.sessionTotal}>{entry.total == null ? entry.binCode : `${entry.total} în locație`}</Text>
                </View>
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>
      <ErrorPopup visible={Boolean(error)} message={error} onDismiss={clearError} />
    </View>
  );
}

const styles = StyleSheet.create({
  stepHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  inactive: { opacity: 0.5 },
  stepNumber: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentRed },
  stepDone: { backgroundColor: colors.success },
  stepNumberText: { color: '#fff', fontFamily: fonts.mono, fontWeight: '800' },
  stepCopy: { flex: 1 },
  stepTitle: { color: colors.textPrimary, fontFamily: fonts.mono, fontSize: 14, fontWeight: '800' },
  stepHint: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  selectionCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14, marginBottom: 20, borderWidth: 1.5, borderColor: colors.success, borderRadius: radii.card, backgroundColor: '#f0fdf4' },
  selectionLabel: { color: colors.success, fontFamily: fonts.mono, fontSize: 10, fontWeight: '800' },
  selectionValue: { color: colors.textPrimary, fontFamily: fonts.mono, fontSize: 20, fontWeight: '800', marginTop: 3 },
  changeButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 10 },
  changeButtonText: { color: colors.accentRed, fontFamily: fonts.mono, fontSize: 11, fontWeight: '800' },
  newBinCard: { padding: 14, marginTop: -8, marginBottom: 20, borderWidth: 1.5, borderColor: '#fed7aa', borderRadius: radii.card, backgroundColor: '#fff7ed' },
  newBinTitle: { color: colors.warning, fontFamily: fonts.mono, fontSize: 13, fontWeight: '800' },
  newBinHint: { color: colors.textSecondary, fontSize: 12, lineHeight: 18, marginTop: 5, marginBottom: 12 },
  productCard: { borderWidth: 1, borderColor: colors.cardBorder, borderRadius: radii.card, backgroundColor: colors.cardBg, padding: 14, marginBottom: 16 },
  productTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 18 },
  productCopy: { flex: 1, minWidth: 0 },
  productImage: { width: 92, height: 92, borderWidth: 1, borderColor: colors.cardBorder, borderRadius: radii.button, backgroundColor: '#fff' },
  productSku: { color: colors.accentRed, fontFamily: fonts.mono, fontSize: 16, fontWeight: '800' },
  productName: { color: colors.textPrimary, fontSize: 14, fontWeight: '700', marginTop: 4 },
  productEan: { color: colors.textMuted, fontFamily: fonts.mono, fontSize: 11, marginTop: 3 },
  pendingBadge: { alignSelf: 'flex-start', color: colors.warning, borderWidth: 1, borderColor: '#fed7aa', backgroundColor: '#fff7ed', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5, fontFamily: fonts.mono, fontSize: 9, fontWeight: '800' },
  knownBadge: { alignSelf: 'flex-start', color: colors.success, borderWidth: 1, borderColor: '#bbf7d0', backgroundColor: '#f0fdf4', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5, fontFamily: fonts.mono, fontSize: 9, fontWeight: '800' },
  quantityLabel: { color: colors.textMuted, fontFamily: fonts.mono, fontSize: 10, fontWeight: '800', marginBottom: 6 },
  quantityRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  quantityButton: { width: 54, minHeight: 52, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.inputBorder, backgroundColor: '#eff6ff' },
  quantityButtonText: { color: colors.accentRed, fontSize: 26 },
  quantityInput: { flex: 1, minHeight: 52, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.inputBorder, color: colors.textPrimary, fontFamily: fonts.mono, fontSize: 21, fontWeight: '800', textAlign: 'center', backgroundColor: '#fff' },
  cancelButton: { marginTop: 8 },
  sessionSection: { marginTop: 4 },
  sessionTitle: { color: colors.textMuted, fontFamily: fonts.mono, fontSize: 10, fontWeight: '800', marginBottom: 8 },
  sessionRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 10, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: colors.cardBorder, borderRadius: radii.card, backgroundColor: '#fff' },
  sessionImage: { width: 52, height: 52, borderWidth: 1, borderColor: colors.cardBorder, borderRadius: radii.button, backgroundColor: '#fff' },
  sessionCopy: { flex: 1, minWidth: 0 },
  sessionSku: { color: colors.textPrimary, fontFamily: fonts.mono, fontSize: 12, fontWeight: '800' },
  sessionName: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  sessionPending: { color: colors.warning, fontSize: 10, fontWeight: '700', marginTop: 3 },
  sessionSyncing: { color: colors.accentRed, fontSize: 10, fontWeight: '700', marginTop: 3 },
  sessionFailed: { color: colors.danger, fontFamily: fonts.mono, fontSize: 10, fontWeight: '800', marginTop: 5 },
  sessionQuantity: { alignItems: 'flex-end' },
  sessionAdded: { color: colors.success, fontFamily: fonts.mono, fontSize: 16, fontWeight: '800' },
  sessionTotal: { color: colors.textMuted, fontSize: 10, marginTop: 2 },
});
