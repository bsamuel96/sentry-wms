import React, { useState, useEffect, useCallback } from 'react';
import { useFocusEffect, useScrollToTop } from '@react-navigation/native';
import { View, TouchableOpacity, ScrollView, FlatList, Modal, Pressable, StyleSheet } from 'react-native';
import Text, { TextInput } from '../components/LocalizedText';
import ScanInput from '../components/ScanInput';
import ScreenHeader from '../components/ScreenHeader';
import ErrorPopup from '../components/ErrorPopup';
import { BusySkeleton, OrderListSkeleton } from '../components/LoadingSkeleton';
import useScreenError from '../hooks/useScreenError';
import { useAuth } from '../auth/AuthContext';
import client from '../api/client';
import { colors, fonts, radii, screenStyles, buttonStyles, modalStyles } from '../theme/styles';

export default function ShipScreen({ navigation, route }) {
  const { warehouseId } = useAuth();
  const scrollRef = React.useRef(null);
  useScrollToTop(scrollRef);
  const [order, setOrder] = useState(null);
  const [lines, setLines] = useState([]);
  const [totalItems, setTotalItems] = useState(0);
  const [phase, setPhase] = useState('scan_order'); // scan_order | shipping | done
  const [carrier, setCarrier] = useState('');
  const [isCustomCarrier, setIsCustomCarrier] = useState(false);
  const [showCarrierPicker, setShowCarrierPicker] = useState(false);
  const [tracking, setTracking] = useState('');
  const { error, scanDisabled, showError, clearError } = useScreenError();
  const [showSODetail, setShowSODetail] = useState(false);
  const [soDetail, setSODetail] = useState(null);
  const [busyMessage, setBusyMessage] = useState('');
  const [readyOrders, setReadyOrders] = useState([]);
  const [readyOrdersTotal, setReadyOrdersTotal] = useState(0);
  const [readyOrdersLoading, setReadyOrdersLoading] = useState(false);
  const [readyOrdersError, setReadyOrdersError] = useState('');
  const readyOrdersRequestRef = React.useRef(null);

  const CARRIERS = ['UPS', 'FedEx', 'USPS', 'DHL', 'Amazon', 'Other'];

  const loadReadyOrders = useCallback(({ silent = false } = {}) => {
    if (!warehouseId) return Promise.resolve();
    if (readyOrdersRequestRef.current) return readyOrdersRequestRef.current;
    if (!silent) setReadyOrdersLoading(true);
    setReadyOrdersError('');
    const request = client.get(
      `/api/shipping/ready-orders?warehouse_id=${encodeURIComponent(warehouseId)}&limit=500`,
    ).then((resp) => {
      setReadyOrders(resp.data.orders || []);
      setReadyOrdersTotal(resp.data.total || 0);
    }).catch((err) => {
      setReadyOrdersError(err.response?.data?.error || 'Lista comenzilor de expediat nu a putut fi încărcată.');
    }).finally(() => {
      readyOrdersRequestRef.current = null;
      setReadyOrdersLoading(false);
    });
    readyOrdersRequestRef.current = request;
    return request;
  }, [warehouseId]);

  useFocusEffect(
    useCallback(() => {
      if (phase !== 'scan_order') return undefined;
      loadReadyOrders();
      const timer = setInterval(() => loadReadyOrders({ silent: true }), 5000);
      return () => clearInterval(timer);
    }, [phase, loadReadyOrders]),
  );

  // Auto-load SO if navigated from home screen scan
  useEffect(() => {
    const soNumber = route?.params?.so_number;
    if (soNumber) {
      handleScanOrder(soNumber);
    }
  }, []);

  const handleScanOrder = async (barcode) => {
    setBusyMessage('Se deschide comanda...');
    try {
      const resp = await client.get(`/api/shipping/order/${encodeURIComponent(barcode)}`);
      const data = resp.data;
      setOrder(data.sales_order);
      setLines(data.lines || []);
      setTotalItems(data.total_items || 0);
      setPhase('shipping');
    } catch (err) {
      showError(err.response?.data?.error || 'Order not found');
    } finally {
      setBusyMessage('');
    }
  };

  const handleShip = async () => {
    if (!carrier.trim() || !tracking.trim()) {
      showError('Carrier and tracking number are required');
      return;
    }
    setBusyMessage('Se confirmă expedierea...');
    try {
      await client.post('/api/shipping/fulfill', {
        so_id: order.so_id,
        tracking_number: tracking.trim(),
        carrier: carrier.trim(),
        ship_method: order.ship_method || 'GROUND',
      });
      setPhase('done');
    } catch (err) {
      showError(err.response?.data?.error || 'Shipment failed');
    } finally {
      setBusyMessage('');
    }
  };

  const showOrderDetail = async () => {
    if (!order) return;
    try {
      const resp = await client.get(`/api/lookup/so/${encodeURIComponent(order.so_number)}`);
      setSODetail(resp.data.sales_order);
    } catch {
      setSODetail({ so_number: order.so_number, customer_name: order.customer_name });
    }
    setShowSODetail(true);
  };

  const resetScreen = () => {
    setOrder(null);
    setLines([]);
    setTotalItems(0);
    setPhase('scan_order');
    setCarrier('');
    setTracking('');
  };

  if (busyMessage) {
    return <BusySkeleton title={busyMessage} detail="Trimitem confirmarea către Autosav." />;
  }

  return (
    <View style={screenStyles.screen}>
      <ScreenHeader
        title={phase === 'scan_order' ? 'COMENZI DE EXPEDIAT' : 'SHIP'}
        onBack={() => navigation.goBack()}
      />

      {phase === 'scan_order' && (
        <FlatList
          ref={scrollRef}
          style={screenStyles.content}
          data={readyOrders}
          keyExtractor={(entry) => String(entry.so_id)}
          contentContainerStyle={styles.listContent}
          refreshing={readyOrdersLoading}
          onRefresh={loadReadyOrders}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={(
            <>
              <ScanInput placeholder="SCAN ORDER" onScan={handleScanOrder} disabled={scanDisabled} />
              <View style={styles.readyHeader}>
                <View style={styles.readyHeaderCopy}>
                  <Text style={styles.sectionTitle}>COMENZI DE EXPEDIAT</Text>
                  <Text style={styles.sectionHint}>Apasă o comandă sau scanează eticheta ei.</Text>
                </View>
                <View style={styles.totalBadge}>
                  <Text style={styles.totalBadgeText}>{readyOrdersTotal}</Text>
                </View>
              </View>
              {!!readyOrdersError && (
                <TouchableOpacity style={styles.inlineError} onPress={loadReadyOrders}>
                  <Text style={styles.inlineErrorText}>{readyOrdersError}</Text>
                  <Text style={styles.retryText}>APASĂ PENTRU REÎNCERCARE</Text>
                </TouchableOpacity>
              )}
            </>
          )}
          ListEmptyComponent={readyOrdersLoading ? (
            <OrderListSkeleton count={5} />
          ) : !readyOrdersError ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>NU EXISTĂ COMENZI DE EXPEDIAT</Text>
              <Text style={styles.emptyText}>Trage în jos pentru actualizare.</Text>
            </View>
          ) : null}
          renderItem={({ item: entry }) => (
            <TouchableOpacity
              style={styles.readyOrderRow}
              onPress={() => handleScanOrder(entry.so_barcode || entry.so_number)}
              activeOpacity={0.72}
              accessibilityRole="button"
              accessibilityLabel={`Deschide comanda ${entry.so_number} pentru expediere`}
            >
              <View style={styles.orderMain}>
                <Text style={styles.readySoNumber}>{entry.so_number}</Text>
                <Text style={styles.readyCustomer}>{entry.customer_name || 'Client nespecificat'}</Text>
                <Text style={styles.readyMeta}>
                  {entry.line_count} poziții · {entry.unit_count} bucăți
                </Text>
              </View>
              <View style={styles.openBadge}>
                <Text style={styles.openBadgeText}>DESCHIDE</Text>
              </View>
            </TouchableOpacity>
          )}
        />
      )}

      {phase !== 'scan_order' && (
      <ScrollView ref={scrollRef} style={screenStyles.content} contentContainerStyle={screenStyles.contentInner} keyboardShouldPersistTaps="handled">
        {phase === 'shipping' && (
          <>
            <TouchableOpacity style={styles.orderInfo} onPress={showOrderDetail} activeOpacity={0.7}>
              <Text style={styles.soNumber}>{order.so_number}</Text>
              <Text style={styles.customer}>{order.customer_name}</Text>
              <Text style={styles.statusLabel}>
                {order.status === 'PACKED' ? 'PACKED - READY TO SHIP' : 'READY TO SHIP'}
              </Text>
              <Text style={styles.tapHint}>Tap for details</Text>
            </TouchableOpacity>

            {order.memo ? (
              <View style={styles.memoBlock}>
                <Text style={styles.memoLabel}>NOTE</Text>
                <Text style={styles.memoText}>{order.memo}</Text>
              </View>
            ) : null}

            <View style={styles.summaryRow}>
              <View style={styles.summaryItem}>
                <Text style={styles.summaryValue}>{lines.length}</Text>
                <Text style={styles.summaryLabel}>LINES</Text>
              </View>
              <View style={styles.summaryItem}>
                <Text style={styles.summaryValue}>{totalItems}</Text>
                <Text style={styles.summaryLabel}>UNITS</Text>
              </View>
            </View>

            <Text style={styles.fieldLabel}>CARRIER</Text>
            <TouchableOpacity style={styles.pickerBtn} onPress={() => setShowCarrierPicker(true)}>
              <Text style={[styles.pickerText, !carrier && { color: colors.textPlaceholder }]}>
                {carrier || 'Select carrier...'}
              </Text>
              <Text style={{ color: colors.textSecondary }}>&#9662;</Text>
            </TouchableOpacity>
            {isCustomCarrier && (
              <TextInput
                style={styles.textInput}
                value={carrier}
                onChangeText={setCarrier}
                placeholder="Enter carrier name"
                placeholderTextColor={colors.textPlaceholder}
                autoFocus
              />
            )}

            <Text style={styles.fieldLabel}>TRACKING NUMBER</Text>
            <TextInput
              style={styles.textInput}
              value={tracking}
              onChangeText={setTracking}
              placeholder="Enter tracking number"
              placeholderTextColor={colors.textPlaceholder}
              autoCapitalize="characters"
            />

            <TouchableOpacity style={[buttonStyles.buttonPrimary, { marginTop: 16, width: '100%' }]} onPress={handleShip}>
              <Text style={buttonStyles.buttonPrimaryText}>SHIP</Text>
            </TouchableOpacity>
          </>
        )}

        {phase === 'done' && (
          <View style={styles.doneContainer}>
            <Text style={styles.doneIcon}>&#10003;</Text>
            <Text style={styles.doneTitle}>Order {order.so_number} shipped!</Text>
            <Text style={styles.doneDetail}>{carrier} - {tracking}</Text>
            <TouchableOpacity style={[buttonStyles.buttonPrimary, { marginTop: 16, width: '100%' }]} onPress={resetScreen}>
              <Text style={buttonStyles.buttonPrimaryText}>SHIP ANOTHER ORDER</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[buttonStyles.buttonSecondary, { marginTop: 8, width: '100%' }]} onPress={() => navigation.goBack()}>
              <Text style={[buttonStyles.buttonSecondaryText, { fontWeight: '700' }]}>DONE</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
      )}

      <Modal visible={showCarrierPicker} transparent animationType="fade">
        <Pressable style={styles.pickerOverlay} onPress={() => setShowCarrierPicker(false)}>
          <View style={styles.pickerCard}>
            <Text style={styles.pickerTitle}>SELECT CARRIER</Text>
            {CARRIERS.map((c) => (
              <TouchableOpacity
                key={c}
                style={[styles.pickerOption, carrier === c && styles.pickerOptionActive]}
                onPress={() => {
                  if (c === 'Other') {
                    setCarrier('');
                    setIsCustomCarrier(true);
                    setShowCarrierPicker(false);
                  } else {
                    setCarrier(c);
                    setIsCustomCarrier(false);
                    setShowCarrierPicker(false);
                  }
                }}
              >
                <Text style={[styles.pickerOptionText, carrier === c && styles.pickerOptionTextActive]}>{c}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </Pressable>
      </Modal>

      {/* SO Detail Modal */}
      <Modal visible={showSODetail} transparent animationType="fade">
        <Pressable style={modalStyles.overlay} onPress={() => setShowSODetail(false)}>
          <View style={modalStyles.card}>
            <Text style={modalStyles.title}>ORDER DETAILS</Text>
            {soDetail && (
              <ScrollView style={{ maxHeight: 300 }}>
                <View style={styles.detailRow}><Text style={styles.detailLabel}>ORDER</Text><Text style={styles.detailValue}>{soDetail.so_number}</Text></View>
                <View style={styles.detailRow}><Text style={styles.detailLabel}>CUSTOMER</Text><Text style={styles.detailValue}>{soDetail.customer_name || '-'}</Text></View>
                {soDetail.customer_phone && <View style={styles.detailRow}><Text style={styles.detailLabel}>PHONE</Text><Text style={styles.detailValue}>{soDetail.customer_phone}</Text></View>}
                {(soDetail.customer_address || soDetail.ship_address) && <View style={styles.detailRow}><Text style={styles.detailLabel}>ADDRESS</Text><Text style={styles.detailValue}>{soDetail.customer_address || soDetail.ship_address}</Text></View>}
                {soDetail.memo && <View style={styles.detailRow}><Text style={styles.detailLabel}>NOTE</Text><Text style={styles.detailValue}>{soDetail.memo}</Text></View>}
                <View style={styles.detailRow}><Text style={styles.detailLabel}>STATUS</Text><Text style={styles.detailValue}>{soDetail.status}</Text></View>
                {soDetail.lines?.length > 0 && (
                  <View style={{ marginTop: 12 }}>
                    <Text style={styles.detailLabel}>ITEMS</Text>
                    {soDetail.lines.map((l, i) => (
                      <View key={i} style={styles.detailItemRow}>
                        <Text style={styles.detailItemSku}>{l.sku}</Text>
                        <Text style={styles.detailItemQty}>{l.quantity_ordered}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </ScrollView>
            )}
            <TouchableOpacity style={[buttonStyles.buttonSecondary, { marginTop: 16 }]} onPress={() => setShowSODetail(false)}>
              <Text style={buttonStyles.buttonSecondaryText}>CLOSE</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>

      <ErrorPopup
        visible={!!error}
        message={error}
        onDismiss={clearError}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  listContent: { padding: 16, paddingBottom: 24 },
  readyHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 20, marginBottom: 10,
  },
  readyHeaderCopy: { flex: 1, paddingRight: 12 },
  sectionTitle: { fontFamily: fonts.mono, fontSize: 16, fontWeight: '700', color: colors.textPrimary },
  sectionHint: { fontSize: 12, color: colors.textMuted, marginTop: 3 },
  totalBadge: {
    minWidth: 36, height: 36, paddingHorizontal: 8, borderRadius: 18,
    backgroundColor: '#eaf3ff', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.inputBorder,
  },
  totalBadgeText: { fontFamily: fonts.mono, color: colors.accentRed, fontWeight: '700' },
  inlineError: {
    padding: 14, borderRadius: radii.card, borderWidth: 1, borderColor: '#fecaca',
    backgroundColor: '#fff7f7', marginBottom: 10,
  },
  inlineErrorText: { color: colors.danger, fontSize: 13 },
  retryText: { color: colors.accentRed, fontFamily: fonts.mono, fontWeight: '700', fontSize: 11, marginTop: 6 },
  emptyState: {
    padding: 28, alignItems: 'center', borderWidth: 1, borderColor: colors.cardBorder,
    borderRadius: radii.card, backgroundColor: colors.cardBg,
  },
  emptyTitle: { fontFamily: fonts.mono, fontWeight: '700', color: colors.textPrimary, fontSize: 14 },
  emptyText: { color: colors.textMuted, fontSize: 12, marginTop: 6 },
  readyOrderRow: {
    flexDirection: 'row', alignItems: 'center', minHeight: 92, padding: 14,
    backgroundColor: colors.cardBg, borderWidth: 1, borderColor: colors.cardBorder,
    borderRadius: radii.card, marginBottom: 9,
  },
  orderMain: { flex: 1, paddingRight: 10 },
  readySoNumber: { fontFamily: fonts.mono, fontSize: 17, lineHeight: 22, fontWeight: '800', color: colors.accentRed },
  readyCustomer: { fontSize: 14, fontWeight: '600', color: colors.textPrimary, marginTop: 4 },
  readyMeta: { fontSize: 12, color: colors.textMuted, marginTop: 5 },
  openBadge: {
    minHeight: 36, paddingHorizontal: 11, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#eff6ff', borderWidth: 1, borderColor: colors.inputBorder,
  },
  openBadgeText: { fontFamily: fonts.mono, fontSize: 10, fontWeight: '800', color: colors.accentRed },
  orderInfo: { marginBottom: 16 },
  soNumber: { fontFamily: fonts.mono, fontSize: 18, fontWeight: '700', color: colors.textPrimary },
  customer: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  statusLabel: { fontFamily: fonts.mono, fontSize: 12, color: colors.success, letterSpacing: 0.3, marginTop: 4 },
  memoBlock: {
    borderWidth: 1, borderColor: colors.warning, borderRadius: radii.badge,
    padding: 10, marginBottom: 16, backgroundColor: '#fdf6ed',
  },
  memoLabel: {
    fontFamily: fonts.mono, fontSize: 10, fontWeight: '700',
    color: colors.warning, letterSpacing: 0.6, marginBottom: 4,
  },
  memoText: { fontSize: 13, color: colors.textPrimary, lineHeight: 18 },
  summaryRow: {
    flexDirection: 'row', gap: 12, marginBottom: 16,
  },
  summaryItem: {
    flex: 1, borderWidth: 1, borderColor: colors.cardBorder, borderRadius: radii.card,
    backgroundColor: colors.cardBg, padding: 12, alignItems: 'center',
  },
  summaryValue: { fontFamily: fonts.mono, fontSize: 20, fontWeight: '700', color: colors.textPrimary },
  summaryLabel: { fontFamily: fonts.mono, fontSize: 10, color: colors.textMuted, letterSpacing: 0.3, marginTop: 2 },
  fieldLabel: {
    fontFamily: fonts.mono, fontSize: 10, fontWeight: '600', color: colors.textMuted,
    letterSpacing: 0.3, marginBottom: 4, marginTop: 12,
  },
  textInput: {
    borderWidth: 1, borderColor: colors.inputBorder, borderRadius: radii.input,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 14,
    color: colors.textPrimary, backgroundColor: colors.inputBg, minHeight: 48, marginBottom: 8,
  },
  doneContainer: { alignItems: 'center', paddingTop: 40 },
  doneIcon: { fontSize: 48, color: colors.success, marginBottom: 16 },
  doneTitle: { fontFamily: fonts.mono, fontSize: 16, fontWeight: '700', color: colors.textPrimary, marginBottom: 4 },
  doneDetail: { fontFamily: fonts.mono, fontSize: 13, color: colors.textMuted, marginBottom: 24 },
  pickerBtn: {
    borderWidth: 1, borderColor: colors.inputBorder, borderRadius: radii.input,
    paddingHorizontal: 12, paddingVertical: 12, minHeight: 48, marginBottom: 8,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: colors.inputBg,
  },
  pickerText: { fontSize: 14, color: colors.textPrimary, fontFamily: fonts.mono },
  pickerOverlay: {
    flex: 1, backgroundColor: colors.overlay,
    justifyContent: 'center', alignItems: 'center', padding: 32,
  },
  pickerCard: {
    backgroundColor: colors.background, borderRadius: radii.card, padding: 20, width: '100%',
    borderWidth: 1, borderColor: colors.cardBorder,
  },
  pickerTitle: { fontFamily: fonts.mono, fontSize: 12, fontWeight: '700', color: colors.textMuted, letterSpacing: 0.5, marginBottom: 12 },
  pickerOption: {
    padding: 14, borderRadius: radii.card, borderWidth: 1, borderColor: colors.cardBorder, marginBottom: 8,
  },
  pickerOptionActive: { borderColor: colors.accentRed, backgroundColor: '#eaf3ff' },
  pickerOptionText: { fontFamily: fonts.mono, fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  pickerOptionTextActive: { color: colors.accentRed },
  tapHint: { fontFamily: fonts.mono, fontSize: 10, color: colors.textPlaceholder, marginTop: 2 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.cardBorder },
  detailLabel: { fontFamily: fonts.mono, fontSize: 11, fontWeight: '600', color: colors.textMuted, letterSpacing: 0.3 },
  detailValue: { fontFamily: fonts.mono, fontSize: 13, color: colors.textPrimary, textAlign: 'right', flex: 1, marginLeft: 12 },
  detailItemRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, paddingLeft: 8 },
  detailItemSku: { fontFamily: fonts.mono, fontSize: 12, color: colors.textPrimary },
  detailItemQty: { fontFamily: fonts.mono, fontSize: 12, fontWeight: '700', color: colors.accentRed },
});
