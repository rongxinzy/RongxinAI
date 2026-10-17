// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { MagpieAgentsPanel } from './MagpieAgentsPanel';

vi.mock('../../services/i18n', () => ({ i18nService: { t: (key: string) => key } }));
vi.mock('../../services/store', () => ({
  appStore: {
    get: vi.fn(async () => false),
    set: vi.fn(async () => undefined),
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
};

beforeEach(() => {
  for (const mock of Object.values(api)) mock.mockReset();
  api.status.mockResolvedValue({
    state: 'running',
    version: 'test',
    gatewayUrl: 'http://127.0.0.1:1',
  });
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
