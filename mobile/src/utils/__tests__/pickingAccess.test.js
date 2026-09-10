import { describe, expect, it } from 'vitest';
import { canResumeAssignedBatch } from '../pickingAccess';

const assignedOrder = {
  active_batch_id: 7,
  active_batch_assigned_to: 'operator1',
};

describe('canResumeAssignedBatch', () => {
  it('allows an administrator to open another operator\'s batch', () => {
    expect(canResumeAssignedBatch(assignedOrder, {
      username: 'admin',
      role: 'ADMIN',
    })).toBe(true);
  });

  it('handles the administrator role case-insensitively', () => {
    expect(canResumeAssignedBatch(assignedOrder, {
      username: 'admin',
      role: 'admin',
    })).toBe(true);
  });

  it('allows the assigned operator to resume the batch', () => {
    expect(canResumeAssignedBatch(assignedOrder, {
      username: 'operator1',
      role: 'USER',
    })).toBe(true);
  });

  it('blocks a different non-admin operator', () => {
    expect(canResumeAssignedBatch(assignedOrder, {
      username: 'operator2',
      role: 'USER',
    })).toBe(false);
  });

  it('allows an unassigned or not-yet-batched order', () => {
    expect(canResumeAssignedBatch({ active_batch_id: 7 }, { role: 'USER' })).toBe(true);
    expect(canResumeAssignedBatch({}, { role: 'USER' })).toBe(true);
  });
});
