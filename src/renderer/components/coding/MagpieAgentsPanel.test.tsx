// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { MagpieAgentsPanel } from './MagpieAgentsPanel';

vi.mock('../../services/i18n', () => ({ i18nService: { t: (key: string) => key } }));
const api = {
  status: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  agents: vi.fn(),
  models: vi.fn(),
  setModel: vi.fn(),
  openManagement: vi.fn(),
};
const stopped = { state: 'stopped', version: 'test-version' };
const running = { state: 'running', version: 'test-version' };
const agent = {
  id: 'codex',
  name: 'Codex',
  cliMissing: false,
  wired: true,
  version: '0.1',
  models: [
    {
      key: 'model',
      label: 'model',
      value: 'vendor/old',
      options: [{ value: 'agent-specific/new', label: 'vendor/new' }],
    },
  ],
};
beforeEach(() => {
  for (const mock of Object.values(api)) mock.mockReset();
  api.status.mockResolvedValue(stopped);
  api.start.mockImplementation(async () => {
    api.status.mockResolvedValue(running);
    return running;
  });
  api.stop.mockImplementation(async () => {
    api.status.mockResolvedValue(stopped);
    return stopped;
  });
  api.agents.mockResolvedValue({ agents: [agent], pending: false });
  api.models.mockResolvedValue([{ id: 'gateway-only/new' }]);
  api.openManagement.mockResolvedValue(undefined);
  Object.assign(window, { electron: { magpie: api } });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test('mount reads process status only and never starts or reads syncing management state', async () => {
  render(<MagpieAgentsPanel />);
  await screen.findByText('magpieState_stopped');
  expect(api.start).not.toHaveBeenCalled();
  expect(api.agents).not.toHaveBeenCalled();
  expect(api.models).not.toHaveBeenCalled();
  expect(screen.getByText('magpieActivationNotice')).toBeVisible();
  expect(screen.getByText('magpieLicenseNotice')).toBeVisible();
});

test('explicit enable starts the official runtime then loads real state without inventing CLI versions', async () => {
  api.agents.mockResolvedValue({
    agents: [{ ...agent, cliMissing: true, version: undefined }],
    pending: true,
  });
  render(<MagpieAgentsPanel />);
  await screen.findByText('magpieState_stopped');
  fireEvent.click(screen.getByRole('button', { name: 'magpieEnable' }));
  await screen.findByText('Codex');
  expect(api.start).toHaveBeenCalledOnce();
  expect(api.agents).toHaveBeenCalledOnce();
  expect(screen.getByText('magpieCliMissing')).toBeVisible();
  expect(screen.getByText('magpieVersionUnknown')).toBeVisible();
  expect(screen.getByText('magpieDiscoveryPending')).toBeVisible();
  expect(screen.getByRole('button', { name: 'magpieApplyModel' })).toBeDisabled();
});

test('a running runtime still waits for explicit management refresh before reading configuration', async () => {
  api.status.mockResolvedValue(running);
  render(<MagpieAgentsPanel />);
  await screen.findByText('magpieState_running');
  expect(api.agents).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'magpieRefreshManagement' }));
  await screen.findByText('Codex');
  expect(api.start).not.toHaveBeenCalled();
});

test('model selection is a draft until Apply uses the exact official agent field', async () => {
  const user = userEvent.setup();
  api.status.mockResolvedValue(running);
  api.setModel.mockResolvedValue({
    agents: [{ ...agent, models: [{ ...agent.models[0], value: 'agent-specific/new' }] }],
    pending: false,
  });
  render(<MagpieAgentsPanel />);
  await screen.findByText('magpieState_running');
  await user.click(screen.getByRole('button', { name: 'magpieRefreshManagement' }));
  await screen.findByText('Codex');
  const modelPicker = screen.getByRole('combobox', { name: 'Codex · model' });
  await waitFor(() => expect(modelPicker).toBeEnabled());
  await user.click(modelPicker);
  await user.click(await screen.findByRole('option', { name: 'vendor/new' }));
  expect(api.setModel).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'magpieApplyModel' }));
  await waitFor(() =>
    expect(api.setModel).toHaveBeenCalledWith({
      agentId: 'codex',
      field: 'model',
      value: 'agent-specific/new',
    }),
  );
});

test('double enable is locked and a late start after closing does not load configuration', async () => {
  let finish!: (result: unknown) => void;
  api.start.mockImplementation(
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  const view = render(<MagpieAgentsPanel />);
  await screen.findByText('magpieState_stopped');
  fireEvent.click(screen.getByRole('button', { name: 'magpieEnable' }));
  fireEvent.click(screen.getByRole('button', { name: 'magpieEnable' }));
  expect(api.start).toHaveBeenCalledOnce();
  view.unmount();
  await act(async () => finish(running));
  expect(api.agents).not.toHaveBeenCalled();
});

test('API failure is distinct from an empty Agent list and can be retried', async () => {
  api.status.mockResolvedValue(running);
  api.agents.mockRejectedValueOnce(new Error('backend detail'));
  render(<MagpieAgentsPanel />);
  await screen.findByText('magpieState_running');
  fireEvent.click(screen.getByRole('button', { name: 'magpieRefreshManagement' }));
  await screen.findByRole('alert');
  expect(screen.queryByText('magpieNoAgents')).not.toBeInTheDocument();
  api.agents.mockResolvedValue({ agents: [], pending: false });
  fireEvent.click(screen.getByRole('button', { name: 'magpieRefreshManagement' }));
  await screen.findByText('magpieNoAgents');
});

test('official management is explicit and stopping clears stale configuration', async () => {
  api.status.mockResolvedValue(running);
  render(<MagpieAgentsPanel />);
  await screen.findByText('magpieState_running');
  fireEvent.click(screen.getByRole('button', { name: 'magpieOpenManagement' }));
  await waitFor(() => expect(api.openManagement).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole('button', { name: 'magpieRefreshManagement' }));
  await screen.findByText('Codex');
  fireEvent.click(screen.getByRole('button', { name: 'magpieStop' }));
  await screen.findByText('magpieState_stopped');
  expect(screen.queryByText('Codex')).not.toBeInTheDocument();
});

test('process exit clears old configured models using status only, without syncing configuration', async () => {
  let tick: (() => void) | undefined;
  const setInterval = window.setInterval.bind(window);
  vi.spyOn(window, 'setInterval').mockImplementation((callback, delay, ...args) => {
    if (delay === 3000) tick = callback as () => void;
    return setInterval(callback, delay, ...args) as unknown as ReturnType<
      typeof globalThis.setInterval
    >;
  });
  api.status.mockResolvedValue(running);
  render(<MagpieAgentsPanel />);
  await screen.findByText('magpieState_running');
  fireEvent.click(screen.getByRole('button', { name: 'magpieRefreshManagement' }));
  await screen.findByText('Codex');
  await waitFor(() => expect(screen.getByRole('button', { name: 'magpieStop' })).toBeEnabled());
  const reads = api.agents.mock.calls.length;
  api.status.mockResolvedValue({ ...stopped, state: 'failed' });
  await act(async () => tick?.());
  expect(screen.queryByText('Codex')).not.toBeInTheDocument();
  expect(screen.queryByText('magpieConfigured')).not.toBeInTheDocument();
  expect(screen.getByText('magpieState_failed')).toBeVisible();
  expect(api.agents).toHaveBeenCalledTimes(reads);
});

test('failed model application retains the last confirmed value and does not claim success', async () => {
  const user = userEvent.setup();
  api.status.mockResolvedValue(running);
  let confirmStatus!: (value: typeof running) => void;
  api.status.mockResolvedValueOnce(running).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        confirmStatus = resolve;
      }),
  );
  api.setModel.mockRejectedValue(new Error('write failed'));
  render(<MagpieAgentsPanel />);
  await screen.findByText('magpieState_running');
  await user.click(screen.getByRole('button', { name: 'magpieRefreshManagement' }));
  await screen.findByText('Codex');
  const modelPicker = screen.getByRole('combobox', { name: 'Codex · model' });
  // Agent data can render before the post-action process-status check ends.
  // A disabled select correctly ignores clicks; wait for that check explicitly.
  expect(modelPicker).toBeDisabled();
  await user.click(modelPicker);
  expect(modelPicker).toHaveAttribute('aria-expanded', 'false');
  await act(async () => confirmStatus(running));
  await waitFor(() => expect(modelPicker).toBeEnabled());
  await user.click(modelPicker);
  const modelOption = await screen.findByRole('option', { name: 'vendor/new' });
  expect(screen.queryByRole('option', { name: 'gateway-only/new' })).toBeNull();
  await user.click(modelOption);
  await user.click(screen.getByRole('button', { name: 'magpieApplyModel' }));
  await screen.findByRole('alert');
  expect(screen.getByText('model: vendor/old')).toBeVisible();
  expect(api.models).not.toHaveBeenCalled();
});
