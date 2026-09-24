import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import DataTable from '../components/DataTable.jsx';
import Modal from '../components/Modal.jsx';
import PageHeader from '../components/PageHeader.jsx';

const STATUS_OPTIONS = [
  { value: 'PENDING', label: 'În așteptare' },
  { value: 'MATCHED', label: 'Echivalate' },
  { value: 'IGNORED', label: 'Ignorate' },
  { value: 'ALL', label: 'Toate' },
];

function statusLabel(status) {
  if (status === 'MATCHED') return 'Echivalat';
  if (status === 'IGNORED') return 'Ignorat';
  return 'În așteptare';
}

function statusTag(status) {
  const className = status === 'MATCHED' ? 'tag-success' : status === 'IGNORED' ? 'tag-gray' : 'tag-info';
  return <span className={`tag ${className}`}>{statusLabel(status)}</span>;
}

export function canSearchScannedCodeInTecDoc(value) {
  return /^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(String(value || '').trim());
}

export default function CatalogMatching() {
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('PENDING');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const [reference, setReference] = useState('');
  const [matches, setMatches] = useState([]);
  const [searchedBy, setSearchedBy] = useState('');
  const [loading, setLoading] = useState(false);
  const [matchLoading, setMatchLoading] = useState(false);
  const [savingId, setSavingId] = useState('');
  const [error, setError] = useState('');
  const [matchError, setMatchError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => loadQueue(controller.signal), search ? 250 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [page, status, search]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadQueue(signal) {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ page: String(page), per_page: '25', status });
      if (search.trim()) params.set('q', search.trim());
      const response = await api.get(`/catalog-discovery/queue?${params}`, { signal });
      if (!response?.ok) {
        const payload = await response?.json();
        throw new Error(payload?.error || 'Coada nu a putut fi încărcată.');
      }
      const payload = await response.json();
      setRows(payload.discoveries || []);
      setPagination({ page: payload.page, pages: payload.pages, total: payload.total });
    } catch (loadError) {
      if (loadError?.name !== 'AbortError') setError(loadError.message || 'Coada nu a putut fi încărcată.');
    } finally {
      setLoading(false);
    }
  }

  async function findMatches(row = selected, nextReference = reference) {
    if (!row) return;
    if (!nextReference.trim() && !canSearchScannedCodeInTecDoc(row.ean)) {
      setMatchError('Introdu codul producătorului sau o referință OE pentru acest cod scanat.');
      setMatches([]);
      setSearchedBy('');
      return;
    }
    setMatchLoading(true);
    setMatchError('');
    setMatches([]);
    try {
      const params = new URLSearchParams();
      if (nextReference.trim()) params.set('reference', nextReference.trim());
      const response = await api.get(`/catalog-discovery/queue/${row.discovery_id}/matches?${params}`);
      if (!response?.ok) {
        const payload = await response?.json();
        throw new Error(payload?.error || 'TecDoc nu a răspuns.');
      }
      const payload = await response.json();
      setMatches(payload.matches || []);
      setSearchedBy(payload.searchedBy || '');
    } catch (lookupError) {
      setMatchError(lookupError.message || 'TecDoc nu a răspuns.');
    } finally {
      setMatchLoading(false);
    }
  }

  function openReview(row) {
    setSelected(row);
    setReference('');
    setMatches([]);
    setMatchError('');
    setSearchedBy('');
    if (row.status === 'PENDING' && canSearchScannedCodeInTecDoc(row.ean)) findMatches(row, '');
  }

  async function chooseMatch(match) {
    if (!selected || savingId) return;
    const equivalent = match.matchType !== 'ean';
    if (equivalent && !window.confirm(`Confirmi că produsul fizic cu codul ${selected.ean} este ${match.brand} ${match.code}?`)) return;
    setSavingId(String(match.id));
    setMatchError('');
    try {
      const response = await api.post(`/catalog-discovery/queue/${selected.discovery_id}/match`, {
        articleId: match.id,
        code: match.code,
        reference: reference.trim(),
        confirmEquivalent: equivalent,
      });
      if (!response?.ok) {
        const payload = await response?.json();
        throw new Error(payload?.error || 'Echivalarea nu a putut fi salvată.');
      }
      setSelected(null);
      loadQueue();
    } catch (saveError) {
      setMatchError(saveError.message || 'Echivalarea nu a putut fi salvată.');
    } finally {
      setSavingId('');
    }
  }

  async function ignoreSelected() {
    if (!selected || savingId || !window.confirm(`Ignori produsul cu codul ${selected.ean}?`)) return;
    setSavingId('ignore');
    setMatchError('');
    try {
      const response = await api.post(`/catalog-discovery/queue/${selected.discovery_id}/ignore`, {});
      if (!response?.ok) {
        const payload = await response?.json();
        throw new Error(payload?.error || 'Produsul nu a putut fi ignorat.');
      }
      setSelected(null);
      loadQueue();
    } catch (saveError) {
      setMatchError(saveError.message || 'Produsul nu a putut fi ignorat.');
    } finally {
      setSavingId('');
    }
  }

  const columns = useMemo(() => [
    { key: 'ean', label: 'Cod scanat', mono: true },
    { key: 'item_name', label: 'Produs curent' },
    { key: 'quantity_on_hand', label: 'Cantitate' },
    { key: 'locations', label: 'Locații', render: (row) => (row.locations || []).map((location) => `${location.bin_code}: ${location.quantity}`).join(' · ') || '—' },
    { key: 'status', label: 'Stare', render: (row) => statusTag(row.status) },
    { key: 'created_by', label: 'Scanat de', render: (row) => row.created_by || '—' },
    { key: 'actions', label: 'Acțiuni', render: (row) => (
      <button type="button" className="btn btn-primary btn-sm" onClick={(event) => { event.stopPropagation(); openReview(row); }}>
        {row.status === 'PENDING' ? 'Compară TecDoc' : 'Detalii'}
      </button>
    ) },
  ], []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <PageHeader title="Echivalare TecDoc" />
      <p style={{ margin: '-8px 0 16px', color: 'var(--text-secondary)', fontSize: 13 }}>
        Produsele necunoscute introduse din APK rămân în stoc cu codul scanat până când le confirmi identitatea TecDoc aici.
      </p>
      <div className="filter-bar">
        <select className="form-select" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }} style={{ width: 180 }}>
          {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <input className="form-input" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Caută cod, SKU sau denumire" style={{ maxWidth: 360 }} />
      </div>
      {error ? <div className="alert alert-error" role="alert">{error}</div> : null}
      {loading && !rows.length ? <p>Se încarcă…</p> : null}
      <DataTable rowKey="discovery_id" columns={columns} data={rows} pagination={pagination} onPageChange={setPage} onRowClick={openReview} clickColumn="ean" emptyMessage="Nu există produse pentru verificare" />

      {selected ? (
        <Modal
          title={`Echivalare TecDoc · ${selected.ean}`}
          onClose={() => setSelected(null)}
          size="wide"
          footer={selected.status === 'PENDING' ? (
            <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', gap: 8 }}>
              <button type="button" className="btn btn-danger" onClick={ignoreSelected} disabled={Boolean(savingId)}>Ignoră</button>
              <button type="button" className="btn" onClick={() => setSelected(null)}>Închide</button>
            </div>
          ) : <button type="button" className="btn" onClick={() => setSelected(null)}>Închide</button>}
        >
          <div className="detail-grid" style={{ marginBottom: 18 }}>
            <span className="detail-label">Cod scanat</span><span className="mono">{selected.ean}</span>
            <span className="detail-label">Produs Sentry</span><span>{selected.item_name}</span>
            <span className="detail-label">Stoc</span><span>{selected.quantity_on_hand} buc.</span>
            <span className="detail-label">Locații</span><span>{(selected.locations || []).map((location) => `${location.bin_code}: ${location.quantity}`).join(' · ') || '—'}</span>
            <span className="detail-label">Stare</span><span>{statusLabel(selected.status)}</span>
            {selected.tecdoc_code ? <><span className="detail-label">TecDoc</span><span>{[selected.tecdoc_brand, selected.tecdoc_code, selected.tecdoc_name].filter(Boolean).join(' · ')}</span></> : null}
          </div>

          {selected.status === 'PENDING' ? (
            <>
              <div className="filter-bar" style={{ alignItems: 'flex-end' }}>
                <label style={{ flex: 1, minWidth: 220 }}>
                  <span className="detail-label" style={{ display: 'block', marginBottom: 5 }}>Cod producător / referință OE</span>
                  <input className="form-input" value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Ex: C113" style={{ width: '100%' }} />
                </label>
                <button type="button" className="btn btn-primary" onClick={() => findMatches()} disabled={matchLoading || (!reference.trim() && !canSearchScannedCodeInTecDoc(selected.ean))}>{matchLoading ? 'Se caută…' : 'Caută în TecDoc'}</button>
              </div>
              {!canSearchScannedCodeInTecDoc(selected.ean) && !reference.trim() ? <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Codul scanat este păstrat în Sentry. Introdu o referință de pe piesă sau ambalaj pentru echivalarea TecDoc.</p> : null}
              {matchError ? <div className="alert alert-error" role="alert">{matchError}</div> : null}
              {!matchLoading && !matchError && matches.length === 0 ? <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Nicio potrivire. Introdu un cod producător sau OE și caută din nou.</p> : null}
              {searchedBy ? <p style={{ color: 'var(--text-secondary)', fontSize: 12 }}>Căutare: {searchedBy === 'ean' ? 'EAN exact' : 'referință produs'}</p> : null}
              <div style={{ display: 'grid', gap: 8 }}>
                {matches.map((match) => (
                  <div key={`${match.id}-${match.code}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: 12, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface)' }}>
                    <div style={{ minWidth: 0 }}>
                      <strong>{match.brand} · {match.name}</strong>
                      <div className="mono" style={{ marginTop: 4 }}>{match.code}</div>
                      <small style={{ display: 'block', marginTop: 4, color: 'var(--text-secondary)' }}>{match.matchType === 'ean' ? 'EAN exact' : 'Potrivire după referință · necesită confirmare'}</small>
                    </div>
                    <button type="button" className="btn btn-primary" onClick={() => chooseMatch(match)} disabled={Boolean(savingId)}>{savingId === String(match.id) ? 'Se salvează…' : 'Alege'}</button>
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </Modal>
      ) : null}
    </div>
  );
}
