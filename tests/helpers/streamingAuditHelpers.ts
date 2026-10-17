import { expect } from 'vitest';
import { adapter } from '../../src/main/libs/agentEngine/piRuntimeAdapter.testHarness';
import type { CoworkStore } from '../../src/main/coworkStore';
import { createHarnessCoworkStore, ensureHarnessCoworkSession } from './harnessCoworkStore';
import {
  createStreamingHarness,
  PiTurnBuilder,
  mulberry32,
  splitIntoDeltas,
  type StreamingHarness,
} from './streamingPipelineHarness';

export async function createAuditHarness(
  sessionId: string,
  mode: 'work' | 'chat' = 'work',
): Promise<{ harness: StreamingHarness; store: CoworkStore; cleanup: () => void }> {
  const handle = createHarnessCoworkStore();
  ensureHarnessCoworkSession(handle.store, sessionId, mode);
  adapter.setCoworkStore(handle.store);
  const harness = await createStreamingHarness({ sessionId });
  return { harness, store: handle.store, cleanup: handle.cleanup };
}

export function assistantRows(harness: StreamingHarness) {
  return harness
    .currentMessages()
    .filter(message => message.type === 'assistant')
    .map(message => ({
      id: message.id,
      thinking: Boolean(message.metadata?.isThinking),
      streaming: Boolean(message.metadata?.isStreaming),
      shown: harness.displayed(message.id) ?? '',
    }));
}

export function dbAssistants(store: CoworkStore, sessionId: string) {
  return (store.getSession(sessionId, null, { includeArtifacts: false })?.messages ?? [])
    .filter(message => message.type === 'assistant')
    .map(message => ({
      content: message.content,
      thinking: Boolean(message.metadata?.isThinking),
      streaming: Boolean(message.metadata?.isStreaming),
    }));
}

export function assertNothingStreaming(
  harness: StreamingHarness,
  store: CoworkStore,
  sessionId: string,
): void {
  expect(assistantRows(harness).every(row => !row.streaming)).toBe(true);
  expect(dbAssistants(store, sessionId).every(row => !row.streaming)).toBe(true);
}

export function streamText(
  harness: StreamingHarness,
  builder: PiTurnBuilder,
  contentIndex: number,
  text: string,
  seed = 1,
  msPerToken = 1,
): void {
  const deltas = splitIntoDeltas(text, 2, 6, mulberry32(seed));
  harness.emitPi(builder.beginTextPart(contentIndex));
  for (const delta of deltas) {
    harness.emitPi(builder.appendText(contentIndex, delta));
    harness.tick(msPerToken);
    harness.runFrames();
  }
}

export function emitAssistantError(
  harness: StreamingHarness,
  builder: PiTurnBuilder,
  errorMessage: string,
): void {
  const end = builder.messageEnd('error') as Record<string, unknown>;
  (end.message as Record<string, unknown>).errorMessage = errorMessage;
  harness.emitPi(end);
  harness.emitPi(builder.turnEnd());
}
