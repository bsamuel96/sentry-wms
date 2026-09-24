import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useWarehouse } from '../warehouse.jsx';
import DataTable from '../components/DataTable.jsx';
import PageHeader from '../components/PageHeader.jsx';
import Modal from '../components/Modal.jsx';

const BIN_TYPES = ['Staging', 'PickableStaging', 'Pickable'];

export default function Bins() {
  const { warehouseId } = useWarehouse();
  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState(searchParams.get('q') || '');
  const [bins, setBins] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [page, setPage] = useState(1);
  const [zones, setZones] = useState([]);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({});
  const [error, setError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [showGenerator, setShowGenerator] = useState(false);
  const [generatorBusy, setGeneratorBusy] = useState(false);
  const [generatorResult, setGeneratorResult] = useState(null);
  const [generator, setGenerator] = useState({
    zone_id: '', aisles: 'A', rows: 'a,b,c', position_from: '1', position_to: '10', level_num: '', bin_type: 'Pickable',
  });

  useEffect(() => { if (warehouseId) { loadBins(); loadZones(); } }, [warehouseId, search, page]);  // eslint-disable-line react-hooks/exhaustive-deps

  async function loadBins() {
    const params = new URLSearchParams({ warehouse_id: String(warehouseId), page, per_page: 50 });
    if (search) params.set('q', search);
    const res = await api.get(`/admin/bins?${params}`);
    if (res?.ok) {
      const data = await res.json();
      setBins(data.bins || []);
      setPagination({ page: data.page, pages: data.pages, total: data.total, per_page: data.per_page });
    }
  }

  // Walks all pages and downloads the full result set as CSV. Sentry's
  // admin/bins endpoint caps page_size at 50 regardless of `per_page`,
  // so we paginate server-side and concat client-side. CSV mirrors the
  // BinImportRow schema (including the complete physical coordinates) so
  // an exported file is round-trip-importable via /admin/import/bins.
  async function exportCsv() {
    setExporting(true);
    try {
      const all = [];
      let p = 1;
      // Hard stop at 200 pages (=10k bins) to avoid runaway
      while (p <= 200) {
        const params = new URLSearchParams({ warehouse_id: String(warehouseId), page: p, per_page: 50 });
        if (search) params.set('q', search);
        const res = await api.get(`/admin/bins?${params}`);
        if (!res?.ok) break;
        const data = await res.json();
        all.push(...(data.bins || []));
        if (p >= (data.pages || 1)) break;
        p += 1;
      }
      const headers = ['bin_code','bin_barcode','zone','warehouse_id','aisle','row_num','level_num','position_num','bin_type','pick_sequence','putaway_sequence','description'];
      const csvEscape = (v) => {
        if (v == null) return '';
        const s = String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const lines = [headers.join(',')];
      for (const b of all) {
        lines.push([
          csvEscape(b.bin_code),
          csvEscape(b.bin_barcode),
          csvEscape(b.zone_name || b.zone || ''),
          csvEscape(b.warehouse_id ?? warehouseId),
          csvEscape(b.aisle ?? ''),
          csvEscape(b.row_num ?? ''),
          csvEscape(b.level_num ?? ''),
          csvEscape(b.position_num ?? ''),
          csvEscape(b.bin_type),
          csvEscape(b.pick_sequence ?? ''),
          csvEscape(b.putaway_sequence ?? ''),
          csvEscape(b.description ?? ''),
        ].join(','));
      }
      const csv = lines.join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const today = new Date().toISOString().split('T')[0];
      link.download = `bins_warehouse${warehouseId}_${today}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  async function loadZones() {
    const res = await api.get(`/admin/zones?warehouse_id=${warehouseId}`);
    if (res?.ok) {
      const data = await res.json();
      setZones(data.zones || []);
    }
  }

  async function viewBin(bin) {
    setSelected(bin);
    setEditing(false);
    const res = await api.get(`/admin/bins/${bin.bin_id}`);
    if (res?.ok) {
      const data = await res.json();
      const flat = { ...(data.bin || {}), inventory: data.inventory || [] };
      setDetail(flat);
      setForm(flat);
    }
  }

  function openEditFromRow(r) {
    setSelected(r);
    setForm(r);
    setEditing(true);
    setError('');
  }

  async function deleteBin() {
    setError('');
    const target = deleteTarget;
    if (!target) return;
    const res = await api.delete(`/admin/bins/${target.bin_id}`);
    if (res?.ok) {
      setDeleteTarget(null);
      loadBins();
    } else {
      const data = await res?.json();
      setError(data?.error || 'Failed to delete');
      setDeleteTarget(null);
    }
  }

  async function saveBin() {
    setError('');
    const body = {
      bin_code: form.bin_code,
      bin_barcode: form.bin_barcode,
      bin_type: form.bin_type,
      zone_id: form.zone_id ? Number(form.zone_id) : null,
      aisle: form.aisle || null,
      row_num: form.row_num || null,
      level_num: form.level_num || null,
      position_num: form.position_num || null,
      pick_sequence: form.pick_sequence !== '' && form.pick_sequence != null ? Number(form.pick_sequence) : 0,
      putaway_sequence: form.putaway_sequence !== '' && form.putaway_sequence != null ? Number(form.putaway_sequence) : 0,
    };
    const res = editing
      ? await api.put(`/admin/bins/${selected.bin_id}`, { ...body, is_active: !!form.is_active })
      : await api.post('/admin/bins', { ...body, warehouse_id: warehouseId });
    if (res?.ok) {
      setSelected(null); setDetail(null); setShowCreate(false); setEditing(false);
      loadBins();
    } else {
      const data = await res?.json();
      setError(data?.error || 'Failed to save');
    }
  }

  async function generateLocations() {
    setError('');
    setGeneratorResult(null);
    const split = (value) => [...new Set(String(value || '').split(',').map((part) => part.trim()).filter(Boolean))];
    const aisles = split(generator.aisles);
    const rowsToCreate = split(generator.rows);
    const positionFrom = Number(generator.position_from);
    const positionTo = Number(generator.position_to);
    if (!generator.zone_id || !aisles.length || !rowsToCreate.length || !Number.isInteger(positionFrom) || !Number.isInteger(positionTo) || positionFrom < 1 || positionTo < positionFrom) {
      setError('Completează zona, rândurile/culoarele, rafturile și un interval valid de coloane.');
      return;
    }
    const count = aisles.length * rowsToCreate.length * (positionTo - positionFrom + 1);
    if (count > 5000) {
      setError('Poți genera maximum 5000 de locații într-o operație.');
      return;
    }
    setGeneratorBusy(true);
    try {
      const res = await api.post('/admin/bins/generate', {
        warehouse_id: Number(warehouseId),
        zone_id: Number(generator.zone_id),
        aisles,
        rows: rowsToCreate,
        position_from: positionFrom,
        position_to: positionTo,
        level_num: generator.level_num.trim() || null,
        bin_type: generator.bin_type,
      });
      const data = await res?.json();
      if (!res?.ok) throw new Error(data?.error || 'Locațiile nu au putut fi generate.');
      setGeneratorResult(data);
      await loadBins();
    } catch (generateError) {
      setError(generateError.message || 'Locațiile nu au putut fi generate.');
    } finally {
      setGeneratorBusy(false);
    }
  }

  const columns = [
    { key: 'bin_code', label: 'Bin Code', mono: true },
    { key: 'bin_barcode', label: 'Barcode', mono: true },
    { key: 'bin_type', label: 'Type' },
    { key: 'zone_name', label: 'Zone' },
    { key: 'aisle', label: 'Culoar' },
    { key: 'row_num', label: 'Raft' },
    { key: 'position_num', label: 'Coloană' },
    { key: 'pick_sequence', label: 'Pick Seq' },
    { key: 'is_active', label: 'Active', render: (r) => r.is_active ? 'Yes' : 'No' },
    { key: 'actions', label: '', render: (r) => (
      <div style={{ display: 'flex', gap: 4 }}>
        <button className="btn btn-sm" onClick={(e) => { e.stopPropagation(); openEditFromRow(r); }} aria-label="Edit" title="Edit">&#9998;</button>
        <button className="btn btn-sm btn-danger" onClick={(e) => { e.stopPropagation(); setDeleteTarget(r); }} aria-label="Delete" title="Delete">&#128465;</button>
      </div>
    )},
  ];

  const invCols = [
    { key: 'sku', label: 'SKU', mono: true },
    { key: 'item_name', label: 'Item' },
    { key: 'quantity_on_hand', label: 'On Hand' },
    { key: 'quantity_allocated', label: 'Allocated' },
  ];

  function renderForm() {
    return (
      <>
        {error && <div className="form-error" style={{ marginBottom: 12 }}>{error}</div>}
        <div className="form-row">
          <div className="form-group">
            <label>Bin Code</label>
            <input className="form-input" value={form.bin_code || ''} onChange={(e) => setForm({ ...form, bin_code: e.target.value })} />
          </div>
          <div className="form-group">
            <label>Barcode</label>
            <input className="form-input" value={form.bin_barcode || ''} onChange={(e) => setForm({ ...form, bin_barcode: e.target.value })} />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>Type</label>
            <select className="form-select" value={form.bin_type || ''} onChange={(e) => setForm({ ...form, bin_type: e.target.value })}>
              <option value="">Select type</option>
              {BIN_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Zone</label>
            <select className="form-select" value={form.zone_id || ''} onChange={(e) => setForm({ ...form, zone_id: Number(e.target.value) })}>
              <option value="">Select zone</option>
              {zones.map((z) => <option key={z.zone_id} value={z.zone_id}>{z.zone_code} - {z.zone_name}</option>)}
            </select>
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>Culoar</label>
            <input aria-label="Culoar" className="form-input" value={form.aisle || ''} onChange={(e) => setForm({ ...form, aisle: e.target.value })} />
          </div>
          <div className="form-group">
            <label>Raft</label>
            <input aria-label="Raft" className="form-input" value={form.row_num || ''} onChange={(e) => setForm({ ...form, row_num: e.target.value })} />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>Coloană</label>
            <input aria-label="Coloană" className="form-input" value={form.position_num || ''} onChange={(e) => setForm({ ...form, position_num: e.target.value })} />
          </div>
          <div className="form-group">
            <label>Nivel</label>
            <input aria-label="Nivel" className="form-input" value={form.level_num || ''} onChange={(e) => setForm({ ...form, level_num: e.target.value })} />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>Ordine colectare</label>
            <input className="form-input" type="number" min="0" value={form.pick_sequence ?? ''} onChange={(e) => setForm({ ...form, pick_sequence: e.target.value })} />
          </div>
          <div className="form-group">
            <label>Ordine depozitare</label>
            <input className="form-input" type="number" min="0" value={form.putaway_sequence ?? ''} onChange={(e) => setForm({ ...form, putaway_sequence: e.target.value })} />
          </div>
        </div>
      </>
    );
  }

  return (
    <div>
      <PageHeader title="Bins">
        <input
          className="form-input"
          style={{ maxWidth: 320, marginRight: 8 }}
          placeholder="Search by bin code or barcode"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        />
        <button
          className="btn"
          onClick={exportCsv}
          disabled={exporting || !pagination?.total}
          style={{ marginRight: 8 }}
          title="Export current filter to CSV"
        >
          {exporting ? 'Exporting…' : 'Export CSV'}
        </button>
        <Link className="btn" to="/data/labels" style={{ marginRight: 8 }}>Etichete cod de bare</Link>
        <button className="btn" onClick={() => { setShowGenerator(true); setGeneratorResult(null); setError(''); }} style={{ marginRight: 8 }}>Generează locații</button>
        <button className="btn btn-primary" onClick={() => { setForm({ is_active: true }); setShowCreate(true); setError(''); }}>New Bin</button>
      </PageHeader>
      <DataTable rowKey="bin_id" columns={columns} data={bins} pagination={pagination} onPageChange={setPage} onRowClick={viewBin} />

      {selected && detail && !editing && (
        <Modal title={`Bin ${detail.bin_code}`} onClose={() => { setSelected(null); setDetail(null); setError(''); }}
          footer={
            <button className="btn" onClick={() => { setEditing(true); setForm(detail); setError(''); }}>Edit</button>
          }
        >
          <div className="detail-grid">
            <span className="detail-label">Code</span><span className="mono">{detail.bin_code}</span>
            <span className="detail-label">Barcode</span><span className="mono">{detail.bin_barcode}</span>
            <span className="detail-label">Type</span><span>{detail.bin_type}</span>
            <span className="detail-label">Zone</span><span>{detail.zone_name || '-'}</span>
            <span className="detail-label">Culoar</span><span>{detail.aisle || '-'}</span>
            <span className="detail-label">Raft</span><span>{detail.row_num || '-'}</span>
            <span className="detail-label">Coloană</span><span>{detail.position_num || '-'}</span>
            <span className="detail-label">Nivel</span><span>{detail.level_num || '-'}</span>
            <span className="detail-label">Pick Seq</span><span>{detail.pick_sequence ?? '-'}</span>
            <span className="detail-label">Active</span><span>{detail.is_active ? 'Yes' : 'No'}</span>
          </div>
          {detail.inventory && detail.inventory.length > 0 && (
            <>
              <div className="section-title">Inventory</div>
              <DataTable rowKey="inventory_id" columns={invCols} data={detail.inventory} />
            </>
          )}
          {error && <div className="form-error" style={{ marginTop: 12 }}>{error}</div>}
        </Modal>
      )}

      {deleteTarget && (
        <Modal
          title={`Delete bin ${deleteTarget.bin_code}?`}
          onClose={() => setDeleteTarget(null)}
          footer={
            <>
              <button className="btn" onClick={() => setDeleteTarget(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={deleteBin}>Delete</button>
            </>
          }
        >
          <p style={{ fontSize: 13 }}>
            This permanently removes bin <span className="mono">{deleteTarget.bin_code}</span>. Inventory with
            quantity on hand and preferred-bin references must be cleared first.
          </p>
          {error && <div className="form-error" style={{ marginTop: 12 }}>{error}</div>}
        </Modal>
      )}

      {(editing || showCreate) && (
        <Modal
          title={editing ? `Edit Bin ${form.bin_code}` : 'New Bin'}
          onClose={() => { setEditing(false); setShowCreate(false); setSelected(null); setDetail(null); }}
          footer={
            <>
              <button className="btn" onClick={() => { setEditing(false); setShowCreate(false); setSelected(null); setDetail(null); }}>Cancel</button>
              <button className="btn btn-primary" onClick={saveBin}>Save</button>
            </>
          }
        >
          {renderForm()}
        </Modal>
      )}

      {showGenerator && (
        <Modal
          title="Generează rânduri, rafturi și coloane"
          onClose={() => { setShowGenerator(false); setError(''); }}
          footer={(
            <>
              <button className="btn" onClick={() => { setShowGenerator(false); setError(''); }}>Închide</button>
              <button className="btn btn-primary" onClick={generateLocations} disabled={generatorBusy}>{generatorBusy ? 'Se generează…' : 'Generează locațiile'}</button>
            </>
          )}
        >
          <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Exemplu: rând A + raft a + coloana 1 generează codul <span className="mono">A-a-1</span>. Separă valorile multiple prin virgulă.</p>
          {error && <div className="form-error" style={{ marginBottom: 12 }}>{error}</div>}
          {generatorResult && <div className="alert alert-success" role="status">{generatorResult.created} locații create · {generatorResult.skipped} duplicate omise.</div>}
          <div className="form-row">
            <div className="form-group">
              <label>Zonă</label>
              <select className="form-select" value={generator.zone_id} onChange={(e) => setGenerator({ ...generator, zone_id: e.target.value })}>
                <option value="">Selectează zona</option>
                {zones.map((zone) => <option key={zone.zone_id} value={zone.zone_id}>{zone.zone_code} · {zone.zone_name}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Tip locație</label>
              <select className="form-select" value={generator.bin_type} onChange={(e) => setGenerator({ ...generator, bin_type: e.target.value })}>
                {BIN_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
              </select>
            </div>
          </div>
          <div className="form-row">
            <div className="form-group"><label>Rânduri / culoare</label><input className="form-input" value={generator.aisles} onChange={(e) => setGenerator({ ...generator, aisles: e.target.value })} placeholder="A,B,C" /></div>
            <div className="form-group"><label>Rafturi</label><input className="form-input" value={generator.rows} onChange={(e) => setGenerator({ ...generator, rows: e.target.value })} placeholder="a,b,c" /></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label>Coloană de la</label><input className="form-input" type="number" min="1" value={generator.position_from} onChange={(e) => setGenerator({ ...generator, position_from: e.target.value })} /></div>
            <div className="form-group"><label>Coloană până la</label><input className="form-input" type="number" min="1" value={generator.position_to} onChange={(e) => setGenerator({ ...generator, position_to: e.target.value })} /></div>
          </div>
          <div className="form-group"><label>Nivel (opțional)</label><input className="form-input" value={generator.level_num} onChange={(e) => setGenerator({ ...generator, level_num: e.target.value })} placeholder="Lasă gol pentru A-a-1" /></div>
        </Modal>
      )}
    </div>
  );
}
