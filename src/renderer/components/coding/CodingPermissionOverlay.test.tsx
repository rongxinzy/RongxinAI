// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';

import {
  CodingEventKind,
  CodingPermissionOutcome,
  type CodingEvent,
} from '../../../shared/codingAgent';
import { i18nService } from '../../services/i18n';
import { CodingPermissionOverlay } from './CodingPermissionOverlay';

const permission: CodingEvent = {
  id: 'event-1',
  laneId: 'lane-1',
  sequence: 1,
  kind: CodingEventKind.Permission,
  payload: {
    requestId: 'approval-1',
    toolCall: { title: 'Run command', kind: 'execute', rawInput: { command: 'npm test' } },
    options: [
      { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
      { optionId: 'reject-once', name: 'Reject once', kind: 'reject_once' },
    ],
  },
  createdAt: 1,
};

test('renders nothing while no permission is pending', () => {
  const { container } = render(<CodingPermissionOverlay permission={null} onRespond={() => {}} />);
  expect(container).toBeEmptyDOMElement();
});

test('sends one answer per request even when the buttons are clicked twice', async () => {
  i18nService.setLanguage('zh', { persist: false });
  let settle: (() => void) | undefined;
  const onRespond = vi.fn(
    () =>
      new Promise<void>(resolve => {
        settle = resolve;
      }),
  );
  render(<CodingPermissionOverlay permission={permission} onRespond={onRespond} />);

  const approve = screen.getByRole('button', { name: '允许一次' });
  await userEvent.click(approve);
  await userEvent.click(approve);
  expect(onRespond).toHaveBeenCalledTimes(1);
  expect(approve).toBeDisabled();

  // A failed or slow answer must leave the card usable instead of stuck.
  settle?.();
  await waitFor(() => expect(approve).not.toBeDisabled());
  await userEvent.click(approve);
  expect(onRespond).toHaveBeenCalledTimes(2);
});

test('answers with the pending request id', async () => {
  i18nService.setLanguage('zh', { persist: false });
  const onRespond = vi.fn();
  render(<CodingPermissionOverlay permission={permission} onRespond={onRespond} />);

  await userEvent.click(screen.getByRole('button', { name: '允许一次' }));
  expect(onRespond).toHaveBeenCalledWith(
    'approval-1',
    CodingPermissionOutcome.Selected,
    'allow-once',
  );
});
