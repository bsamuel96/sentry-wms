import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const apiGetMock = vi.fn();

vi.mock('../api.js', () => ({
  api: {
    get: (...args) => apiGetMock(...args),
  },
}));

vi.mock('../warehouse.jsx', () => ({
  useWarehouse: () => ({
    warehouseId: 1,
    warehouse: { warehouse_id: 1, warehouse_code: 'NEGOESTI' },
  }),
}));

function response(body) {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
}

const BINS = [
  {
    bin_id: 1,
    zone_id: 3,
    bin_code: 'A-a-1',
    bin_barcode: 'A-a-1',
    aisle: 'A',
    row_num: 'a',
    position_num: '1',
    is_active: true,
  },
  {
    bin_id: 2,
    zone_id: 3,
    bin_code: 'A-a-2',
    bin_barcode: 'A-a-2',
    aisle: 'A',
    row_num: 'a',
    position_num: '2',
    is_active: true,
  },
  {
    bin_id: 3,
    zone_id: 3,
    bin_code: 'B-b-1',
    bin_barcode: 'B-b-1',
    aisle: 'B',
    row_num: 'b',
    position_num: '1',
    is_active: true,
  },
];

const ZONES = [
  { zone_id: 1, zone_code: 'BUCATARIE', zone_name: 'Bucătărie', zone_type: 'STORAGE', is_active: true },
  { zone_id: 2, zone_code: 'BAIE', zone_name: 'Baie', zone_type: 'STORAGE', is_active: true },
  { zone_id: 3, zone_code: 'SPATE', zone_name: 'Spatele magazinului', zone_type: 'STORAGE', is_active: true },
  { zone_id: 4, zone_code: 'FATA', zone_name: 'Fața magazinului', zone_type: 'STORAGE', is_active: true },
];

import BinLabels from '../pages/BinLabels.jsx';

describe('Bin and row barcode labels', () => {
  beforeEach(() => {
    apiGetMock.mockReset();
    apiGetMock.mockImplementation((path) => (
      path.startsWith('/admin/zones')
        ? response({ zones: ZONES, page: 1, pages: 1, total: ZONES.length })
        : response({ bins: BINS, page: 1, pages: 1, total: BINS.length })
    ));
    window.print = vi.fn();
  });

  it('selects and renders scannable bin_barcode values in bulk', async () => {
    render(<BinLabels />);

    await screen.findByText('A-a-1');
    fireEvent.click(screen.getByRole('button', { name: 'Selectează toate (3)' }));

    expect(screen.getByRole('img', { name: 'Cod de bare A-a-1' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Cod de bare A-a-2' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Cod de bare B-b-1' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('3 selectate');
  });

  it('deduplicates aisles into printable aisle labels scoped by zone', async () => {
    render(<BinLabels />);

    await screen.findByText('A-a-1');
    fireEvent.click(screen.getByRole('button', { name: 'Culoare' }));
    fireEvent.click(screen.getByRole('button', { name: 'Selectează toate (2)' }));

    expect(screen.getByRole('img', { name: 'Cod de bare AISLE:SPATE:A' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Cod de bare AISLE:SPATE:B' })).toBeInTheDocument();
    expect(screen.getAllByText('CULOAR A').length).toBeGreaterThan(0);
  });

  it('prints zone and shelf labels from the same warehouse hierarchy', async () => {
    render(<BinLabels />);

    await screen.findByText('A-a-1');
    fireEvent.click(screen.getByRole('button', { name: 'Zone' }));
    fireEvent.click(screen.getByRole('button', { name: 'Selectează toate (4)' }));
    expect(screen.getByRole('img', { name: 'Cod de bare ZONE:BUCATARIE' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Cod de bare ZONE:BAIE' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Cod de bare ZONE:SPATE' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Cod de bare ZONE:FATA' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Rafturi' }));
    fireEvent.click(screen.getByRole('button', { name: 'Selectează toate (2)' }));
    expect(screen.getByRole('img', { name: 'Cod de bare SHELF:SPATE:A:A' })).toBeInTheDocument();
  });

  it('prints only after at least one label is selected', async () => {
    render(<BinLabels />);

    await screen.findByText('A-a-1');
    const printButton = screen.getByRole('button', { name: 'Tipărește selecția' });
    expect(printButton).toBeDisabled();

    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    await waitFor(() => expect(printButton).toBeEnabled());
    fireEvent.click(printButton);

    expect(window.print).toHaveBeenCalledOnce();
  });
});
