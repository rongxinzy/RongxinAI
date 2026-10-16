// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';

import { CoworkArtifactSource } from '../../../../shared/cowork/artifacts';
import { addArtifact } from '../../../store/slices/artifactSlice';
import { ArtifactRole, type Artifact } from '../../../types/artifact';
import type { CoworkMessage, CoworkSession } from '../../../types/cowork';
import { useSessionArtifactDetection } from './useSessionArtifactDetection';

const mocks = vi.hoisted(() => {
  class FakeDetectionService {
    static instances: FakeDetectionService[] = [];
    onDetected: (artifacts: unknown[]) => void;
    processed: { messages: unknown[]; sessionId: string }[] = [];
    terminated = 0;

    constructor(onDetected: (artifacts: unknown[]) => void) {
      this.onDetected = onDetected;
      mocks.FakeDetectionService.instances.push(this);
    }

    processMessages(messages: unknown[], sessionId: string) {
      this.processed.push({ messages, sessionId });
      return Promise.resolve([]);
    }

    terminate() {
      this.terminated += 1;
    }
  }
  return {
    dispatch: vi.fn(),
    prepare: vi.fn(),
    detect: vi.fn(),
    FakeDetectionService,
  };
});

vi.mock('react-redux', () => ({ useDispatch: () => mocks.dispatch }));
vi.mock('../../../services/artifactAvailability', () => ({
  prepareAvailableArtifacts: mocks.prepare,
}));
vi.mock('../../../services/artifactParser', () => ({
  detectArtifactsFromMessages: mocks.detect,
}));
vi.mock('../../../services/artifactDetectionService', () => ({
  ArtifactDetectionService: mocks.FakeDetectionService,
}));

const artifact = (id: string, filePath?: string): Artifact => ({
  id,
  messageId: 'm1',
  sessionId: 'session-1',
  type: 'document',
  title: id,
  content: '',
  filePath,
  source: CoworkArtifactSource.Tool,
  role: ArtifactRole.Deliverable,
  declared: true,
  createdAt: 1,
});

const message = (id: string): CoworkMessage => ({
  id,
  type: 'assistant',
  content: 'answer',
  timestamp: 1,
});

const session = (messages: CoworkMessage[]): CoworkSession => ({
  id: 'session-1',
  title: 'session',
  status: 'idle',
  pinned: false,
  cwd: '/work',
  systemPrompt: '',
  modelOverride: '',
  executionMode: 'auto',
  activeSkillIds: [],
  workspaceId: '',
  agentId: '',
  source: 'manual',
  messages,
  messagesOffset: 0,
  totalMessages: messages.length,
  createdAt: 1,
  updatedAt: 1,
});

const renderDetection = (props: {
  sessionId?: string;
  currentSession: CoworkSession | null;
  isStreaming?: boolean;
}) =>
  renderHook(
    (next: typeof props) =>
      useSessionArtifactDetection({
        sessionId: next.sessionId ?? 'session-1',
        currentSession: next.currentSession,
        isStreaming: next.isStreaming ?? false,
        messagesLength: next.currentSession?.messages.length ?? 0,
      }),
    { initialProps: props },
  );

beforeEach(() => {
  mocks.dispatch.mockReset();
  mocks.prepare.mockReset();
  mocks.detect.mockReset();
  mocks.FakeDetectionService.instances = [];
});

test('lands detection batches in arrival order even when probes settle late', async () => {
  renderDetection({ currentSession: null });
  const service = mocks.FakeDetectionService.instances[0]!;
  const first = artifact('first');
  const second = artifact('second');

  let resolveFirst!: (value: { artifact: Artifact; reveal: boolean }[]) => void;
  mocks.prepare.mockImplementationOnce(
    () =>
      new Promise(resolve => {
        resolveFirst = resolve;
      }),
  );
  mocks.prepare.mockResolvedValueOnce([{ artifact: second, reveal: true }]);

  await act(async () => {
    service.onDetected([{ artifact: first, needsFileLoad: true }]);
    service.onDetected([{ artifact: second, needsFileLoad: true }]);
  });
  // The newer batch stays queued behind the older batch's pending probe.
  expect(mocks.prepare).toHaveBeenCalledTimes(1);
  expect(mocks.dispatch).not.toHaveBeenCalled();

  await act(async () => {
    resolveFirst([{ artifact: first, reveal: false }]);
  });

  await waitFor(() => {
    expect(mocks.dispatch).toHaveBeenCalledTimes(2);
  });

  const dispatchedIds = mocks.dispatch.mock.calls.map(call => call[0].payload.artifact.id);
  expect(dispatchedIds).toEqual(['first', 'second']);
});

test('first-paint pass only adds inline artifacts and feeds the worker pass', () => {
  const messages = [message('m1'), message('m2')];
  mocks.detect.mockReturnValue([
    { artifact: artifact('inline'), needsFileLoad: false },
    { artifact: artifact('file', '/work/out.docx'), needsFileLoad: true },
  ]);

  renderDetection({ currentSession: session(messages) });

  expect(mocks.detect).toHaveBeenCalledWith(messages, 'session-1');
  expect(mocks.dispatch).toHaveBeenCalledTimes(1);
  expect(mocks.dispatch).toHaveBeenCalledWith(
    addArtifact({ sessionId: 'session-1', artifact: artifact('inline') }),
  );

  const service = mocks.FakeDetectionService.instances[0]!;
  expect(service.processed).toEqual([{ messages, sessionId: 'session-1' }]);
});

test('skips detection passes while the session is streaming', () => {
  renderDetection({ currentSession: session([message('m1')]), isStreaming: true });

  expect(mocks.detect).not.toHaveBeenCalled();
  expect(mocks.FakeDetectionService.instances[0]!.processed).toEqual([]);
});

test('terminates the detection service on session change and unmount', () => {
  const { rerender, unmount } = renderDetection({ currentSession: null });

  expect(mocks.FakeDetectionService.instances).toHaveLength(1);
  const first = mocks.FakeDetectionService.instances[0]!;

  act(() => {
    rerender({ sessionId: 'session-2', currentSession: null });
  });
  expect(first.terminated).toBe(1);
  expect(mocks.FakeDetectionService.instances).toHaveLength(2);

  unmount();
  expect(mocks.FakeDetectionService.instances[1]!.terminated).toBe(1);
});
