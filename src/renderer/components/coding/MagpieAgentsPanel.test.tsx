// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { MagpieAgent, MagpieAgents } from '../../../shared/magpie/types';
import { MagpieAgentsPanel } from './MagpieAgentsPanel';
import { localStore } from '../../services/store';

vi.mock('../../services/i18n', () => ({ i18nService: { t: (key: string) => key } }));
vi.mock('../../services/store', () => ({
  localStore: {
    getItem: vi.fn(async () => false),
    setItem: vi.fn(async () => undefined),
  },
}));

const api = {
  status: vi.fn(),
  agents: vi.fn(),
  connectAgent: vi.fn(),
  disconnectAgent: vi.fn(),
  disconnectAllAgents: vi.fn(),
  previewAgent: vi.fn(),
  setModel: vi.fn(),
  start: vi.fn(),
};

function codexAgent(overrides: Partial<MagpieAgent> = {}): MagpieAgent {
  return {
    id: 'codex',
    name: 'Codex',
    cliMissing: false,
    wired: false,
    models: [
      {
        key: 'model',
        label: 'Model',
        value: 'm1',
        options: [
          { value: 'm1', label: 'One' },
          { value: 'm2', label: 'Two' },
        ],
      },
    ],
    ...overrides,
  };
}

const runningStatus = {
  state: 'running' as const,
  version: 'test',
  gatewayUrl: 'http://127.0.0.1:1',
};

async function refreshAgents() {
  await waitFor(() =>
    expect(
      screen.getAllByRole('button', { name: 'magpieRefreshManagement' }).length,
    ).toBeGreaterThan(0),
  );
  fireEvent.click(screen.getAllByRole('button', { name: 'magpieRefreshManagement' })[0]!);
}

const fiveAgents = (): MagpieAgents => ({
  pending: false,
  agents: [
    codexAgent({ id: 'codex' }),
    codexAgent({ id: 'claude', name: 'Claude' }),
    codexAgent({ id: 'opencode', name: 'OpenCode' }),
    codexAgent({ id: 'gemini', name: 'Gemini' }),
    codexAgent({ id: 'pi', name: 'Pi' }),
  ],
});

beforeEach(() => {
  vi.useRealTimers();
  Element.prototype.setPointerCapture ??= vi.fn();
  Element.prototype.releasePointerCapture ??= vi.fn();
  for (const mock of Object.values(api)) mock.mockReset();
  vi.mocked(localStore.getItem).mockResolvedValue(false);
  vi.mocked(localStore.setItem).mockResolvedValue(undefined);
  api.status.mockResolvedValue(runningStatus);
  api.agents.mockResolvedValue({ agents: [], pending: false });
  Object.assign(window, { electron: { magpie: api } });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test('shows keep-running notice and disconnect-all when the service is running', async () => {
  render(<MagpieAgentsPanel />);
  expect(await screen.findByText('magpieExternalKeepRunningNotice')).toBeVisible();
  expect(screen.getByRole('button', { name: 'magpieExternalDisconnectAll' })).toBeVisible();
});

test('prompts to enable the model service when it is not running', async () => {
  api.status.mockResolvedValue({ state: 'stopped', version: 'test' });
  render(<MagpieAgentsPanel />);
  expect(await screen.findByText('magpieExternalServiceRequired')).toBeVisible();
});

test('mount polls status only and does not start the service or load agents', async () => {
  render(<MagpieAgentsPanel />);
  await waitFor(() => expect(api.status).toHaveBeenCalled());
  expect(api.start).not.toHaveBeenCalled();
  expect(api.agents).not.toHaveBeenCalled();
  expect(api.connectAgent).not.toHaveBeenCalled();
});

test('does not load agents when status becomes running until explicit refresh', async () => {
  api.status
    .mockResolvedValueOnce({ state: 'stopped', version: 'test' })
    .mockResolvedValue({ state: 'running', version: 'test', gatewayUrl: 'http://127.0.0.1:1' });
  render(<MagpieAgentsPanel />);
  expect(await screen.findByText('magpieExternalServiceRequired')).toBeVisible();
  await waitFor(() => expect(screen.getByText('magpieExternalKeepRunningNotice')).toBeVisible(), {
    timeout: 5000,
  });
  expect(api.agents).not.toHaveBeenCalled();
});

test('blocks a second refresh while the first agent load is still in flight', async () => {
  let resolveAgents!: (value: MagpieAgents) => void;
  api.agents.mockImplementation(
    () =>
      new Promise<MagpieAgents>(resolve => {
        resolveAgents = resolve;
      }),
  );
  render(<MagpieAgentsPanel />);
  await refreshAgents();
  fireEvent.click(screen.getAllByRole('button', { name: 'magpieRefreshManagement' })[0]!);
  expect(api.agents).toHaveBeenCalledTimes(1);
  await act(async () => resolveAgents({ agents: [], pending: false }));
});

test('loads agents only after explicit refresh while the service is running', async () => {
  api.agents.mockResolvedValue(fiveAgents());
  render(<MagpieAgentsPanel />);
  await waitFor(() => expect(api.status).toHaveBeenCalled());
  expect(api.agents).not.toHaveBeenCalled();
  await refreshAgents();
  await waitFor(() => expect(api.agents).toHaveBeenCalledTimes(1));
  expect(await screen.findByText('magpieExternalAgentCodex')).toBeVisible();
});

test('shows catalog rows with missing status when the agent list is empty', async () => {
  api.agents.mockResolvedValue({ agents: [], pending: false });
  render(<MagpieAgentsPanel />);
  await refreshAgents();
  expect((await screen.findAllByText('magpieExternalStatusMissing')).length).toBe(5);
  expect(screen.getAllByText('magpieExternalAgentClaude').length).toBeGreaterThan(0);
});

test('surfaces agent list failures without treating them as an empty catalog', async () => {
  api.agents.mockRejectedValue(new Error('network'));
  render(<MagpieAgentsPanel />);
  await refreshAgents();
  expect(await screen.findByText('magpieActionFailed')).toBeVisible();
});

test('clears stale agent rows when status polling reports the service stopped', async () => {
  api.agents.mockResolvedValue(fiveAgents());
  render(<MagpieAgentsPanel />);
  await refreshAgents();
  expect(await screen.findByText('magpieExternalAgentCodex')).toBeVisible();
  api.status.mockResolvedValue({ state: 'stopped', version: 'test' });
  await waitFor(
    () => {
      expect(screen.queryByText('magpieExternalAgentCodex')).toBeNull();
      expect(screen.getByText('magpieExternalServiceRequired')).toBeVisible();
    },
    { timeout: 5000 },
  );
});

test('opens connect confirmation and calls connectAgent once when confirmed', async () => {
  api.agents.mockResolvedValue({ agents: [codexAgent()], pending: false });
  let resolveConnect!: (value: MagpieAgents) => void;
  api.connectAgent.mockImplementation(
    () =>
      new Promise<MagpieAgents>(resolve => {
        resolveConnect = resolve;
      }),
  );
  render(<MagpieAgentsPanel />);
  await refreshAgents();
  await screen.findByText('magpieExternalAgentCodex');
  const toggle = screen.getAllByRole('switch').at(-1)!;
  await userEvent.click(toggle);
  expect(await screen.findByText('magpieExternalConnectConfirmTitle')).toBeVisible();
  const confirm = screen.getByRole('button', { name: 'magpieExternalConnectConfirmAction' });
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  expect(api.connectAgent).toHaveBeenCalledTimes(1);
  expect(api.connectAgent).toHaveBeenCalledWith('codex');
  await act(async () => resolveConnect({ agents: [codexAgent({ wired: true })], pending: false }));
});

test('loads disconnect preview and shows file changes before confirming', async () => {
  api.agents.mockResolvedValue({ agents: [codexAgent({ wired: true })], pending: false });
  api.previewAgent.mockResolvedValue({
    changes: [{ path: '~/.codex/config.toml', lines: [{ op: '-', was: 'wired' }] }],
  });
  render(<MagpieAgentsPanel />);
  await refreshAgents();
  await screen.findByText('magpieExternalAgentCodex');
  const toggle = screen
    .getAllByRole('switch')
    .find(node => node.getAttribute('aria-disabled') !== 'true')!;
  await userEvent.click(toggle);
  expect(await screen.findByText('magpieExternalDisconnectConfirmTitle')).toBeVisible();
  expect(api.previewAgent).toHaveBeenCalledWith('codex');
  expect(await screen.findByText('~/.codex/config.toml')).toBeVisible();
});

test('persists disconnect-on-quit via localStore', async () => {
  render(<MagpieAgentsPanel />);
  const checkbox = await screen.findByRole('checkbox', { name: 'magpieExternalDisconnectOnQuit' });
  await userEvent.click(checkbox);
  expect(localStore.setItem).toHaveBeenCalledWith('magpie_disconnect_external_on_quit', true);
});

test('shows unavailable error when the magpie API is missing', async () => {
  Object.assign(window, { electron: {} });
  render(<MagpieAgentsPanel />);
  expect(await screen.findByText('magpieUnavailable')).toBeVisible();
});

describe('model apply', () => {
  test('does not call setModel until Apply is clicked', async () => {
    const user = userEvent.setup();
    api.agents.mockResolvedValue({ agents: [codexAgent()], pending: false });
    render(<MagpieAgentsPanel />);
    await refreshAgents();
    await screen.findByText('magpieExternalAgentCodex');
    await user.click(screen.getByRole('combobox', { name: 'magpieSelectModel' }));
    await user.click(await screen.findByText('Two'));
    expect(api.setModel).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'magpieApplyModel' }));
    await waitFor(() =>
      expect(api.setModel).toHaveBeenCalledWith({
        agentId: 'codex',
        field: 'model',
        value: 'm2',
      }),
    );
  });

  test('surfaces setModel failures', async () => {
    const user = userEvent.setup();
    api.agents.mockResolvedValue({ agents: [codexAgent()], pending: false });
    api.setModel.mockRejectedValue(new Error('upstream'));
    render(<MagpieAgentsPanel />);
    await refreshAgents();
    await screen.findByText('magpieExternalAgentCodex');
    await user.click(screen.getByRole('combobox', { name: 'magpieSelectModel' }));
    await user.click(await screen.findByText('Two'));
    await user.click(screen.getByRole('button', { name: 'magpieApplyModel' }));
    expect(await screen.findByText('magpieActionFailed')).toBeVisible();
  });
});
