import { describe, expect, it } from 'vitest';
import {
  emptyWorkspace,
  ensureDraft,
  recordDraft,
  recordNavigation,
  undoWorkspace,
  WORKSPACE_HISTORY_LIMIT,
} from '../workspaceState';

describe('workspace history', () => {
  it('restores draft changes one step at a time', () => {
    let state = ensureDraft(emptyWorkspace(), 'product:1', { code: '' });
    state = recordDraft(state, 'product:1', { code: 'ATK' });
    state = recordDraft(state, 'product:1', { code: 'ATK 03.03.054' });

    let result = undoWorkspace(state);
    expect(result.workspace.drafts['product:1']).toEqual({ code: 'ATK' });
    result = undoWorkspace(result.workspace);
    expect(result.workspace.drafts['product:1']).toEqual({ code: '' });
  });

  it('restores the preceding navigation stack without making an extra history entry', () => {
    const home = { index: 0, routes: [{ name: 'Home' }] };
    const details = { index: 1, routes: [{ name: 'Home' }, { name: 'CatalogDetails', params: { item_id: 4 } }] };
    let state = recordNavigation(emptyWorkspace(), home);
    state = recordNavigation(state, details);
    const result = undoWorkspace(state);
    expect(result.workspace.navigationState).toEqual(home);
    expect(result.restored.kind).toBe('navigation');
  });

  it('keeps the most recent bounded history while recording every edit', () => {
    let state = ensureDraft(emptyWorkspace(), 'filter', '');
    for (let index = 0; index < WORKSPACE_HISTORY_LIMIT + 20; index += 1) {
      state = recordDraft(state, 'filter', String(index));
    }
    expect(state.history).toHaveLength(WORKSPACE_HISTORY_LIMIT);
    expect(state.drafts.filter).toBe(String(WORKSPACE_HISTORY_LIMIT + 19));
  });
});
