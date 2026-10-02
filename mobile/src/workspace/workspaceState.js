export const WORKSPACE_HISTORY_LIMIT = 100;

export function emptyWorkspace() {
  return { navigationState: null, drafts: {}, history: [], updatedAt: null };
}

function snapshot(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

function same(left, right) {
  if (left === right) return true;
  try { return JSON.stringify(left) === JSON.stringify(right); } catch { return false; }
}

function withHistory(workspace, entry) {
  return {
    ...workspace,
    history: [...workspace.history, entry].slice(-WORKSPACE_HISTORY_LIMIT),
    updatedAt: new Date().toISOString(),
  };
}

export function recordNavigation(workspace, navigationState) {
  if (!navigationState || same(workspace.navigationState, navigationState)) return workspace;
  const next = workspace.navigationState
    ? withHistory(workspace, { kind: 'navigation', value: snapshot(workspace.navigationState) })
    : workspace;
  return { ...next, navigationState: snapshot(navigationState), updatedAt: new Date().toISOString() };
}

export function ensureDraft(workspace, scope, value) {
  if (!scope || Object.prototype.hasOwnProperty.call(workspace.drafts, scope)) return workspace;
  return {
    ...workspace,
    drafts: { ...workspace.drafts, [scope]: snapshot(value) },
    updatedAt: new Date().toISOString(),
  };
}

export function recordDraft(workspace, scope, value) {
  if (!scope) return workspace;
  const previous = workspace.drafts[scope];
  if (same(previous, value)) return workspace;
  const next = withHistory(workspace, {
    kind: 'draft',
    scope,
    existed: Object.prototype.hasOwnProperty.call(workspace.drafts, scope),
    value: snapshot(previous),
  });
  return { ...next, drafts: { ...next.drafts, [scope]: snapshot(value) } };
}

export function removeDraft(workspace, scope) {
  if (!Object.prototype.hasOwnProperty.call(workspace.drafts, scope)) return workspace;
  const drafts = { ...workspace.drafts };
  delete drafts[scope];
  return { ...workspace, drafts, updatedAt: new Date().toISOString() };
}

export function undoWorkspace(workspace) {
  const entry = workspace.history[workspace.history.length - 1];
  if (!entry) return { workspace, restored: null };
  const next = { ...workspace, history: workspace.history.slice(0, -1), updatedAt: new Date().toISOString() };
  if (entry.kind === 'navigation') {
    next.navigationState = snapshot(entry.value);
  } else if (entry.kind === 'draft') {
    const drafts = { ...workspace.drafts };
    if (entry.existed) drafts[entry.scope] = snapshot(entry.value);
    else delete drafts[entry.scope];
    next.drafts = drafts;
  }
  return { workspace: next, restored: entry };
}

export function workspaceUserKey(user) {
  const identity = user?.id ?? user?.user_id ?? user?.username ?? user?.email ?? 'anonymous';
  return String(identity).replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 120);
}
