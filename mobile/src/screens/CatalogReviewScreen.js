import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, ScrollView, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import Text, { TextInput } from '../components/LocalizedText';
import ScreenHeader from '../components/ScreenHeader';
import client from '../api/client';
import { screenStyles } from '../theme/styles';
import { CATALOG_TIMEOUT, matchPendingCatalog } from '../utils/catalogReview';
import { CatalogButton, catalogStyles as styles } from '../components/CatalogForm';

export default function CatalogReviewScreen({ navigation }) {
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState({ total: 0, pages: 1 });
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('PENDING');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [progress, setProgress] = useState(null);
  const stop = useRef(false);
  const busy = useRef(false);
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    try {
      const query = `page=${page}&per_page=25&status=${status}&q=${encodeURIComponent(search.trim())}`;
      const { data } = await client.get(`/api/catalog-discovery/queue?${query}`);
      if (id !== requestId.current) return;
      if (page > data.pages) { setPage(data.pages); return; }
      setRows(data.discoveries || []);
      setPagination(data);
    } catch (err) {
      if (id === requestId.current) setError(err.message);
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [page, status, search]);

  useFocusEffect(useCallback(() => {
    const timer = setTimeout(load, 250);
    return () => { clearTimeout(timer); requestId.current += 1; };
  }, [load]));

  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active' && busy.current) { stop.current = true; setStopping(true); }
    });
    return () => { stop.current = true; subscription.remove(); };
  }, []);

  async function bulkMatch() {
    if (busy.current) return;
    busy.current = true;
    stop.current = false;
    setRunning(true); setStopping(false); setProgress(null); setError('');
    try {
      const result = await matchPendingCatalog({
        getIds: async () => (await client.get('/api/catalog-discovery/queue/pending-ids')).data.discovery_ids,
        matchBatch: async ids => (await client.post('/api/catalog-discovery/queue/bulk-match', { discovery_ids: ids }, { timeout: CATALOG_TIMEOUT })).data,
        onProgress: setProgress,
        shouldStop: () => stop.current,
      });
      setProgress(result);
    } catch (err) {
      setError(`${err.message} Echivalarea s-a oprit. Rezultatele deja salvate rămân; reîncearcă pentru produsele încă în așteptare.`);
    } finally {
      busy.current = false; setRunning(false); await load();
    }
  }

  return (
    <View style={screenStyles.screen}>
      <ScreenHeader title="Produse de verificat" onBack={() => { stop.current = true; navigation.goBack(); }} />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <Text style={styles.help}>Produsele fără o identitate TecDoc rămân aici până le echivalezi sau completezi detaliile manual.</Text>
        <View style={styles.card}>
          <CatalogButton title={running ? 'Se echivalează…' : 'Echivalează toate în TecDoc'} disabled={running} onPress={bulkMatch} />
          <Text style={styles.help}>Include toate produsele în așteptare, din toate paginile, indiferent de căutare. Se salvează automat doar o potrivire unică după EAN. Ține ecranul deschis.</Text>
          {progress && <View accessibilityLiveRegion="polite" style={styles.stack}>
            <Text style={styles.title}>{progress.processed} / {progress.total} verificate{progress.stopped ? ' · Oprit' : !running && progress.processed === progress.total ? ' · Finalizat' : ''}</Text>
            <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: progress.total || 1, now: progress.processed }} style={styles.track}>
              <View style={[styles.fill, { width: `${progress.total ? 100 * progress.processed / progress.total : 0}%` }]} />
            </View>
            <Text>{progress.matched} echivalate · {progress.not_found} fără potrivire · {progress.ambiguous} necesită alegere · {progress.skipped} omise · {progress.failed} erori</Text>
          </View>}
          {running && <CatalogButton secondary title={stopping ? 'Se oprește după lotul curent…' : 'Oprește după lotul curent'} disabled={stopping} onPress={() => { stop.current = true; setStopping(true); }} />}
        </View>
        <View style={styles.row}>
          <CatalogButton secondary={status !== 'PENDING'} title="De verificat" disabled={running} onPress={() => { setStatus('PENDING'); setPage(1); }} />
          <CatalogButton secondary={status !== 'MANUAL'} title="Completate manual" disabled={running} onPress={() => { setStatus('MANUAL'); setPage(1); }} />
        </View>
        <TextInput style={styles.input} accessibilityLabel="Caută produs" placeholder="EAN, SKU sau denumire" value={search} editable={!running} onChangeText={value => { setSearch(value); setPage(1); }} />
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        <CatalogButton secondary title="Reîncarcă lista" disabled={loading || running} onPress={() => { setError(''); load(); }} />
        <Text>{pagination.total} produse · Pagina {page} / {pagination.pages}</Text>
        {loading ? <ActivityIndicator /> : rows.length === 0 ? <Text style={styles.help}>Niciun produs în această listă.</Text> : rows.map(row => (
          <View key={row.discovery_id} style={styles.card}>
            <Text style={styles.title}>{row.item_name}</Text>
            <Text>EAN: {row.ean} · SKU: {row.sku}</Text>
            <Text style={styles.help}>Stoc: {row.quantity_on_hand} · {(row.locations || []).map(location => `${location.bin_code}: ${location.quantity}`).join(', ') || 'Fără locație'}</Text>
            <CatalogButton secondary title={row.status === 'MANUAL' ? 'Editează detaliile' : 'Verifică / completează detalii'} disabled={running} onPress={() => navigation.navigate('CatalogDetails', { discovery: row })} />
          </View>
        ))}
        <View style={styles.row}>
          <CatalogButton secondary title="Înapoi" disabled={page <= 1 || loading || running} onPress={() => setPage(value => value - 1)} />
          <CatalogButton secondary title="Înainte" disabled={page >= pagination.pages || loading || running} onPress={() => setPage(value => value + 1)} />
        </View>
      </ScrollView>
    </View>
  );
}
