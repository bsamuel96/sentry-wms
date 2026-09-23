import React, { useEffect, useRef, useState } from 'react';
import { Modal, View, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import Text, { TextInput } from './LocalizedText';
import client from '../api/client';
import { colors, radii } from '../theme/styles';

export default function UnknownProductDiscovery({ ean, countId, onDone }) {
  const [stage, setStage] = useState('confirm');
  const [matches, setMatches] = useState([]);
  const [reference, setReference] = useState('');
  const [searchedReference, setSearchedReference] = useState('');
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const generation = useRef(0);
  useEffect(() => () => { generation.current++; }, []);
  async function search(term = '') {
    const id = ++generation.current;
    setStage('matches'); setError(''); setLoading(true); setMatches([]); setSelected(null);
    try {
      const { data } = await client.get(`/api/catalog-discovery/lookup?${new URLSearchParams({ ean, reference: term })}`, { timeout: 60000 });
      if (id === generation.current) { setMatches(data.matches || []); setSearchedReference(term); }
    } catch (err) { if (id === generation.current) setError(err.message); }
    finally { if (id === generation.current) setLoading(false); }
  }
  async function register(match) {
    const id = ++generation.current;
    setLoading(true); setError(''); setStage('registering');
    try {
      const { data } = await client.post('/api/catalog-discovery/register', { ean, reference: searchedReference, articleId: match.id, code: match.code, confirmEquivalent: match.matchType !== 'ean', countId }, { timeout: 120000 });
      if (id === generation.current) onDone(data.item);
    } catch (err) { if (id === generation.current) { setError(err.message); setStage('matches'); } }
    finally { if (id === generation.current) setLoading(false); }
  }
  return <Modal visible transparent animationType="fade" onRequestClose={() => { if (stage !== 'registering') onDone(null); }}>
    <View style={styles.overlay}><View style={styles.card}>
      <Text style={styles.title}>EAN necunoscut</Text><Text style={styles.ean}>{ean}</Text>
      <ScrollView keyboardShouldPersistTaps="handled">
        {stage === 'confirm' ? <>
          <Text style={styles.text}>Adaugi acest produs? Vom căuta în TecDoc după EAN sau referințe înainte de înregistrare.</Text>
          <TouchableOpacity accessibilityRole="button" style={styles.button} onPress={() => search()}><Text style={styles.buttonText}>Da, caută în TecDoc</Text></TouchableOpacity>
        </> : <>
          {loading && <Text accessibilityLiveRegion="polite" style={styles.text}>{stage === 'registering' ? 'Înregistrez produsul în AutoSav și Sentry…' : 'Caut în TecDoc…'}</Text>}
          {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
          {!loading && !error && matches.length === 0 && <Text style={styles.text}>Nu am găsit o potrivire. Caută folosind codul producătorului sau codul OE de pe ambalaj.</Text>}
          <TextInput accessibilityLabel="Cod producător sau OE" style={styles.input} placeholder="Cod producător / OE" value={reference} maxLength={80} editable={!loading} onChangeText={setReference} />
          <TouchableOpacity accessibilityRole="button" disabled={loading} style={styles.button} onPress={() => search(reference.trim())}><Text style={styles.buttonText}>{reference.trim() ? 'Caută corespondențe' : 'Reîncearcă după EAN'}</Text></TouchableOpacity>
          {matches.map(match => <View key={`${match.id}:${match.code}:${match.brand}`} style={styles.match}>
            <Text style={styles.title}>{match.name}</Text><Text>{match.brand} · {match.code}</Text>
            <Text style={styles.text}>{match.matchType === 'ean' ? 'EAN confirmat de TecDoc' : 'Corespondență posibilă — nu confirmă EAN-ul piesei'}</Text>
            {(match.eans || []).length > 0 && <Text>EAN TecDoc: {match.eans.join(', ')}</Text>}
            {(match.references || []).slice(0, 8).map((row, i) => <Text key={i}>{row.type}: {row.manufacturer} {row.code}</Text>)}
            {selected === match ? <>
              <Text style={styles.text}>Confirmi că produsul fizic este {match.brand} {match.code}? EAN-ul scanat {ean} va fi păstrat.</Text>
              <TouchableOpacity accessibilityRole="button" disabled={loading} style={styles.button} onPress={() => register(match)}><Text style={styles.buttonText}>Confirmă produsul și adaugă</Text></TouchableOpacity>
            </> : <TouchableOpacity accessibilityRole="button" disabled={loading} style={styles.button} onPress={() => setSelected(match)}><Text style={styles.buttonText}>Selectează produsul</Text></TouchableOpacity>}
          </View>)}
        </>}
      </ScrollView>
      <TouchableOpacity accessibilityRole="button" disabled={stage === 'registering'} style={styles.cancel} onPress={() => onDone(null)}><Text>Anulează</Text></TouchableOpacity>
    </View></View>
  </Modal>;
}
const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'center', padding: 18 },
  card: { backgroundColor: colors.background, borderRadius: radii.card, padding: 18, maxHeight: '90%' },
  title: { fontSize: 18, fontWeight: '700', marginBottom: 8 }, ean: { fontSize: 16, marginBottom: 10 }, text: { marginVertical: 10, lineHeight: 22 },
  button: { backgroundColor: colors.accentBlue || '#0b63d6', padding: 14, borderRadius: radii.button, marginVertical: 6, minHeight: 46 },
  buttonText: { color: '#fff', textAlign: 'center', fontWeight: '600' }, cancel: { padding: 14, alignItems: 'center' },
  input: { borderWidth: 1, borderColor: '#cbd5e1', padding: 12, borderRadius: radii.button, marginTop: 12 },
  match: { padding: 12, marginTop: 12, borderWidth: 1, borderColor: '#cbd5e1', borderRadius: radii.card }, error: { color: colors.accentRed, marginVertical: 10 },
});
