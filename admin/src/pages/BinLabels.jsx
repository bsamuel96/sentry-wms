import { useEffect, useMemo, useState } from 'react';
import BarcodeSvg from '../components/BarcodeSvg.jsx';
import PageHeader from '../components/PageHeader.jsx';
import { api } from '../api.js';
import { useWarehouse } from '../warehouse.jsx';
import './binLabels.css';

const FORMATS = [
  { value: 'a4', label: 'A4 · 3 coloane' },
  { value: 'thermal-100', label: 'Termică · 100 × 50 mm' },
  { value: 'thermal-62', label: 'Termică · 62 × 30 mm' },
];
const NATURAL_COLLATOR = new Intl.Collator('ro', { numeric: true, sensitivity: 'base' });

function binSearchText(bin) {
  return [
    bin.bin_code,
    bin.bin_barcode,
    bin.zone_code,
    bin.zone_name,
    bin.aisle,
    bin.row_num,
    bin.level_num,
    bin.position_num,
  ].filter(Boolean).join(' ').toLocaleLowerCase('ro');
}

function rowBarcode(aisle) {
  const safeAisle = String(aisle || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9_.\-/]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toUpperCase();
  return `ROW-${safeAisle || 'UNKNOWN'}`;
}

function coordinates(bin) {
  const parts = [];
  if (bin.aisle) parts.push(`Rând ${bin.aisle}`);
  if (bin.row_num) parts.push(`Raft ${bin.row_num}`);
  if (bin.position_num) parts.push(`Coloană ${bin.position_num}`);
  if (bin.level_num) parts.push(`Nivel ${bin.level_num}`);
  return parts.join(' · ');
}

function BinLabel({ entry, format, warehouseName }) {
  const compact = format === 'thermal-62';
  return (
    <article className="warehouse-label warehouse-label-bin">
      <header>
        <span className="warehouse-label-kind">LOCAȚIE</span>
        {warehouseName ? <span className="warehouse-label-warehouse">{warehouseName}</span> : null}
      </header>
      <strong className="warehouse-label-title">{entry.bin_code}</strong>
      <div className="warehouse-label-coordinates">{coordinates(entry) || entry.zone_name || 'Locație de stocare'}</div>
      <BarcodeSvg
        value={entry.bin_barcode || entry.bin_code}
        className="warehouse-label-barcode"
        modulePx={compact ? 0.8 : 1}
        height={compact ? 38 : 52}
      />
      <span className="warehouse-label-value">{entry.bin_barcode || entry.bin_code}</span>
    </article>
  );
}

function RowLabel({ entry, format, warehouseName }) {
  const compact = format === 'thermal-62';
  const barcode = rowBarcode(entry.aisle);
  return (
    <article className="warehouse-label warehouse-label-row">
      <header>
        <span className="warehouse-label-kind">RÂND DE DEPOZIT</span>
        {warehouseName ? <span className="warehouse-label-warehouse">{warehouseName}</span> : null}
      </header>
      <strong className="warehouse-label-title">RÂND {entry.aisle}</strong>
      <div className="warehouse-label-coordinates">
        {entry.binCount} {entry.binCount === 1 ? 'locație' : 'locații'}
      </div>
      <BarcodeSvg
        value={barcode}
        className="warehouse-label-barcode"
        modulePx={compact ? 0.8 : 1}
        height={compact ? 38 : 52}
      />
      <span className="warehouse-label-value">{barcode}</span>
    </article>
  );
}

export default function BinLabels() {
  const { warehouseId, warehouse } = useWarehouse();
  const [bins, setBins] = useState([]);
  const [scope, setScope] = useState('bins');
  const [format, setFormat] = useState('a4');
  const [search, setSearch] = useState('');
  const [selectedKeys, setSelectedKeys] = useState(() => new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!warehouseId) return undefined;
    let cancelled = false;

    async function loadBins() {
      setLoading(true);
      setError('');
      const loaded = [];

      try {
        for (let page = 1; page <= 200; page += 1) {
          const params = new URLSearchParams({
            warehouse_id: String(warehouseId),
            page: String(page),
            per_page: '50',
          });
          const response = await api.get(`/admin/bins?${params}`);
          if (!response?.ok) throw new Error('Nu am putut încărca locațiile de stocare.');
          const payload = await response.json();
          loaded.push(...(payload.bins || []));
          if (page >= (payload.pages || 1)) break;
        }

        if (!cancelled) {
          loaded.sort((left, right) => NATURAL_COLLATOR.compare(left.bin_code || '', right.bin_code || ''));
          setBins(loaded);
          setSelectedKeys(new Set());
        }
      } catch (loadError) {
        if (!cancelled) setError(loadError.message || 'Nu am putut încărca locațiile de stocare.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadBins();
    return () => { cancelled = true; };
  }, [warehouseId]);

  const rows = useMemo(() => {
    const byAisle = new Map();
    for (const bin of bins) {
      const aisle = String(bin.aisle || '').trim();
      if (!aisle) continue;
      const key = aisle.toLocaleLowerCase('ro');
      const current = byAisle.get(key);
      if (current) current.binCount += 1;
      else byAisle.set(key, { key: `row:${key}`, aisle, binCount: 1 });
    }
    return [...byAisle.values()].sort((left, right) => NATURAL_COLLATOR.compare(left.aisle, right.aisle));
  }, [bins]);

  const allEntries = scope === 'rows' ? rows : bins;

  const entries = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('ro');
    if (scope === 'rows') {
      if (!term) return rows;
      return rows.filter((row) => `${row.aisle} ${rowBarcode(row.aisle)}`.toLocaleLowerCase('ro').includes(term));
    }
    if (!term) return bins;
    return bins.filter((bin) => binSearchText(bin).includes(term));
  }, [bins, rows, scope, search]);

  const selectedEntries = useMemo(() => allEntries.filter((entry) => {
    const key = scope === 'rows' ? entry.key : `bin:${entry.bin_id}`;
    return selectedKeys.has(key);
  }), [allEntries, scope, selectedKeys]);

  const warehouseName = warehouse?.warehouse_code || warehouse?.warehouse_name || `Depozit ${warehouseId}`;
  const printPageSize = format === 'a4' ? 'A4 portrait' : format === 'thermal-100' ? '100mm 50mm' : '62mm 30mm';

  function changeScope(nextScope) {
    setScope(nextScope);
    setSearch('');
    setSelectedKeys(new Set());
  }

  function entryKey(entry) {
    return scope === 'rows' ? entry.key : `bin:${entry.bin_id}`;
  }

  function toggleEntry(entry) {
    const key = entryKey(entry);
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function selectVisible() {
    setSelectedKeys((current) => {
      const next = new Set(current);
      for (const entry of entries) next.add(entryKey(entry));
      return next;
    });
  }

  return (
    <div className="bin-labels-page">
      <style>{`@media print { @page { size: ${printPageSize}; margin: ${format === 'a4' ? '10mm' : '0'}; } }`}</style>
      <PageHeader title="Etichete cod de bare" />

      <section className="section label-builder-controls" aria-label="Configurare etichete">
        <div className="label-builder-toolbar">
          <fieldset className="label-scope-picker">
            <legend>Ce tipărești?</legend>
            <button
              type="button"
              className={`btn${scope === 'bins' ? ' btn-primary' : ''}`}
              aria-pressed={scope === 'bins'}
              onClick={() => changeScope('bins')}
            >
              Bin-uri
            </button>
            <button
              type="button"
              className={`btn${scope === 'rows' ? ' btn-primary' : ''}`}
              aria-pressed={scope === 'rows'}
              onClick={() => changeScope('rows')}
            >
              Rânduri
            </button>
          </fieldset>

          <label className="form-group label-format-picker">
            <span>Format hârtie</span>
            <select className="form-select" value={format} onChange={(event) => setFormat(event.target.value)}>
              {FORMATS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>

          <label className="form-group label-search">
            <span>Filtrează</span>
            <input
              className="form-input"
              type="search"
              value={search}
              placeholder={scope === 'rows' ? 'Ex.: A' : 'Cod, barcode, rând, raft…'}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
        </div>

        <div className="label-selection-actions">
          <button type="button" className="btn" onClick={selectVisible} disabled={entries.length === 0}>
            Selectează toate ({entries.length})
          </button>
          <button type="button" className="btn" onClick={() => setSelectedKeys(new Set())} disabled={selectedKeys.size === 0}>
            Deselectează
          </button>
          <span role="status">{selectedEntries.length} selectate</span>
          <button
            type="button"
            className="btn btn-primary label-print-button"
            disabled={selectedEntries.length === 0}
            onClick={() => window.print()}
          >
            Tipărește selecția
          </button>
        </div>

        {error ? <div className="form-error">{error}</div> : null}
        {loading ? <div className="placeholder-section">Se încarcă locațiile…</div> : null}
        {!loading && !error ? (
          <div className="label-source-list" aria-label={scope === 'rows' ? 'Rânduri disponibile' : 'Bin-uri disponibile'}>
            {entries.map((entry) => {
              const key = entryKey(entry);
              const selected = selectedKeys.has(key);
              return (
                <label className={`label-source-option${selected ? ' selected' : ''}`} key={key}>
                  <input type="checkbox" checked={selected} onChange={() => toggleEntry(entry)} />
                  <span>
                    <strong>{scope === 'rows' ? `Rând ${entry.aisle}` : entry.bin_code}</strong>
                    <small>
                      {scope === 'rows'
                        ? `${entry.binCount} ${entry.binCount === 1 ? 'locație' : 'locații'} · ${rowBarcode(entry.aisle)}`
                        : `${entry.bin_barcode || entry.bin_code}${coordinates(entry) ? ` · ${coordinates(entry)}` : ''}`}
                    </small>
                  </span>
                </label>
              );
            })}
            {entries.length === 0 ? <div className="placeholder-section">Nu există rezultate pentru filtrul curent.</div> : null}
          </div>
        ) : null}
      </section>

      <section className="section label-preview-section">
        <div className="section-title">Previzualizare ({selectedEntries.length})</div>
        {selectedEntries.length === 0 ? (
          <div className="placeholder-section label-builder-controls">Selectează cel puțin o locație sau un rând.</div>
        ) : (
          <div className={`bin-label-print-area format-${format}`}>
            {selectedEntries.map((entry) => (
              scope === 'rows'
                ? <RowLabel key={entry.key} entry={entry} format={format} warehouseName={warehouseName} />
                : <BinLabel key={entry.bin_id} entry={entry} format={format} warehouseName={warehouseName} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
