import { test, expect } from 'vitest';

import { PiUiEventSequencer, PiUiEventType } from '../../shared/cowork/piUiEvent';
import { DesktopPetState } from '../../shared/desktopPet/constants';
import { CoworkErrorKind } from '../../common/coworkError';
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

test('a failure survives other successes, running tasks and terminal expiry until its exact event is acknowledged', () => {
  const status = new DesktopPetStatus();
  let id = 0;
  const events = new PiUiEventSequencer(() => `event-${++id}`);
  status.observe(events.next({ type: PiUiEventType.Started, sessionId: 'a' }));
  status.observe(events.next({ type: PiUiEventType.Started, sessionId: 'b' }));
  const failure = events.next({
    type: PiUiEventType.Error,
    sessionId: 'a',
    error: { kind: CoworkErrorKind.Unknown, message: 'failed' },
  });
  status.observe(failure);
  expect(status.state).toBe(DesktopPetState.Error);
  expect(status.targetSessionId).toBe('a');
  status.observe(events.next({ type: PiUiEventType.Completed, sessionId: 'b' }));
  status.clearTerminal();
  expect(status.state).toBe(DesktopPetState.Error);
  status.acknowledgeFailure('a', 'stale');
  expect(status.state).toBe(DesktopPetState.Error);
  status.acknowledgeFailure('a', failure.eventId);
  expect(status.state).toBe(DesktopPetState.Idle);
  expect(status.targetSessionId).toBeNull();
});

test('a second failure while navigation is loading cannot be cleared by acknowledgement of the first', () => {
  const status = new DesktopPetStatus();
  let id = 0;
  const events = new PiUiEventSequencer(() => `${++id}`);
  const fail = () =>
    events.next({
      type: PiUiEventType.Error,
      sessionId: 'a',
      error: { kind: CoworkErrorKind.Unknown, message: 'failed' },
    });
  const first = fail();
  status.observe(first);
  const second = fail();
  status.observe(second);
  status.acknowledgeFailure('a', first.eventId);
  expect(status.pendingFailures).toEqual([{ sessionId: 'a', eventId: second.eventId }]);
  const restored = new DesktopPetStatus();
  restored.restoreFailures(status.pendingFailures);
  expect(restored.state).toBe(DesktopPetState.Error);
  restored.observe(
    events.next({
      type: PiUiEventType.PermissionRequest,
      sessionId: 'b',
      request: { requestId: 'r', toolName: 'bash', toolInput: {} },
    }),
  );
  expect(restored.state).toBe(DesktopPetState.Waiting);
  expect(restored.targetSessionId).toBe('b');
  restored.removeSession('b');
  expect(restored.targetSessionId).toBe('a');
  restored.observe(events.next({ type: PiUiEventType.Completed, sessionId: 'a' }));
  expect(restored.pendingFailures).toEqual([]);
});
