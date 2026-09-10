// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';

import {
  CodingEventKind,
  CodingPermissionOutcome,
  type CodingEvent,
} from '../../../shared/codingAgent';
import { i18nService } from '../../services/i18n';
import { CodingPermissionCard } from './CodingPermissionCard';

const makeEvent = (payload: Record<string, unknown>): CodingEvent => ({
  id: 'event-1',
  laneId: 'lane-1',
  sequence: 1,
  kind: CodingEventKind.Permission,
  payload,
  createdAt: 1,
});

const builtinRequest = makeEvent({
  requestId: 'approval-1',
  request: { toolName: 'Bash', toolInput: { command: 'npm test' } },
});

const acpRequest = makeEvent({
  requestId: 'approval-2',
  toolCall: { title: 'Run command', kind: 'execute', rawInput: { command: 'rm -rf build' } },
  options: [
    { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
    { optionId: 'allow-always', name: 'Allow for session', kind: 'allow_always' },
    { optionId: 'allow-command', name: 'Allow Commands Starting With rm', kind: null },
    { optionId: 'reject-once', name: 'Reject once', kind: 'reject_once' },
  ],
});

test('renders the shared work-mode permission surface with the requested command', () => {
  i18nService.setLanguage('zh', { persist: false });
  render(<CodingPermissionCard event={builtinRequest} onRespond={() => {}} />);

  expect(document.querySelector('.theme-permission-inline-surface')).not.toBeNull();
  expect(screen.getByText('Bash')).toBeInTheDocument();
  expect(screen.getByText('npm test')).toBeInTheDocument();
});

test('shows the risk banner for destructive commands', () => {
  i18nService.setLanguage('zh', { persist: false });
  render(<CodingPermissionCard event={acpRequest} onRespond={() => {}} />);

  expect(screen.getByText(i18nService.t('coworkDestructiveOperation'))).toBeInTheDocument();
});

test('selects with an option id when the agent offered options', async () => {
  i18nService.setLanguage('zh', { persist: false });
  const onRespond = vi.fn();
  render(<CodingPermissionCard event={acpRequest} onRespond={onRespond} />);

  await userEvent.click(screen.getByRole('button', { name: '允许一次' }));
  expect(onRespond).toHaveBeenCalledWith(CodingPermissionOutcome.Selected, 'allow-once');

  await userEvent.click(screen.getByRole('button', { name: '拒绝本次' }));
  expect(onRespond).toHaveBeenCalledWith(CodingPermissionOutcome.Selected, 'reject-once');
});

test('keeps the remaining options behind the overflow menu', async () => {
  i18nService.setLanguage('zh', { persist: false });
  const onRespond = vi.fn();
  render(<CodingPermissionCard event={acpRequest} onRespond={onRespond} />);

  await userEvent.click(screen.getByRole('button', { name: '更多' }));
  await userEvent.click(await screen.findByText('Allow Commands Starting With rm'));
  expect(onRespond).toHaveBeenCalledWith(CodingPermissionOutcome.Selected, 'allow-command');
});

test('localizes agent option names in the footer and the overflow menu', async () => {
  i18nService.setLanguage('zh', { persist: false });
  const onRespond = vi.fn();
  render(
    <CodingPermissionCard
      event={makeEvent({
        requestId: 'approval-5',
        toolCall: { title: 'Run command', kind: 'execute', rawInput: { command: 'npm test' } },
        options: [
          { optionId: 'allow-once', name: 'Allow', kind: 'allow_once' },
          { optionId: 'allow-always', name: 'Always Allow', kind: 'allow_always' },
          { optionId: 'reject-once', name: 'Deny', kind: 'reject_once' },
        ],
      })}
      onRespond={onRespond}
    />,
  );

  expect(screen.getByRole('button', { name: '允许一次' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '拒绝本次' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Always Allow' })).toBeNull();

  await userEvent.click(screen.getByRole('button', { name: '更多' }));
  await userEvent.click(await screen.findByText('本会话允许'));
  expect(onRespond).toHaveBeenCalledWith(CodingPermissionOutcome.Selected, 'allow-always');
});

test('blocks the footer actions while an answer is on its way', async () => {
  i18nService.setLanguage('zh', { persist: false });
  const onRespond = vi.fn();
  render(<CodingPermissionCard event={acpRequest} onRespond={onRespond} disabled />);

  const approve = screen.getByRole('button', { name: '允许一次' });
  const reject = screen.getByRole('button', { name: '拒绝本次' });
  expect(approve).toBeDisabled();
  expect(reject).toBeDisabled();
  await userEvent.click(approve);
  await userEvent.click(reject);
  expect(onRespond).not.toHaveBeenCalled();
});

test('approves without an option id only for the option-less built-in agent', async () => {
  i18nService.setLanguage('zh', { persist: false });
  const onRespond = vi.fn();
  render(<CodingPermissionCard event={builtinRequest} onRespond={onRespond} />);

  expect(screen.queryByRole('button', { name: '更多' })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: '允许本次操作' }));
  expect(onRespond).toHaveBeenCalledWith(CodingPermissionOutcome.Selected, undefined);

  await userEvent.click(screen.getByRole('button', { name: '拒绝' }));
  expect(onRespond).toHaveBeenCalledWith(CodingPermissionOutcome.Cancelled, undefined);
});

test('renders the overflow menu only when options are left over', () => {
  i18nService.setLanguage('zh', { persist: false });
  render(
    <CodingPermissionCard
      event={makeEvent({
        requestId: 'approval-3',
        toolCall: { title: 'Run command', kind: 'execute', rawInput: { command: 'npm test' } },
        options: [
          { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
          { optionId: 'reject-once', name: 'Reject once', kind: 'reject_once' },
        ],
      })}
      onRespond={() => {}}
    />,
  );

  expect(screen.getByRole('button', { name: '允许一次' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '拒绝本次' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '更多' })).toBeNull();
});

test('does not repeat the command when the agent uses it as the tool title', () => {
  i18nService.setLanguage('zh', { persist: false });
  render(
    <CodingPermissionCard
      event={makeEvent({
        requestId: 'approval-4',
        toolCall: { title: 'ls -d */', kind: 'execute', rawInput: { command: 'ls -d */' } },
        options: [
          { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
          { optionId: 'reject-once', name: 'Reject once', kind: 'reject_once' },
        ],
      })}
      onRespond={() => {}}
    />,
  );

  expect(screen.getAllByText('ls -d */').length).toBe(1);
  expect(screen.getByText(i18nService.t('codingAgentToolKindExecute'))).toBeInTheDocument();
});
