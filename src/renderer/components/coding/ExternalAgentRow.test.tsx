// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Terminal } from 'lucide-react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { MagpieExternalAgentId } from '../../../shared/magpie/constants';
import type { MagpieAgent } from '../../../shared/magpie/types';
import { ExternalAgentRow } from './ExternalAgentRow';

vi.mock('../../services/i18n', () => ({ i18nService: { t: (key: string) => key } }));

const agent: MagpieAgent = {
  id: 'pi',
  name: 'Pi',
  cliMissing: false,
  wired: true,
  version: '9.9.9',
  models: [
    {
      key: 'model',
      label: 'Model',
      value: 'live-model',
      options: [{ value: 'live-model' }, { value: 'draft-model', label: 'Draft' }],
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  Element.prototype.setPointerCapture ??= vi.fn();
  Element.prototype.releasePointerCapture ??= vi.fn();
});

afterEach(cleanup);

test('shows connected status, version, and reapply error badge', () => {
  render(
    <ExternalAgentRow
      catalogId={MagpieExternalAgentId.Pi}
      labelKey="magpieExternalAgentPi"
      icon={Terminal}
      agent={{ ...agent, reapplyError: 'gateway drift' }}
      busy={false}
      onToggle={vi.fn()}
      onApplyModel={vi.fn(async () => undefined)}
    />,
  );
  expect(screen.getByText('magpieExternalStatusConnected')).toBeVisible();
  expect(screen.getByText('magpieExternalReapplyError')).toBeVisible();
  expect(screen.getByText('magpieExternalVersion')).toBeVisible();
});

test('disables toggle when CLI is missing', () => {
  const onToggle = vi.fn();
  render(
    <ExternalAgentRow
      catalogId={MagpieExternalAgentId.Pi}
      labelKey="magpieExternalAgentPi"
      icon={Terminal}
      agent={{ ...agent, cliMissing: true, wired: false }}
      busy={false}
      onToggle={onToggle}
      onApplyModel={vi.fn(async () => undefined)}
    />,
  );
  expect(screen.getByRole('switch')).toHaveAttribute('aria-disabled', 'true');
  expect(screen.getByText('magpieExternalStatusMissing')).toBeVisible();
});

test('calls onToggle when the switch changes', async () => {
  const onToggle = vi.fn();
  render(
    <ExternalAgentRow
      catalogId={MagpieExternalAgentId.Pi}
      labelKey="magpieExternalAgentPi"
      icon={Terminal}
      agent={{ ...agent, wired: false }}
      busy={false}
      onToggle={onToggle}
      onApplyModel={vi.fn(async () => undefined)}
    />,
  );
  await userEvent.click(screen.getByRole('switch'));
  expect(onToggle.mock.calls[0]?.[0]).toBe(true);
});

test('applies draft model only through Apply', async () => {
  const user = userEvent.setup();
  const onApplyModel = vi.fn(async () => undefined);
  render(
    <ExternalAgentRow
      catalogId={MagpieExternalAgentId.Pi}
      labelKey="magpieExternalAgentPi"
      icon={Terminal}
      agent={agent}
      busy={false}
      onToggle={vi.fn()}
      onApplyModel={onApplyModel}
    />,
  );
  await user.click(screen.getByRole('combobox', { name: 'magpieSelectModel' }));
  await user.click(await screen.findByText('Draft'));
  expect(onApplyModel).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'magpieApplyModel' }));
  await waitFor(() =>
    expect(onApplyModel).toHaveBeenCalledWith({
      agentId: 'pi',
      field: 'model',
      value: 'draft-model',
    }),
  );
});
