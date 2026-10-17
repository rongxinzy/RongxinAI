/**
 * Behavior tests for the Pi session event → UIMessageChunk translator.
 *
 * Source: vercel/ai @ai-sdk/harness-pi@1.0.156 — packages/harness-pi/src/pi-translate.test.ts (Apache-2.0).
 * Ported for Cowork with the following rewrites:
 * - `translatePiEvent` → `translatePiSessionEventToUiChunks`; output chunks are ai@6 `UIMessageChunk`s.
 * - Upstream harness `tool-call` parts → `tool-input-available`; `tool-result` parts → `tool-output-available`,
 *   or `tool-output-error` when the Pi event carries `isError: true`.
 * - Tool-input chunks key calls by `toolCallId` (not `id`); input deltas use `inputTextDelta` (not `delta`).
 * - No `tool-input-end` is expected at `toolcall_end`: the Cowork renderer does not consume the tool-input
 *   stream; `tool-input-available` carries the full input at `tool_execution_start`.
 * - finish-step / usage / takePiEarlyFinishStep / compaction cases are not ported (Cowork IPC omits those
 *   chunks; the session layer owns the lifecycle).
 * - Added: `closeOpenTextAndReasoningParts` (+ `setStreamedAssistantText` resync) cases, and a safeJsonParse
 *   prototype-pollution fallback case observed through the MCP result path.
 */
import { describe, expect, it } from 'vitest';
import type { UIMessageChunk } from 'ai';
import type { PiSessionEvent } from './piEvents';
import {
  closeOpenTextAndReasoningParts,
  createPiTranslatorState,
  setStreamedAssistantText,
  translatePiSessionEventToUiChunks,
  type PiTranslatorState,
} from './piTranslateUiMessageChunk';

function emit(events: PiSessionEvent[], state: PiTranslatorState): UIMessageChunk[] {
  return events.flatMap(event => translatePiSessionEventToUiChunks(event, state));
}

function textStartId(part: UIMessageChunk | undefined): string {
  if (part?.type !== 'text-start') {
    throw new Error(`expected text-start, got ${String(part?.type)}`);
  }
  return part.id;
}

function reasoningStartId(part: UIMessageChunk | undefined): string {
  if (part?.type !== 'reasoning-start') {
    throw new Error(`expected reasoning-start, got ${String(part?.type)}`);
  }
  return part.id;
}

function callIds(parts: UIMessageChunk[]): Array<[string, string | undefined]> {
  return parts.map(part => [
    part.type,
    'toolCallId' in part ? (part as { toolCallId: string }).toolCallId : undefined,
  ]);
}

describe('translatePiSessionEventToUiChunks (tool calls and results)', () => {
  it('buffers tool input of later calls until Pi starts them', () => {
    const state = createPiTranslatorState({ hostToolNames: ['deploy'] });
    const content = [
      { type: 'toolCall', id: 'call-1', name: 'deploy' },
      { type: 'toolCall', id: 'call-2', name: 'deploy' },
    ];
    const streamed = emit(
      [
        { type: 'turn_start' } as PiSessionEvent,
        {
          type: 'message_start',
          message: { role: 'assistant', content: [] },
        } as PiSessionEvent,
        ...[0, 1].flatMap(contentIndex => [
          {
            type: 'message_update',
            assistantMessageEvent: {
              type: 'toolcall_start',
              contentIndex,
              partial: { content },
            },
          } as PiSessionEvent,
          {
            type: 'message_update',
            assistantMessageEvent: {
              type: 'toolcall_end',
              contentIndex,
              partial: { content },
            },
          } as PiSessionEvent,
        ]),
        {
          type: 'message_end',
          message: { role: 'assistant', content },
        } as PiSessionEvent,
      ],
      state,
    );
    expect(callIds(streamed)).toEqual([['tool-input-start', 'call-1']]);

    const second = translatePiSessionEventToUiChunks(
      {
        type: 'tool_execution_start',
        toolCallId: 'call-2',
        toolName: 'deploy',
        args: { target: 'two' },
      } as PiSessionEvent,
      state,
    );
    expect(second.map(p => p.type)).toEqual(['tool-input-start', 'tool-input-available']);
    expect(second[1]).toEqual({
      type: 'tool-input-available',
      toolCallId: 'call-2',
      toolName: 'deploy',
      input: '{"target":"two"}',
    });
  });

  it('emits reasoning-start lazily on first thinking_delta', () => {
    const state = createPiTranslatorState();
    const out = emit(
      [
        { type: 'turn_start' } as PiSessionEvent,
        {
          type: 'message_update',
          assistantMessageEvent: {
            type: 'thinking_delta',
            delta: 'pondering...',
          },
        } as PiSessionEvent,
      ],
      state,
    );
    const id = reasoningStartId(out[0]);
    expect(out[1]).toMatchObject({
      type: 'reasoning-delta',
      id,
      delta: 'pondering...',
    });
  });

  it('emits reasoning-end on turn_end if reasoning was started', () => {
    const state = createPiTranslatorState();
    emit(
      [
        { type: 'turn_start' } as PiSessionEvent,
        {
          type: 'message_update',
          assistantMessageEvent: { type: 'thinking_delta', delta: 'think' },
        } as PiSessionEvent,
      ],
      state,
    );
    const closing = translatePiSessionEventToUiChunks(
      {
        type: 'turn_end',
        message: { role: 'assistant', content: '' },
      } as PiSessionEvent,
      state,
    );
    expect(closing.find(p => p.type === 'reasoning-end')).toBeDefined();
  });

  it('emits tool-input-available with providerExecuted=true for builtin tools', () => {
    const state = createPiTranslatorState({
      builtinToolNames: ['bash'],
    });
    emit([{ type: 'turn_start' } as PiSessionEvent], state);
    const out = translatePiSessionEventToUiChunks(
      {
        type: 'tool_execution_start',
        toolCallId: 'call_1',
        toolName: 'bash',
        args: { command: 'ls' },
      } as PiSessionEvent,
      state,
    );
    expect(out[0]).toEqual({
      type: 'tool-input-available',
      toolCallId: 'call_1',
      toolName: 'bash',
      input: '{"command":"ls"}',
      providerExecuted: true,
    });
  });

  it('uses the common name as wire toolName when nativeToCommon contains it', () => {
    const state = createPiTranslatorState({
      builtinToolNames: ['find'],
      nativeToCommon: { find: 'glob' },
    });
    emit([{ type: 'turn_start' } as PiSessionEvent], state);
    const out = translatePiSessionEventToUiChunks(
      {
        type: 'tool_execution_start',
        toolCallId: 'c2',
        toolName: 'find',
        args: { pattern: '*.ts' },
      } as PiSessionEvent,
      state,
    );
    expect(out[0]).toEqual({
      type: 'tool-input-available',
      toolCallId: 'c2',
      toolName: 'glob',
      input: '{"pattern":"*.ts"}',
      providerExecuted: true,
    });
  });

  it('leaves providerExecuted unset for user-registered tools', () => {
    const state = createPiTranslatorState({
      builtinToolNames: ['bash'],
      hostToolNames: ['deploy'],
    });
    emit([{ type: 'turn_start' } as PiSessionEvent], state);
    const out = translatePiSessionEventToUiChunks(
      {
        type: 'tool_execution_start',
        toolCallId: 'c3',
        toolName: 'deploy',
        args: { env: 'staging' },
      } as PiSessionEvent,
      state,
    );
    expect(out[0]).toEqual({
      type: 'tool-input-available',
      toolCallId: 'c3',
      toolName: 'deploy',
      input: '{"env":"staging"}',
    });
  });

  it('marks MCP-prefixed tool calls and results as dynamic and parses JSON results', () => {
    const state = createPiTranslatorState();
    emit([{ type: 'turn_start' } as PiSessionEvent], state);

    const call = translatePiSessionEventToUiChunks(
      {
        type: 'tool_execution_start',
        toolCallId: 'mcp-call',
        toolName: 'mcp__memory_search',
        args: { query: 'AI SDK' },
      } as PiSessionEvent,
      state,
    );
    const result = translatePiSessionEventToUiChunks(
      {
        type: 'tool_execution_end',
        toolCallId: 'mcp-call',
        result: {
          content: [
            {
              type: 'text',
              text: '{"matches":["AI SDK Core","AI SDK UI"]}',
            },
          ],
        },
      } as PiSessionEvent,
      state,
    );

    expect(call[0]).toEqual({
      type: 'tool-input-available',
      toolCallId: 'mcp-call',
      toolName: 'mcp__memory_search',
      input: '{"query":"AI SDK"}',
      providerExecuted: true,
      dynamic: true,
    });
    expect(result[0]).toEqual({
      type: 'tool-output-available',
      toolCallId: 'mcp-call',
      output: { matches: ['AI SDK Core', 'AI SDK UI'] },
      providerExecuted: true,
      dynamic: true,
    });
  });

  it('parses a JSON MCP result that carries native MCP details', () => {
    const state = createPiTranslatorState();
    emit(
      [
        { type: 'turn_start' } as PiSessionEvent,
        {
          type: 'tool_execution_start',
          toolCallId: 'mcp-call',
          toolName: 'mcp__brand_ai__brand_check',
          args: {},
        } as PiSessionEvent,
      ],
      state,
    );

    const chunks = translatePiSessionEventToUiChunks(
      {
        type: 'tool_execution_end',
        toolCallId: 'mcp-call',
        result: {
          content: [{ type: 'text', text: '{"ok":true,"issues":[]}' }],
          details: { server: 'brand_ai', tool: 'brand_check' },
        },
      } as PiSessionEvent,
      state,
    );

    expect(chunks[0]).toEqual({
      type: 'tool-output-available',
      toolCallId: 'mcp-call',
      output: { ok: true, issues: [] },
      providerExecuted: true,
      dynamic: true,
    });
  });

  it('keeps non-JSON MCP results and JSON native results as text', () => {
    const state = createPiTranslatorState({ builtinToolNames: ['read'] });
    emit(
      [
        { type: 'turn_start' } as PiSessionEvent,
        {
          type: 'tool_execution_start',
          toolCallId: 'mcp-call',
          toolName: 'mcp__memory_search',
          args: {},
        } as PiSessionEvent,
        {
          type: 'tool_execution_start',
          toolCallId: 'native-call',
          toolName: 'read',
          args: {},
        } as PiSessionEvent,
      ],
      state,
    );

    const mcpResult = translatePiSessionEventToUiChunks(
      {
        type: 'tool_execution_end',
        toolCallId: 'mcp-call',
        result: { content: [{ type: 'text', text: 'not JSON' }] },
      } as PiSessionEvent,
      state,
    );
    const nativeResult = translatePiSessionEventToUiChunks(
      {
        type: 'tool_execution_end',
        toolCallId: 'native-call',
        result: { content: [{ type: 'text', text: '{"path":"README.md"}' }] },
      } as PiSessionEvent,
      state,
    );

    expect(mcpResult[0]).toEqual({
      type: 'tool-output-available',
      toolCallId: 'mcp-call',
      output: 'not JSON',
      providerExecuted: true,
      dynamic: true,
    });
    expect(nativeResult[0]).toEqual({
      type: 'tool-output-available',
      toolCallId: 'native-call',
      output: '{"path":"README.md"}',
      providerExecuted: true,
    });
  });

  it('falls back to the raw text when an MCP result carries a __proto__ key', () => {
    const state = createPiTranslatorState();
    emit(
      [
        { type: 'turn_start' } as PiSessionEvent,
        {
          type: 'tool_execution_start',
          toolCallId: 'mcp-call',
          toolName: 'mcp__memory_search',
          args: {},
        } as PiSessionEvent,
      ],
      state,
    );

    const chunks = translatePiSessionEventToUiChunks(
      {
        type: 'tool_execution_end',
        toolCallId: 'mcp-call',
        result: { content: [{ type: 'text', text: '{"__proto__":{"x":1}}' }] },
      } as PiSessionEvent,
      state,
    );

    expect(chunks[0]).toEqual({
      type: 'tool-output-available',
      toolCallId: 'mcp-call',
      output: '{"__proto__":{"x":1}}',
      providerExecuted: true,
      dynamic: true,
    });
    // The rejected parse must not have polluted Object.prototype.
    expect(({} as { x?: unknown }).x).toBeUndefined();
  });

  it('keeps explicitly typed host tools static even with an MCP prefix', () => {
    const state = createPiTranslatorState({
      hostToolNames: ['mcp__custom_tool'],
    });
    emit([{ type: 'turn_start' } as PiSessionEvent], state);

    const out = translatePiSessionEventToUiChunks(
      {
        type: 'tool_execution_start',
        toolCallId: 'host-call',
        toolName: 'mcp__custom_tool',
        args: {},
      } as PiSessionEvent,
      state,
    );

    expect(out[0]).toEqual({
      type: 'tool-input-available',
      toolCallId: 'host-call',
      toolName: 'mcp__custom_tool',
      input: '{}',
    });
  });

  it('marks tools registered by an extension as dynamic and provider-executed', () => {
    const state = createPiTranslatorState({
      builtinToolNames: ['read'],
      hostToolNames: ['deploy'],
    });
    const out = emit(
      [
        { type: 'turn_start' } as PiSessionEvent,
        {
          type: 'message_update',
          assistantMessageEvent: {
            type: 'toolcall_start',
            contentIndex: 0,
            partial: {
              content: [{ type: 'toolCall', id: 'task-call', name: 'Task' }],
            },
          },
        } as PiSessionEvent,
        {
          type: 'tool_execution_start',
          toolCallId: 'task-call',
          toolName: 'Task',
          args: { prompt: 'Summarize the repo' },
        } as PiSessionEvent,
        {
          type: 'tool_execution_end',
          toolCallId: 'task-call',
          result: { content: [{ type: 'text', text: '{"not":"mcp"}' }] },
        } as PiSessionEvent,
      ],
      state,
    );

    expect(out).toEqual([
      {
        type: 'tool-input-start',
        toolCallId: 'task-call',
        toolName: 'Task',
        providerExecuted: true,
        dynamic: true,
      },
      {
        type: 'tool-input-available',
        toolCallId: 'task-call',
        toolName: 'Task',
        input: '{"prompt":"Summarize the repo"}',
        providerExecuted: true,
        dynamic: true,
      },
      {
        type: 'tool-output-available',
        toolCallId: 'task-call',
        output: '{"not":"mcp"}',
        providerExecuted: true,
        dynamic: true,
      },
    ]);
  });

  it('correlates the tool output with the prior call by id', () => {
    const state = createPiTranslatorState({
      builtinToolNames: ['bash'],
    });
    emit(
      [
        { type: 'turn_start' } as PiSessionEvent,
        {
          type: 'tool_execution_start',
          toolCallId: 'c4',
          toolName: 'bash',
          args: { command: 'echo' },
        } as PiSessionEvent,
      ],
      state,
    );
    const out = translatePiSessionEventToUiChunks(
      {
        type: 'tool_execution_end',
        toolCallId: 'c4',
        result: 'hello',
      } as PiSessionEvent,
      state,
    );
    expect(out[0]).toEqual({
      type: 'tool-output-available',
      toolCallId: 'c4',
      output: 'hello',
      providerExecuted: true,
    });
  });

  it('surfaces the original host-submitted output object instead of the echoed text', () => {
    const state = createPiTranslatorState({ hostToolNames: ['weather'] });
    emit(
      [
        { type: 'turn_start' } as PiSessionEvent,
        {
          type: 'tool_execution_start',
          toolCallId: 'c6',
          toolName: 'weather',
          args: { city: 'SF' },
        } as PiSessionEvent,
      ],
      state,
    );

    // The session records the exact value the host submitted; Pi echoes only
    // the serialized text back on the result event.
    const submitted = { state: 'ready', temperature: 72, weather: 'sunny' };
    state.hostToolResults.set('c6', submitted);

    const out = translatePiSessionEventToUiChunks(
      {
        type: 'tool_execution_end',
        toolCallId: 'c6',
        result: {
          content: [{ type: 'text', text: JSON.stringify(submitted) }],
        },
      } as PiSessionEvent,
      state,
    );

    expect(out[0]).toEqual({
      type: 'tool-output-available',
      toolCallId: 'c6',
      output: submitted,
    });
    // The stored value is consumed so it cannot leak into a later result.
    expect(state.hostToolResults.has('c6')).toBe(false);
  });

  it('marks a tool result as error when isError is true', () => {
    const state = createPiTranslatorState({ builtinToolNames: ['bash'] });
    emit(
      [
        { type: 'turn_start' } as PiSessionEvent,
        {
          type: 'tool_execution_start',
          toolCallId: 'c5',
          toolName: 'bash',
          args: {},
        } as PiSessionEvent,
      ],
      state,
    );
    const out = translatePiSessionEventToUiChunks(
      {
        type: 'tool_execution_end',
        toolCallId: 'c5',
        result: 'boom',
        isError: true,
      } as PiSessionEvent,
      state,
    );
    expect(out[0]).toEqual({
      type: 'tool-output-error',
      toolCallId: 'c5',
      errorText: 'boom',
      providerExecuted: true,
    });
  });

  it('drops unrecognised event types', () => {
    const state = createPiTranslatorState();
    emit([{ type: 'turn_start' } as PiSessionEvent], state);
    expect(
      translatePiSessionEventToUiChunks({ type: 'queue_update' } as PiSessionEvent, state),
    ).toEqual([]);
  });
});

describe('closeOpenTextAndReasoningParts', () => {
  it('ends an open text part and lets the next delta open a fresh part id', () => {
    const state = createPiTranslatorState();
    const streamed = emit(
      [
        { type: 'turn_start' } as PiSessionEvent,
        {
          type: 'message_update',
          assistantMessageEvent: { type: 'text_delta', delta: 'partial' },
        } as PiSessionEvent,
      ],
      state,
    );
    const textId = textStartId(streamed[0]);

    // Turn bridge scenario: a non-prefix snapshot must close the old part so
    // later deltas do not append to a part the renderer already replaced.
    expect(closeOpenTextAndReasoningParts(state)).toEqual([{ type: 'text-end', id: textId }]);
    expect(closeOpenTextAndReasoningParts(state)).toEqual([]);

    const resumed = emit(
      [
        {
          type: 'message_update',
          assistantMessageEvent: { type: 'text_delta', delta: ' more' },
        } as PiSessionEvent,
      ],
      state,
    );
    const resumedId = textStartId(resumed[0]);
    expect(resumedId).not.toBe(textId);
    expect(resumed[1]).toMatchObject({ type: 'text-delta', id: resumedId, delta: ' more' });
  });

  it('ends an open reasoning part', () => {
    const state = createPiTranslatorState();
    const streamed = emit(
      [
        { type: 'turn_start' } as PiSessionEvent,
        {
          type: 'message_update',
          assistantMessageEvent: { type: 'thinking_delta', delta: 'hmm' },
        } as PiSessionEvent,
      ],
      state,
    );
    const reasoningId = reasoningStartId(streamed[0]);
    expect(closeOpenTextAndReasoningParts(state)).toEqual([
      { type: 'reasoning-end', id: reasoningId },
    ]);
    expect(closeOpenTextAndReasoningParts(state)).toEqual([]);
  });

  it('setStreamedAssistantText aligns message_end gap-fill with a snapshot', () => {
    const state = createPiTranslatorState();
    emit(
      [
        { type: 'turn_start' } as PiSessionEvent,
        {
          type: 'message_update',
          assistantMessageEvent: { type: 'text_delta', delta: 'partial' },
        } as PiSessionEvent,
      ],
      state,
    );
    // Simulate the turn bridge replacing the text with a non-prefix snapshot.
    closeOpenTextAndReasoningParts(state);
    setStreamedAssistantText(state, 'partial (revised)');
    emit(
      [
        {
          type: 'message_update',
          assistantMessageEvent: { type: 'text_delta', delta: '!' },
        } as PiSessionEvent,
      ],
      state,
    );

    const closing = translatePiSessionEventToUiChunks(
      {
        type: 'turn_end',
        message: { role: 'assistant', content: 'partial (revised)! and done' },
      } as PiSessionEvent,
      state,
    );

    // Only the true suffix beyond the snapshot text is gap-filled.
    expect(closing[0]).toMatchObject({ type: 'text-delta', delta: ' and done' });
    expect(closing[1]?.type).toBe('text-end');
  });
});
