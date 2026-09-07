import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import Text, { TextInput } from '../components/LocalizedText';
import { useScrollToTop } from '@react-navigation/native';
import { useAuth } from '../auth/AuthContext';
import client from '../api/client';
import ErrorPopup from '../components/ErrorPopup';
import ScanInput from '../components/ScanInput';
import ScreenHeader from '../components/ScreenHeader';
import useScreenError from '../hooks/useScreenError';
import { buttonStyles, colors, fonts, radii, screenStyles } from '../theme/styles';
import {
  buildCheckoutPayload,
  checkoutErrorMessage,
  checkoutTotals,
  createUuidV4,
  formatMoney,
  locationsForWarehouse,
  upsertCartLine,
} from '../utils/pos';

const EMPTY_CARD = { brand: '', last4: '', authCode: '', externalRef: '' };

export default function PosScreen({ navigation, route }) {
  const { user } = useAuth();
  const warehouseCode = route?.params?.warehouseCode || '';
  const warehouseName = route?.params?.warehouseName || warehouseCode;
  const scrollRef = useRef(null);
  const pendingPayloadRef = useRef(null);
  useScrollToTop(scrollRef);

  const [cart, setCart] = useState([]);
  const [locationChoice, setLocationChoice] = useState(null);
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [cashTendered, setCashTendered] = useState('');
  const [card, setCard] = useState(EMPTY_CARD);
  const [customer, setCustomer] = useState({ name: '', phone: '' });
  const [memo, setMemo] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [completedOrder, setCompletedOrder] = useState(null);
  const { error, scanDisabled, showError, clearError } = useScreenError();

  const totals = useMemo(() => checkoutTotals(cart), [cart]);

  const invalidateCheckout = useCallback(() => {
    pendingPayloadRef.current = null;
  }, []);

  const updateCart = useCallback((updater) => {
    invalidateCheckout();
    setCart((current) => updater(current));
  }, [invalidateCheckout]);

  const addAtLocation = useCallback((item, location) => {
    updateCart((current) => upsertCartLine(current, item, location));
    setLocationChoice(null);
  }, [updateCart]);

  const findItem = useCallback(async (code) => {
    const encoded = encodeURIComponent(code);
    try {
      return await client.get(`/api/v1/pos/availability?barcode=${encoded}`);
    } catch (barcodeError) {
      if (barcodeError?.response?.status !== 404) throw barcodeError;
      return client.get(`/api/v1/pos/availability?sku=${encoded}`);
    }
  }, []);

  const handleScan = useCallback(async (rawCode) => {
    const code = String(rawCode || '').replace(/[\r\n\s]+/g, '').trim();
    if (!code) return;
    try {
      const response = await findItem(code);
      const item = response.data;
      const locations = locationsForWarehouse(item.availability, warehouseCode);
      if (!locations.length) {
        showError(warehouseCode
          ? `Produsul ${item.sku} nu are stoc disponibil în depozitul ${warehouseName || warehouseCode}.`
          : `Produsul ${item.sku} nu are stoc disponibil.`);
        return;
      }
      if (locations.length === 1) {
        addAtLocation(item, locations[0]);
        return;
      }
      setLocationChoice({ item, locations });
    } catch (scanError) {
      if (scanError?.response?.status === 404) {
        showError('Produsul scanat nu există sau nu este disponibil în depozitele tale.');
        return;
      }
      showError(checkoutErrorMessage(scanError));
    }
  }, [addAtLocation, findItem, showError, warehouseCode, warehouseName]);

  const patchLine = useCallback((index, patch) => {
    updateCart((current) => current.map((line, lineIndex) => (
      lineIndex === index ? { ...line, ...patch } : line
    )));
  }, [updateCart]);

  const removeLine = useCallback((index) => {
    updateCart((current) => current.filter((_, lineIndex) => lineIndex !== index));
  }, [updateCart]);

  const patchCard = useCallback((patch) => {
    invalidateCheckout();
    setCard((current) => ({ ...current, ...patch }));
  }, [invalidateCheckout]);

  const resetSale = useCallback(() => {
    pendingPayloadRef.current = null;
    setCart([]);
    setPaymentMethod('cash');
    setCashTendered('');
    setCard(EMPTY_CARD);
    setCustomer({ name: '', phone: '' });
    setMemo('');
    setCompletedOrder(null);
  }, []);

  const completeSale = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      let payload = pendingPayloadRef.current;
      if (!payload) {
        payload = buildCheckoutPayload({
          cart,
          paymentMethod,
          cashTendered,
          card,
          cashierId: user?.username || String(user?.user_id || 'mobile'),
          terminalId: `mobil-${user?.user_id || user?.username || 'sentry'}`,
          customer,
          memo,
          idempotencyKey: createUuidV4(),
          completedAt: new Date().toISOString(),
        });
        pendingPayloadRef.current = payload;
      }

      const validationLines = cart.map((line) => ({
        sku: line.sku,
        warehouse_id: line.warehouseId,
        bin_id: line.binId,
        quantity: Number(line.quantity),
      }));
      await client.post('/api/v1/pos/validate-cart', { lines: validationLines });

      const response = await client.post('/api/v1/pos/checkout', payload, { timeout: 30000 });
      pendingPayloadRef.current = null;
      setCompletedOrder(response.data?.so_number || response.data?.so_id || 'POS');
    } catch (checkoutError) {
      showError(checkoutErrorMessage(checkoutError));
    } finally {
      setSubmitting(false);
    }
  }, [card, cart, cashTendered, customer, memo, paymentMethod, showError, submitting, user]);

  if (completedOrder) {
    return (
      <View style={screenStyles.screen}>
        <ScreenHeader title="CASĂ / POS" onBack={() => navigation.goBack()} />
        <View style={styles.successPage}>
          <Text style={styles.successMark}>✓</Text>
          <Text style={styles.successTitle}>VÂNZARE FINALIZATĂ</Text>
          <Text style={styles.successOrder}>{completedOrder}</Text>
          <Text style={styles.successText}>Stocul a fost descărcat și vânzarea a fost înregistrată.</Text>
          <TouchableOpacity style={[buttonStyles.buttonPrimary, styles.fullButton]} onPress={resetSale}>
            <Text style={buttonStyles.buttonPrimaryText}>VÂNZARE NOUĂ</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[buttonStyles.buttonSecondary, styles.fullButton]} onPress={() => navigation.navigate('Home')}>
            <Text style={buttonStyles.buttonSecondaryText}>ÎNAPOI LA MENIU</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={screenStyles.screen}>
      <ScreenHeader
        title="CASĂ / POS"
        onBack={() => navigation.goBack()}
        right={<Text style={styles.headerTotal}>{formatMoney(totals.totalCents)}</Text>}
      />

      <ScrollView
        ref={scrollRef}
        style={screenStyles.content}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.sectionLabel}>SCANARE PRODUSE</Text>
        <ScanInput
          placeholder="SCANEAZĂ CODUL PRODUSULUI"
          onScan={handleScan}
          disabled={scanDisabled || submitting}
        />
        <Text style={styles.warehouseText}>Depozit: {warehouseName || warehouseCode || 'depozitul atribuit'}</Text>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionLabel}>COȘ</Text>
          <Text style={styles.sectionCount}>{cart.length} poziții</Text>
        </View>

        {cart.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>Coșul este gol</Text>
            <Text style={styles.emptyText}>Scanează un cod de bare sau introdu manual codul produsului.</Text>
          </View>
        ) : cart.map((line, index) => (
          <View key={`${line.sku}-${line.warehouseId}-${line.binId}`} style={styles.lineCard}>
            <View style={styles.lineTop}>
              <View style={styles.lineIdentity}>
                <Text style={styles.lineSku}>{line.sku}</Text>
                <Text style={styles.lineName}>{line.name}</Text>
                <Text style={styles.lineLocation}>{line.warehouseName} · {line.binName} · stoc {line.available}</Text>
              </View>
              <TouchableOpacity style={styles.removeButton} onPress={() => removeLine(index)} accessibilityLabel={`Elimină ${line.sku}`}>
                <Text style={styles.removeText}>×</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.lineControls}>
              <View>
                <Text style={styles.inputLabel}>CANTITATE</Text>
                <View style={styles.quantityControl}>
                  <TouchableOpacity
                    style={styles.quantityButton}
                    onPress={() => patchLine(index, { quantity: Math.max(1, Number(line.quantity || 1) - 1) })}
                  >
                    <Text style={styles.quantityButtonText}>−</Text>
                  </TouchableOpacity>
                  <TextInput
                    style={styles.quantityInput}
                    value={String(line.quantity)}
                    onChangeText={(value) => {
                      const parsed = Number.parseInt(value.replace(/\D/g, ''), 10);
                      patchLine(index, { quantity: Number.isFinite(parsed) ? Math.min(line.available, parsed) : 1 });
                    }}
                    keyboardType="number-pad"
                    selectTextOnFocus
                  />
                  <TouchableOpacity
                    style={styles.quantityButton}
                    onPress={() => patchLine(index, { quantity: Math.min(line.available, Number(line.quantity || 0) + 1) })}
                  >
                    <Text style={styles.quantityButtonText}>+</Text>
                  </TouchableOpacity>
                </View>
              </View>
              <View style={styles.priceControl}>
                <Text style={styles.inputLabel}>PREȚ FINAL / BUC. (TVA INCLUS)</Text>
                <TextInput
                  style={styles.priceInput}
                  value={line.price}
                  onChangeText={(value) => patchLine(index, { price: value.replace(/[^0-9.,]/g, '') })}
                  placeholder="0,00"
                  placeholderTextColor={colors.textPlaceholder}
                  keyboardType="decimal-pad"
                  selectTextOnFocus
                />
              </View>
            </View>
          </View>
        ))}

        {cart.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>CLIENT OPȚIONAL</Text>
            <View style={styles.formCard}>
              <TextInput
                style={styles.formInput}
                value={customer.name}
                onChangeText={(value) => { invalidateCheckout(); setCustomer((current) => ({ ...current, name: value })); }}
                placeholder="Nume client"
                placeholderTextColor={colors.textPlaceholder}
              />
              <TextInput
                style={styles.formInput}
                value={customer.phone}
                onChangeText={(value) => { invalidateCheckout(); setCustomer((current) => ({ ...current, phone: value })); }}
                placeholder="Telefon"
                placeholderTextColor={colors.textPlaceholder}
                keyboardType="phone-pad"
              />
              <TextInput
                style={[styles.formInput, styles.memoInput]}
                value={memo}
                onChangeText={(value) => { invalidateCheckout(); setMemo(value); }}
                placeholder="Observații pentru vânzare"
                placeholderTextColor={colors.textPlaceholder}
                multiline
              />
            </View>

            <Text style={styles.sectionLabel}>PLATĂ</Text>
            <View style={styles.paymentTabs}>
              {[
                ['cash', 'NUMERAR'],
                ['card', 'CARD'],
              ].map(([method, label]) => (
                <TouchableOpacity
                  key={method}
                  style={[styles.paymentTab, paymentMethod === method && styles.paymentTabActive]}
                  onPress={() => { invalidateCheckout(); setPaymentMethod(method); }}
                >
                  <Text style={[styles.paymentTabText, paymentMethod === method && styles.paymentTabTextActive]}>{label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {paymentMethod === 'cash' ? (
              <View style={styles.formCard}>
                <Text style={styles.inputLabel}>SUMĂ PRIMITĂ</Text>
                <View style={styles.cashRow}>
                  <TextInput
                    style={[styles.formInput, styles.cashInput]}
                    value={cashTendered}
                    onChangeText={(value) => { invalidateCheckout(); setCashTendered(value.replace(/[^0-9.,]/g, '')); }}
                    placeholder="0,00"
                    placeholderTextColor={colors.textPlaceholder}
                    keyboardType="decimal-pad"
                  />
                  <TouchableOpacity
                    style={styles.exactButton}
                    onPress={() => { invalidateCheckout(); setCashTendered((totals.totalCents / 100).toFixed(2)); }}
                  >
                    <Text style={styles.exactButtonText}>SUMĂ EXACTĂ</Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.changeText}>
                  Rest: {formatMoney(Math.max(0, Math.round(Number(String(cashTendered).replace(',', '.')) * 100 || 0) - totals.totalCents))}
                </Text>
              </View>
            ) : (
              <View style={styles.formCard}>
                <Text style={styles.cardNotice}>Sentry nu procesează plata. Completează datele confirmate de terminalul bancar.</Text>
                <TextInput style={styles.formInput} value={card.brand} onChangeText={(value) => patchCard({ brand: value })} placeholder="Marcă (Visa, Mastercard)" placeholderTextColor={colors.textPlaceholder} />
                <TextInput style={styles.formInput} value={card.last4} onChangeText={(value) => patchCard({ last4: value.replace(/\D/g, '').slice(0, 4) })} placeholder="Ultimele 4 cifre" placeholderTextColor={colors.textPlaceholder} keyboardType="number-pad" maxLength={4} />
                <TextInput style={styles.formInput} value={card.authCode} onChangeText={(value) => patchCard({ authCode: value })} placeholder="Cod autorizare" placeholderTextColor={colors.textPlaceholder} autoCapitalize="characters" />
                <TextInput style={styles.formInput} value={card.externalRef} onChangeText={(value) => patchCard({ externalRef: value })} placeholder="Referință tranzacție" placeholderTextColor={colors.textPlaceholder} autoCapitalize="characters" />
              </View>
            )}

            <View style={styles.totalCard}>
              <View style={styles.totalRow}><Text style={styles.totalLabel}>Subtotal fără TVA</Text><Text style={styles.totalValue}>{formatMoney(totals.subtotalCents)}</Text></View>
              <View style={styles.totalRow}><Text style={styles.totalLabel}>TVA inclus (21%)</Text><Text style={styles.totalValue}>{formatMoney(totals.taxCents)}</Text></View>
              <View style={[styles.totalRow, styles.grandTotalRow]}><Text style={styles.grandTotalLabel}>TOTAL</Text><Text style={styles.grandTotalValue}>{formatMoney(totals.totalCents)}</Text></View>
            </View>

            <TouchableOpacity
              style={[buttonStyles.buttonPrimary, submitting && buttonStyles.buttonDisabled]}
              onPress={completeSale}
              disabled={submitting}
            >
              {submitting
                ? <ActivityIndicator color={colors.cream} />
                : <Text style={buttonStyles.buttonPrimaryText}>VALIDEAZĂ ȘI FINALIZEAZĂ</Text>}
            </TouchableOpacity>
            <Text style={styles.finalHint}>Finalizarea descarcă imediat stocul din locațiile selectate.</Text>
          </>
        )}
      </ScrollView>

      <Modal visible={Boolean(locationChoice)} transparent animationType="fade">
        <Pressable style={styles.modalOverlay} onPress={() => setLocationChoice(null)}>
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <Text style={styles.modalTitle}>ALEGE LOCAȚIA</Text>
            <Text style={styles.modalSubtitle}>{locationChoice?.item?.sku} · {locationChoice?.item?.name}</Text>
            <ScrollView style={styles.locationList}>
              {(locationChoice?.locations || []).map((location) => (
                <TouchableOpacity
                  key={`${location.warehouseId}-${location.binId}`}
                  style={styles.locationRow}
                  onPress={() => addAtLocation(locationChoice.item, location)}
                >
                  <View>
                    <Text style={styles.locationBin}>{location.binName}</Text>
                    <Text style={styles.locationWarehouse}>{location.warehouseName}</Text>
                  </View>
                  <Text style={styles.locationStock}>{location.available} buc.</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity style={buttonStyles.buttonSecondary} onPress={() => setLocationChoice(null)}>
              <Text style={buttonStyles.buttonSecondaryText}>ANULEAZĂ</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      <ErrorPopup visible={Boolean(error)} message={error} onDismiss={clearError} />
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 48 },
  headerTotal: { fontFamily: fonts.mono, fontSize: 13, fontWeight: '800', color: colors.accentRed },
  sectionLabel: { fontFamily: fonts.mono, fontSize: 10, fontWeight: '800', color: colors.textMuted, letterSpacing: 1.1, marginBottom: 8, marginTop: 8 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 },
  sectionCount: { fontSize: 12, color: colors.textMuted },
  warehouseText: { color: colors.textMuted, fontSize: 12, marginTop: -8, marginBottom: 8 },
  emptyCard: { backgroundColor: colors.cardBg, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.cardBorder, borderRadius: radii.card, padding: 24, alignItems: 'center', marginBottom: 16 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: colors.textPrimary },
  emptyText: { fontSize: 13, color: colors.textMuted, textAlign: 'center', marginTop: 6, lineHeight: 19 },
  lineCard: { backgroundColor: colors.cardBg, borderWidth: 1, borderColor: colors.cardBorder, borderRadius: radii.card, padding: 14, marginBottom: 10 },
  lineTop: { flexDirection: 'row', alignItems: 'flex-start' },
  lineIdentity: { flex: 1 },
  lineSku: { fontFamily: fonts.mono, fontSize: 15, fontWeight: '800', color: colors.accentRed },
  lineName: { fontSize: 14, fontWeight: '700', color: colors.textPrimary, marginTop: 3 },
  lineLocation: { fontSize: 11, color: colors.textMuted, marginTop: 4 },
  removeButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginTop: -8, marginRight: -8 },
  removeText: { fontSize: 26, color: colors.danger },
  lineControls: { flexDirection: 'row', gap: 12, marginTop: 12, alignItems: 'flex-end' },
  inputLabel: { fontFamily: fonts.mono, fontSize: 9, fontWeight: '700', color: colors.textMuted, marginBottom: 5 },
  quantityControl: { flexDirection: 'row', alignItems: 'center' },
  quantityButton: { width: 42, height: 46, borderWidth: 1, borderColor: colors.inputBorder, alignItems: 'center', justifyContent: 'center', backgroundColor: '#edf5ff' },
  quantityButtonText: { fontSize: 22, fontWeight: '700', color: colors.accentRed },
  quantityInput: { width: 50, height: 46, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.inputBorder, backgroundColor: colors.inputBg, textAlign: 'center', fontSize: 16, fontWeight: '800', color: colors.textPrimary },
  priceControl: { flex: 1 },
  priceInput: { minHeight: 46, borderWidth: 1, borderColor: colors.inputBorder, borderRadius: radii.input, backgroundColor: colors.inputBg, paddingHorizontal: 12, textAlign: 'right', fontSize: 17, fontWeight: '800', color: colors.accentRed },
  formCard: { backgroundColor: colors.cardBg, borderWidth: 1, borderColor: colors.cardBorder, borderRadius: radii.card, padding: 12, gap: 8, marginBottom: 16 },
  formInput: { minHeight: 48, borderWidth: 1, borderColor: colors.inputBorder, borderRadius: radii.input, backgroundColor: colors.inputBg, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: colors.textPrimary },
  memoInput: { minHeight: 76, textAlignVertical: 'top' },
  paymentTabs: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  paymentTab: { flex: 1, minHeight: 48, borderWidth: 1.5, borderColor: colors.cardBorder, borderRadius: radii.button, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.cardBg },
  paymentTabActive: { borderColor: colors.accentRed, backgroundColor: '#eaf3ff' },
  paymentTabText: { fontFamily: fonts.mono, fontSize: 13, fontWeight: '700', color: colors.textMuted },
  paymentTabTextActive: { color: colors.accentRed },
  cashRow: { flexDirection: 'row', gap: 8 },
  cashInput: { flex: 1, fontSize: 18, fontWeight: '800' },
  exactButton: { minWidth: 116, minHeight: 48, paddingHorizontal: 10, borderRadius: radii.button, backgroundColor: '#eaf3ff', borderWidth: 1, borderColor: colors.inputBorder, alignItems: 'center', justifyContent: 'center' },
  exactButtonText: { fontFamily: fonts.mono, fontSize: 10, fontWeight: '800', color: colors.accentRed },
  changeText: { fontSize: 13, fontWeight: '700', color: colors.success, textAlign: 'right' },
  cardNotice: { fontSize: 12, color: colors.warning, lineHeight: 18, marginBottom: 2 },
  totalCard: { backgroundColor: '#eaf3ff', borderWidth: 1, borderColor: colors.inputBorder, borderRadius: radii.card, padding: 14, marginBottom: 12 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  totalLabel: { fontSize: 13, color: colors.textSecondary },
  totalValue: { fontFamily: fonts.mono, fontSize: 13, color: colors.textPrimary },
  grandTotalRow: { borderTopWidth: 1, borderTopColor: colors.inputBorder, marginTop: 6, paddingTop: 10 },
  grandTotalLabel: { fontFamily: fonts.mono, fontSize: 15, fontWeight: '900', color: colors.textPrimary },
  grandTotalValue: { fontFamily: fonts.mono, fontSize: 18, fontWeight: '900', color: colors.accentRed },
  finalHint: { fontSize: 11, color: colors.textMuted, textAlign: 'center', marginTop: 8 },
  modalOverlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'center', padding: 24 },
  modalCard: { backgroundColor: colors.background, borderRadius: radii.card, borderWidth: 1, borderColor: colors.cardBorder, padding: 18, maxHeight: '75%' },
  modalTitle: { fontFamily: fonts.mono, fontSize: 15, fontWeight: '800', color: colors.textPrimary },
  modalSubtitle: { fontSize: 12, color: colors.textMuted, marginTop: 4, marginBottom: 12 },
  locationList: { marginBottom: 10 },
  locationRow: { minHeight: 58, padding: 12, borderWidth: 1, borderColor: colors.cardBorder, borderRadius: radii.small, backgroundColor: colors.cardBg, marginBottom: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  locationBin: { fontFamily: fonts.mono, fontSize: 14, fontWeight: '800', color: colors.accentRed },
  locationWarehouse: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  locationStock: { fontFamily: fonts.mono, fontSize: 13, fontWeight: '800', color: colors.success },
  successPage: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
  successMark: { fontSize: 68, color: colors.success, marginBottom: 12 },
  successTitle: { fontFamily: fonts.mono, fontSize: 21, fontWeight: '900', color: colors.textPrimary, textAlign: 'center' },
  successOrder: { fontFamily: fonts.mono, fontSize: 18, fontWeight: '800', color: colors.accentRed, marginTop: 8 },
  successText: { fontSize: 14, color: colors.textMuted, textAlign: 'center', marginTop: 10, marginBottom: 24, lineHeight: 20 },
  fullButton: { width: '100%', marginBottom: 10 },
});
