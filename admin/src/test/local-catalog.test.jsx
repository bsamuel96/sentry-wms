import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
const { get, post, put } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn() }));
vi.mock('../api.js', () => ({ api: { get, post, put } }));
import LocalCatalogPanel from '../components/LocalCatalogPanel.jsx';

const response = data => ({ ok: true, json: async () => data });
const catalog = { name: 'Filtru', brand: 'Marca', code: 'ABC', eans: ['123'], images: [], references: [] };
const quote = { id: '321', code: 'ABC', price: 160, raw_price: 100, net_price: 132.23, vat_percent: 21, checked_at: '2026-09-29T10:00:00Z', currency: 'RON' };

describe('Local catalogue editor', () => {
  beforeEach(() => { get.mockReset(); post.mockReset(); put.mockReset(); });

  it('preserves the manual price on refresh and requires a separate action to use Connex', async () => {
    get.mockResolvedValue(response({ status: 'MATCHED', catalog, pricing: { source: 'manual', price: 150, connex: quote } }));
    post.mockResolvedValueOnce(response({ pricing: { source: 'manual', price: 150, connex: { ...quote, price: 170 } } }))
      .mockResolvedValueOnce(response({ pricing: { source: 'connex', price: 170, connex: { ...quote, price: 170 } } }));
    render(<LocalCatalogPanel itemId={91} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Actualizează referința Connex' }));
    expect(await screen.findByText('Referința Connex a fost actualizată. Prețul tău a fost păstrat.')).toBeInTheDocument();
    expect(screen.getByLabelText('Preț Local cu TVA (RON)')).toHaveValue('150');
    fireEvent.click(screen.getByRole('button', { name: 'Folosește prețul Connex' }));
    await waitFor(() => expect(screen.getByLabelText('Preț Local cu TVA (RON)')).toHaveValue('170'));
    expect(post).toHaveBeenLastCalledWith('/admin/items/91/local-price', { action: 'use_connex' });
    expect(screen.queryByText('Identificare manuală · date produs')).not.toBeInTheDocument();
  });

  it('saves a manually identified product with barcode, images and OE references', async () => {
    get.mockResolvedValue(response({ status: 'PENDING', catalog, pricing: {} }));
    put.mockResolvedValue(response({ status: 'MANUAL', catalog, pricing: {} }));
    render(<LocalCatalogPanel itemId={91} />);
    fireEvent.change(await screen.findByLabelText('Denumire'), { target: { value: 'Produs manual' } });
    fireEvent.change(screen.getByLabelText('Imagini (URL HTTPS, unul pe rând)'), { target: { value: 'https://example.test/image.jpg' } });
    fireEvent.click(screen.getByRole('button', { name: 'Adaugă referință' }));
    fireEvent.change(screen.getByLabelText('Cod referință'), { target: { value: 'OE999' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvează datele produsului' }));
    await waitFor(() => expect(put).toHaveBeenCalledWith('/admin/items/91/local-catalog', expect.objectContaining({ name: 'Produs manual', images: ['https://example.test/image.jpg'], references: [{ code: 'OE999', type: 'OE', manufacturer: '' }] })));
  });

  it('does not save a price just by looking up Connex candidates', async () => {
    get.mockResolvedValue(response({ status: 'MATCHED', catalog, pricing: {} }));
    post.mockResolvedValueOnce(response({ matches: [quote] }))
      .mockResolvedValueOnce(response({ pricing: { price: 160, source: 'connex', connex: quote } }));
    render(<LocalCatalogPanel itemId={91} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Echivalează prețul cu Connex' }));
    const choose = await screen.findByRole('button', { name: 'Alege referința Connex' });
    expect(post).toHaveBeenCalledTimes(1);
    fireEvent.click(choose);
    await waitFor(() => expect(post).toHaveBeenLastCalledWith('/admin/items/91/local-price', { action: 'refresh', reference: 'ABC', product_id: '321' }));
  });
});
