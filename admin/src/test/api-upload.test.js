import { expect, it, vi } from 'vitest';
import { api } from '../api.js';

it('sends multipart photos with session cookies and CSRF without overriding the browser boundary', async () => {
  document.cookie = 'sentry_csrf=test-csrf; path=/';
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ status: 201, ok: true });
  try {
    const body = new FormData();
    body.append('file', new File(['photo'], 'photo.jpg', { type: 'image/jpeg' }));
    await api.upload('/admin/items/91/catalog-images', body);
    expect(fetch).toHaveBeenCalledWith('/api/admin/items/91/catalog-images', expect.objectContaining({
      method: 'POST', body, credentials: 'include', headers: { 'X-CSRF-Token': 'test-csrf' },
    }));
  } finally {
    fetch.mockRestore();
    document.cookie = 'sentry_csrf=; Max-Age=0; path=/';
  }
});
