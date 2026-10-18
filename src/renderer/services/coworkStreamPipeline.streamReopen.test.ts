import { configureStore } from '@reduxjs/toolkit';
import { describe, expect, it } from 'vitest';

import {
  CoworkExecutionMode,
  CoworkSessionMode,
  CoworkSessionSource,
  CoworkSessionStatus,
} from '../../shared/cowork/constants';
import { PiUiEventSequencer, PiUiEventType, type PiUiEvent } from '../../shared/cowork/piUiEvent';
import coworkReducer, { addMessage, setCurrentSession } from '../store/slices/coworkSlice';
import type { CoworkMessage, CoworkSession } from '../types/cowork';
import { createCoworkStreamPipeline } from './coworkStreamPipeline';
import { LiveTextStore } from './liveTextStore';

class ManualFrameScheduler {
  private nextHandle = 1;
  private readonly pending = new Map<number, (time?: number) => void>();

  request = (callback: unknown): number => {
    const handle = this.nextHandle;
    this.nextHandle += 1;
    this.pending.set(handle, callback as (time?: number) => void);
    return handle;
  };

  cancel = (handle: number): void => {
    this.pending.delete(handle);
  };

  drain(): void {
    while (this.pending.size > 0) {
      const callbacks = [...this.pending.values()];
      this.pending.clear();
      for (const callback of callbacks) callback(0);
    }
  }
}

const sessionId = 'stream-reopen-session';
const messageId = 'assistant-retry-1';

type StreamReopenTestStore = ReturnType<
  typeof configureStore<{ cowork: ReturnType<typeof coworkReducer> }>
>;

function seedSession(store: StreamReopenTestStore): void {
  const session: CoworkSession = {
    id: sessionId,
    title: 'Stream reopen',
    status: CoworkSessionStatus.Running,
    pinned: false,
    cwd: '/tmp',
    systemPrompt: '',
    modelOverride: '',
    executionMode: CoworkExecutionMode.Auto,
    activeSkillIds: [],
    workspaceId: '',
    agentId: 'main',
    source: CoworkSessionSource.Manual,
    mode: CoworkSessionMode.Work,
    messages: [],
    messagesOffset: 0,
    totalMessages: 0,
    createdAt: 1,
    updatedAt: 1,
  };
  store.dispatch(setCurrentSession(session));
  store.dispatch(
    addMessage({
      sessionId,
      message: {
        id: messageId,
        type: 'assistant',
        content: '',
        timestamp: 1,
        metadata: { isStreaming: true, isFinal: false },
      },
    }),
  );
}

function assistantMessage(store: StreamReopenTestStore): CoworkMessage | undefined {
  const session = store.getState().cowork.currentSession;
  return session?.messages.find((message: CoworkMessage) => message.id === messageId);
}

describe('coworkStreamPipeline streamReopen', () => {
  it('keeps live text growing and streaming metadata during auto-retry reopen', () => {
    const store = configureStore({ reducer: { cowork: coworkReducer } });
    seedSession(store);
    const live = new LiveTextStore();
    const scheduler = new ManualFrameScheduler();
    const sequencer = new PiUiEventSequencer(() => crypto.randomUUID());
    const pipeline = createCoworkStreamPipeline({
      dispatch: action => store.dispatch(action as never),
      getCoworkState: () => store.getState().cowork,
      liveText: live,
      scheduler,
      shouldApply: () => true,
      onSequenceGap: () => {},
      onContentGap: () => {},
      onUnknownSession: () => {},
    });

    const push = (payload: Parameters<PiUiEventSequencer['next']>[0]): PiUiEvent => {
      const event = sequencer.next(payload);
      pipeline.handleUiEvent(event);
      scheduler.drain();
      pipeline.flush();
      return event;
    };

    push({
      type: PiUiEventType.MessageUpdate,
      sessionId,
      messageId,
      content: 'Part',
      metadata: { isStreaming: false, isFinal: true },
    });
    expect(assistantMessage(store)?.content).toBe('Part');
    expect(assistantMessage(store)?.metadata?.isStreaming).not.toBe(true);

    push({
      type: PiUiEventType.MessageUpdate,
      sessionId,
      messageId,
      content: 'Part',
      metadata: { isStreaming: true, isFinal: false, streamReopen: true },
    });
    expect(assistantMessage(store)?.metadata?.isStreaming).toBe(true);
    expect(assistantMessage(store)?.metadata?.isFinal).toBe(false);

    const lengths: number[] = [];
    push({
      type: PiUiEventType.StreamPart,
      sessionId,
      messageId,
      chunk: { type: 'text-start', id: 'part-1' },
    });
    push({
      type: PiUiEventType.StreamPart,
      sessionId,
      messageId,
      chunk: { type: 'text-delta', id: 'part-1', delta: 'Reco' },
    });
    lengths.push((live.getSnapshot(messageId) ?? '').length);
    push({
      type: PiUiEventType.StreamPart,
      sessionId,
      messageId,
      chunk: { type: 'text-delta', id: 'part-1', delta: 'vered' },
    });
    lengths.push((live.getSnapshot(messageId) ?? '').length);

    expect(lengths[0]).toBeGreaterThan(0);
    expect(lengths[1]).toBeGreaterThan(lengths[0]);
    expect(live.getSnapshot(messageId)).toBe('Recovered');
    expect(assistantMessage(store)?.metadata?.isStreaming).toBe(true);

    pipeline.dispose();
  });
});
