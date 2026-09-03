/**
 * V-021: tests for the friendly-error helper.
 */

import { describe, it, expect } from 'vitest';
import { friendlyError } from '../utils/friendlyError.js';

describe('friendlyError', () => {
  it('maps known error codes to user-friendly strings', () => {
    expect(friendlyError({ error: 'validation_error' })).toBe(
      'Unul sau mai multe câmpuri conțin valori nevalide.'
    );
    expect(friendlyError({ error: 'Invalid username or password' })).toBe(
      'Utilizator sau parolă incorectă.'
    );
    expect(friendlyError({ error: 'CSRF token missing or invalid' })).toBe(
      'Sesiunea nu mai este sincronizată. Reîncarcă pagina și încearcă din nou.'
    );
  });

  it('returns fallback for unknown error codes', () => {
    expect(friendlyError({ error: 'some_internal_code' })).toBe(
      'A apărut o problemă. Încearcă din nou.'
    );
  });

  it('never echoes raw backend error strings', () => {
    const leakyPayload = {
      error: 'UNIQUE_CONSTRAINT_VIOLATION on users_username_key',
      stack: 'Traceback: /app/routes/admin_users.py line 42',
    };
    const result = friendlyError(leakyPayload);
    expect(result).not.toContain('UNIQUE_CONSTRAINT_VIOLATION');
    expect(result).not.toContain('Traceback');
    expect(result).not.toContain('admin_users.py');
  });

  it('uses the custom fallback when provided', () => {
    expect(friendlyError({ error: 'mystery' }, 'Could not save item.')).toBe(
      'Could not save item.'
    );
  });

  it('handles null/non-object payloads safely', () => {
    expect(friendlyError(null)).toBe('A apărut o problemă. Încearcă din nou.');
    expect(friendlyError(undefined)).toBe('A apărut o problemă. Încearcă din nou.');
    expect(friendlyError('some string')).toBe('A apărut o problemă. Încearcă din nou.');
  });

  it('handles payload with no error field', () => {
    expect(friendlyError({})).toBe('A apărut o problemă. Încearcă din nou.');
  });
});
