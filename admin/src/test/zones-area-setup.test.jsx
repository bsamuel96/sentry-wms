import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const apiGetMock = vi.fn();
const apiPostMock = vi.fn();

vi.mock('../api.js', () => ({
  api: {
    get: (...args) => apiGetMock(...args),
    post: (...args) => apiPostMock(...args),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('../warehouse.jsx', () => ({
  useWarehouse: () => ({ warehouseId: 1 }),
}));

import Zones from '../pages/Zones.jsx';

function response(body) {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
}

describe('configurarea zonelor fizice ale magazinului', () => {
  beforeEach(() => {
    apiGetMock.mockReset();
    apiPostMock.mockReset();
    apiGetMock.mockImplementation(() => response({ zones: [] }));
    apiPostMock.mockImplementation(() => response({ count: 4, zones: [] }));
  });

  it('creează zonele Bucătărie, Baie, Spate și Față', async () => {
    render(<MemoryRouter><Zones /></MemoryRouter>);

    await screen.findByText('Nu există zone');
    fireEvent.click(screen.getByRole('button', { name: 'Configurează cele 4 zone' }));
    fireEvent.click(screen.getByRole('button', { name: 'Creează cele 4 zone' }));

    await waitFor(() => expect(apiPostMock).toHaveBeenCalledOnce());
    expect(apiPostMock).toHaveBeenCalledWith('/admin/zones/area-setup', {
      warehouse_id: 1,
      zones: [
        { zone_code: 'BUCATARIE', zone_name: 'Bucătărie', zone_type: 'STORAGE' },
        { zone_code: 'BAIE', zone_name: 'Baie', zone_type: 'STORAGE' },
        { zone_code: 'SPATE', zone_name: 'Spatele magazinului', zone_type: 'STORAGE' },
        { zone_code: 'FATA', zone_name: 'Fața magazinului', zone_type: 'STORAGE' },
      ],
    });
  });
});
