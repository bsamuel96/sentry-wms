import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const { get, post } = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
}));

vi.mock('../api.js', () => ({ api: { get, post } }));
vi.mock('../warehouse.jsx', () => ({
  useWarehouse: () => ({
    warehouseId: 1,
    warehouse: { warehouse_id: 1, warehouse_code: 'WH-01', warehouse_name: 'Negoiești-1' },
  }),
}));

import StockEntry from '../pages/StockEntry.jsx';

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn(async () => payload),
  };
}

describe('introducere marfă prin scanare în web', () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
  });

  it('păstrează locația și salvează un cod necunoscut pentru TecDoc ulterior', async () => {
    get
      .mockResolvedValueOnce(jsonResponse({
        bin: { bin_id: 7, warehouse_id: 1, bin_code: 'A-a-1' },
      }))
      .mockResolvedValueOnce(jsonResponse({ error: 'Item not found' }, 404));
    post.mockResolvedValueOnce(jsonResponse({
      stock_entry_id: 91,
      item: { sku: 'SCAN-5941234567890', item_name: 'Produs nou – 5941234567890' },
      quantity_added: 3,
      quantity_in_bin: 3,
      catalog_status: 'PENDING',
    }, 201));

    render(<StockEntry />);

    fireEvent.change(screen.getByLabelText('Cod locație / bin'), { target: { value: 'A-a-1' } });
    fireEvent.submit(screen.getByLabelText('Cod locație / bin').closest('form'));
    expect(await screen.findByText('LOCAȚIE ACTIVĂ')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('EAN / cod produs'), { target: { value: '5941234567890' } });
    fireEvent.submit(screen.getByLabelText('EAN / cod produs').closest('form'));
    expect(await screen.findByText('TECDOC ÎN AȘTEPTARE')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Cantitate'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Adaugă în A-a-1' }));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0][0]).toBe('/inventory/stock-entry');
    expect(post.mock.calls[0][1]).toMatchObject({
      warehouse_id: 1,
      bin_id: 7,
      barcode: '5941234567890',
      quantity: 3,
    });
    expect(post.mock.calls[0][1].idempotency_key).toMatch(/^[0-9a-f-]{36}$/);
    expect(await screen.findByText('3 în locație')).toBeInTheDocument();
    expect(screen.getByText('A-a-1')).toBeInTheDocument();
    expect(screen.getByLabelText('EAN / cod produs')).toHaveFocus();
  });

  it('permite crearea unei locații scanate care nu există', async () => {
    get.mockResolvedValueOnce(jsonResponse({ error: 'Bin not found' }, 404));
    post.mockResolvedValueOnce(jsonResponse({
      created: true,
      bin: { bin_id: 8, warehouse_id: 1, bin_code: 'B-b-2' },
    }, 201));

    render(<StockEntry />);
    fireEvent.change(screen.getByLabelText('Cod locație / bin'), { target: { value: 'B-b-2' } });
    fireEvent.submit(screen.getByLabelText('Cod locație / bin').closest('form'));
    fireEvent.click(await screen.findByRole('button', { name: 'Creează locația' }));

    await waitFor(() => expect(post).toHaveBeenCalledWith('/inventory/stock-entry/bin', {
      warehouse_id: 1,
      bin_code: 'B-b-2',
      zone_code: 'PICK',
    }));
    expect(await screen.findByText('Locația B-b-2 a fost creată.')).toBeInTheDocument();
  });
});
