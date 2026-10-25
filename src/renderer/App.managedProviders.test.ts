// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { ManagedProviderAccessMode } from '../shared/managedProviders';
import { useAvailableModelsRefresh } from './app/useAvailableModelsRefresh';
import { MainView } from './app/constants';

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(async () => {}),
  reload: vi.fn(async () => {}),
  notify: vi.fn(),
  write: vi.fn(),
}));
vi.mock('./services/availableModels', () => ({
  refreshMagpieModels: mocks.refresh,
  LLAMACPP_RUNNING_MODELS_CHANGED_EVENT: 'fixture-models-changed',
  notifyLlamaCppRunningModelsChanged: mocks.notify,
}));
vi.mock('./services/config', () => ({
  configService: { reload: mocks.reload, updateConfig: mocks.write },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

function fixture() {
  let changed: (() => void) | undefined;
  let bindingsChanged: (() => void) | undefined;
  const unsubscribe = vi.fn(),
    unsubscribeBindings = vi.fn();
  const policy = vi.fn(async () => ({
    mode: ManagedProviderAccessMode.Exclusive,
    providerKeys: ['managed'],
  }));
  const electron = {
    managedProviders: {
      policy,
      onChanged: (listener: () => void) => {
        changed = listener;
        return unsubscribe;
      },
    },
    llamacpp: {
      onModelBindingsChanged: (listener: () => void) => {
        bindingsChanged = listener;
        return unsubscribeBindings;
      },
    },
  };
  Object.defineProperty(window, 'electron', { configurable: true, value: electron });
  const setPolicy = vi.fn(),
    setView = vi.fn();
  const hook = renderHook(() => useAvailableModelsRefresh(true, setPolicy, setView));
  return {
    hook,
    changed: () => changed?.(),
    bindingsChanged: () => bindingsChanged?.(),
    policy,
    setPolicy,
    setView,
    unsubscribe,
    unsubscribeBindings,
  };
}

test('refreshes available models when the managed provider projection changes', async () => {
  const source = readFileSync(path.resolve('src/renderer/App.tsx'), 'utf8');
  expect(source).toContain('useAvailableModelsRefresh(');
  const f = fixture();
  act(() => f.changed());
  await waitFor(() =>
    expect(f.setPolicy).toHaveBeenCalledWith({
      mode: ManagedProviderAccessMode.Exclusive,
      providerKeys: ['managed'],
    }),
  );
  expect(mocks.refresh).toHaveBeenCalledOnce();
  expect(f.policy).toHaveBeenCalledOnce();
  const restrictView = f.setView.mock.calls[0][0];
  expect(restrictView(MainView.LocalInference)).toBe(MainView.Cowork);
  f.hook.unmount();
  expect(f.unsubscribe).toHaveBeenCalledOnce();
  expect(f.unsubscribeBindings).toHaveBeenCalledOnce();
});

test('refreshes the unified model catalog without writing a renderer selection to app config', async () => {
  const f = fixture();
  await act(async () => f.hook.result.current());
  expect(mocks.refresh).toHaveBeenCalledOnce();
  expect(f.policy).toHaveBeenCalledOnce();
  act(() => f.bindingsChanged());
  await waitFor(() => expect(mocks.notify).toHaveBeenCalledOnce());
  expect(mocks.reload).toHaveBeenCalledOnce();
  expect(mocks.write).not.toHaveBeenCalled();
});
