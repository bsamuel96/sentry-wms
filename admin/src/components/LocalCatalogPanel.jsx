import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import Modal from './Modal.jsx';
import './LocalCatalogPanel.css';

const money = (value) => value == null ? '—' : `${Number(value).toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} RON`;

async function readResponse(response) {
  const data = await response?.json();
  if (!response?.ok) throw new Error(data?.error || 'Cererea nu a putut fi finalizată.');
  return data;
}

export default function LocalCatalogPanel({ itemId, onSaved }) {
  const [data, setData] = useState(null);
  const [form, setForm] = useState({});
  const [reference, setReference] = useState('');
  const [matches, setMatches] = useState(null);
  const [searchedReference, setSearchedReference] = useState('');
  const [price, setPrice] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [photo, setPhoto] = useState(null);
  const [photoPreview, setPhotoPreview] = useState('');
  const [expandedImage, setExpandedImage] = useState(null);
  const photoInput = useRef(null);
  const feedback = useRef(null);
  const operation = useRef(false);

  useEffect(() => {
    if (success || error) feedback.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [success, error]);

  useEffect(() => {
    if (!photo) { setPhotoPreview(''); return; }
    const url = URL.createObjectURL(photo);
    setPhotoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  useEffect(() => {
    let cancelled = false;
    api.get(`/admin/items/${itemId}/local-catalog`).then(readResponse).then(value => {
      if (cancelled) return;
      setData(value);
      setForm(value.catalog || {});
      setReference(value.pricing?.reference || value.catalog?.code || '');
      setPrice(value.pricing?.price ?? '');
    }).catch(err => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, [itemId]);

  async function run(work) {
    if (operation.current) return;
    operation.current = true;
    setBusy(true); setError(''); setSuccess('');
    try { await work(); } catch (err) { setError(err.message); } finally { operation.current = false; setBusy(false); }
  }

  function savePrice(action, match) {
    return run(async () => {
      const result = await readResponse(await api.post(`/admin/items/${itemId}/local-price`, {
        action, ...(action === 'manual' ? { price } : {}),
        ...(match ? { reference: searchedReference, product_id: match.id } : {}),
      }));
      setData(current => ({ ...current, pricing: result.pricing }));
      setPrice(result.pricing.price ?? '');
      setMatches(null);
      setSuccess(action === 'refresh' && result.pricing.source === 'manual'
        ? 'Referința Connex a fost actualizată. Prețul tău a fost păstrat.' : 'Prețul Local a fost salvat.');
      onSaved?.();
    });
  }

  function saveCatalog(complete = false) {
    return run(async () => {
      if (complete && ['name', 'brand', 'code'].some(key => !String(form[key] || '').trim())) {
        throw new Error('Completează denumirea, producătorul / marca și codul producătorului înainte de finalizare.');
      }
      let catalog = form;
      if (photo) {
        const body = new FormData();
        body.append('file', photo);
        const uploaded = await readResponse(await api.upload(`/admin/items/${itemId}/catalog-images`, body));
        if (!uploaded.image_url) throw new Error('Fotografia nu a putut fi încărcată. Reîncearcă.');
        catalog = { ...form, images: [...new Set([...(form.images || []).filter(Boolean), uploaded.image_url])] };
        // Keep the uploaded URL if saving the catalogue fails, so retrying
        // does not upload another copy or lose the user's other edits.
        setForm(catalog);
        setPhoto(null);
      }
      const result = await readResponse(await api.put(`/admin/items/${itemId}/local-catalog`, { ...catalog, complete }));
      setData(result); setForm(result.catalog); setPrice(result.pricing?.price ?? '');
      setReference(result.catalog.code); setMatches(null);
      setSuccess(result.message || (complete ? 'Produsul este complet și a fost scos din lista de produse neechivalate.' : 'Datele produsului au fost salvate.'));
      onSaved?.({ ...result, completed: result.completed === true });
    });
  }

  function choosePhoto(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError(''); setSuccess('');
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError('Alege o fotografie JPG, PNG sau WebP.'); return;
    }
    if (file.size > 4 * 1024 * 1024) {
      setError('Fotografia poate avea maximum 4 MB.'); return;
    }
    if ((form.images || []).filter(Boolean).length >= 10) {
      setError('Produsul poate avea maximum 10 imagini.'); return;
    }
    setPhoto(file);
  }

  const pricing = data?.pricing || {};
  const quote = pricing.connex;
  return (
    <section className="local-catalog-panel" aria-label="Catalog și preț Local">
      {!data ? <p>Se încarcă datele Local…</p> : <>
        <h3>Local · preț de vânzare</h3>
        <p>Preț cu TVA, folosit în Autosav pentru furnizorul Local. Actualizarea Connex păstrează prețul modificat manual.</p>
        <div className="local-catalog-price"><strong>{money(pricing.price)}</strong><span>{pricing.source === 'manual' ? 'Preț stabilit manual' : quote ? 'Preț preluat din Connex' : 'Fără preț'}</span></div>
        {quote ? <div className="local-catalog-reference">
          <strong>Connex · {quote.brand} {quote.code}</strong>
          <span>Brut: {money(quote.raw_price)} · Adaos fix: {quote.fixed_markup_percent}% · Adaos Connex: {quote.extra_markup_percent}%</span>
          <span>Fără TVA: {money(quote.net_price)} · TVA: {quote.vat_percent}% · Cu TVA: {money(quote.price)}</span>
          <small>Verificat: {new Date(quote.checked_at).toLocaleString('ro-RO')}</small>
          <div className="local-catalog-actions">
            <button type="button" className="btn" disabled={busy} onClick={() => savePrice('refresh')}>Actualizează referința Connex</button>
            {pricing.source === 'manual' ? <button type="button" className="btn" disabled={busy} onClick={() => savePrice('use_connex')}>Folosește prețul Connex</button> : null}
          </div>
        </div> : null}
        <fieldset disabled={busy}>
          <div className="local-catalog-actions">
            <label>Preț Local cu TVA (RON)<input className="form-input" inputMode="decimal" value={price} onChange={event => setPrice(event.target.value)} /></label>
            <button type="button" className="btn btn-primary" onClick={() => savePrice('manual')}>Salvează prețul meu</button>
          </div>
          <div className="local-catalog-actions">
            <label>Cod Connex / producător<input className="form-input" value={reference} onChange={event => { setReference(event.target.value); setMatches(null); }} /></label>
            <button type="button" className="btn" disabled={!reference.trim()} onClick={() => run(async () => {
              const result = await readResponse(await api.post(`/admin/items/${itemId}/connex-prices`, { reference }));
              setMatches(result.matches || []); setSearchedReference(reference);
            })}>Echivalează prețul cu Connex</button>
          </div>
          {matches?.length === 0 ? <p role="status">Niciun preț Connex disponibil. Poți stabili prețul manual.</p> : null}
          {matches?.map(match => <div className="local-catalog-match" key={match.id}>
            <div><strong>{match.brand} · {match.code}</strong><span>{match.name}</span><span>Brut: {money(match.raw_price)} → cu adaos și TVA: {money(match.price)}</span></div>
            <button type="button" className="btn" disabled={match.currency !== 'RON'} onClick={() => savePrice('refresh', match)}>Alege referința Connex</button>
          </div>)}
        </fieldset>
        {data.status !== 'MATCHED' ? <details className="local-catalog-manual" open={data.status !== 'MANUAL'}>
          <summary>Identificare manuală · date produs</summary>
          <p>Salvează datele pentru a continua mai târziu. Pentru finalizare și scoaterea din listă, completează denumirea, marca și codul producătorului.</p>
          <fieldset disabled={busy}>
            <div className="local-catalog-fields">
              {[['name', 'Denumire'], ['brand', 'Producător / marcă'], ['code', 'Cod producător'], ['category', 'Categorie']].map(([key, label]) => <label key={key}>{label}<input className="form-input" value={form[key] || ''} onChange={event => setForm({ ...form, [key]: event.target.value })} /></label>)}
              <label>Descriere<textarea className="form-input" value={form.description || ''} onChange={event => setForm({ ...form, description: event.target.value })} /></label>
              <label>EAN / coduri de bare (unul pe rând)<textarea className="form-input" value={(form.eans || []).join('\n')} onChange={event => setForm({ ...form, eans: event.target.value.split('\n') })} /></label>
            </div>
            <section className="local-catalog-photos" aria-label="Fotografii produs">
              <h4>Fotografii produs</h4>
              <p>Adaugă o poză chiar dacă produsul nu există în TecDoc. Fotografia se salvează odată cu datele produsului.</p>
              <button type="button" className="btn btn-primary" disabled={(form.images || []).filter(Boolean).length >= 10} onClick={() => photoInput.current?.click()}>Încarcă poză</button>
              <input ref={photoInput} type="file" aria-label="Alege o fotografie" accept="image/jpeg,image/png,image/webp" onChange={choosePhoto} hidden disabled={(form.images || []).filter(Boolean).length >= 10} />
              <small>JPG, PNG sau WebP · maximum 4 MB / fotografie · maximum 10 imagini</small>
              <div className="local-catalog-photo-grid">
                {(form.images || []).filter(Boolean).map((url, index) => <figure key={`${url}-${index}`}>
                  <button type="button" className="local-catalog-photo-preview" aria-label={`Mărește fotografia ${index + 1}`} onClick={() => setExpandedImage({ url, label: `Fotografie produs ${index + 1}` })}>
                    <img src={url} alt={`Fotografie produs ${index + 1}`} />
                  </button>
                  <button type="button" className="btn" aria-label={`Elimină fotografia ${index + 1}`} onClick={() => setForm(current => ({ ...current, images: current.images.filter(image => image !== url) }))}>Elimină</button>
                </figure>)}
                {photoPreview ? <figure>
                  <button type="button" className="local-catalog-photo-preview" aria-label="Mărește fotografia nouă" onClick={() => setExpandedImage({ url: photoPreview, label: 'Previzualizare fotografie nouă' })}>
                    <img src={photoPreview} alt="Previzualizare fotografie nouă" />
                  </button>
                  <figcaption>Se va salva cu produsul</figcaption>
                  <button type="button" className="btn" onClick={() => setPhoto(null)}>Renunță la fotografie</button>
                </figure> : null}
              </div>
              <details><summary>Adaugă imagini prin link</summary>
                <label>Imagini (URL HTTPS, unul pe rând)<textarea className="form-input" value={(form.images || []).join('\n')} onChange={event => setForm({ ...form, images: event.target.value.split('\n') })} /></label>
              </details>
            </section>
            <p>Referințe OE / echivalențe</p>
            {(form.references || []).map((row, index) => <div className="local-catalog-reference-row" key={index}>
              {[['code', 'Cod referință'], ['type', 'Tip (OE / echivalent)'], ['manufacturer', 'Marcă referință']].map(([key, label]) => <label key={key}>{label}<input className="form-input" value={row[key] || ''} onChange={event => setForm({ ...form, references: form.references.map((entry, i) => i === index ? { ...entry, [key]: event.target.value } : entry) })} /></label>)}
              <button type="button" className="btn" aria-label={`Șterge referința ${index + 1}`} onClick={() => setForm({ ...form, references: form.references.filter((_, i) => i !== index) })}>Șterge</button>
            </div>)}
            <div className="local-catalog-actions">
              <button type="button" className="btn" onClick={() => setForm({ ...form, references: [...(form.references || []), { code: '', type: 'OE', manufacturer: '' }] })}>Adaugă referință</button>
              <button type="button" className="btn" onClick={() => saveCatalog(false)}>Salvează datele produsului</button>
              <button type="button" className="btn btn-primary" onClick={() => saveCatalog(true)}>Salvează și scoate din listă</button>
            </div>
          </fieldset>
        </details> : null}
        {busy ? <p role="status">Se procesează…</p> : null}
      </>}
      <div ref={feedback} className="local-catalog-feedback">
        {error ? <div className="alert alert-error" role="alert">{error}</div> : null}
        {success ? <div className="alert alert-success" role="status">{success}</div> : null}
      </div>
      {expandedImage ? <Modal size="wide" title={expandedImage.label} onClose={() => setExpandedImage(null)}>
        <div className="local-catalog-photo-expanded"><img src={expandedImage.url} alt={`${expandedImage.label} mărită`} /></div>
      </Modal> : null}
    </section>
  );
}
