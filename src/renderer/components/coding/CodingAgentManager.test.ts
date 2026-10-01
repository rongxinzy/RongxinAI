// @vitest-environment jsdom
import { createElement } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { CodingAgentManager } from './CodingAgentManager';
import { i18nService } from '../../services/i18n';
import { showAppError } from '../../services/appToast';

vi.mock('../../services/appToast', () => ({ showAppError: vi.fn() }));

// jsdom lacks the animation query used by the real ScrollArea component.
beforeAll(() => {
  Object.defineProperty(Element.prototype, 'getAnimations', {
    configurable: true,
    value: () => [],
  });
});
afterAll(() => {
  Reflect.deleteProperty(Element.prototype, 'getAnimations');
});

beforeEach(() => {
  i18nService.setLanguage('zh', { persist: false });
  vi.clearAllMocks();
});

function openForm(onAddProfile: (input: unknown) => Promise<boolean>) {
  render(
    createElement(CodingAgentManager, {
      open: true,
      onOpenChange: vi.fn(),
      profiles: [],
      onDiscover: vi.fn(async () => true),
      onAddProfile,
      onProbe: vi.fn(async () => true),
      onTrust: vi.fn(async () => true),
    }),
  );
  fireEvent.click(screen.getByRole('tab', { name: i18nService.t('codingAgentCustomAgent') }));
  const name = screen.getByLabelText(i18nService.t('codingAgentProfileName'));
  fireEvent.change(name, { target: { value: 'Manual ACP' } });
  fireEvent.change(screen.getByLabelText(i18nService.t('codingAgentProfileCommand')), {
    target: { value: 'C:\\Program Files\\Agent\\agent.cmd' },
  });
  fireEvent.change(screen.getByLabelText(i18nService.t('codingAgentProfileArguments')), {
    target: { value: ' acp \n\n argument with spaces ' },
  });
  const form = name.closest('form');
  if (!form) throw new Error('The manual agent form is missing.');
  return form;
}

test('manual addition passes a separate executable and one argument per line, then returns to the list', async () => {
  const onAddProfile = vi.fn(async () => true);
  const form = openForm(onAddProfile);
  fireEvent.submit(form);
  await waitFor(() =>
    expect(onAddProfile).toHaveBeenCalledWith({
      name: 'Manual ACP',
      description: '',
      command: 'C:\\Program Files\\Agent\\agent.cmd',
      args: ['acp', 'argument with spaces'],
    }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole('tab', { name: `${i18nService.t('codingAgentLocalAgents')} (0)` }),
    ).toHaveAttribute('aria-selected', 'true'),
  );
});

test('failed manual additions preserve the draft and allow retry', async () => {
  const onAddProfile = vi.fn(async () => false);
  fireEvent.submit(openForm(onAddProfile));
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: i18nService.t('codingAgentAddProfile') }),
    ).toBeEnabled(),
  );
  expect(screen.getByLabelText(i18nService.t('codingAgentProfileName'))).toHaveValue('Manual ACP');
});

test('duplicate submissions save once and rejected IPC calls release the submit button', async () => {
  let rejectSave: (error: Error) => void = () => {};
  const onAddProfile = vi.fn(
    () =>
      new Promise<boolean>((_resolve, reject) => {
        rejectSave = reject;
      }),
  );
  const form = openForm(onAddProfile);
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(onAddProfile).toHaveBeenCalledTimes(1);
  await act(async () => rejectSave(new Error('IPC disconnected')));
  expect(showAppError).toHaveBeenCalledTimes(1);
  expect(
    screen.getByRole('button', { name: i18nService.t('codingAgentAddProfile') }),
  ).toBeEnabled();
  expect(screen.getByLabelText(i18nService.t('codingAgentProfileName'))).toHaveValue('Manual ACP');
});

test('repeated scan clicks run once and a failed scan restores the action', async () => {
  let rejectScan: (error: Error) => void = () => {};
  const onDiscover = vi.fn(
    () =>
      new Promise<boolean>((_resolve, reject) => {
        rejectScan = reject;
      }),
  );
  render(
    createElement(CodingAgentManager, {
      open: true,
      onOpenChange: vi.fn(),
      profiles: [],
      onDiscover,
      onAddProfile: vi.fn(async () => true),
      onProbe: vi.fn(async () => true),
      onTrust: vi.fn(async () => true),
    }),
  );
  const button = screen.getByRole('button', { name: i18nService.t('codingAgentRescan') });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(onDiscover).toHaveBeenCalledTimes(1);
  await act(async () => rejectScan(new Error('Discovery failed')));
  expect(showAppError).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: i18nService.t('codingAgentRescan') })).toBeEnabled();
});
