/**
 * Records forwarder UiEvent IPC output from GLM Pi replay fixtures (or scripted
 * Pi events) through the production streaming harness.
 */
import '../../src/main/libs/agentEngine/piRuntimeAdapter.testHarness';
import { setupPiRuntimeAdapterSuite } from '../../src/main/libs/agentEngine/piRuntimeAdapter.testHarness';
import {
  buildCorpus,
  buildTextTurn,
  createStreamingHarness,
  mulberry32,
  type PiStreamEvent,
  type PiUiEvent,
  type StreamingHarness,
} from './streamingPipelineHarness';
import { expectedFinalAssistantText, loadGlmReplayTimedLines } from './loadGlmReplayFixture';

export interface RecordedStreamReplayTrace {
  readonly sessionId: string;
  readonly fixture: string;
  readonly expectedFinalText: string;
  readonly events: readonly RecordedStreamReplayEvent[];
  readonly markers: StreamReplayMarkers;
}

export interface RecordedStreamReplayEvent {
  readonly delayMs: number;
  readonly event: PiUiEvent;
}

export interface StreamReplayMarkers {
  readonly thinkingBeforeAnswer: boolean;
  readonly toolBeforeAnswer: boolean;
  readonly toolNames: readonly string[];
}

const compressTraceDeltaMs = (rawMs: number): number => {
  if (rawMs <= 0) return 1;
  const scaled = Math.round(rawMs / 8);
  return Math.min(32, Math.max(1, scaled));
};

function spreadIpcDelays(
  ipcEvents: readonly PiUiEvent[],
  piTraceDeltaMs: readonly number[],
): RecordedStreamReplayEvent[] {
  return ipcEvents.map((event, index) => ({
    delayMs: compressTraceDeltaMs(piTraceDeltaMs[index] ?? 2),
    event,
  }));
}

async function recordPiEvents(
  sessionId: string,
  fixtureLabel: string,
  piEvents: readonly unknown[],
  piTraceDeltaMs: readonly number[],
  expectedFinalText: string,
): Promise<RecordedStreamReplayTrace> {
  const harness = await createStreamingHarness({ sessionId });
  try {
    const ipcTraceDeltaMs: number[] = [];
    let ipcCursor = 0;
    for (let index = 0; index < piEvents.length; index += 1) {
      harness.emitPi(piEvents[index]);
      harness.tick(16);
      const delta = compressTraceDeltaMs(piTraceDeltaMs[index] ?? 2);
      const newEvents = harness.ipcEvents.length - ipcCursor;
      ipcCursor = harness.ipcEvents.length;
      if (newEvents <= 0) continue;
      const share = Math.max(1, Math.floor(delta / newEvents));
      let remainder = delta - share * newEvents;
      for (let slot = 0; slot < newEvents; slot += 1) {
        const extra = remainder > 0 ? 1 : 0;
        if (remainder > 0) remainder -= 1;
        ipcTraceDeltaMs.push(share + extra);
      }
    }
    harness.settle();
    while (ipcCursor < harness.ipcEvents.length) {
      ipcTraceDeltaMs.push(2);
      ipcCursor += 1;
    }
    const markers = collectMarkers(harness);
    const ipcEvents = harness.sessionIpcEvents();
    const delays = spreadIpcDelays(ipcEvents, ipcTraceDeltaMs);
    return {
      sessionId,
      fixture: fixtureLabel,
      expectedFinalText: expectedFinalText || inferAnswerFromHarness(harness),
      events: delays,
      markers,
    };
  } finally {
    harness.dispose();
  }
}

function inferAnswerFromHarness(harness: StreamingHarness): string {
  for (const messageId of [...harness.answerMessageIds()].reverse()) {
    const text = harness.displayed(messageId);
    if (text && text.trim().length > 0) return text;
  }
  return '';
}

function collectMarkers(harness: StreamingHarness): StreamReplayMarkers {
  const messages = harness.currentMessages();
  let sawThinking = false;
  let sawTool = false;
  let sawAnswer = false;
  let thinkingBeforeAnswer = false;
  let toolBeforeAnswer = false;
  const toolNames: string[] = [];
  for (const message of messages) {
    if (message.metadata?.isThinking) {
      sawThinking = true;
      if (!sawAnswer) thinkingBeforeAnswer = true;
      continue;
    }
    if (message.type === 'tool_use') {
      sawTool = true;
      const name =
        typeof message.metadata?.toolName === 'string' ? message.metadata.toolName.trim() : '';
      if (name) toolNames.push(name);
      if (!sawAnswer) toolBeforeAnswer = true;
      continue;
    }
    if (message.type === 'assistant' && !message.metadata?.isThinking) {
      if (message.content.trim().length > 0) sawAnswer = true;
    }
  }
  return {
    thinkingBeforeAnswer: sawThinking && thinkingBeforeAnswer,
    toolBeforeAnswer: sawTool && toolBeforeAnswer,
    toolNames,
  };
}

export async function recordGlmFixtureIpcTrace(
  fixtureRelativePath: string,
  sessionId: string,
): Promise<RecordedStreamReplayTrace> {
  const lines = loadGlmReplayTimedLines(fixtureRelativePath);
  const piEvents = lines.map(line => line.e);
  const traceDeltas = lines.map((line, index) => (index === 0 ? 0 : line.t - lines[index - 1]!.t));
  const expectedFinal = expectedFinalAssistantText(lines.map(line => line.e));
  return recordPiEvents(sessionId, fixtureRelativePath, piEvents, traceDeltas, expectedFinal);
}

export async function recordScriptedPiIpcTrace(
  fixtureLabel: string,
  sessionId: string,
  piEvents: readonly PiStreamEvent[],
  expectedFinalText: string,
): Promise<RecordedStreamReplayTrace> {
  return recordPiEvents(
    sessionId,
    fixtureLabel,
    piEvents,
    piEvents.map(() => 24),
    expectedFinalText,
  );
}

export async function recordSyntheticTextIpcTrace(
  sessionId: string,
  lengthInCodePoints: number,
  seed: number,
): Promise<RecordedStreamReplayTrace> {
  const random = mulberry32(seed);
  const turn = buildTextTurn({
    text: buildCorpus(lengthInCodePoints, random),
    random,
    minDelta: 8,
    maxDelta: 24,
    emitStartEnd: true,
  });
  return recordScriptedPiIpcTrace(
    `synthetic-${lengthInCodePoints}`,
    sessionId,
    turn.events,
    turn.finalText,
  );
}

/** Vitest suite hook — call once from codegen tests. */
export function installStreamReplayRecordingSuite(): void {
  setupPiRuntimeAdapterSuite();
}

export const scripted503RetryPiEvents: PiStreamEvent[] = [
  { type: 'turn_start' },
  {
    type: 'message_update',
    message: { role: 'assistant', content: [{ type: 'text', text: 'Part' }] },
    assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'Part' },
  },
  {
    type: 'message_end',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: 'Part' }],
      stopReason: 'error',
      errorMessage: '503 Service Unavailable',
    },
  },
  { type: 'agent_end' },
  { type: 'auto_retry_start', attempt: 1 },
  { type: 'turn_start' },
  {
    type: 'message_update',
    message: { role: 'assistant', content: [{ type: 'text', text: 'Rec' }] },
    assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'Reco' },
  },
  {
    type: 'message_update',
    message: { role: 'assistant', content: [{ type: 'text', text: 'Recovered' }] },
    assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'vered' },
  },
  {
    type: 'message_end',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: 'Recovered' }],
      stopReason: 'stop',
    },
  },
  { type: 'agent_end' },
  { type: 'auto_retry_end', success: true, attempt: 1 },
  { type: 'agent_settled' },
];
