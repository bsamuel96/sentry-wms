import { useEffect, useState } from 'react';
import { api } from '../api.js';
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
    setBusy(true); setError(''); setSuccess('');
    try { await work(); } catch (err) { setError(err.message); } finally { setBusy(false); }
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

  function saveCatalog() {
    return run(async () => {
      const result = await readResponse(await api.put(`/admin/items/${itemId}/local-catalog`, form));
      setData(result); setForm(result.catalog); setPrice(result.pricing?.price ?? '');
      setReference(result.catalog.code); setMatches(null);
      setSuccess('Produsul a fost identificat manual și este disponibil în catalog.');
      onSaved?.(result);
    });
  }

  const pricing = data?.pricing || {};
  const quote = pricing.connex;
  return (
    <section className="local-catalog-panel" aria-label="Catalog și preț Local">
      {error ? <div className="alert alert-error" role="alert">{error}</div> : null}
      {success ? <div className="alert alert-success" role="status">{success}</div> : null}
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
          <p>Completează datele de pe produs sau ambalaj. Produsul va fi marcat „Identificat manual”.</p>
          <fieldset disabled={busy}>
            <div className="local-catalog-fields">
              {[['name', 'Denumire'], ['brand', 'Producător / marcă'], ['code', 'Cod producător'], ['category', 'Categorie']].map(([key, label]) => <label key={key}>{label}<input className="form-input" value={form[key] || ''} onChange={event => setForm({ ...form, [key]: event.target.value })} /></label>)}
              <label>Descriere<textarea className="form-input" value={form.description || ''} onChange={event => setForm({ ...form, description: event.target.value })} /></label>
              <label>EAN / coduri de bare (unul pe rând)<textarea className="form-input" value={(form.eans || []).join('\n')} onChange={event => setForm({ ...form, eans: event.target.value.split('\n') })} /></label>
              <label>Imagini (URL HTTPS, unul pe rând)<textarea className="form-input" value={(form.images || []).join('\n')} onChange={event => setForm({ ...form, images: event.target.value.split('\n') })} /></label>
            </div>
            <p>Referințe OE / echivalențe</p>
            {(form.references || []).map((row, index) => <div className="local-catalog-reference-row" key={index}>
              {[['code', 'Cod referință'], ['type', 'Tip (OE / echivalent)'], ['manufacturer', 'Marcă referință']].map(([key, label]) => <label key={key}>{label}<input className="form-input" value={row[key] || ''} onChange={event => setForm({ ...form, references: form.references.map((entry, i) => i === index ? { ...entry, [key]: event.target.value } : entry) })} /></label>)}
              <button type="button" className="btn" aria-label={`Șterge referința ${index + 1}`} onClick={() => setForm({ ...form, references: form.references.filter((_, i) => i !== index) })}>Șterge</button>
            </div>)}
            <div className="local-catalog-actions">
              <button type="button" className="btn" onClick={() => setForm({ ...form, references: [...(form.references || []), { code: '', type: 'OE', manufacturer: '' }] })}>Adaugă referință</button>
              <button type="button" className="btn btn-primary" onClick={saveCatalog}>Salvează datele produsului</button>
            </div>
          </fieldset>
        </details> : null}
        {busy ? <p role="status">Se procesează…</p> : null}
      </>}
    </section>
  );
}
