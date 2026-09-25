import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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
});
