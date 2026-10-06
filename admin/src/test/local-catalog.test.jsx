import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
const { get, post, put, upload } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), upload: vi.fn() }));
vi.mock('../api.js', () => ({ api: { get, post, put, upload } }));
import LocalCatalogPanel from '../components/LocalCatalogPanel.jsx';

const response = data => ({ ok: true, json: async () => data });
const catalog = { name: 'Filtru', brand: 'Marca', code: 'ABC', eans: ['123'], images: [], references: [] };
const quote = { id: '321', code: 'ABC', price: 160, raw_price: 100, net_price: 132.23, vat_percent: 21, checked_at: '2026-09-29T10:00:00Z', currency: 'RON' };

describe('Local catalogue editor', () => {
  beforeEach(() => { get.mockReset(); post.mockReset(); put.mockReset(); upload.mockReset(); URL.createObjectURL = vi.fn(() => 'blob:preview'); URL.revokeObjectURL = vi.fn(); });

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
  it('previews a chosen photo, uploads on save, and reuses it after a catalogue save failure', async () => {
    get.mockResolvedValue(response({ status: 'PENDING', catalog, pricing: {} }));
    const image = 'https://wms.example.test/api/admin/catalog-images/photo-id';
    upload.mockResolvedValue(response({ image_url: image }));
    put.mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Reîncearcă salvarea.' }) })
      .mockResolvedValueOnce(response({ status: 'MANUAL', catalog: { ...catalog, images: [image] }, pricing: {} }));
    const saved = vi.fn();
    render(<LocalCatalogPanel itemId={91} onSaved={saved} />);
    const input = await screen.findByLabelText('Alege o fotografie');
    const click = vi.spyOn(input, 'click');
    fireEvent.click(screen.getByRole('button', { name: 'Încarcă poză' }));
    expect(click).toHaveBeenCalledOnce();
    const file = new File(['photo'], 'produs.jpg', { type: 'image/jpeg' });
    fireEvent.change(input, { target: { files: [file] } });
    expect(await screen.findByAltText('Previzualizare fotografie nouă')).toHaveAttribute('src', 'blob:preview');
    expect(upload).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Salvează datele produsului' }));
    expect(await screen.findByText('Reîncearcă salvarea.')).toBeInTheDocument();
    expect(upload).toHaveBeenCalledWith('/admin/items/91/catalog-images', expect.any(FormData));
    expect(upload.mock.calls[0][1].get('file')).toBe(file);
    expect(put).toHaveBeenCalledWith('/admin/items/91/local-catalog', expect.objectContaining({ images: [image] }));
    expect(saved).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Salvează datele produsului' }));
    await waitFor(() => expect(saved).toHaveBeenCalledOnce());
    expect(upload).toHaveBeenCalledOnce();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview');
  });

  it('rejects oversized and unsupported photos before upload', async () => {
    get.mockResolvedValue(response({ status: 'PENDING', catalog, pricing: {} }));
    render(<LocalCatalogPanel itemId={91} />);
    const input = await screen.findByLabelText('Alege o fotografie');
    fireEvent.change(input, { target: { files: [new File(['text'], 'note.txt', { type: 'text/plain' })] } });
    expect(await screen.findByRole('alert')).toHaveTextContent('JPG, PNG sau WebP');
    const big = new File(['x'], 'big.jpg', { type: 'image/jpeg' });
    Object.defineProperty(big, 'size', { value: 4 * 1024 * 1024 + 1 });
    fireEvent.change(input, { target: { files: [big] } });
    expect(await screen.findByRole('alert')).toHaveTextContent('maximum 4 MB');
    expect(upload).not.toHaveBeenCalled();
    expect(screen.queryByAltText('Previzualizare fotografie nouă')).not.toBeInTheDocument();
  });

  it('opens saved and newly selected product photos in an enlarged modal', async () => {
    get.mockResolvedValue(response({ status: 'PENDING', catalog: { ...catalog, images: ['https://example.test/photo.jpg'] }, pricing: {} }));
    render(<LocalCatalogPanel itemId={91} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Mărește fotografia 1' }));
    expect(screen.getByRole('img', { name: 'Fotografie produs 1 mărită' })).toHaveAttribute('src', 'https://example.test/photo.jpg');
    fireEvent.click(screen.getByRole('button', { name: 'Închide' }));
    const input = screen.getByLabelText('Alege o fotografie');
    fireEvent.change(input, { target: { files: [new File(['photo'], 'produs.jpg', { type: 'image/jpeg' })] } });
    fireEvent.click(await screen.findByRole('button', { name: 'Mărește fotografia nouă' }));
    expect(screen.getByRole('img', { name: 'Previzualizare fotografie nouă mărită' })).toHaveAttribute('src', 'blob:preview');
  });

  it('keeps the product open when completion fails and validates required fields before sending', async () => {
    get.mockResolvedValue(response({ status: 'PENDING', catalog, pricing: {} }));
    put.mockResolvedValue({ ok: false, json: async () => ({ error: 'Salvarea a eșuat.' }) });
    const saved = vi.fn();
    render(<LocalCatalogPanel itemId={91} onSaved={saved} />);
    fireEvent.change(await screen.findByLabelText('Producător / marcă'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvează și scoate din listă' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(put).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Producător / marcă'), { target: { value: 'Marca' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvează și scoate din listă' }));
    expect(await screen.findByText('Salvarea a eșuat.')).toBeInTheDocument();
    expect(put).toHaveBeenCalledWith('/admin/items/91/local-catalog', expect.objectContaining({ complete: true }));
    expect(saved).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Salvează și scoate din listă' })).toBeEnabled();
  });

});
