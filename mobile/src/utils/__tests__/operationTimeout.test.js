import { describe, expect, it, vi } from 'vitest';
import {
  OPERATION_TIMEOUT_CODE,
  withOperationTimeout,
} from '../operationTimeout';

describe('withOperationTimeout', () => {
  it('returns the original operation result before the deadline', async () => {
    await expect(withOperationTimeout(Promise.resolve('gata'), 100, 'Test')).resolves.toBe('gata');
  });

  it('rejects a stalled operation so the scanner can recover', async () => {
    vi.useFakeTimers();
    const stalled = new Promise(() => {});
    const guarded = withOperationTimeout(stalled, 1_000, 'Scanarea');
    const assertion = expect(guarded).rejects.toMatchObject({
      code: OPERATION_TIMEOUT_CODE,
      message: 'Scanarea a depășit limita de timp.',
    });

    await vi.advanceTimersByTimeAsync(1_000);
    await assertion;
    vi.useRealTimers();
  });
});
