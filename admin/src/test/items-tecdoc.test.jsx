import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { get, post, put, del } = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
}));

vi.mock('../api.js', () => ({ api: { get, post, put, delete: del } }));

import Items from '../pages/Items.jsx';

function jsonResponse(payload) {
  return { ok: true, json: vi.fn(async () => payload) };
}

describe('catalogul de produse TecDoc', () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
    put.mockReset();
    del.mockReset();
  });

  it('afișează identitatea, EAN-ul și fotografia TecDoc în rândul produsului', async () => {
    get.mockResolvedValueOnce(jsonResponse({
      items: [{
        item_id: 91,
        sku: 'SCAN-4006381333931',
        item_name: 'DOLZ · Pompă apă',
        upc: '4006381333931',
        category: 'TecDoc',
        is_active: true,
        catalog_status: 'MATCHED',
        tecdoc_code: 'C113',
        tecdoc_brand: 'DOLZ',
        tecdoc_name: 'Pompă apă',
        image_url: 'https://cdn.example.test/c113.jpg',
      }],
      total: 1,
      page: 1,
      pages: 1,
      per_page: 50,
    }));

    render(<MemoryRouter><Items /></MemoryRouter>);

    expect(await screen.findByRole('img', { name: 'Imagine Pompă apă' })).toHaveAttribute('src', 'https://cdn.example.test/c113.jpg');
    expect(screen.getByText('DOLZ')).toBeInTheDocument();
    expect(screen.getByText('Pompă apă')).toBeInTheDocument();
    expect(screen.getByText('C113')).toBeInTheDocument();
    expect(screen.getByText('4006381333931')).toBeInTheDocument();
    expect(screen.getAllByText('TecDoc')).toHaveLength(2);
  });

  it('opens the product image in a modal without opening the product row', async () => {
    get.mockResolvedValueOnce(jsonResponse({
      items: [{ item_id: 91, sku: 'ABC', item_name: 'Filtru ulei', is_active: true, image_url: 'https://cdn.example.test/filter.jpg' }],
      total: 1, page: 1, pages: 1, per_page: 50,
    }));
    render(<MemoryRouter><Items /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Mărește imaginea pentru Filtru ulei' }));
    expect(screen.getByRole('dialog', { name: 'Filtru ulei' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Imagine mărită Filtru ulei' })).toHaveAttribute('src', 'https://cdn.example.test/filter.jpg');
    expect(get).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Închide' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('prefills the edit price, preserves unchanged pricing and saves decimal-comma changes with the product', async () => {
    get.mockResolvedValue(jsonResponse({ items: [{ item_id: 91, sku: 'ABC', item_name: 'Produs', is_active: true, local_pricing: { price: 120, source: 'connex' } }], page: 1, pages: 1, total: 1 }));
    put.mockResolvedValue(jsonResponse({ item_id: 91 }));
    render(<MemoryRouter><Items /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    expect(screen.getByLabelText('Preț Local cu TVA (RON)')).toHaveValue('120');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(put.mock.calls[0][1]).not.toHaveProperty('local_price');
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Preț Local cu TVA (RON)'), { target: { value: '135,50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(put).toHaveBeenLastCalledWith('/admin/items/91', expect.objectContaining({ local_price: '135.50', item_name: 'Produs' })));
  });

  it('blocks invalid prices and keeps edits open on server failure', async () => {
    get.mockResolvedValue(jsonResponse({ items: [{ item_id: 91, sku: 'ABC', item_name: 'Produs', is_active: true }], page: 1, pages: 1, total: 1 }));
    put.mockResolvedValue({ ok: false, json: async () => ({ error: 'Salvarea a eșuat.' }) });
    render(<MemoryRouter><Items /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    const input = screen.getByLabelText('Preț Local cu TVA (RON)');
    fireEvent.change(input, { target: { value: '-10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(put).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: '15' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Salvarea a eșuat.')).toBeInTheDocument();
    expect(input).toHaveValue('15');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

});
