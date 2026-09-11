// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';

import { CodingEventKind, type CodingEvent } from '../../../shared/codingAgent';
import { i18nService } from '../../services/i18n';
import { CodingActivity } from './CodingActivityView';
import { projectCodingEvents } from './codingEventProjection';

const permissionEvent: CodingEvent = {
  id: 'event-1',
  laneId: 'lane-1',
  sequence: 1,
  kind: CodingEventKind.Permission,
  payload: {
    requestId: 'approval-1',
    request: { toolName: 'Bash', toolInput: { command: 'npm test' } },
  },
  createdAt: 1,
};

const permissionActivity = () => {
  const [turn] = projectCodingEvents([permissionEvent]);
  return turn.activities[0];
};

test('keeps the pending permission in the stream as a collapsed tool entry', () => {
  i18nService.setLanguage('zh', { persist: false });
  const activity = permissionActivity();
  // The approval card covers the composer while it waits, so the conversation
  // must not bury a second copy inside the process group — nor when expanded.
  const closed = render(
    <CodingActivity activity={activity} open={false} onOpenChange={() => {}} />,
  );
  expect(closed.container.querySelector('[data-coding-permission-card]')).toBeNull();
  closed.unmount();

  const expanded = render(<CodingActivity activity={activity} open onOpenChange={() => {}} />);
  expect(expanded.container.querySelector('[data-coding-permission-card]')).toBeNull();
  expect(screen.getAllByText(i18nService.t('codingAgentPermissionEvent')).length).toBeGreaterThan(
    0,
  );
});
