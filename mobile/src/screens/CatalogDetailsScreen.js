import React, { useEffect, useRef, useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import Text from '../components/LocalizedText';
import ScreenHeader from '../components/ScreenHeader';
import { CatalogButton, CatalogField, catalogStyles as styles } from '../components/CatalogForm';
import { screenStyles } from '../theme/styles';
import client from '../api/client';
import { catalogToForm, formToCatalog, CATALOG_TIMEOUT } from '../utils/catalogReview';
import { CatalogDetailsSkeleton, CatalogPhotoSkeleton } from '../components/LoadingSkeleton';
import { useWorkspace } from '../workspace/WorkspaceContext';

const MAX_PRODUCT_IMAGE_BYTES = 4 * 1024 * 1024;

function imageUrls(value = '') {
  return [...new Set(String(value).split(/\r?\n/).map(row => row.trim()).filter(Boolean))];
}

export default function CatalogDetailsScreen({ navigation, route }) {
  const { discovery } = route.params;
  const draftScope = `catalog-details:${discovery.item_id}`;
  const { workspace, ensureDraft, recordDraft, clearDraft } = useWorkspace();
  const [serverForm, setServerForm] = useState(null);
  const form = workspace.drafts[draftScope] ?? serverForm;
  const [status, setStatus] = useState(discovery.status);
  const [reference, setReference] = useState(discovery.product_code || '');
  const [lookupReference, setLookupReference] = useState('');
  const [matches, setMatches] = useState(null);
  const [busy, setBusy] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const action = useRef(false);

  useEffect(() => {
    let active = true;
    client.get(`/api/admin/items/${discovery.item_id}/local-catalog`).then(({ data }) => {
      if (!active) return;
      setStatus(data.status);
      const nextForm = catalogToForm(data.catalog);
      setServerForm(nextForm);
      ensureDraft(draftScope, nextForm);
    }).catch(err => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [discovery.item_id, draftScope, ensureDraft, reload]);

  function setForm(updater) {
    const current = workspace.drafts[draftScope] ?? serverForm;
    if (!current) return;
    recordDraft(draftScope, typeof updater === 'function' ? updater(current) : updater);
  }
  function update(key, value) { setForm(current => ({ ...current, [key]: value })); }
  function updateReference(index, key, value) {
    setForm(current => ({ ...current, references: current.references.map((row, i) => i === index ? { ...row, [key]: value } : row) }));
  }

  function removeImage(imageUrl) {
    setForm(current => ({
      ...current,
      images: imageUrls(current.images).filter(value => value !== imageUrl).join('\n'),
    }));
  }

  async function perform(work) {
    if (action.current) return;
    action.current = true; setBusy(true); setError('');
    try { await work(); } catch (err) { setError(err.message); }
    finally { action.current = false; setBusy(false); }
  }

  function findMatches() {
    perform(async () => {
      setMatches(null);
      const value = reference.trim();
      const { data } = await client.get(`/api/catalog-discovery/queue/${discovery.discovery_id}/matches?reference=${encodeURIComponent(value)}`, { timeout: CATALOG_TIMEOUT });
      setLookupReference(value);
      setMatches(data.matches || []);
    });
  }

  function chooseMatch(match) {
    perform(async () => {
      await client.post(`/api/catalog-discovery/queue/${discovery.discovery_id}/match`, {
        articleId: match.id, code: match.code, reference: lookupReference, confirmEquivalent: true,
      }, { timeout: CATALOG_TIMEOUT });
      clearDraft(draftScope);
      navigation.goBack();
    });
  }

  function save() {
    perform(async () => {
      await client.put(`/api/admin/items/${discovery.item_id}/local-catalog`, formToCatalog(form));
      clearDraft(draftScope);
      navigation.goBack();
    });
  }

  async function pickProductImage(source) {
    if (!form || action.current) return;
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
      if (imageUrls(form.images).length >= 10) {
        throw new Error('Produsul poate avea maximum 10 imagini.');
      }
      setUploadingImage(true);
      const extension = asset.mimeType === 'image/png' ? 'png' : asset.mimeType === 'image/webp' ? 'webp' : 'jpg';
      const fileName = asset.fileName || `produs-${discovery.item_id}-${Date.now()}.${extension}`;
      const body = new FormData();
      if (Platform.OS === 'web' && asset.file) body.append('file', asset.file, fileName);
      else body.append('file', { uri: asset.uri, name: fileName, type: asset.mimeType || 'image/jpeg' });
      await perform(async () => {
        const { data } = await client.post(
          `/api/admin/items/${discovery.item_id}/catalog-images`,
          body,
          { timeout: 30_000 },
        );
        setForm(current => ({
          ...current,
          images: [...imageUrls(current.images), data.image_url].filter((value, index, values) => values.indexOf(value) === index).join('\n'),
        }));
      });
    } catch (err) {
      setError(err.message || 'Fotografia produsului nu a putut fi încărcată.');
    } finally {
      setUploadingImage(false);
    }
  }

  return <KeyboardAvoidingView style={screenStyles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScreenHeader title="Detalii produs" onBack={() => { if (!busy) navigation.goBack(); }} />
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      <View style={styles.card}><Text style={styles.title}>{discovery.item_name}</Text><Text>EAN scanat: {discovery.ean}</Text><Text>SKU: {discovery.sku}</Text>{discovery.product_code ? <Text>Cod produs: {discovery.product_code}</Text> : null}</View>
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {!form ? error ? <CatalogButton title="Reîncearcă încărcarea" onPress={() => { setError(''); setReload(value => value + 1); }} /> : <CatalogDetailsSkeleton /> : <>
        {status === 'MATCHED' ? <Text style={styles.help}>Produsul a fost deja echivalat în TecDoc. Reîncarcă lista pentru identitatea actualizată.</Text> : <>
          {status === 'PENDING' && <View style={styles.card}>
            <Text style={styles.title}>Caută în TecDoc</Text>
            <CatalogField label="Cod producător / referință OE (opțional)" value={reference} editable={!busy} onChangeText={value => { setReference(value); setMatches(null); }} autoCapitalize="characters" />
            <CatalogButton title={busy ? 'Se procesează…' : 'Caută potriviri TecDoc'} disabled={busy} onPress={findMatches} />
            <Text style={styles.help}>Fără referință se caută după EAN. Confirmă o potrivire numai după verificarea produsului fizic.</Text>
            {matches?.length === 0 && <Text style={styles.help}>Nicio potrivire. Poți introduce detaliile manual mai jos.</Text>}
            {matches?.map((match, index) => <View key={`${match.id}:${match.code}:${index}`} style={styles.card}>
              <Text style={styles.title}>{match.brand} · {match.code}</Text><Text>{match.name}</Text>
              <Text style={styles.help}>{(match.eans || []).join(', ')}</Text>
              <CatalogButton secondary title={`Confirmă produsul ${match.code}`} disabled={busy || !match.id || !match.code} onPress={() => chooseMatch(match)} />
            </View>)}
          </View>}
          <View style={styles.card}>
            <Text style={styles.title}>Detalii manuale</Text>
            <Text style={styles.help}>Câmpurile produsului din TecDoc. Denumirea, marca și codul sunt obligatorii. După salvare, produsul apare în „Completate manual”.</Text>
            <CatalogField label="Denumire *" value={form.name} maxLength={200} editable={!busy} onChangeText={value => update('name', value)} />
            <CatalogField label="Marcă / producător *" value={form.brand} maxLength={200} editable={!busy} onChangeText={value => update('brand', value)} />
            <CatalogField label="Cod producător *" value={form.code} maxLength={64} editable={!busy} onChangeText={value => update('code', value)} autoCapitalize="characters" />
            <CatalogField label="Categorie" value={form.category} maxLength={100} editable={!busy} onChangeText={value => update('category', value)} />
            <CatalogField label="Descriere" value={form.description} maxLength={1000} editable={!busy} onChangeText={value => update('description', value)} multiline />
            <CatalogField label="Coduri EAN — câte unul pe linie (maximum 50)" value={form.eans} editable={!busy} onChangeText={value => update('eans', value)} multiline autoCapitalize="none" />
            <Text style={styles.label}>Fotografii produs (maximum 10)</Text>
            <View style={styles.imageActions}>
              <CatalogButton secondary title="Cameră" disabled={busy || imageUrls(form.images).length >= 10} onPress={() => pickProductImage('camera')} />
              <CatalogButton secondary title="Upload" disabled={busy || imageUrls(form.images).length >= 10} onPress={() => pickProductImage('library')} />
            </View>
            {uploadingImage || imageUrls(form.images).length ? <View style={styles.imageGrid}>
              {uploadingImage ? <CatalogPhotoSkeleton /> : null}
              {imageUrls(form.images).map((imageUrl, index) => <View key={imageUrl} style={styles.imageCard}>
                <Image source={{ uri: imageUrl }} accessibilityLabel={`Imagine produs ${index + 1}`} style={styles.productImage} resizeMode="contain" />
                <CatalogButton secondary title={`Șterge imaginea ${index + 1}`} disabled={busy} onPress={() => removeImage(imageUrl)} />
              </View>)}
            </View> : <Text style={styles.help}>Fotografiază produsul sau alege o imagine din telefon.</Text>}
            <CatalogField label="Alte imagini — URL HTTPS pe linie" value={form.images} editable={!busy} onChangeText={value => update('images', value)} multiline autoCapitalize="none" autoCorrect={false} />
            <Text style={styles.label}>Referințe OE / echivalențe</Text>
            {form.references.map((row, index) => <View key={index} style={styles.card}>
              <CatalogField label={`Referința ${index + 1}: cod *`} value={row.code} maxLength={200} editable={!busy} onChangeText={value => updateReference(index, 'code', value)} />
              <CatalogField label={`Referința ${index + 1}: tip`} placeholder="OE, IAM…" value={row.type} maxLength={200} editable={!busy} onChangeText={value => updateReference(index, 'type', value)} />
              <CatalogField label={`Referința ${index + 1}: producător`} value={row.manufacturer} maxLength={200} editable={!busy} onChangeText={value => updateReference(index, 'manufacturer', value)} />
              <CatalogButton secondary title={`Elimină referința ${index + 1}`} disabled={busy} onPress={() => update('references', form.references.filter((_, i) => i !== index))} />
            </View>)}
            <CatalogButton secondary title="Adaugă referință" disabled={busy || form.references.length >= 40} onPress={() => update('references', [...form.references, { code: '', type: '', manufacturer: '' }])} />
            <CatalogButton title={busy ? 'Se procesează…' : 'Salvează detaliile manuale'} disabled={busy} onPress={save} />
          </View>
        </>}
      </>}
    </ScrollView>
  </KeyboardAvoidingView>;
}
