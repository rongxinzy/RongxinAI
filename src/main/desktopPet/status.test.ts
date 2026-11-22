import { test, expect } from 'vitest';

import { PiUiEventSequencer, PiUiEventType, type PiUiEvent } from '../../shared/cowork/piUiEvent';
import { piUiLifecycleStatus } from '../../shared/cowork/piUiRuntimeSnapshot';
import { CoworkSessionStatus } from '../../shared/cowork/constants';
import { DesktopPetState } from '../../shared/desktopPet/constants';
import { CoworkErrorKind } from '../../common/coworkError';
import { DesktopPetStatus } from './status';

function fixture() {
  const running = new Set<string>();
  const approvals = new Map<string, string>();
  const status = new DesktopPetStatus(
    () => running.values().next().value,
    () => approvals.values().next().value,
  );
  const observe = (event: PiUiEvent) => {
    const lifecycle = piUiLifecycleStatus(event);
    if (
      lifecycle === CoworkSessionStatus.Running ||
      event.type === PiUiEventType.PermissionRequest
    ) {
      if (!event.sessionId) throw new Error('Running test event requires a session');
      running.add(event.sessionId);
    } else if (event.sessionId && lifecycle) {
      running.delete(event.sessionId);
      for (const [requestId, sessionId] of approvals) {
        if (sessionId === event.sessionId) approvals.delete(requestId);
      }
    }
    if (event.type === PiUiEventType.PermissionRequest)
      approvals.set(event.request.requestId, event.sessionId);
    if (event.type === PiUiEventType.PermissionDismiss) approvals.delete(event.requestId);
    status.observe(event);
  };
  return { status, observe };
}

test('reads running work directly when the pet has not received a start event', () => {
  let running: string | undefined = 'attached-late';
  const status = new DesktopPetStatus(
    () => running,
    () => undefined,
  );
  expect(status.state).toBe(DesktopPetState.Thinking);
  expect(status.targetSessionId).toBe('attached-late');
  running = undefined;
  expect(status.state).toBe(DesktopPetState.Idle);
});

test('one completed session cannot celebrate while another session is running', () => {
  const { status, observe } = fixture();
  const events = new PiUiEventSequencer(() => 'test');
  observe(events.next({ type: PiUiEventType.Started, sessionId: 'a' }));
  observe(events.next({ type: PiUiEventType.Started, sessionId: 'b' }));
  observe(events.next({ type: PiUiEventType.Completed, sessionId: 'a' }));
  expect(status.state).toBe(DesktopPetState.Thinking);
  observe(events.next({ type: PiUiEventType.Completed, sessionId: 'b' }));
  expect(status.state).toBe(DesktopPetState.Completed);
  status.clearTerminal();
  expect(status.state).toBe(DesktopPetState.Idle);
});

test('pending approvals take precedence and terminal events remove only their own approvals', () => {
  const { status, observe } = fixture();
  const events = new PiUiEventSequencer(() => 'test');
  for (const sessionId of ['a', 'b']) {
    observe(
      events.next({
        type: PiUiEventType.PermissionRequest,
        sessionId,
        request: { requestId: sessionId, toolName: 'bash', toolInput: {} },
      }),
    );
  }
  expect(status.state).toBe(DesktopPetState.Waiting);
  observe(events.next({ type: PiUiEventType.Stopped, sessionId: 'a' }));
  expect(status.state).toBe(DesktopPetState.Waiting);
  observe(events.next({ type: PiUiEventType.PermissionDismiss, sessionId: null, requestId: 'b' }));
  expect(status.state).toBe(DesktopPetState.Thinking);
  observe(events.next({ type: PiUiEventType.Stopped, sessionId: 'b' }));
  expect(status.state).toBe(DesktopPetState.Idle);
});

test('text updates cannot clear an approval or reawaken a finished task', () => {
  const { status, observe } = fixture();
  const events = new PiUiEventSequencer(() => 'test');
  observe(
    events.next({
      type: PiUiEventType.PermissionRequest,
      sessionId: 'a',
      request: { requestId: 'approval', toolName: 'bash', toolInput: {} },
    }),
  );
  observe(
    events.next({
      type: PiUiEventType.MessageUpdate,
      sessionId: 'a',
      messageId: 'm',
      content: 'late',
    }),
  );
  expect(status.state).toBe(DesktopPetState.Waiting);
  observe(events.next({ type: PiUiEventType.Completed, sessionId: 'a' }));
  observe(
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
  const { status, observe } = fixture();
  let id = 0;
  const events = new PiUiEventSequencer(() => `event-${++id}`);
  observe(events.next({ type: PiUiEventType.Started, sessionId: 'a' }));
  observe(events.next({ type: PiUiEventType.Started, sessionId: 'b' }));
  const failure = events.next({
    type: PiUiEventType.Error,
    sessionId: 'a',
    error: { kind: CoworkErrorKind.Unknown, message: 'failed' },
  });
  observe(failure);
  expect(status.state).toBe(DesktopPetState.Error);
  expect(status.targetSessionId).toBe('a');
  observe(events.next({ type: PiUiEventType.Completed, sessionId: 'b' }));
  status.clearTerminal();
  expect(status.state).toBe(DesktopPetState.Error);
  status.acknowledgeFailure('a', 'stale');
  expect(status.state).toBe(DesktopPetState.Error);
  status.acknowledgeFailure('a', failure.eventId);
  expect(status.state).toBe(DesktopPetState.Idle);
  expect(status.targetSessionId).toBeNull();
});

test('a second failure while navigation is loading cannot be cleared by acknowledgement of the first', () => {
  const { status, observe } = fixture();
  let id = 0;
  const events = new PiUiEventSequencer(() => `${++id}`);
  const fail = () =>
    events.next({
      type: PiUiEventType.Error,
      sessionId: 'a',
      error: { kind: CoworkErrorKind.Unknown, message: 'failed' },
    });
  const first = fail();
  observe(first);
  const second = fail();
  observe(second);
  status.acknowledgeFailure('a', first.eventId);
  expect(status.pendingFailures).toEqual([{ sessionId: 'a', eventId: second.eventId }]);
  const { status: restored, observe: observeRestored } = fixture();
  restored.restoreFailures(status.pendingFailures);
  expect(restored.state).toBe(DesktopPetState.Error);
  observeRestored(
    events.next({
      type: PiUiEventType.PermissionRequest,
      sessionId: 'b',
      request: { requestId: 'r', toolName: 'bash', toolInput: {} },
    }),
  );
  expect(restored.state).toBe(DesktopPetState.Waiting);
  expect(restored.targetSessionId).toBe('b');
  observeRestored(events.next({ type: PiUiEventType.Stopped, sessionId: 'b' }));
  expect(restored.targetSessionId).toBe('a');
  observeRestored(events.next({ type: PiUiEventType.Completed, sessionId: 'a' }));
  expect(restored.pendingFailures).toEqual([]);
});
