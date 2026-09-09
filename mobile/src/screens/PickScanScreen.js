import React, { useCallback, useState } from 'react';
import { View, TouchableOpacity, FlatList, StyleSheet } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import Text from '../components/LocalizedText';
import ScanInput from '../components/ScanInput';
import ErrorPopup from '../components/ErrorPopup';
import UnpickableOrdersModal from '../components/UnpickableOrdersModal';
import useScreenError from '../hooks/useScreenError';
import { useAuth } from '../auth/AuthContext';
import client from '../api/client';
import ScreenHeader from '../components/ScreenHeader';
import { BusySkeleton, OrderListSkeleton } from '../components/LoadingSkeleton';
import { colors, fonts, radii, screenStyles, buttonStyles, listStyles } from '../theme/styles';

export default function PickScanScreen({ navigation }) {
  const { warehouseId, user } = useAuth();
  const [orders, setOrders] = useState([]);
  const [openOrders, setOpenOrders] = useState([]);
  const [openOrdersTotal, setOpenOrdersTotal] = useState(0);
  const [openOrdersLoading, setOpenOrdersLoading] = useState(false);
  const [openOrdersError, setOpenOrdersError] = useState('');
  const { error, scanDisabled, showError, clearError } = useScreenError();
  const [loading, setLoading] = useState(false);
  // Unpickable list returned by the backend's 409 insufficient_coverage
  // response. Non-null while the modal is visible.
  const [unpickable, setUnpickable] = useState(null);

  const loadOpenOrders = useCallback(async () => {
    if (!warehouseId) return;
    setOpenOrdersLoading(true);
    setOpenOrdersError('');
    try {
      const resp = await client.get(
        `/api/picking/open-orders?warehouse_id=${encodeURIComponent(warehouseId)}&limit=500`,
      );
      setOpenOrders(resp.data.orders || []);
      setOpenOrdersTotal(resp.data.total || 0);
    } catch (err) {
      setOpenOrdersError(err.response?.data?.error || 'Lista comenzilor nu a putut fi încărcată.');
    } finally {
      setOpenOrdersLoading(false);
    }
  }, [warehouseId]);

  useFocusEffect(
    useCallback(() => {
      loadOpenOrders();
      const timer = setInterval(loadOpenOrders, 10000);
      return () => clearInterval(timer);
    }, [loadOpenOrders]),
  );

  const handleScan = async (barcode) => {
    // Client-side duplicate check
    if (orders.find((o) => o.so_barcode === barcode || o.so_number === barcode)) {
      showError('Already scanned');
      return;
    }

    try {
      const resp = await client.post('/api/picking/wave-validate', {
        barcode,
        warehouse_id: warehouseId,
      });
      if (!resp.data.valid) return;

      // Transfer orders are pre-provisioned single-shot batches (not
      // wave-stackable with sales orders), so a TO scan jumps straight
      // into PickWalk on the batch admin already started. Mixing types
      // in one wave is not supported -- prompt the picker to drop any
      // scanned SOs first.
      if (resp.data.kind === 'TO') {
        if (orders.length > 0) {
          showError('Drop scanned sales orders before loading a transfer order');
          return;
        }
        navigation.replace('PickWalk', {
          batch_id: resp.data.batch_id,
          batch: resp.data,
        });
        return;
      }

      setOrders((prev) => [...prev, {
        so_id: resp.data.so_id,
        so_number: resp.data.so_number,
        so_barcode: barcode,
        item_count: resp.data.line_count || resp.data.item_count || 0,
        unit_count: resp.data.total_units || resp.data.unit_count || 0,
      }]);
    } catch (err) {
      const data = err.response?.data;
      if (err.response?.status === 409) {
        showError(data?.error || `Order already in batch #${data?.batch_id}`);
      } else if (err.response?.status === 404) {
        showError('Order not found');
      } else {
        showError(data?.error || 'Validation failed');
      }
    }
  };

  const removeOrder = (so_id) => {
    setOrders((prev) => prev.filter((o) => o.so_id !== so_id));
  };

  const handleOrderPress = (order) => {
    if (order.active_batch_id) {
      if (order.active_batch_assigned_to
          && order.active_batch_assigned_to !== user?.username) {
        showError(`Comanda este în colectare la ${order.active_batch_assigned_to}.`);
        return;
      }
      navigation.replace('PickWalk', {
        batch_id: order.active_batch_id,
        batch: {
          batch_id: order.active_batch_id,
          total_orders: 1,
          total_picks: order.line_count || 0,
        },
      });
      return;
    }
    if (orders.some((selected) => selected.so_id === order.so_id)) {
      removeOrder(order.so_id);
      return;
    }
    handleScan(order.so_barcode || order.so_number);
  };

  const submitBatch = async (excludeSoIds = []) => {
    // wave-create does per-order planning work; a large wave can take a
    // while. Give it a generous 60s timeout so it waits for the real response
    // -- the 200, or the 409 shortfall -- instead of the blanket 10s abort
    // that nulled the response and swallowed both around 20 orders. Still
    // bounded, so a genuine hang surfaces as a timeout rather than hanging
    // the handheld.
    const resp = await client.post(
      '/api/picking/wave-create',
      {
        so_ids: orders.map((o) => o.so_id),
        warehouse_id: warehouseId,
        exclude_so_ids: excludeSoIds.length ? excludeSoIds : undefined,
      },
      { timeout: 60000 },
    );
    return resp;
  };

  const handleLoadAll = async () => {
    if (orders.length === 0) return;
    setLoading(true);
    try {
      const resp = await submitBatch();
      navigation.replace('PickWalk', {
        batch_id: resp.data.batch_id,
        batch: resp.data,
      });
    } catch (err) {
      const data = err.response?.data;
      if (err.response?.status === 409 && data?.error_type === 'insufficient_coverage') {
        setUnpickable(data.unpickable || []);
        setLoading(false);
        return;
      }
      if (err.isTimeout) {
        showError('Still building the batch - it is taking longer than expected. Wait a moment and try again, or scan fewer orders.');
        setLoading(false);
        return;
      }
      showError(data?.error || 'Failed to create batch');
      setLoading(false);
    }
  };

  const handleContinueDrop = async () => {
    const excluded = (unpickable || []).map((so) => so.so_id);
    const excludedSet = new Set(excluded);
    setUnpickable(null);
    setLoading(true);
    try {
      const resp = await submitBatch(excluded);
      // Drop the excluded SOs from the local picker list so the user
      // doesn't see them as still-scanned on a back-navigation.
      setOrders((prev) => prev.filter((o) => !excludedSet.has(o.so_id)));
      navigation.replace('PickWalk', {
        batch_id: resp.data.batch_id,
        batch: resp.data,
      });
    } catch (err) {
      const data = err.response?.data;
      if (err.response?.status === 409 && data?.error_type === 'insufficient_coverage') {
        // Another batch took more stock between calls; surface the new list.
        setUnpickable(data.unpickable || []);
        setLoading(false);
        return;
      }
      if (err.isTimeout) {
        showError('Still building the batch - it is taking longer than expected. Wait a moment and try again, or scan fewer orders.');
        setLoading(false);
        return;
      }
      showError(data?.error || 'Failed to create batch');
      setLoading(false);
    }
  };

  const handleCancelDrop = () => {
    setUnpickable(null);
  };

  if (loading) {
    return <BusySkeleton title="Se pregătește traseul de colectare..." detail={`${orders.length} comenzi selectate`} />;
  }

  return (
    <View style={screenStyles.screen}>
      <ScreenHeader
        title="COMENZI DESCHISE"
        onBack={() => navigation.goBack()}
        right={
          orders.length > 0 ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{orders.length}</Text>
            </View>
          ) : undefined
        }
      />

      <View style={screenStyles.content}>
        <FlatList
          data={openOrders}
          keyExtractor={(order) => String(order.so_id)}
          contentContainerStyle={styles.listContent}
          refreshing={openOrdersLoading}
          onRefresh={loadOpenOrders}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={(
            <>
              <ScanInput placeholder="SCAN SO OR TO" onScan={handleScan} disabled={scanDisabled} />

              {orders.length > 0 && (
                <View style={styles.selectedSection}>
                  <Text style={styles.sectionLabel}>SELECTATE PENTRU COLECTARE</Text>
                  {orders.map((order) => (
                    <View key={order.so_id} style={styles.selectedRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.soNumber}>{order.so_number}</Text>
                        <Text style={styles.orderDetail}>
                          {order.item_count} poziții · {order.unit_count} bucăți
                        </Text>
                      </View>
                      <TouchableOpacity
                        style={listStyles.removeBtn}
                        onPress={() => removeOrder(order.so_id)}
                        accessibilityRole="button"
                        accessibilityLabel={`Elimină comanda ${order.so_number} din selecție`}
                      >
                        <Text style={listStyles.removeText}>X</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              )}

              <View style={styles.openOrdersHeader}>
                <View>
                  <Text style={styles.sectionTitle}>COMENZI DESCHISE</Text>
                  <Text style={styles.sectionHint}>Selectează o comandă sau redeschide colectarea începută.</Text>
                </View>
                <View style={styles.totalBadge}>
                  <Text style={styles.totalBadgeText}>{openOrdersTotal}</Text>
                </View>
              </View>

              {!!openOrdersError && (
                <TouchableOpacity style={styles.inlineError} onPress={loadOpenOrders}>
                  <Text style={styles.inlineErrorText}>{openOrdersError}</Text>
                  <Text style={styles.retryText}>APASĂ PENTRU REÎNCERCARE</Text>
                </TouchableOpacity>
              )}
            </>
          )}
          ListEmptyComponent={openOrdersLoading ? (
            <OrderListSkeleton count={5} />
          ) : !openOrdersError ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>NU EXISTĂ COMENZI DESCHISE</Text>
              <Text style={styles.emptyText}>Trage în jos pentru actualizare.</Text>
            </View>
          ) : null}
          renderItem={({ item: order }) => {
            const selected = orders.some((entry) => entry.so_id === order.so_id);
            const busy = Boolean(order.active_batch_id);
            return (
              <TouchableOpacity
                style={[
                  styles.openOrderRow,
                  selected && styles.openOrderRowSelected,
                  busy && styles.openOrderRowBusy,
                ]}
                onPress={() => handleOrderPress(order)}
                activeOpacity={0.72}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={`${order.so_number}, ${order.line_count} poziții, ${order.unit_count} bucăți`}
              >
                <View style={styles.orderMain}>
                  <Text style={styles.openSoNumber}>{order.so_number}</Text>
                  <Text style={styles.customerName}>{order.customer_name || 'Client nespecificat'}</Text>
                  <Text style={styles.orderMeta}>
                    {order.line_count} poziții · {order.unit_count} bucăți
                  </Text>
                </View>
                <View style={styles.orderAction}>
                  <View style={[
                    styles.orderStateBadge,
                    selected && styles.orderStateBadgeSelected,
                    busy && styles.orderStateBadgeBusy,
                  ]}>
                    <Text style={[
                      styles.orderStateText,
                      selected && styles.orderStateTextSelected,
                      busy && styles.orderStateTextBusy,
                    ]}>
                      {busy ? 'REDESCHIDE' : selected ? 'SELECTATĂ' : 'SELECTEAZĂ'}
                    </Text>
                  </View>
                  {busy && (
                    <Text style={styles.batchText}>Lot #{order.active_batch_id}</Text>
                  )}
                </View>
              </TouchableOpacity>
            );
          }}
        />

        <View style={screenStyles.bottomBar}>
          <TouchableOpacity
            style={[buttonStyles.buttonPrimary, { flex: 1 }, orders.length === 0 && buttonStyles.buttonDisabled]}
            onPress={handleLoadAll}
            disabled={orders.length === 0}
          >
            <Text style={buttonStyles.buttonPrimaryText}>
              {orders.length ? `ÎNCEPE COLECTAREA (${orders.length})` : 'ALEGE O COMANDĂ'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <ErrorPopup
        visible={!!error}
        message={error}
        onDismiss={clearError}
      />

      <UnpickableOrdersModal
        visible={!!unpickable}
        unpickable={unpickable}
        onCancel={handleCancelDrop}
        onContinue={handleContinueDrop}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  listContent: { padding: 16, paddingBottom: 8 },
  badge: {
    backgroundColor: colors.accentRed, borderRadius: 10,
    paddingHorizontal: 8, paddingVertical: 2, minWidth: 24, alignItems: 'center',
  },
  badgeText: { color: '#FFFFFF', fontFamily: fonts.mono, fontSize: 12, fontWeight: '700' },
  soNumber: { fontFamily: fonts.mono, fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  orderDetail: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  selectedSection: { marginTop: 14 },
  sectionLabel: {
    fontFamily: fonts.mono, fontSize: 11, fontWeight: '700', color: colors.textMuted,
    letterSpacing: 0.5, marginBottom: 8,
  },
  selectedRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#eaf3ff',
    borderWidth: 1.5, borderColor: colors.accentRed, borderRadius: radii.card,
    paddingLeft: 14, marginBottom: 8, minHeight: 64,
  },
  openOrdersHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 20, marginBottom: 10,
  },
  sectionTitle: {
    fontFamily: fonts.mono, fontSize: 16, fontWeight: '700', color: colors.textPrimary,
  },
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
  openOrderRow: {
    flexDirection: 'row', alignItems: 'center', minHeight: 92, padding: 14,
    backgroundColor: colors.cardBg, borderWidth: 1, borderColor: colors.cardBorder,
    borderRadius: radii.card, marginBottom: 9,
  },
  openOrderRowSelected: { backgroundColor: '#eaf3ff', borderWidth: 2, borderColor: colors.accentRed },
  openOrderRowBusy: { backgroundColor: '#f8fafc' },
  orderMain: { flex: 1, paddingRight: 10 },
  openSoNumber: {
    fontFamily: fonts.mono, fontSize: 17, lineHeight: 22, fontWeight: '800', color: colors.accentRed,
  },
  customerName: { fontSize: 14, fontWeight: '600', color: colors.textPrimary, marginTop: 4 },
  orderMeta: { fontSize: 12, color: colors.textMuted, marginTop: 5 },
  orderAction: { alignItems: 'flex-end', maxWidth: 118 },
  orderStateBadge: {
    minHeight: 36, paddingHorizontal: 11, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#eff6ff', borderWidth: 1, borderColor: colors.inputBorder,
  },
  orderStateBadgeSelected: { backgroundColor: colors.accentRed, borderColor: colors.accentRed },
  orderStateBadgeBusy: { backgroundColor: '#fff7ed', borderColor: '#fed7aa' },
  orderStateText: { fontFamily: fonts.mono, fontSize: 10, fontWeight: '800', color: colors.accentRed },
  orderStateTextSelected: { color: '#ffffff' },
  orderStateTextBusy: { color: colors.warning },
  batchText: { fontSize: 10, color: colors.textMuted, marginTop: 5 },
});
