export const ROMANIA_VAT_RATE = 0.21;

export function createUuidV4(random = Math.random) {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (token) => {
    const value = Math.floor(random() * 16);
    const nibble = token === 'x' ? value : ((value & 0x3) | 0x8);
    return nibble.toString(16);
  });
}

export function moneyToCents(value) {
  const normalized = String(value ?? '').trim().replace(',', '.');
  if (!/^\d+(?:\.\d{0,2})?$/.test(normalized)) return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100);
}

export function formatMoney(cents) {
  return `${(Number(cents || 0) / 100).toFixed(2)} RON`;
}

export function locationsForWarehouse(availability = [], warehouseCode = '') {
  const normalizedCode = String(warehouseCode || '').trim().toUpperCase();
  return (availability || [])
    .filter((warehouse) => (
      !normalizedCode
      || String(warehouse.warehouse_id || '').trim().toUpperCase() === normalizedCode
    ))
    .flatMap((warehouse) => (warehouse.bins || []).map((bin) => ({
      warehouseId: warehouse.warehouse_id,
      warehouseName: warehouse.warehouse_name || warehouse.warehouse_id,
      binId: bin.bin_id,
      binName: bin.bin_name || bin.bin_id,
      available: Number(bin.qty || 0),
    })))
    .filter((location) => location.available > 0)
    .sort((left, right) => (
      right.available - left.available
      || String(left.binId).localeCompare(String(right.binId), 'ro', { numeric: true })
    ));
}

export function upsertCartLine(cart = [], item, location) {
  const existingIndex = cart.findIndex((line) => (
    line.sku === item.sku
    && line.warehouseId === location.warehouseId
    && line.binId === location.binId
  ));
  if (existingIndex === -1) {
    return [...cart, {
      sku: item.sku,
      name: item.name || item.sku,
      barcode: item.barcode || '',
      warehouseId: location.warehouseId,
      warehouseName: location.warehouseName,
      binId: location.binId,
      binName: location.binName,
      available: location.available,
      quantity: 1,
      price: '',
    }];
  }

  return cart.map((line, index) => {
    if (index !== existingIndex) return line;
    return {
      ...line,
      quantity: Math.min(line.available, Number(line.quantity || 0) + 1),
      available: location.available,
    };
  });
}

export function checkoutTotals(cart = []) {
  return cart.reduce((totals, line) => {
    const grossUnitCents = moneyToCents(line.price);
    if (grossUnitCents == null) return totals;
    const grossCents = grossUnitCents * Number(line.quantity || 0);
    const netCents = Math.round(grossCents / (1 + ROMANIA_VAT_RATE));
    return {
      subtotalCents: totals.subtotalCents + netCents,
      taxCents: totals.taxCents + grossCents - netCents,
      totalCents: totals.totalCents + grossCents,
    };
  }, { subtotalCents: 0, taxCents: 0, totalCents: 0 });
}

export function validateCheckoutInput({ cart, paymentMethod, cashTendered, card }) {
  if (!Array.isArray(cart) || cart.length === 0) {
    throw new Error('Coșul este gol. Scanează cel puțin un produs.');
  }
  cart.forEach((line) => {
    const quantity = Number(line.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > Number(line.available || 0)) {
      throw new Error(`Cantitatea pentru ${line.sku} trebuie să fie între 1 și ${line.available}.`);
    }
    if (moneyToCents(line.price) == null) {
      throw new Error(`Introdu un preț final valid pentru ${line.sku}.`);
    }
  });

  const totals = checkoutTotals(cart);
  if (paymentMethod === 'cash') {
    const tendered = moneyToCents(cashTendered);
    if (tendered == null || tendered < totals.totalCents) {
      throw new Error('Suma primită trebuie să acopere totalul vânzării.');
    }
  } else if (paymentMethod === 'card') {
    if (!String(card?.brand || '').trim()) throw new Error('Introdu marca cardului.');
    if (!/^\d{4}$/.test(String(card?.last4 || '').trim())) throw new Error('Ultimele 4 cifre ale cardului sunt obligatorii.');
    if (!String(card?.authCode || '').trim()) throw new Error('Codul de autorizare este obligatoriu.');
    if (!String(card?.externalRef || '').trim()) throw new Error('Referința tranzacției este obligatorie.');
  } else {
    throw new Error('Selectează metoda de plată.');
  }
  return totals;
}

export function buildCheckoutPayload({
  cart,
  paymentMethod,
  cashTendered,
  card = {},
  cashierId,
  terminalId,
  customer = {},
  memo = '',
  idempotencyKey,
  completedAt,
}) {
  const totals = validateCheckoutInput({ cart, paymentMethod, cashTendered, card });
  const lines = cart.map((line) => {
    const grossUnitCents = moneyToCents(line.price);
    const grossCents = grossUnitCents * Number(line.quantity);
    const netCents = Math.round(grossCents / (1 + ROMANIA_VAT_RATE));
    return {
      sku: line.sku,
      warehouse_id: line.warehouseId,
      bin_id: line.binId,
      quantity: Number(line.quantity),
      unit_price_cents: Math.round(grossUnitCents / (1 + ROMANIA_VAT_RATE)),
      tax_cents: grossCents - netCents,
      line_total_cents: grossCents,
    };
  });

  const tender = paymentMethod === 'cash'
    ? {
        type: 'cash',
        amount_cents: totals.totalCents,
        amount_tendered_cents: moneyToCents(cashTendered),
        change_cents: moneyToCents(cashTendered) - totals.totalCents,
      }
    : {
        type: 'card',
        amount_cents: totals.totalCents,
        card_brand: String(card.brand).trim(),
        card_last4: String(card.last4).trim(),
        auth_code: String(card.authCode).trim(),
        external_ref: String(card.externalRef).trim(),
      };

  return {
    idempotency_key: idempotencyKey,
    external_txn_ref: paymentMethod === 'card' ? tender.external_ref : null,
    cashier_id: String(cashierId || '').trim(),
    terminal_id: String(terminalId || '').trim(),
    completed_at: completedAt,
    payment_summary: {
      method: paymentMethod,
      subtotal_cents: totals.subtotalCents,
      tax_cents: totals.taxCents,
      total_cents: totals.totalCents,
      tenders: [tender],
    },
    lines,
    is_phone_order: false,
    customer_name: String(customer.name || '').trim() || null,
    customer_phone: String(customer.phone || '').trim() || null,
    customer_email: null,
    order_origin: 'Sentry Mobile POS',
    memo: String(memo || '').trim() || null,
  };
}

const CONFLICT_MESSAGES = {
  sku_not_found: 'Produsul nu mai există.',
  item_inactive: 'Produsul este inactiv.',
  warehouse_not_found: 'Depozitul nu mai există.',
  warehouse_not_in_scope: 'Nu ai acces la depozitul selectat.',
  bin_not_found: 'Locația nu mai există.',
  insufficient_stock: 'Stocul s-a modificat și nu mai acoperă cantitatea.',
};

export function checkoutErrorMessage(error) {
  const data = error?.response?.data;
  const conflict = data?.conflicts?.[0];
  if (conflict) {
    const base = CONFLICT_MESSAGES[conflict.reason] || 'Coșul nu mai este valid.';
    const suffix = conflict.sku ? ` (${conflict.sku})` : '';
    return `${base}${suffix}`;
  }
  if (data?.error === 'pos_access_denied') return 'Contul nu are dreptul „Vânzare (POS)”.';
  if (data?.error === 'pos_warehouse_access_required') return 'Contul nu are niciun depozit atribuit.';
  if (data?.error_kind === 'fulfillment_failed') return 'Stocul s-a schimbat. Verifică din nou coșul.';
  if (data?.error_kind === 'lock_contention') return 'Stocul este actualizat de alt operator. Reîncearcă imediat.';
  return data?.message || data?.error || error?.message || 'Operația POS nu a putut fi finalizată.';
}
