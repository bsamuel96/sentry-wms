import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => ({ getItem: vi.fn(), setItem: vi.fn() }));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: storage }));
vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('../auth/secureStorage', () => ({ getAuthItem: vi.fn() }));

const destination = 'https://wms.purplehive.pro';

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.stubEnv('EXPO_PUBLIC_API_URL', destination);
  storage.setItem.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllEnvs());

describe('server selection after the Railway migration', () => {
  it('migrates a previously saved Railway URL and displays the new server', async () => {
    storage.getItem.mockResolvedValue('https://sentry-wms-production.up.railway.app/');
    const api = await import('./client.js');
    expect(await api.getStoredApiUrl()).toBe(destination);
    expect(storage.setItem).toHaveBeenCalledWith('sentry_api_url', destination);
  });

  it('preserves a custom server selected by the operator', async () => {
    storage.getItem.mockResolvedValue('https://warehouse.example.org');
    const api = await import('./client.js');
    expect(await api.getStoredApiUrl()).toBe('https://warehouse.example.org');
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('uses the build default on a fresh installation', async () => {
    storage.getItem.mockResolvedValue(null);
    const api = await import('./client.js');
    expect(await api.getStoredApiUrl()).toBe(destination);
  });

  it('connects to the new server even if saving the migration fails', async () => {
    storage.getItem.mockResolvedValue('https://sentry-wms-production.up.railway.app');
    storage.setItem.mockRejectedValue(new Error('Storage unavailable'));
    const api = await import('./client.js');
    expect(await api.getStoredApiUrl()).toBe(destination);
  });
});
