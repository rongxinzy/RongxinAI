import { test, expect } from 'vitest';

import { PiUiEventSequencer, PiUiEventType } from '../../shared/cowork/piUiEvent';
import { DesktopPetState } from '../../shared/desktopPet/constants';
import { DesktopPetStatus } from './status';

test('one completed session cannot celebrate while another session is running', () => {
  const status = new DesktopPetStatus();
  const events = new PiUiEventSequencer(() => 'test');
  status.observe(events.next({ type: PiUiEventType.Started, sessionId: 'a' }));
  status.observe(events.next({ type: PiUiEventType.Started, sessionId: 'b' }));
  status.observe(events.next({ type: PiUiEventType.Completed, sessionId: 'a' }));
  expect(status.state).toBe(DesktopPetState.Thinking);
  status.observe(events.next({ type: PiUiEventType.Completed, sessionId: 'b' }));
  expect(status.state).toBe(DesktopPetState.Completed);
  status.clearTerminal();
  expect(status.state).toBe(DesktopPetState.Idle);
});

test('pending approvals take precedence and terminal events remove only their own approvals', () => {
  const status = new DesktopPetStatus();
  const events = new PiUiEventSequencer(() => 'test');
  for (const sessionId of ['a', 'b']) {
    status.observe(
      events.next({
        type: PiUiEventType.PermissionRequest,
        sessionId,
        request: { requestId: sessionId, toolName: 'bash', toolInput: {} },
      }),
    );
  }
  expect(status.state).toBe(DesktopPetState.Waiting);
  status.observe(events.next({ type: PiUiEventType.Stopped, sessionId: 'a' }));
  expect(status.state).toBe(DesktopPetState.Waiting);
  status.observe(
    events.next({ type: PiUiEventType.PermissionDismiss, sessionId: null, requestId: 'b' }),
  );
  expect(status.state).toBe(DesktopPetState.Thinking);
  status.observe(events.next({ type: PiUiEventType.Stopped, sessionId: 'b' }));
  expect(status.state).toBe(DesktopPetState.Idle);
});

test('text updates cannot clear an approval or reawaken a finished task', () => {
  const status = new DesktopPetStatus();
  const events = new PiUiEventSequencer(() => 'test');
  status.observe(
    events.next({
      type: PiUiEventType.PermissionRequest,
      sessionId: 'a',
      request: { requestId: 'approval', toolName: 'bash', toolInput: {} },
    }),
  );
  status.observe(
    events.next({
      type: PiUiEventType.MessageUpdate,
      sessionId: 'a',
      messageId: 'm',
      content: 'late',
    }),
  );
  expect(status.state).toBe(DesktopPetState.Waiting);
  status.observe(events.next({ type: PiUiEventType.Completed, sessionId: 'a' }));
  status.observe(
    events.next({
      type: PiUiEventType.MessageUpdate,
      sessionId: 'a',
      messageId: 'm',
      content: 'late',
    }),
  );
  expect(status.state).toBe(DesktopPetState.Completed);
});
