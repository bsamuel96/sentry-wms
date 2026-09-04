import React from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom';

const logout = vi.fn();
vi.mock('../auth.jsx', () => ({
  useAuth: () => ({
    user: { username: 'admin', full_name: 'Admin Autosav', role: 'ADMIN' },
    logout,
  }),
}));

vi.mock('../warehouse.jsx', () => ({
  useWarehouse: () => ({
    warehouses: [{ warehouse_id: 1, warehouse_code: 'WH-01', warehouse_name: 'Negoesti' }],
    warehouseId: 1,
    warehouse: { warehouse_id: 1, warehouse_code: 'WH-01' },
    setWarehouseId: vi.fn(),
  }),
}));

vi.mock('../api.js', () => ({
  api: {
    get: vi.fn(async (path) => ({
      ok: true,
      json: async () => (path.includes('dashboard') ? {} : { version: 'test', value: 'false' }),
    })),
  },
}));

import Layout from '../components/Layout.jsx';
import Modal from '../components/Modal.jsx';
import TopBar from '../components/TopBar.jsx';

describe('interfața mobilă', () => {
  it('deschide drawer-ul peste pagină și îl închide cu Escape', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<div>Conținut</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Deschide meniul' }));
    expect(screen.getByRole('navigation', { name: 'Navigare principală' })).toHaveClass('mobile-open');
    expect(document.querySelector('.sidebar-backdrop')).toHaveClass('visible');

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.getByRole('navigation', { name: 'Navigare principală' })).not.toHaveClass('mobile-open');
    });
  });

  it('mută focusul în modal și îl închide cu Escape', () => {
    const onClose = vi.fn();
    render(<Modal title="Detalii" onClose={onClose}>Conținut</Modal>);
    expect(screen.getByRole('dialog', { name: 'Detalii' })).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('instalarea PWA', () => {
  it('afișează acțiunea de instalare numai după evenimentul browserului', async () => {
    const prompt = vi.fn(async () => undefined);
    const event = new Event('beforeinstallprompt');
    Object.defineProperty(event, 'prompt', { value: prompt });
    Object.defineProperty(event, 'userChoice', { value: Promise.resolve({ outcome: 'accepted' }) });

    render(<MemoryRouter><TopBar /></MemoryRouter>);
    fireEvent(window, event);
    fireEvent.click(screen.getByRole('button', { name: 'Meniu utilizator' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Instalează aplicația' }));
    await waitFor(() => expect(prompt).toHaveBeenCalledTimes(1));
  });

  it('manifestul și workerul păstrează datele API în afara cache-ului', () => {
    const manifest = JSON.parse(readFileSync(join(process.cwd(), 'public/manifest.webmanifest'), 'utf8'));
    const worker = readFileSync(join(process.cwd(), 'public/sw.js'), 'utf8');
    expect(manifest.name).toBe('Sentry WMS');
    expect(manifest.display).toBe('standalone');
    expect(manifest.icons.map((icon) => icon.sizes)).toEqual(['192x192', '512x512']);
    expect(worker).toContain("url.pathname.startsWith('/api/')");
    expect(worker).toContain("request.method !== 'GET'");
  });
});
