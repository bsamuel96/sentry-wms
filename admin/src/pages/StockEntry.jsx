import { useCallback, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import BarcodeCameraModal from '../components/BarcodeCameraModal.jsx';
import PageHeader from '../components/PageHeader.jsx';
import { useWarehouse } from '../warehouse.jsx';

const PRODUCT_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/+*-]{5,49}$/;

function requestId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const values = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(values);
  } else {
    for (let index = 0; index < values.length; index += 1) values[index] = Math.floor(Math.random() * 256);
  }
  values[6] = (values[6] & 0x0f) | 0x40;
  values[8] = (values[8] & 0x3f) | 0x80;
  const hex = [...values].map((value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function readError(response, fallback) {
  try {
    const payload = await response?.json();
    return payload?.error || fallback;
  } catch {
    return fallback;
  }
}

function WarehouseStockEntry({ warehouseId, warehouse }) {
  const binInputRef = useRef(null);
  const productInputRef = useRef(null);
  const [binCode, setBinCode] = useState('');
  const [bin, setBin] = useState(null);
  const [newBinCode, setNewBinCode] = useState('');
  const [productCode, setProductCode] = useState('');
  const [item, setItem] = useState(null);
  const [entryKey, setEntryKey] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [cameraTarget, setCameraTarget] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [sessionEntries, setSessionEntries] = useState([]);

  const quantityNumber = useMemo(() => Number.parseInt(quantity, 10) || 0, [quantity]);

  function clearProduct({ focus = true } = {}) {
    setProductCode('');
    setItem(null);
    setEntryKey('');
    setQuantity('1');
    if (focus) window.setTimeout(() => productInputRef.current?.focus(), 0);
  }

  const selectBin = useCallback(async (rawCode) => {
    const code = String(rawCode || '').trim();
    if (!warehouseId) {
      setError('Selectează mai întâi depozitul din bara de sus.');
      return;
    }
    if (!code) return;
    setBusy('bin');
    setError('');
    setSuccess('');
    setNewBinCode('');
    try {
      const response = await api.get(`/lookup/bin/${encodeURIComponent(code)}`);
      if (response?.status === 404) {
        setBin(null);
        setNewBinCode(code);
        return;
      }
      if (!response?.ok) throw new Error(await readError(response, 'Locația nu a putut fi verificată.'));
      const payload = await response.json();
      if (Number(payload.bin?.warehouse_id) !== Number(warehouseId)) {
        throw new Error('Locația nu aparține depozitului selectat.');
      }
      setBin(payload.bin);
      setBinCode(payload.bin.bin_code);
      clearProduct();
    } catch (lookupError) {
      setError(lookupError.message || 'Locația nu a putut fi verificată.');
    } finally {
      setBusy('');
    }
  }, [warehouseId]);

  async function registerBin() {
    if (!warehouseId || !newBinCode || busy) return;
    setBusy('register-bin');
    setError('');
    try {
      const response = await api.post('/inventory/stock-entry/bin', {
        warehouse_id: warehouseId,
        bin_code: newBinCode,
        zone_code: 'PICK',
      });
      if (!response?.ok) throw new Error(await readError(response, 'Locația nu a putut fi creată.'));
      const payload = await response.json();
      setBin(payload.bin);
      setBinCode(payload.bin.bin_code);
      setNewBinCode('');
      setSuccess(payload.created ? `Locația ${payload.bin.bin_code} a fost creată.` : `Locația ${payload.bin.bin_code} este activă.`);
      clearProduct();
    } catch (registerError) {
      setError(registerError.message || 'Locația nu a putut fi creată.');
    } finally {
      setBusy('');
    }
  }

  const selectProduct = useCallback(async (rawCode) => {
    const code = String(rawCode || '').trim();
    if (!bin) {
      setError('Scanează mai întâi locația.');
      return;
    }
    if (!PRODUCT_CODE_PATTERN.test(code)) {
      setError('Scanează un cod de produs de 6–50 de caractere. Sunt acceptate cifre, litere, punct, cratimă, / și +.');
      return;
    }
    setBusy('product');
    setError('');
    setSuccess('');
    setProductCode(code);
    setQuantity('1');
    setEntryKey(requestId());
    try {
      const response = await api.get(`/lookup/item/${encodeURIComponent(code)}`);
      if (response?.status === 404) {
        setItem({
          sku: `SCAN-${code}`,
          item_name: 'Produs nou · va fi echivalat ulterior în TecDoc',
          provisional: true,
        });
        return;
      }
      if (!response?.ok) throw new Error(await readError(response, 'Produsul nu a putut fi verificat.'));
      const payload = await response.json();
      setItem(payload.item);
    } catch (lookupError) {
      setProductCode('');
      setEntryKey('');
      setItem(null);
      setError(lookupError.message || 'Produsul nu a putut fi verificat.');
    } finally {
      setBusy('');
    }
  }, [bin]);

  async function saveEntry() {
    if (!warehouseId || !bin?.bin_id || !productCode || !entryKey || busy) return;
    if (quantityNumber < 1 || quantityNumber > 100000) {
      setError('Cantitatea trebuie să fie între 1 și 100000.');
      return;
    }
    setBusy('save');
    setError('');
    setSuccess('');
    try {
      const response = await api.post('/inventory/stock-entry', {
        warehouse_id: warehouseId,
        bin_id: bin.bin_id,
        barcode: productCode,
        quantity: quantityNumber,
        idempotency_key: entryKey,
      });
      if (!response?.ok) throw new Error(await readError(response, 'Produsul nu a putut fi introdus în stoc.'));
      const payload = await response.json();
      setSessionEntries((current) => [{
        id: payload.stock_entry_id,
        sku: payload.item?.sku || productCode,
        name: payload.item?.item_name || 'Produs',
        quantity: payload.quantity_added,
        total: payload.quantity_in_bin,
        pending: payload.catalog_status === 'PENDING',
      }, ...current].slice(0, 12));
      setSuccess(`Adăugat: ${payload.quantity_added} buc. în ${bin.bin_code}.`);
      clearProduct();
    } catch (saveError) {
      // Keep entryKey intact. A second click after a timeout is an
      // idempotent replay and cannot add the same physical pieces twice.
      setError(saveError.message || 'Produsul nu a putut fi introdus în stoc.');
    } finally {
      setBusy('');
    }
  }

  function submitBin(event) {
    event.preventDefault();
    selectBin(binCode);
  }

  function submitProduct(event) {
    event.preventDefault();
    selectProduct(productCode);
  }

  function handleCameraResult(value) {
    if (cameraTarget === 'bin') {
      setBinCode(value);
      selectBin(value);
    } else {
      setProductCode(value);
      selectProduct(value);
    }
    setCameraTarget('');
  }

  return (
    <div className="stock-entry-page">
      <PageHeader title="Introducere marfă prin scanare" />
      <p className="stock-entry-intro">
        Scanează locația, apoi produsele de pe raft. Codurile necunoscute sunt salvate imediat și apar în „Echivalare TecDoc” pentru identificare ulterioară.
      </p>

      {!warehouseId ? <div className="alert alert-error" role="alert">Selectează un depozit din bara de sus.</div> : null}
      {error ? <div className="alert alert-error" role="alert">{error}</div> : null}
      {success ? <div className="alert alert-success" role="status">{success}</div> : null}

      <div className="stock-entry-grid">
        <section className={`stock-entry-step card${bin ? ' is-complete' : ''}`}>
          <div className="stock-entry-step-heading">
            <span className="stock-entry-step-number">{bin ? '✓' : '1'}</span>
            <div>
              <h2>Scanează locația</h2>
              <p>Locația rămâne activă pentru toate produsele următoare.</p>
            </div>
          </div>

          {bin ? (
            <div className="stock-entry-active-bin">
              <div><small>LOCAȚIE ACTIVĂ</small><strong className="mono">{bin.bin_code}</strong></div>
              <button type="button" className="btn" onClick={() => {
                setBin(null);
                setBinCode('');
                setNewBinCode('');
                clearProduct({ focus: false });
                window.setTimeout(() => binInputRef.current?.focus(), 0);
              }}>Schimbă</button>
            </div>
          ) : (
            <form className="stock-entry-scan-row" onSubmit={submitBin}>
              <label className="stock-entry-input-wrap">
                <span>Cod locație / bin</span>
                <input
                  ref={binInputRef}
                  className="form-input mono"
                  value={binCode}
                  onChange={(event) => setBinCode(event.target.value)}
                  placeholder="Scanează și apasă Enter"
                  autoComplete="off"
                  autoFocus
                  disabled={!warehouseId || Boolean(busy)}
                />
              </label>
              <button type="submit" className="btn btn-primary" disabled={!binCode.trim() || Boolean(busy)}>{busy === 'bin' ? 'Se verifică…' : 'Confirmă'}</button>
              <button type="button" className="btn" onClick={() => setCameraTarget('bin')} disabled={!warehouseId || Boolean(busy)}>▣ Cameră</button>
            </form>
          )}

          {newBinCode ? (
            <div className="stock-entry-new-bin">
              <strong>Locația <span className="mono">{newBinCode}</span> nu există.</strong>
              <p>O poți crea în zona PICK și continua imediat introducerea produselor.</p>
              <div className="stock-entry-actions">
                <button type="button" className="btn btn-primary" onClick={registerBin} disabled={Boolean(busy)}>{busy === 'register-bin' ? 'Se creează…' : 'Creează locația'}</button>
                <button type="button" className="btn" onClick={() => { setNewBinCode(''); setBinCode(''); binInputRef.current?.focus(); }} disabled={Boolean(busy)}>Scanează din nou</button>
              </div>
            </div>
          ) : null}
        </section>

        <section className={`stock-entry-step card${!bin ? ' is-disabled' : ''}${item ? ' is-complete' : ''}`}>
          <div className="stock-entry-step-heading">
            <span className="stock-entry-step-number">{item ? '✓' : '2'}</span>
            <div>
              <h2>Scanează produsul</h2>
              <p>Poți folosi EAN, UPC, SKU sau codul tipărit de furnizor.</p>
            </div>
          </div>

          {bin && !item ? (
            <form className="stock-entry-scan-row" onSubmit={submitProduct}>
              <label className="stock-entry-input-wrap">
                <span>EAN / cod produs</span>
                <input
                  ref={productInputRef}
                  className="form-input mono"
                  value={productCode}
                  onChange={(event) => setProductCode(event.target.value)}
                  placeholder="Scanează și apasă Enter"
                  autoComplete="off"
                  disabled={Boolean(busy)}
                />
              </label>
              <button type="submit" className="btn btn-primary" disabled={!productCode.trim() || Boolean(busy)}>{busy === 'product' ? 'Se verifică…' : 'Confirmă'}</button>
              <button type="button" className="btn" onClick={() => setCameraTarget('product')} disabled={Boolean(busy)}>▣ Cameră</button>
            </form>
          ) : null}

          {item ? (
            <div className="stock-entry-product">
              <div className="stock-entry-product-summary">
                <div>
                  <strong className="mono">{item.sku || productCode}</strong>
                  <span>{item.item_name || 'Produs'}</span>
                  <small className="mono">COD SCANAT {productCode}</small>
                </div>
                <span className={`tag ${item.provisional ? 'tag-info' : 'tag-success'}`}>
                  {item.provisional ? 'TECDOC ÎN AȘTEPTARE' : 'IDENTIFICAT'}
                </span>
              </div>
              <div className="stock-entry-quantity">
                <label htmlFor="stock-entry-quantity">Cantitate</label>
                <div>
                  <button type="button" className="btn" aria-label="Scade cantitatea" onClick={() => setQuantity(String(Math.max(1, quantityNumber - 1)))} disabled={quantityNumber <= 1 || Boolean(busy)}>−</button>
                  <input id="stock-entry-quantity" className="form-input mono" value={quantity} onChange={(event) => setQuantity(event.target.value.replace(/\D/g, ''))} inputMode="numeric" />
                  <button type="button" className="btn" aria-label="Crește cantitatea" onClick={() => setQuantity(String(Math.max(1, quantityNumber + 1)))} disabled={Boolean(busy)}>+</button>
                </div>
              </div>
              <div className="stock-entry-actions">
                <button type="button" className="btn btn-primary stock-entry-save" onClick={saveEntry} disabled={quantityNumber < 1 || Boolean(busy)}>{busy === 'save' ? 'Se salvează…' : `Adaugă în ${bin.bin_code}`}</button>
                <button type="button" className="btn" onClick={() => clearProduct()} disabled={Boolean(busy)}>Anulează produsul</button>
              </div>
            </div>
          ) : null}
        </section>
      </div>

      <section className="card stock-entry-session">
        <div className="card-title">Adăugate în sesiunea curentă · {warehouse?.warehouse_name || warehouse?.warehouse_code || 'Depozit'}</div>
        {sessionEntries.length ? (
          <div className="stock-entry-session-list">
            {sessionEntries.map((entry) => (
              <div className="stock-entry-session-row" key={entry.id}>
                <div><strong className="mono">{entry.sku}</strong><span>{entry.name}</span>{entry.pending ? <small>În așteptare TecDoc</small> : null}</div>
                <div><strong>+{entry.quantity}</strong><span>{entry.total} în locație</span></div>
              </div>
            ))}
          </div>
        ) : <p className="stock-entry-empty">Produsele salvate în această sesiune vor apărea aici.</p>}
      </section>

      {cameraTarget ? (
        <BarcodeCameraModal
          title={cameraTarget === 'bin' ? 'Scanează locația' : 'Scanează produsul'}
          onClose={() => setCameraTarget('')}
          onDetected={handleCameraResult}
        />
      ) : null}
    </div>
  );
}

export default function StockEntry() {
  const { warehouseId, warehouse } = useWarehouse();
  // A warehouse change starts a clean scanning session. Keying the workflow
  // also prevents a previously selected bin from leaking into another site.
  return <WarehouseStockEntry key={warehouseId || 'no-warehouse'} warehouseId={warehouseId} warehouse={warehouse} />;
}
