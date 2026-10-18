// @vitest-environment jsdom
import { configureStore } from '@reduxjs/toolkit';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { Provider } from 'react-redux';
import { afterEach, expect, test, vi } from 'vitest';

import { CoworkArtifactRole, type CoworkPersistedArtifact } from '../../../shared/cowork/artifacts';
import artifactReducer, { activateSessionArtifactView } from '../../store/slices/artifactSlice';
import { useLedgerArtifacts } from './useLedgerArtifacts';

const row = (overrides: Partial<CoworkPersistedArtifact> = {}): CoworkPersistedArtifact => ({
  id: 'coding-file-/work/index.html',
  messageId: '',
  toolCallId: 'call-1',
  type: 'html',
  title: 'index.html',
  content: '',
  filePath: '/work/index.html',
  source: 'tool',
  role: CoworkArtifactRole.Deliverable,
  declared: false,
  createdAt: 1,
  ...overrides,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const setup = (list: (scopeId: string) => Promise<unknown>, scopeId: string | null) => {
  vi.stubGlobal('electron', { artifacts: { list, onUpsert: () => () => {} } });
  const store = configureStore({ reducer: { artifact: artifactReducer } });
  store.dispatch(activateSessionArtifactView('lane-1'));
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(Provider, { store, children });
  const view = renderHook(({ id }) => useLedgerArtifacts(id), {
    initialProps: { id: scopeId },
    wrapper,
  });
  return { store, view };
};

test('folds the lane ledger rows in silently, once per lane', async () => {
  const list = vi.fn(async () => ({ success: true, artifacts: [row()] }));
  const { store, view } = setup(list, 'lane-1');

  await waitFor(() =>
    expect(store.getState().artifact.artifactsBySession['lane-1']).toHaveLength(1),
  );
  expect(store.getState().artifact.artifactsBySession['lane-1'][0].toolCallId).toBe('call-1');
  expect(store.getState().artifact.isPanelOpen).toBe(false);

  view.rerender({ id: 'lane-1' });
  expect(list).toHaveBeenCalledTimes(1);
});

test('reads nothing without a lane and ignores a failed read', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const list = vi.fn(async () => ({ success: false, error: 'db closed' }));
  const { store, view } = setup(list, null);
  expect(list).not.toHaveBeenCalled();

  view.rerender({ id: 'lane-1' });
  await waitFor(() => expect(error).toHaveBeenCalled());
  expect(store.getState().artifact.artifactsBySession['lane-1']).toBeUndefined();
  error.mockRestore();
});
