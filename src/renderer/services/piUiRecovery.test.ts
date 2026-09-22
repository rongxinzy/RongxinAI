import { CoworkExecutionMode } from '../../shared/cowork/constants';
import { expect, test, vi } from 'vitest';
import {
  CoworkSessionMode,
  CoworkSessionSource,
  CoworkSessionStatus,
} from '../../shared/cowork/constants';
import { PiUiEventSequencer, PiUiEventType } from '../../shared/cowork/piUiEvent';
import type { PiUiRuntimeSnapshot } from '../../shared/cowork/piUiRuntimeSnapshot';
import type { CoworkSession } from '../types/cowork';
import { PiUiRecovery } from './piUiRecovery';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
}
const session: CoworkSession = {
  id: 'A',
  status: CoworkSessionStatus.Running,
  title: 'A',
  mode: CoworkSessionMode.Work,
  pinned: false,
  cwd: '/tmp',
  systemPrompt: '',
  modelOverride: '',
  executionMode: CoworkExecutionMode.Local,
  activeSkillIds: [],
  workspaceId: '',
  agentId: '',
  source: CoworkSessionSource.Manual,
  messages: [],
  messagesOffset: 0,
  totalMessages: 0,
  createdAt: 1,
  updatedAt: 1,
};
function fixture() {
  const dependencies = {
    readRuntime: vi
      .fn<(id?: string) => Promise<PiUiRuntimeSnapshot[]>>()
      .mockResolvedValue([{ sessionId: 'A', status: CoworkSessionStatus.Completed, sequence: 2 }]),
    readSession: vi.fn().mockResolvedValue(session),
    prepare: vi.fn().mockResolvedValue(undefined),
    applyStatus: vi.fn(),
    applySession: vi.fn(),
    flush: vi.fn(),
  };
  return {
    dependencies,
    recovery: new PiUiRecovery(dependencies),
    sequencer: new PiUiEventSequencer(() => crypto.randomUUID()),
  };
}

test('an old completion snapshot cannot stop a newer turn during render preparation', async () => {
  const { dependencies, recovery, sequencer } = fixture();
  const preparation = deferred<void>();
  dependencies.prepare.mockReturnValue(preparation.promise);
  recovery.observe(sequencer.next({ type: PiUiEventType.Started, sessionId: 'A' }));
  sequencer.next({ type: PiUiEventType.Completed, sessionId: 'A' });
  const pending = recovery.recover('A');
  await vi.waitFor(() => expect(dependencies.prepare).toHaveBeenCalled());
  recovery.observe(sequencer.next({ type: PiUiEventType.Started, sessionId: 'A' }));
  preparation.resolve();
  await pending;
  expect(dependencies.applyStatus).not.toHaveBeenCalled();
  expect(dependencies.applySession).toHaveBeenCalledWith(
    expect.objectContaining({ status: CoworkSessionStatus.Running }),
    true,
  );
});

test('a running bootstrap response cannot revive execution after a newer completion', async () => {
  const { dependencies, recovery, sequencer } = fixture();
  const response = deferred<PiUiRuntimeSnapshot[]>();
  dependencies.readRuntime.mockReturnValue(response.promise);
  const pending = recovery.bootstrap();
  recovery.observe(sequencer.next({ type: PiUiEventType.Started, sessionId: 'A' }));
  recovery.observe(
    sequencer.next({ type: PiUiEventType.Completed, sessionId: 'A' }),
  );
  response.resolve([{ sessionId: 'A', sequence: 1, status: CoworkSessionStatus.Running }]);
  await pending;
  expect(dependencies.applyStatus).not.toHaveBeenCalled();
  expect(dependencies.applySession).toHaveBeenCalledWith(
    expect.objectContaining({ status: CoworkSessionStatus.Completed }),
    false,
  );
});

test('queued old lifecycle events are ignored after authoritative snapshot recovery', async () => {
  const { recovery, sequencer } = fixture();
  const started = sequencer.next({ type: PiUiEventType.Started, sessionId: 'A' });
  await recovery.bootstrap();
  expect(recovery.observe(started)).toBe(false);
});

test('new message updates preserve live content instead of retrying a continuously active stream', async () => {
  const { dependencies, recovery, sequencer } = fixture();
  const response = deferred<CoworkSession>();
  dependencies.readSession.mockReturnValue(response.promise);
  const pending = recovery.recover('A');
  recovery.observe(
    sequencer.next({
      type: PiUiEventType.MessageUpdate,
      sessionId: 'A',
      messageId: 'm',
      content: 'new text',
    }),
  );
  response.resolve(session);
  await pending;
  expect(dependencies.applySession).toHaveBeenCalledWith(expect.anything(), true);
  expect(dependencies.readSession).toHaveBeenCalledOnce();
  expect(dependencies.flush).toHaveBeenCalledOnce();
});

test('a second gap during an outstanding recovery queues a fresh read', async () => {
  const { dependencies, recovery } = fixture();
  const response = deferred<CoworkSession>();
  dependencies.readSession.mockReturnValueOnce(response.promise);
  const first = recovery.recover('A');
  const second = recovery.recover('A');
  response.resolve(session);
  await Promise.all([first, second]);
  expect(dependencies.readSession).toHaveBeenCalledTimes(2);
});

test('disposed listeners never apply outstanding recovery results', async () => {
  const { dependencies, recovery } = fixture();
  const response = deferred<CoworkSession>();
  dependencies.readSession.mockReturnValue(response.promise);
  const pending = recovery.recover('A');
  recovery.dispose();
  response.resolve(session);
  await pending;
  expect(dependencies.applySession).not.toHaveBeenCalled();
  expect(dependencies.applyStatus).not.toHaveBeenCalled();
});
