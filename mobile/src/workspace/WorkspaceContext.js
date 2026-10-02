import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '../auth/AuthContext';
import {
  emptyWorkspace,
  ensureDraft as ensureWorkspaceDraft,
  recordDraft as recordWorkspaceDraft,
  recordNavigation as recordWorkspaceNavigation,
  removeDraft as removeWorkspaceDraft,
  undoWorkspace,
  workspaceUserKey,
} from './workspaceState';

const WorkspaceContext = createContext(null);
const STORAGE_PREFIX = '@sentry/workspace/v1/';

export function WorkspaceProvider({ children }) {
  const { user } = useAuth();
  const userKey = user ? workspaceUserKey(user) : null;
  const storageKey = userKey ? `${STORAGE_PREFIX}${userKey}` : null;
  const [workspace, setWorkspace] = useState(emptyWorkspace);
  const [loadedStorageKey, setLoadedStorageKey] = useState(storageKey ? null : storageKey);
  const isLoading = storageKey !== loadedStorageKey;
  const workspaceRef = useRef(workspace);
  const navigationUndoRef = useRef(null);

  useEffect(() => { workspaceRef.current = workspace; }, [workspace]);

  useEffect(() => {
    let active = true;
    setLoadedStorageKey(null);
    setWorkspace(emptyWorkspace());
    if (!storageKey) {
      setLoadedStorageKey(storageKey);
      return () => { active = false; };
    }
    AsyncStorage.getItem(storageKey).then(raw => {
      if (!active) return;
      if (!raw) return;
      const parsed = JSON.parse(raw);
      setWorkspace({ ...emptyWorkspace(), ...parsed, drafts: parsed.drafts || {}, history: parsed.history || [] });
    }).catch(() => {}).finally(() => { if (active) setLoadedStorageKey(storageKey); });
    return () => { active = false; };
  }, [storageKey]);

  useEffect(() => {
    if (!storageKey || isLoading) return undefined;
    const timer = setTimeout(() => {
      AsyncStorage.setItem(storageKey, JSON.stringify(workspace)).catch(() => {});
    }, 120);
    return () => clearTimeout(timer);
  }, [isLoading, storageKey, workspace]);

  useEffect(() => {
    if (!storageKey) return undefined;
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active') AsyncStorage.setItem(storageKey, JSON.stringify(workspaceRef.current)).catch(() => {});
    });
    return () => subscription.remove();
  }, [storageKey]);

  const recordNavigation = useCallback(value => setWorkspace(current => recordWorkspaceNavigation(current, value)), []);
  const ensureDraft = useCallback((scope, value) => setWorkspace(current => ensureWorkspaceDraft(current, scope, value)), []);
  const recordDraft = useCallback((scope, value) => setWorkspace(current => recordWorkspaceDraft(current, scope, value)), []);
  const clearDraft = useCallback(scope => setWorkspace(current => removeWorkspaceDraft(current, scope)), []);
  const registerNavigationUndo = useCallback(handler => {
    navigationUndoRef.current = handler;
    return () => { if (navigationUndoRef.current === handler) navigationUndoRef.current = null; };
  }, []);
  const undo = useCallback(() => {
    const result = undoWorkspace(workspaceRef.current);
    if (!result.restored) return false;
    workspaceRef.current = result.workspace;
    setWorkspace(result.workspace);
    if (result.restored.kind === 'navigation') navigationUndoRef.current?.(result.workspace.navigationState);
    return true;
  }, []);

  const value = useMemo(() => ({
    workspace,
    isLoading,
    canUndo: workspace.history.length > 0,
    recordNavigation,
    ensureDraft,
    recordDraft,
    clearDraft,
    registerNavigationUndo,
    undo,
  }), [workspace, isLoading, recordNavigation, ensureDraft, recordDraft, clearDraft, registerNavigationUndo, undo]);

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error('useWorkspace must be used inside WorkspaceProvider');
  return context;
}
