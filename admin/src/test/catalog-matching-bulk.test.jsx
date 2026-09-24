import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const { get, post, del } = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  del: vi.fn(),
}));

vi.mock('../api.js', () => ({ api: { get, post, delete: del } }));

import CatalogMatching from '../pages/CatalogMatching.jsx';

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn(async () => payload),
  };
}

const discovery = {
  discovery_id: 41,
  item_id: 91,
  ean: '5941234567890',
  sku: 'SCAN-5941234567890',
  item_name: 'Produs nou – 5941234567890',
  quantity_on_hand: 3,
  locations: [{ bin_code: 'A-a-1', quantity: 3 }],
  status: 'PENDING',
  created_by: 'admin',
};

const page = (discoveries = [discovery]) => ({
  discoveries,
  total: discoveries.length,
  page: 1,
  pages: 1,
  per_page: 25,
});

describe('echivalarea TecDoc în masă și ștergerea produselor scanate', () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
    del.mockReset();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  it('trimite selecția EAN într-o singură operație bulk', async () => {
    get.mockResolvedValueOnce(jsonResponse(page())).mockResolvedValueOnce(jsonResponse(page([])));
    post.mockResolvedValueOnce(jsonResponse({
      ok: true,
      summary: { requested: 1, matched: 1, not_found: 0, ambiguous: 0, skipped: 0, failed: 0 },
      results: [{ discovery_id: 41, status: 'matched' }],
    }));

    render(<CatalogMatching />);
    const checkbox = await screen.findByRole('checkbox', { name: 'Selectează 5941234567890 pentru echivalare automată' });
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole('button', { name: 'Echivalează automat după EAN (1)' }));

    await waitFor(() => expect(post).toHaveBeenCalledWith('/catalog-discovery/queue/bulk-match', { discovery_ids: [41] }));
    expect(await screen.findByText(/1 echivalate · 0 fără potrivire/)).toBeInTheDocument();
  });

  it('șterge explicit produsul provizoriu din listă', async () => {
    get.mockResolvedValueOnce(jsonResponse(page())).mockResolvedValueOnce(jsonResponse(page([])));
    del.mockResolvedValueOnce(jsonResponse({ ok: true, deleted_item_id: 91, quantity_removed: 3 }));

    render(<CatalogMatching />);
    fireEvent.click(await screen.findByRole('button', { name: 'Șterge' }));

    await waitFor(() => expect(del).toHaveBeenCalledWith('/catalog-discovery/queue/41'));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('Se elimină 3 buc. din A-a-1: 3'));
  });

  it('confirmă vizibil echivalarea manuală și scoate produsul din așteptare', async () => {
    get
      .mockResolvedValueOnce(jsonResponse(page()))
      .mockResolvedValueOnce(jsonResponse({
        searchedBy: 'ean',
        matches: [{ id: '123', code: 'C113', brand: 'DOLZ', name: 'Pompă apă', matchType: 'ean' }],
      }))
      .mockResolvedValueOnce(jsonResponse(page([])));
    post.mockResolvedValueOnce(jsonResponse({ ok: true, item_id: 91, status: 'MATCHED' }));

    render(<CatalogMatching />);
    fireEvent.click(await screen.findByRole('button', { name: 'Compară TecDoc' }));
    fireEvent.change(screen.getByPlaceholderText('Ex: C113'), { target: { value: 'C113' } });
    fireEvent.click(screen.getByRole('button', { name: 'Caută în TecDoc' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Alege' }));

    expect(await screen.findByRole('status')).toHaveTextContent('5941234567890 a fost echivalat cu DOLZ C113');
    expect(screen.getByRole('button', { name: 'Vezi echivalatele' })).toBeInTheDocument();
    await waitFor(() => expect(post).toHaveBeenCalledWith('/catalog-discovery/queue/41/match', {
      articleId: '123', code: 'C113', reference: 'C113', confirmEquivalent: false,
    }));
  });
});
