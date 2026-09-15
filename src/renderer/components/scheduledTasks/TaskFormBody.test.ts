// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, expect, test, vi } from 'vitest';

import { SessionBindingStrategy } from '../../../scheduledTask/constants';
import TaskFormBody from './TaskFormBody';

afterEach(cleanup);

test('shows the selected session title instead of its internal id', () => {
  render(
    createElement(TaskFormBody, {
      mode: 'create',
      name: '',
      modelId: '',
      workspaceId: 'workspace-1',
      sessionBinding: SessionBindingStrategy.Existing,
      boundSessionId: 'session-internal-id',
      sessionOptions: [{ value: 'session-internal-id', label: 'Quarterly planning' }],
      sessionOptionsLoading: false,
      payloadText: '',
      errors: {},
      modelOptions: [],
      workspaceOptions: [{ value: 'workspace-1', label: 'Main workspace' }],
      scheduleControl: null,
      notificationControl: null,
      onNameChange: vi.fn(),
      onModelChange: vi.fn(),
      onWorkspaceChange: vi.fn(),
      onSessionBindingChange: vi.fn(),
      onBoundSessionChange: vi.fn(),
      onPayloadTextChange: vi.fn(),
    }),
  );

  const triggers = screen.getAllByRole('combobox');
  const sessionTrigger = triggers.at(-1);
  expect(sessionTrigger).toHaveTextContent('Quarterly planning');
  expect(sessionTrigger).not.toHaveTextContent('session-internal-id');
});
