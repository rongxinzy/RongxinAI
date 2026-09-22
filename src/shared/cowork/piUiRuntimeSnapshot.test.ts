import { expect, test } from 'vitest';
import { CoworkSessionStatus } from './constants';
import { PiUiEventSequencer, PiUiEventType } from './piUiEvent';
import { PiUiRuntimeSnapshots } from './piUiRuntimeSnapshot';

test('runtime snapshots survive listener absence and reflect actual lifecycle events', () => {
  const snapshots = new PiUiRuntimeSnapshots();
  const sequencer = new PiUiEventSequencer(() => crypto.randomUUID());
  expect(snapshots.read('A')).toEqual([
    { sessionId: 'A', sequence: 0, status: CoworkSessionStatus.Idle },
  ]);
  snapshots.observe(sequencer.next({ type: PiUiEventType.Started, sessionId: 'A' }));
  snapshots.observe(
    sequencer.next({ type: PiUiEventType.QueueUpdated, sessionId: 'A', items: [] }),
  );
  expect(snapshots.read('A')[0]).toEqual({
    sessionId: 'A',
    sequence: 2,
    status: CoworkSessionStatus.Running,
  });
  const detached = snapshots.read('A')[0];
  detached.status = CoworkSessionStatus.Error;
  expect(snapshots.read('A')[0].status).toBe(CoworkSessionStatus.Running);
  snapshots.observe(
    sequencer.next({ type: PiUiEventType.Completed, sessionId: 'A' }),
  );
  expect(snapshots.read('A')[0].status).toBe(CoworkSessionStatus.Completed);
  snapshots.observe(sequencer.next({ type: PiUiEventType.Started, sessionId: 'B' }));
  snapshots.observe(sequencer.next({ type: PiUiEventType.Stopped, sessionId: 'B' }));
  expect(snapshots.read('B')[0].status).toBe(CoworkSessionStatus.Idle);
  expect(snapshots.read()).toHaveLength(2);
});

test('messages cannot manufacture live execution before Started or after completion', () => {
  const snapshots = new PiUiRuntimeSnapshots();
  const sequencer = new PiUiEventSequencer(() => crypto.randomUUID());
  const message = () =>
    sequencer.next({
      type: PiUiEventType.Message,
      sessionId: 'A',
      message: { id: 'm', type: 'user', content: 'hello', timestamp: 1 },
    });
  snapshots.observe(message());
  expect(snapshots.read('A')[0].status).toBe(CoworkSessionStatus.Idle);
  snapshots.observe(
    sequencer.next({ type: PiUiEventType.Completed, sessionId: 'A' }),
  );
  snapshots.observe(message());
  expect(snapshots.read('A')[0].status).toBe(CoworkSessionStatus.Completed);
});
