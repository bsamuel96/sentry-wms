import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import Text from '../components/LocalizedText';
import ScreenHeader from '../components/ScreenHeader';
import ScanInput from '../components/ScanInput';
import { CatalogButton, CatalogField, catalogStyles as styles } from '../components/CatalogForm';
import { screenStyles } from '../theme/styles';
import client from '../api/client';
import { useWorkspace } from '../workspace/WorkspaceContext';
import ExpandableProductImage from '../components/ExpandableProductImage';

const MAX_PRODUCT_IMAGE_BYTES = 4 * 1024 * 1024;
const EMPTY_FORM = Object.freeze({
  name: '',
  ean: '',
  price: '',
  brand: '',
  code: '',
  category: '',
  description: '',
});

function savedAtLabel(value) {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('ro-RO', {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(date);
}

export default function ManualProductScreen({ navigation }) {
  const draftScope = 'manual-product:new';
  const { workspace, ensureDraft, recordDraft, clearDraft } = useWorkspace();
  const form = workspace.drafts[draftScope] || EMPTY_FORM;
  const [photo, setPhoto] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(null);

  useEffect(() => { ensureDraft(draftScope, EMPTY_FORM); }, [draftScope, ensureDraft]);

  function update(key, value) {
    recordDraft(draftScope, { ...form, [key]: value });
    setError('');
  }

  async function pickProductImage(source) {
    setError('');
    try {
      const permission = source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        throw new Error(source === 'camera'
          ? 'Permite accesul la cameră pentru a fotografia produsul.'
          : 'Permite accesul la fotografii pentru a alege imaginea produsului.');
      }
      const result = source === 'camera'
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], allowsEditing: true, quality: 0.8 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, quality: 0.8 });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      if (Number(asset.fileSize || 0) > MAX_PRODUCT_IMAGE_BYTES) {
        throw new Error('Fotografia poate avea maximum 4 MB.');
      }
      setPhoto(asset);
    } catch (err) {
      setError(err.message || 'Fotografia produsului nu a putut fi selectată.');
    }
  }

  async function save() {
    if (busy) return;
    if (!form.name.trim()) {
      setError('Introdu numele produsului.');
      return;
    }
    if (!form.ean.trim()) {
      setError('Introdu sau scanează EAN-ul produsului.');
      return;
    }
    if (!form.price.trim()) {
      setError('Introdu prețul final cu TVA.');
      return;
    }

    setBusy(true);
    setError('');
    try {
      const body = new FormData();
      Object.entries(form).forEach(([key, value]) => body.append(key, String(value || '').trim()));
      if (photo) {
        const extension = photo.mimeType === 'image/png' ? 'png' : photo.mimeType === 'image/webp' ? 'webp' : 'jpg';
        const fileName = photo.fileName || `produs-${Date.now()}.${extension}`;
        if (Platform.OS === 'web' && photo.file) body.append('file', photo.file, fileName);
        else body.append('file', { uri: photo.uri, name: fileName, type: photo.mimeType || 'image/jpeg' });
      }
      const { data } = await client.post('/api/admin/local-catalog/products', body, { timeout: 30_000 });
      clearDraft(draftScope);
      setPhoto(null);
      setSaved(data);
    } catch (err) {
      setError(err.message || 'Produsul nu a putut fi salvat.');
    } finally {
      setBusy(false);
    }
  }

  function addAnother() {
    setSaved(null);
    setPhoto(null);
    recordDraft(draftScope, { ...EMPTY_FORM });
  }

  return <KeyboardAvoidingView style={screenStyles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScreenHeader title="Produs manual" onBack={() => { if (!busy) navigation.goBack(); }} />
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      {saved ? <View style={styles.card}>
        <Text style={styles.title}>Produs salvat</Text>
        <Text>{saved.catalog?.name}</Text>
        <Text>EAN: {saved.catalog?.eans?.[0]}</Text>
        <Text>Preț: {Number(saved.pricing?.price || 0).toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} RON cu TVA</Text>
        <Text style={styles.help}>Salvat de {saved.audit?.saved_by || 'utilizatorul curent'} la {savedAtLabel(saved.audit?.saved_at)}</Text>
        <Text style={styles.help}>Produsul poate fi găsit acum în AutoSav prin scanarea acestui EAN.</Text>
        <Text style={styles.help}>Pentru a-l introduce în stoc, alege raftul și cantitatea.</Text>
        <CatalogButton title="Așază pe raft" onPress={() => navigation.push('StockEntry', { productToPlace: saved })} />
        <CatalogButton title="Adaugă alt produs" onPress={addAnother} />
        <CatalogButton secondary title="Înapoi la meniu" onPress={() => navigation.goBack()} />
      </View> : <>
        <View style={styles.card}>
          <Text style={styles.title}>Introducere manuală produs</Text>
          <Text style={styles.help}>Numele, EAN-ul și prețul final cu TVA sunt obligatorii. Utilizatorul și ora salvării se înregistrează automat.</Text>
          <CatalogField label="Nume produs *" value={form.name} maxLength={200} editable={!busy} onChangeText={value => update('name', value)} />
          <Text style={styles.label}>Scanează EAN</Text>
          <ScanInput placeholder="SCANEAZĂ CODUL DE BARE" disabled={busy} autoFocus={false} suppressRefocus onScan={value => update('ean', value)} />
          <CatalogField label="EAN *" value={form.ean} maxLength={50} editable={!busy} onChangeText={value => update('ean', value)} autoCapitalize="characters" autoCorrect={false} />
          <CatalogField label="Preț cu TVA (RON) *" value={form.price} maxLength={20} editable={!busy} onChangeText={value => update('price', value)} keyboardType="decimal-pad" />
        </View>

        <View style={styles.card}>
          <Text style={styles.title}>Poză produs</Text>
          <View style={styles.imageActions}>
            <CatalogButton secondary title="Cameră" disabled={busy} onPress={() => pickProductImage('camera')} />
            <CatalogButton secondary title="Upload" disabled={busy} onPress={() => pickProductImage('library')} />
          </View>
          {photo ? <View style={styles.imageCard}>
            <ExpandableProductImage uri={photo.uri} label="Poză produs selectată" style={styles.productImage} />
            <CatalogButton secondary title="Elimină poza" disabled={busy} onPress={() => setPhoto(null)} />
          </View> : <Text style={styles.help}>Poți fotografia produsul sau alege o imagine din telefon.</Text>}
        </View>

        <View style={styles.card}>
          <Text style={styles.title}>Detalii suplimentare</Text>
          <Text style={styles.help}>Dacă nu le completezi, codul va fi EAN-ul, iar marca va fi LOCAL.</Text>
          <CatalogField label="Marcă / producător" value={form.brand} maxLength={200} editable={!busy} onChangeText={value => update('brand', value)} />
          <CatalogField label="Cod produs" value={form.code} maxLength={64} editable={!busy} onChangeText={value => update('code', value)} autoCapitalize="characters" />
          <CatalogField label="Categorie" value={form.category} maxLength={100} editable={!busy} onChangeText={value => update('category', value)} />
          <CatalogField label="Descriere" value={form.description} maxLength={1000} editable={!busy} onChangeText={value => update('description', value)} multiline />
        </View>

        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        <CatalogButton title={busy ? 'Se salvează…' : 'Salvează produsul'} disabled={busy} onPress={save} />
      </>}
    </ScrollView>
  </KeyboardAvoidingView>;
}
