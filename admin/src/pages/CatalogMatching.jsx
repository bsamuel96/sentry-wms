import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import DataTable from '../components/DataTable.jsx';
import Modal from '../components/Modal.jsx';
import PageHeader from '../components/PageHeader.jsx';
import { canSearchScannedCodeInTecDoc } from '../utils/catalogMatching.js';

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
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkResult, setBulkResult] = useState(null);
  const [error, setError] = useState('');
  const [matchError, setMatchError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => loadQueue(controller.signal), search ? 250 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [page, status, search]); // eslint-disable-line react-hooks/exhaustive-deps

  function resetBulkSelection() {
    setSelectedIds(new Set());
    setBulkResult(null);
  }

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
      const nextMatches = payload.matches || [];
      const eanLedLookup = !nextReference.trim() && ['ean', 'ean_then_reference'].includes(payload.searchedBy);
      const uniqueAutoMatches = [...new Map(nextMatches
        .filter((match) => eanLedLookup && match.id && match.code)
        .map((match) => [`${match.id}:${match.code}`, match])).values()];
      if (uniqueAutoMatches.length === 1) {
        await chooseMatch(uniqueAutoMatches[0], row, '', true);
        return;
      }
      setMatches(nextMatches);
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

  async function chooseMatch(match, target = selected, matchReference = reference, eanLedLookup = false) {
    if (!target || savingId) return;
    const discoveryId = Number(target.discovery_id);
    const scannedCode = target.ean;
    const equivalent = match.matchType !== 'ean' && !eanLedLookup;
    if (equivalent && !window.confirm(`Confirmi că produsul fizic cu codul ${target.ean} este ${match.brand} ${match.code}?`)) return;
    setSavingId(String(match.id));
    setMatchError('');
    try {
      const response = await api.post(`/catalog-discovery/queue/${target.discovery_id}/match`, {
        articleId: match.id,
        code: match.code,
        reference: matchReference.trim(),
        confirmEquivalent: equivalent,
      });
      if (!response?.ok) {
        const payload = await response?.json();
        throw new Error(payload?.error || 'Echivalarea nu a putut fi salvată.');
      }
      setRows((current) => status === 'PENDING'
        ? current.filter((row) => Number(row.discovery_id) !== discoveryId)
        : current.map((row) => Number(row.discovery_id) === discoveryId
          ? { ...row, status: 'MATCHED', item_name: [match.brand, match.name].filter(Boolean).join(' · '), tecdoc_code: match.code, tecdoc_brand: match.brand, tecdoc_name: match.name }
          : row));
      if (status === 'PENDING') {
        setPagination((current) => current ? { ...current, total: Math.max(0, current.total - 1) } : current);
      }
      setSuccess(`${scannedCode} a fost identificat și salvat direct ca produs TecDoc ${[match.brand, match.code].filter(Boolean).join(' ')}.`);
      setSelected(null);
      setSelectedIds((current) => {
        const next = new Set(current);
        next.delete(discoveryId);
        return next;
      });
      await loadQueue();
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
      setSelectedIds((current) => {
        const next = new Set(current);
        next.delete(Number(selected.discovery_id));
        return next;
      });
      loadQueue();
    } catch (saveError) {
      setMatchError(saveError.message || 'Produsul nu a putut fi ignorat.');
    } finally {
      setSavingId('');
    }
  }

  function toggleRow(discoveryId) {
    setSelectedIds((current) => {
      const next = new Set(current);
      const key = Number(discoveryId);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function selectVisiblePending() {
    const eligible = rows.filter((row) => row.status === 'PENDING' && canSearchScannedCodeInTecDoc(row.ean));
    setSelectedIds((current) => {
      const next = new Set(current);
      const allSelected = eligible.length > 0 && eligible.every((row) => next.has(Number(row.discovery_id)));
      eligible.forEach((row) => {
        if (allSelected) next.delete(Number(row.discovery_id));
        else next.add(Number(row.discovery_id));
      });
      return next;
    });
  }

  async function bulkMatchSelected() {
    const ids = [...selectedIds];
    if (!ids.length || bulkLoading) return;
    setBulkLoading(true);
    setBulkResult(null);
    setError('');
    try {
      const response = await api.post('/catalog-discovery/queue/bulk-match', { discovery_ids: ids });
      if (!response?.ok) {
        const payload = await response?.json();
        throw new Error(payload?.error || 'Echivalarea multiplă nu a putut fi executată.');
      }
      const payload = await response.json();
      setBulkResult(payload.summary ? { ...payload.summary, results: payload.results || [] } : null);
      setSelectedIds(new Set());
      await loadQueue();
    } catch (bulkError) {
      setError(bulkError.message || 'Echivalarea multiplă nu a putut fi executată.');
    } finally {
      setBulkLoading(false);
    }
  }

  async function deleteDiscovery(row = selected) {
    if (!row || savingId) return;
    const locations = (row.locations || []).map((location) => `${location.bin_code}: ${location.quantity}`).join(' · ');
    const detail = locations ? `\n\nSe elimină ${row.quantity_on_hand} buc. din ${locations}.` : '';
    if (!window.confirm(`Ștergi definitiv produsul scanat ${row.ean}?${detail}\n\nOperația este permisă numai dacă produsul nu a fost folosit într-o comandă sau operație de depozit.`)) return;
    setSavingId(`delete:${row.discovery_id}`);
    setMatchError('');
    setError('');
    try {
      const response = await api.delete(`/catalog-discovery/queue/${row.discovery_id}`);
      if (!response?.ok) {
        const payload = await response?.json();
        throw new Error(payload?.error || 'Produsul scanat nu a putut fi șters.');
      }
      setSelectedIds((current) => {
        const next = new Set(current);
        next.delete(Number(row.discovery_id));
        return next;
      });
      if (selected?.discovery_id === row.discovery_id) setSelected(null);
      await loadQueue();
    } catch (deleteError) {
      if (selected?.discovery_id === row.discovery_id) setMatchError(deleteError.message || 'Produsul scanat nu a putut fi șters.');
      else setError(deleteError.message || 'Produsul scanat nu a putut fi șters.');
    } finally {
      setSavingId('');
    }
  }

  const columns = useMemo(() => [
    { key: 'select', label: 'Selectează', render: (row) => (
      <input
        type="checkbox"
        checked={selectedIds.has(Number(row.discovery_id))}
        disabled={row.status !== 'PENDING' || !canSearchScannedCodeInTecDoc(row.ean) || bulkLoading}
        aria-label={`Selectează ${row.ean} pentru echivalare automată`}
        onClick={(event) => event.stopPropagation()}
        onChange={() => toggleRow(row.discovery_id)}
      />
    ) },
    { key: 'ean', label: 'Cod scanat', mono: true },
    { key: 'item_name', label: 'Produs curent' },
    { key: 'quantity_on_hand', label: 'Cantitate' },
    { key: 'locations', label: 'Locații', render: (row) => (row.locations || []).map((location) => `${location.bin_code}: ${location.quantity}`).join(' · ') || '—' },
    { key: 'status', label: 'Stare', render: (row) => statusTag(row.status) },
    { key: 'created_by', label: 'Scanat de', render: (row) => row.created_by || '—' },
    { key: 'actions', label: 'Acțiuni', render: (row) => (
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-primary btn-sm" onClick={(event) => { event.stopPropagation(); openReview(row); }}>
          {row.status === 'PENDING' ? 'Compară TecDoc' : 'Detalii'}
        </button>
        <button type="button" className="btn btn-danger btn-sm" disabled={Boolean(savingId)} onClick={(event) => { event.stopPropagation(); deleteDiscovery(row); }}>
          {savingId === `delete:${row.discovery_id}` ? 'Se șterge…' : 'Șterge'}
        </button>
      </div>
    ) },
  ], [bulkLoading, savingId, selectedIds]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <PageHeader title="Echivalare TecDoc" />
      <p style={{ margin: '-8px 0 16px', color: 'var(--text-secondary)', fontSize: 13 }}>
        Un singur rezultat găsit pornind de la EAN devine automat produs TecDoc. Numai căutările manuale după cod producător/OE și rezultatele multiple cer confirmare.
      </p>
      <div className="filter-bar">
        <select className="form-select" value={status} onChange={(event) => { resetBulkSelection(); setStatus(event.target.value); setPage(1); }} style={{ width: 180 }}>
          {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <input className="form-input" value={search} onChange={(event) => { resetBulkSelection(); setSearch(event.target.value); setPage(1); }} placeholder="Caută cod, SKU sau denumire" style={{ maxWidth: 360 }} />
        <button type="button" className="btn" onClick={selectVisiblePending} disabled={!rows.some((row) => row.status === 'PENDING' && canSearchScannedCodeInTecDoc(row.ean)) || bulkLoading}>
          Selectează pagina
        </button>
        <button type="button" className="btn btn-primary" onClick={bulkMatchSelected} disabled={!selectedIds.size || bulkLoading}>
          {bulkLoading ? 'Se echivalează…' : `Echivalează automat după EAN (${selectedIds.size})`}
        </button>
      </div>
      {success ? (
        <div className="alert alert-success" role="status">
          {success}{' '}
          <button type="button" className="btn btn-sm" onClick={() => { resetBulkSelection(); setStatus('MATCHED'); setPage(1); setSuccess(''); }}>
            Vezi echivalatele
          </button>
        </div>
      ) : null}
      {error ? <div className="alert alert-error" role="alert">{error}</div> : null}
      {bulkResult ? (
        <div className={`alert ${bulkResult.failed || bulkResult.not_found ? 'alert-error' : 'alert-success'}`} role="status">
          {bulkResult.not_found ? <strong style={{ display: 'block', marginBottom: 5 }}>INEXISTENTE ÎN TECDOC: {bulkResult.not_found}</strong> : null}
          {bulkResult.matched} echivalate · {bulkResult.ambiguous} necesită alegere · {bulkResult.skipped} omise{bulkResult.failed ? ` · ${bulkResult.failed} erori` : ''}.
          {bulkResult.not_found ? (
            <span style={{ display: 'block', marginTop: 6 }}>
              Nu este un mismatch: TecDoc nu a returnat nicio potrivire EAN exactă pentru {bulkResult.results.filter((result) => result.status === 'not_found').map((result) => result.ean).filter(Boolean).join(', ') || 'codurile marcate'}.
            </span>
          ) : null}
        </div>
      ) : null}
      {loading && !rows.length ? <p>Se încarcă…</p> : null}
      <DataTable rowKey="discovery_id" columns={columns} data={rows} pagination={pagination} onPageChange={(nextPage) => { resetBulkSelection(); setPage(nextPage); }} onRowClick={openReview} clickColumn="ean" emptyMessage="Nu există produse pentru verificare" />

      {selected ? (
        <Modal
          title={`Echivalare TecDoc · ${selected.ean}`}
          onClose={() => setSelected(null)}
          size="wide"
          footer={selected.status === 'PENDING' ? (
            <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', gap: 8 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn btn-danger" onClick={ignoreSelected} disabled={Boolean(savingId)}>Ignoră</button>
                <button type="button" className="btn btn-danger" onClick={() => deleteDiscovery(selected)} disabled={Boolean(savingId)}>{savingId === `delete:${selected.discovery_id}` ? 'Se șterge…' : 'Șterge produsul scanat'}</button>
              </div>
              <button type="button" className="btn" onClick={() => setSelected(null)}>Închide</button>
            </div>
          ) : (
            <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', gap: 8 }}>
              <button type="button" className="btn btn-danger" onClick={() => deleteDiscovery(selected)} disabled={Boolean(savingId)}>{savingId === `delete:${selected.discovery_id}` ? 'Se șterge…' : 'Șterge produsul scanat'}</button>
              <button type="button" className="btn" onClick={() => setSelected(null)}>Închide</button>
            </div>
          )}
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
              {!matchLoading && !matchError && matches.length === 0 ? (
                <div className="alert alert-error" role="status">
                  <strong>INEXISTENT ÎN TECDOC</strong><br />TecDoc nu a returnat o potrivire. Nu este un mismatch; introdu un cod producător sau OE pentru o căutare alternativă.
                </div>
              ) : null}
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
