// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import type {
  MagpieProviderSummary,
  MagpieTestProviderResult,
} from '../../../../../shared/magpie/types';
import { useProviderEditor, type ProviderEditorProps } from './useProviderEditor';
import { parseProviderModels } from './constants';

function pending<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
}
const provider: MagpieProviderSummary = {
  id: 'fixture-provider',
  name: 'Fixture',
  api: 'openai-completions',
  baseUrl: 'http://127.0.0.1:1234',
  models: ['first', 'second'],
  fallback: ['second'],
  off: false,
  hasKey: false,
};
function props(): ProviderEditorProps {
  return { open: true, provider, onOpenChange: vi.fn(), onSave: vi.fn(async () => true) };
}

test('closing and reopening invalidates an old discovery even when the fields match again', async () => {
  const discovery = pending<MagpieTestProviderResult>();
  const base = { ...props(), onTest: vi.fn(() => discovery.promise) };
  const view = renderHook((input: ProviderEditorProps) => useProviderEditor(input), {
    initialProps: base,
  });
  let work!: Promise<void>;
  act(() => {
    work = view.result.current.testConnection();
  });
  expect(view.result.current.isTesting).toBe(true);
  view.rerender({ ...base, open: false });
  view.rerender({ ...base, open: true });
  await act(async () => {
    discovery.resolve({ ok: true, discoveredModels: ['from-closed-form'] });
    await work;
  });
  expect(view.result.current.draft.models).toEqual(['first', 'second']);
  expect(view.result.current.pendingModels).toBeNull();
  expect(view.result.current.testResult).toBeNull();
  expect(view.result.current.isTesting).toBe(false);
});

test('same-provider refresh preserves edits, but changing provider creates a fresh form', () => {
  const base = props();
  const view = renderHook((input: ProviderEditorProps) => useProviderEditor(input), {
    initialProps: base,
  });
  act(() => view.result.current.edit({ name: 'Unfinished name' }));
  view.rerender({ ...base, provider: { ...provider, name: 'Server refresh' } });
  expect(view.result.current.draft.name).toBe('Unfinished name');
  view.rerender({ ...base, provider: { ...provider, id: 'another', name: 'Another provider' } });
  expect(view.result.current.draft.name).toBe('Another provider');
  expect(view.result.current.draft.apiKey).toBe('');
});

test('one save owns the in-flight form and failed saves retain data for a later explicit retry', async () => {
  const response = pending<boolean>();
  const base = { ...props(), onSave: vi.fn(() => response.promise) };
  const view = renderHook(() => useProviderEditor(base));
  act(() => view.result.current.edit({ name: 'Keep this name' }));
  let first!: Promise<void>;
  act(() => {
    first = view.result.current.save();
    void view.result.current.save();
  });
  expect(base.onSave).toHaveBeenCalledTimes(1);
  act(() => view.result.current.changeOpen(false));
  expect(base.onOpenChange).not.toHaveBeenCalled();
  await act(async () => {
    response.resolve(false);
    await first;
  });
  expect(view.result.current.saveFailed).toBe(true);
  expect(view.result.current.draft.name).toBe('Keep this name');
  expect(view.result.current.isSaving).toBe(false);
  base.onSave.mockResolvedValueOnce(true);
  await act(async () => {
    await view.result.current.save();
  });
  expect(base.onSave).toHaveBeenCalledTimes(2);
  expect(base.onOpenChange).toHaveBeenCalledWith(false);
});

test('a save receipt for an old opening cannot close or change a new provider form', async () => {
  const response = pending<boolean>();
  const base = { ...props(), onSave: vi.fn(() => response.promise) };
  const view = renderHook((input: ProviderEditorProps) => useProviderEditor(input), {
    initialProps: base,
  });
  let work!: Promise<void>;
  act(() => {
    work = view.result.current.save();
  });
  view.rerender({ ...base, open: false });
  view.rerender({ ...base, provider: { ...provider, id: 'another', name: 'New provider' } });
  await act(async () => {
    response.resolve(true);
    await work;
  });
  expect(base.onOpenChange).not.toHaveBeenCalled();
  expect(view.result.current.draft.name).toBe('New provider');
  expect(view.result.current.isSaving).toBe(false);
  expect(view.result.current.saveFailed).toBe(false);
});

test('edited fields remove a previous connection verdict and late results cannot restore it', async () => {
  const response = pending<MagpieTestProviderResult>();
  const base = {
    ...props(),
    onTest: vi.fn(async (): Promise<MagpieTestProviderResult> => ({
      ok: true,
      discoveredModels: ['first', 'second'],
    })),
  };
  const view = renderHook(() => useProviderEditor(base));
  await act(async () => {
    await view.result.current.testConnection();
  });
  expect(view.result.current.testResult?.ok).toBe(true);
  act(() => view.result.current.edit({ baseUrl: 'http://127.0.0.1:9999' }));
  expect(view.result.current.testResult).toBeNull();
  base.onTest.mockImplementationOnce(() => response.promise);
  let work!: Promise<void>;
  act(() => {
    work = view.result.current.testConnection();
  });
  act(() => view.result.current.edit({ name: 'Edited during discovery' }));
  await act(async () => {
    response.resolve({ ok: true, discoveredModels: ['stale-model'] });
    await work;
  });
  expect(view.result.current.testResult).toBeNull();
  expect(view.result.current.pendingModels).toBeNull();
});

test('provider-local hints follow the URL host and model text preserves user separators', () => {
  const view = renderHook(() => useProviderEditor(props()));
  for (const baseUrl of ['https://127.0.0.1.remote.example/v1', 'https://example.test/localhost']) {
    act(() => view.result.current.edit({ baseUrl }));
    expect(view.result.current.isLocal).toBe(false);
  }
  act(() => view.result.current.edit({ baseUrl: 'http://[::1]:11434/v1' }));
  expect(view.result.current.isLocal).toBe(true);
  const text = 'first, \nsecond，third、first';
  act(() => view.result.current.textChanged(text));
  expect(view.result.current.draft.modelsText).toBe(text);
  expect(view.result.current.draft.models).toEqual(['first', 'second', 'third']);
  expect(parseProviderModels('one, \ntwo，one')).toEqual(['one', 'two']);
});
