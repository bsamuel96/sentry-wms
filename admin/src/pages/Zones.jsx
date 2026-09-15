import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useWarehouse } from '../warehouse.jsx';
import DataTable from '../components/DataTable.jsx';
import PageHeader from '../components/PageHeader.jsx';
import Modal from '../components/Modal.jsx';

const ZONE_TYPES = ['RECEIVING', 'STORAGE', 'PICKING', 'STAGING', 'SHIPPING'];
const WAREHOUSE_AREA_DEFAULTS = [
  { zone_code: 'BUCATARIE', zone_name: 'Bucătărie', zone_type: 'STORAGE' },
  { zone_code: 'BAIE', zone_name: 'Baie', zone_type: 'STORAGE' },
  { zone_code: 'SPATE', zone_name: 'Spatele magazinului', zone_type: 'STORAGE' },
  { zone_code: 'FATA', zone_name: 'Fața magazinului', zone_type: 'STORAGE' },
];

export default function Zones() {
  const { warehouseId } = useWarehouse();
  const [zones, setZones] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({});
  const [error, setError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [showAreaSetup, setShowAreaSetup] = useState(false);
  const [warehouseAreas, setWarehouseAreas] = useState(WAREHOUSE_AREA_DEFAULTS);
  const [savingAreaSetup, setSavingAreaSetup] = useState(false);
  const [success, setSuccess] = useState('');

  useEffect(() => { if (warehouseId) loadZones(); }, [warehouseId]);

  async function loadZones() {
    const res = await api.get(`/admin/zones?warehouse_id=${warehouseId}`);
    if (res?.ok) {
      const data = await res.json();
      setZones(data.zones || []);
    }
  }

  function openCreate() {
    setEditId(null);
    setForm({ is_active: true });
    setError('');
    setShowModal(true);
  }

  function openAreaSetup() {
    const currentByCode = new Map(zones.map((zone) => [String(zone.zone_code || '').toUpperCase(), zone]));
    setWarehouseAreas(WAREHOUSE_AREA_DEFAULTS.map((fallback) => {
      const current = currentByCode.get(fallback.zone_code);
      return current ? {
        zone_code: current.zone_code,
        zone_name: current.zone_name,
        zone_type: current.zone_type,
      } : fallback;
    }));
    setError('');
    setSuccess('');
    setShowAreaSetup(true);
  }

  function openEdit(zone) {
    setEditId(zone.zone_id);
    setForm(zone);
    setError('');
    setShowModal(true);
  }

  async function save() {
    setError('');
    const body = { zone_code: form.zone_code, zone_name: form.zone_name, zone_type: form.zone_type };
    const res = editId
      ? await api.put(`/admin/zones/${editId}`, { ...body, is_active: !!form.is_active })
      : await api.post('/admin/zones', { ...body, warehouse_id: warehouseId });
    if (res?.ok) {
      setShowModal(false);
      loadZones();
    } else {
      const data = await res?.json();
      setError(data?.error || 'Failed to save');
    }
  }

  async function deleteZone() {
    setError('');
    const target = deleteTarget;
    if (!target) return;
    const res = await api.delete(`/admin/zones/${target.zone_id}`);
    if (res?.ok) {
      setDeleteTarget(null);
      loadZones();
    } else {
      const data = await res?.json();
      setError(data?.error || 'Failed to delete zone');
      setDeleteTarget(null);
    }
  }

  function updateWarehouseArea(index, field, value) {
    setWarehouseAreas((current) => current.map((zone, zoneIndex) => (
      zoneIndex === index ? { ...zone, [field]: value } : zone
    )));
  }

  async function saveAreaSetup() {
    setError('');
    setSuccess('');
    setSavingAreaSetup(true);
    try {
      const res = await api.post('/admin/zones/area-setup', {
        warehouse_id: Number(warehouseId),
        zones: warehouseAreas.map((zone) => ({
          ...zone,
          zone_code: String(zone.zone_code || '').trim().toUpperCase(),
          zone_name: String(zone.zone_name || '').trim(),
        })),
      });
      if (!res?.ok) {
        const data = await res?.json();
        throw new Error(data?.error || 'Nu am putut configura zonele.');
      }
      setShowAreaSetup(false);
      setSuccess('Bucătărie, Baie, Spatele magazinului și Fața magazinului sunt configurate. Acum poți atribui fiecărui bin zona corectă și poți tipări etichetele.');
      await loadZones();
    } catch (setupError) {
      setError(setupError.message || 'Nu am putut configura zonele.');
    } finally {
      setSavingAreaSetup(false);
    }
  }

  const columns = [
    { key: 'zone_code', label: 'Cod zonă', mono: true },
    { key: 'zone_name', label: 'Denumire' },
    { key: 'zone_type', label: 'Tip' },
    { key: 'is_active', label: 'Activă', render: (r) => r.is_active ? 'Da' : 'Nu' },
    { key: 'actions', label: '', render: (r) => (
      <div style={{ display: 'flex', gap: 4 }}>
        <button className="btn btn-sm" onClick={(e) => { e.stopPropagation(); openEdit(r); }} aria-label="Edit" title="Edit">&#9998;</button>
        <button className="btn btn-sm btn-danger" onClick={(e) => { e.stopPropagation(); setDeleteTarget(r); }} aria-label="Delete" title="Delete">&#128465;</button>
      </div>
    )},
  ];

  return (
    <div>
      <PageHeader title="Zone depozit">
        <Link className="btn" to="/data/labels">Tipărește etichete</Link>
        <button className="btn btn-primary" onClick={openAreaSetup}>Configurează cele 4 zone</button>
        <button className="btn" onClick={openCreate}>Zonă nouă</button>
      </PageHeader>
      {success ? <div className="form-success" role="status" style={{ marginBottom: 12 }}>{success}</div> : null}
      <DataTable rowKey="zone_id" columns={columns} data={zones} emptyMessage="Nu există zone" />

      {showAreaSetup && (
        <Modal
          title="Configurează zonele fizice ale magazinului"
          onClose={() => { setShowAreaSetup(false); setError(''); }}
          footer={
            <>
              <button className="btn" onClick={() => { setShowAreaSetup(false); setError(''); }}>Renunță</button>
              <button className="btn btn-primary" disabled={savingAreaSetup} onClick={saveAreaSetup}>
                {savingAreaSetup ? 'Se salvează…' : 'Creează cele 4 zone'}
              </button>
            </>
          }
        >
          <p style={{ marginTop: 0, color: 'var(--text-secondary)', fontSize: 13 }}>
            Vor fi create sau actualizate zonele Bucătărie, Baie, Spatele magazinului și Fața magazinului. Operația nu mută stocul; bin-urile existente rămân intacte și pot fi atribuite ulterior zonei corecte.
          </p>
          {error ? <div className="form-error" style={{ marginBottom: 12 }}>{error}</div> : null}
          <div className="warehouse-area-grid">
            {warehouseAreas.map((zone, index) => (
              <fieldset className="section" key={`${index}-${zone.zone_code}`} style={{ padding: 14 }}>
                <legend style={{ padding: '0 6px', fontWeight: 700 }}>Zona {index + 1}</legend>
                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor={`warehouse-area-code-${index}`}>Cod</label>
                    <input
                      id={`warehouse-area-code-${index}`}
                      className="form-input"
                      value={zone.zone_code}
                      maxLength={32}
                      onChange={(event) => updateWarehouseArea(index, 'zone_code', event.target.value)}
                    />
                  </div>
                </div>
                <div className="form-group">
                  <label htmlFor={`warehouse-area-name-${index}`}>Denumire</label>
                  <input
                    id={`warehouse-area-name-${index}`}
                    className="form-input"
                    value={zone.zone_name}
                    maxLength={128}
                    onChange={(event) => updateWarehouseArea(index, 'zone_name', event.target.value)}
                  />
                </div>
              </fieldset>
            ))}
          </div>
        </Modal>
      )}

      {showModal && (
        <Modal
          title={editId ? 'Editează zona' : 'Zonă nouă'}
          onClose={() => { setShowModal(false); setError(''); }}
          footer={
            <>
              <button className="btn" onClick={() => { setShowModal(false); setError(''); }}>Renunță</button>
              <button className="btn btn-primary" onClick={save}>Salvează</button>
            </>
          }
        >
          {error && <div className="form-error" style={{ marginBottom: 12 }}>{error}</div>}
          <div className="form-group">
            <label>Cod zonă</label>
            <input className="form-input" value={form.zone_code || ''} onChange={(e) => setForm({ ...form, zone_code: e.target.value })} />
          </div>
          <div className="form-group">
            <label>Denumire zonă</label>
            <input className="form-input" value={form.zone_name || ''} onChange={(e) => setForm({ ...form, zone_name: e.target.value })} />
          </div>
          <div className="form-group">
            <label>Tip</label>
            <select className="form-select" value={form.zone_type || ''} onChange={(e) => setForm({ ...form, zone_type: e.target.value })}>
              <option value="">Selectează tipul</option>
              {ZONE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </Modal>
      )}

      {deleteTarget && (
        <Modal
          title={`Delete zone ${deleteTarget.zone_code || ''}?`}
          onClose={() => setDeleteTarget(null)}
          footer={
            <>
              <button className="btn" onClick={() => setDeleteTarget(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={deleteZone}>Delete</button>
            </>
          }
        >
          <p style={{ fontSize: 13 }}>
            This permanently removes the zone. Bins assigned to it must be
            reassigned or deleted first.
          </p>
          {error && <div className="form-error" style={{ marginTop: 12 }}>{error}</div>}
        </Modal>
      )}
    </div>
  );
}
