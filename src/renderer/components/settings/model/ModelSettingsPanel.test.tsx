// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import ModelSettingsPanel from './ModelSettingsPanel';
import { store } from '../../../store';

vi.mock('../../../services/i18n', () => ({ i18nService: { t: (key: string) => key } }));
const api = {
  catalog: vi.fn(),
  status: vi.fn(),
  start: vi.fn(),
  selectDefault: vi.fn(),
  openManagement: vi.fn(),
};
const stopped = { status: { state: 'stopped', version: '1' }, models: [], defaultModelId: null };
const running = {
  status: { state: 'running', version: '1' },
  models: [{ id: 'vendor/exact', display_name: 'Exact model', native_endpoints: ['anthropic'] }],
  defaultModelId: null,
};
beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, 'electron', { configurable: true, value: { magpie: api } });
  api.catalog.mockResolvedValue(stopped);
  api.status.mockResolvedValue(stopped.status);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
test('opening settings only reads catalog and requires informed explicit activation', async () => {
  render(<ModelSettingsPanel />);
  await waitFor(() => expect(api.catalog).toHaveBeenCalledTimes(1));
  expect(api.start).not.toHaveBeenCalled();
  expect(api.openManagement).not.toHaveBeenCalled();
  expect(screen.getByText('magpieCatalogConsent')).toBeTruthy();
  expect(screen.getByText('magpieLicenseNotice')).toBeTruthy();
  api.start.mockResolvedValue(running.status);
  api.catalog.mockResolvedValue(running);
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'magpieCatalogEnable' }).hasAttribute('disabled'),
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole('button', { name: 'magpieCatalogEnable' }));
  await screen.findByText('Exact model');
  expect(api.start).toHaveBeenCalledTimes(1);
  expect(store.getState().model.defaultSelectedModel.id).toBe('');
});
test('failed start remains stopped and does not load or claim a model', async () => {
  api.start.mockResolvedValue({ state: 'failed', version: '1' });
  render(<ModelSettingsPanel />);
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'magpieCatalogEnable' }).hasAttribute('disabled'),
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole('button', { name: 'magpieCatalogEnable' }));
  await screen.findByRole('alert');
  expect(screen.getByText('magpieState_failed')).toBeTruthy();
  expect(api.catalog).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('searchbox')).toBeNull();
});

test('explicit enable displays starting immediately and failed immediately without polling', async () => {
  let finish!: (value: { state: string; version: string }) => void;
  api.start.mockImplementation(
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  render(<ModelSettingsPanel />);
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'magpieCatalogEnable' }).hasAttribute('disabled'),
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole('button', { name: 'magpieCatalogEnable' }));
  expect(screen.getByText('magpieState_starting')).toBeTruthy();
  expect(screen.queryByText('magpieState_stopped')).toBeNull();
  await act(async () => finish({ state: 'failed', version: '1' }));
  expect(screen.getByText('magpieState_failed')).toBeTruthy();
  expect(api.status).not.toHaveBeenCalled();
  expect(api.catalog).toHaveBeenCalledTimes(1);
});
test('sends exact catalog id only after explicit default confirmation', async () => {
  api.catalog.mockResolvedValue(running);
  api.selectDefault.mockResolvedValue({ ...running, defaultModelId: 'vendor/exact' });
  render(<ModelSettingsPanel />);
  const select = await screen.findByRole('button', { name: 'modelBrowseSelect vendor/exact' });
  await waitFor(() => expect(select.hasAttribute('disabled')).toBe(false));
  fireEvent.click(select);
  expect(api.selectDefault).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'magpieSetDefault' }));
  await waitFor(() => expect(api.selectDefault).toHaveBeenCalledWith('vendor/exact'));
  await waitFor(() => expect(store.getState().model.defaultSelectedModel.id).toBe('vendor/exact'));
});
test('rejected default save preserves the last confirmed state and surfaces error', async () => {
  api.catalog.mockResolvedValue(running);
  api.selectDefault.mockRejectedValue(new Error('rejected'));
  render(<ModelSettingsPanel />);
  const select = await screen.findByRole('button', { name: 'modelBrowseSelect vendor/exact' });
  await waitFor(() => expect(select.hasAttribute('disabled')).toBe(false));
  fireEvent.click(select);
  fireEvent.click(screen.getByRole('button', { name: 'magpieSetDefault' }));
  await screen.findByRole('alert');
  expect(store.getState().model.defaultSelectedModel.id).toBe('');
});
test('process exit clears stale models without starting or reading management', async () => {
  vi.useFakeTimers();
  api.catalog.mockResolvedValue({ ...running, defaultModelId: 'vendor/exact' });
  render(<ModelSettingsPanel />);
  await act(async () => {
    await Promise.resolve();
  });
  expect(store.getState().model.defaultSelectedModel.id).toBe('vendor/exact');
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000);
  });
  expect(screen.queryByRole('searchbox')).toBeNull();
  expect(store.getState().model.availableModels).toEqual([]);
  expect(api.start).not.toHaveBeenCalled();
  expect(api.catalog).toHaveBeenCalledTimes(1);
});

test('search and provisional selection survive refresh without changing the saved default', async () => {
  const catalog = {
    ...running,
    defaultModelId: 'vendor/exact',
    models: [
      ...running.models,
      { id: 'other/model', display_name: 'Other', owned_by: 'Enterprise' },
    ],
  };
  api.catalog.mockResolvedValue(catalog);
  render(<ModelSettingsPanel />);
  const search = await screen.findByRole('searchbox');
  await waitFor(() =>
    expect(
      screen
        .getByRole('button', { name: 'modelBrowseSelect other/model' })
        .hasAttribute('disabled'),
    ).toBe(false),
  );
  fireEvent.change(search, { target: { value: 'Enterprise' } });
  fireEvent.click(screen.getByRole('button', { name: 'modelBrowseSelect other/model' }));
  expect(screen.getByText('modelBrowseUnsaved')).toBeTruthy();
  expect(api.selectDefault).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'magpieCatalogRefresh' }));
  await waitFor(() => expect(api.catalog).toHaveBeenCalledTimes(2));
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'magpieCatalogRefresh' }).hasAttribute('disabled'),
    ).toBe(false),
  );
  expect((search as HTMLInputElement).value).toBe('Enterprise');
  expect(screen.getByText('modelBrowseUnsaved')).toBeTruthy();
  expect(store.getState().model.defaultSelectedModel.id).toBe('vendor/exact');
  expect(api.selectDefault).not.toHaveBeenCalled();
  expect(api.start).not.toHaveBeenCalled();
});

test('distinguishes loading and catalog failure and offers an explicit read-only retry', async () => {
  let reject!: (error: Error) => void;
  api.catalog.mockImplementationOnce(
    () =>
      new Promise((_, fail) => {
        reject = fail;
      }),
  );
  render(<ModelSettingsPanel />);
  expect(screen.getByText('modelBrowseLoading')).toBeTruthy();
  expect(screen.queryByText('magpieCatalogEmpty')).toBeNull();
  await act(async () => reject(new Error('unavailable')));
  expect(screen.getByRole('alert')).toBeTruthy();
  expect(screen.queryByText('modelBrowseLoading')).toBeNull();
  api.catalog.mockResolvedValue({ ...running, models: [] });
  fireEvent.click(screen.getByRole('button', { name: 'magpieCatalogRefresh' }));
  await screen.findByText('magpieCatalogEmpty');
  expect(api.start).not.toHaveBeenCalled();
  expect(api.selectDefault).not.toHaveBeenCalled();
});

test('renders only one page of choices with no unbounded duplicate selector', async () => {
  api.catalog.mockResolvedValue({
    ...running,
    models: Array.from({ length: 101 }, (_, index) => ({ id: `vendor/${index}` })),
  });
  render(<ModelSettingsPanel />);
  await screen.findByRole('searchbox');
  expect(screen.queryByRole('combobox')).toBeNull();
  expect(screen.getAllByRole('button', { name: /^modelBrowseSelect vendor\// })).toHaveLength(10);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'vendor/100' } });
  expect(screen.getAllByRole('button', { name: /^modelBrowseSelect vendor\// })).toHaveLength(1);
  expect(api.selectDefault).not.toHaveBeenCalled();
});
