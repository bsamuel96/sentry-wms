/* global process */

import { afterEach, describe, expect, it } from 'vitest';

import {
  buildUpstreamUrl,
  getUpstreamBaseUrl,
} from '../../api/proxy.js';

const originalApiUrl = process.env.SENTRY_API_URL;

afterEach(() => {
  if (originalApiUrl === undefined) {
    delete process.env.SENTRY_API_URL;
  } else {
    process.env.SENTRY_API_URL = originalApiUrl;
  }
});

describe('Vercel Sentry API proxy', () => {
  it('keeps the API path and query string on the configured upstream', () => {
    process.env.SENTRY_API_URL = 'https://sentry-api.example.com/';

    const upstream = buildUpstreamUrl({
      url: '/api/auth/me?include=permissions',
      headers: { host: 'sentry-admin.vercel.app' },
    });

    expect(upstream.toString()).toBe(
      'https://sentry-api.example.com/api/auth/me?include=permissions',
    );
  });

  it('supports an upstream deployed below a path prefix', () => {
    process.env.SENTRY_API_URL = 'https://example.com/sentry';

    const upstream = buildUpstreamUrl({
      url: '/api/health',
      headers: { host: 'sentry-admin.vercel.app' },
    });

    expect(upstream.toString()).toBe('https://example.com/sentry/api/health');
  });

  it('uses the explicit Vercel rewrite path and removes it from the query string', () => {
    process.env.SENTRY_API_URL = 'https://sentry-api.example.com';

    const upstream = buildUpstreamUrl({
      url: '/api/proxy?path=auth/login&next=dashboard',
      headers: { host: 'sentry-admin.vercel.app' },
      query: { path: 'auth/login', next: 'dashboard' },
    });

    expect(upstream.toString()).toBe(
      'https://sentry-api.example.com/api/auth/login?next=dashboard',
    );
  });

  it('rejects missing and non-http upstream URLs', () => {
    delete process.env.SENTRY_API_URL;
    expect(() => getUpstreamBaseUrl()).toThrow(/not configured/);

    process.env.SENTRY_API_URL = 'file:///tmp/sentry';
    expect(() => getUpstreamBaseUrl()).toThrow(/http or https/);
  });
});
