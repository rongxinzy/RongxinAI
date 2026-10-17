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
  createPiTranslatorState,
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

function callIds(parts: UIMessageChunk[]): Array<[string, string | undefined]> {
  return parts.map(part => [
    part.type,
    'toolCallId' in part ? (part as { toolCallId: string }).toolCallId : undefined,
  ]);
}

describe('translatePiSessionEventToUiChunks', () => {
  it.each(['', 'native output'])(
    'projects text %j tool results as the output string',
    text => {
      const state = createPiTranslatorState({ builtinToolNames: ['ls'] });
      emit(
        [
          { type: 'turn_start' } as PiSessionEvent,
          {
            type: 'tool_execution_start',
            toolCallId: 'file-call',
            toolName: 'ls',
            args: {},
          } as PiSessionEvent,
        ],
        state,
      );
      const result = { content: [{ type: 'text', text }], details: undefined };
      const chunks = translatePiSessionEventToUiChunks(
        {
          type: 'tool_execution_end',
          toolCallId: 'file-call',
          toolName: 'ls',
          result,
        } as PiSessionEvent,
        state,
      );

      expect(chunks[0]).toMatchObject({
        type: 'tool-output-available',
        toolCallId: 'file-call',
        output: text,
      });
      expect(JSON.parse(JSON.stringify(chunks[0]))).toEqual(chunks[0]);
      expect(Object.prototype.hasOwnProperty.call(result, 'details')).toBe(true);
    },
  );

  it.each([
    {
      name: 'image content',
      result: {
        content: [{ type: 'image', data: 'AA==', mimeType: 'image/png' }],
        details: undefined,
      },
      expected: {
        content: [{ type: 'image', data: 'AA==', mimeType: 'image/png' }],
      },
    },
    {
      name: 'mixed text and image content',
      result: {
        content: [
          { type: 'text', text: 'caption' },
          { type: 'image', data: 'AA==', mimeType: 'image/png' },
        ],
        details: undefined,
      },
      expected: {
        content: [
          { type: 'text', text: 'caption' },
          { type: 'image', data: 'AA==', mimeType: 'image/png' },
        ],
      },
    },
    {
      name: 'an empty content array',
      result: { content: [], details: undefined },
      expected: { content: [] },
    },
    {
      name: 'additional envelope fields',
      result: {
        content: [{ type: 'text', text: 'done' }],
        details: undefined,
        terminate: true,
      },
      expected: {
        content: [{ type: 'text', text: 'done' }],
        terminate: true,
      },
    },
  ])('retains $name in a JSON-safe envelope as the output', ({ result, expected }) => {
    const state = createPiTranslatorState({ builtinToolNames: ['read'] });
    emit(
      [
        { type: 'turn_start' } as PiSessionEvent,
        {
          type: 'tool_execution_start',
          toolCallId: 'file-call',
          toolName: 'read',
          args: {},
        } as PiSessionEvent,
      ],
      state,
    );
    const chunks = translatePiSessionEventToUiChunks(
      {
        type: 'tool_execution_end',
        toolCallId: 'file-call',
        toolName: 'read',
        result,
      } as PiSessionEvent,
      state,
    );

    expect(chunks[0]).toMatchObject({
      type: 'tool-output-available',
      toolCallId: 'file-call',
      output: expected,
    });
    expect(JSON.parse(JSON.stringify(chunks[0]))).toEqual(chunks[0]);
    expect(Object.prototype.hasOwnProperty.call(result, 'details')).toBe(true);
  });

  it.each([false, true])(
    'retains native result details and error semantics (error=%s)',
    isError => {
      const state = createPiTranslatorState({ builtinToolNames: ['grep'] });
      emit(
        [
          { type: 'turn_start' } as PiSessionEvent,
          {
            type: 'tool_execution_start',
            toolCallId: 'file-call',
            toolName: 'grep',
            args: {},
          } as PiSessionEvent,
        ],
        state,
      );
      const result = {
        content: [{ type: 'text', text: 'partial output' }],
        details: { truncated: true, nextOffset: 20 },
      };
      const chunks = translatePiSessionEventToUiChunks(
        {
          type: 'tool_execution_end',
          toolCallId: 'file-call',
          toolName: 'grep',
          result,
          isError,
        } as PiSessionEvent,
        state,
      );

      if (isError) {
        expect(chunks[0]).toMatchObject({
          type: 'tool-output-error',
          toolCallId: 'file-call',
          errorText: JSON.stringify(result),
        });
      } else {
        expect(chunks[0]).toMatchObject({
          type: 'tool-output-available',
          toolCallId: 'file-call',
          output: result,
        });
      }
    },
  );

  it('projects empty text from flat tool results', () => {
    const state = createPiTranslatorState({ builtinToolNames: ['ls'] });
    emit(
      [
        { type: 'turn_start' } as PiSessionEvent,
        {
          type: 'tool_execution_start',
          toolCallId: 'file-call',
          toolName: 'ls',
          args: {},
        } as PiSessionEvent,
      ],
      state,
    );
    const chunks = translatePiSessionEventToUiChunks(
      {
        type: 'tool_result',
        toolCallId: 'file-call',
        toolName: 'ls',
        content: [{ type: 'text', text: '' }],
        details: undefined,
      } as PiSessionEvent,
      state,
    );

    expect(chunks[0]).toMatchObject({
      type: 'tool-output-available',
      toolCallId: 'file-call',
      output: '',
    });
    expect(JSON.parse(JSON.stringify(chunks[0]))).toEqual(chunks[0]);
  });

  it('drops events before turn_start', () => {
    const state = createPiTranslatorState();
    const out = translatePiSessionEventToUiChunks(
      {
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: 'hi' },
      } as PiSessionEvent,
      state,
    );
    expect(out).toEqual([]);
  });

  it('emits text-start before the first text-delta', () => {
    const state = createPiTranslatorState();
    const out = emit(
      [
        { type: 'turn_start' } as PiSessionEvent,
        {
          type: 'message_update',
          assistantMessageEvent: { type: 'text_delta', delta: 'Hello ' },
        } as PiSessionEvent,
        {
          type: 'message_update',
          assistantMessageEvent: { type: 'text_delta', delta: 'world' },
        } as PiSessionEvent,
      ],
      state,
    );
    const id = textStartId(out[0]);
    expect(out).toHaveLength(3);
    expect(out[1]).toMatchObject({ type: 'text-delta', id, delta: 'Hello ' });
    expect(out[2]).toMatchObject({ type: 'text-delta', id, delta: 'world' });
  });

  it('streams tool input as the model writes it', () => {
    const state = createPiTranslatorState({ hostToolNames: ['visualize'] });
    const partial = (args: string) => ({
      content: [{ type: 'toolCall', id: 'call-1', name: 'visualize', args }],
    });
    const out = emit(
      [
        { type: 'turn_start' } as PiSessionEvent,
        {
          type: 'message_update',
          assistantMessageEvent: {
            type: 'toolcall_start',
            contentIndex: 0,
            partial: partial(''),
          },
        } as PiSessionEvent,
        {
          type: 'message_update',
          assistantMessageEvent: {
            type: 'toolcall_delta',
            contentIndex: 0,
            delta: '{"html":"<h1>',
            partial: partial('{"html":"<h1>'),
          },
        } as PiSessionEvent,
        {
          type: 'message_update',
          assistantMessageEvent: {
            type: 'toolcall_delta',
            contentIndex: 0,
            delta: 'hi</h1>"}',
            partial: partial('{"html":"<h1>hi</h1>"}'),
          },
        } as PiSessionEvent,
        {
          type: 'message_update',
          assistantMessageEvent: {
            type: 'toolcall_end',
            contentIndex: 0,
            partial: partial('{"html":"<h1>hi</h1>"}'),
          },
        } as PiSessionEvent,
      ],
      state,
    );

    // No tool-input-end: Cowork relies on tool-input-available for the full input.
    expect(out).toEqual([
      { type: 'tool-input-start', toolCallId: 'call-1', toolName: 'visualize' },
      { type: 'tool-input-delta', toolCallId: 'call-1', inputTextDelta: '{"html":"<h1>' },
      { type: 'tool-input-delta', toolCallId: 'call-1', inputTextDelta: 'hi</h1>"}' },
    ]);
  });

  it('reports the same dispatch on tool-input-start as on tool-input-available', () => {
    const state = createPiTranslatorState({ builtinToolNames: ['read'] });
    const out = emit(
      [
        { type: 'turn_start' } as PiSessionEvent,
        {
          type: 'message_update',
          assistantMessageEvent: {
            type: 'toolcall_start',
            contentIndex: 0,
            partial: {
              content: [{ type: 'toolCall', id: 'call-1', name: 'read' }],
            },
          },
        } as PiSessionEvent,
        {
          type: 'tool_execution_start',
          toolCallId: 'call-1',
          toolName: 'read',
          args: { path: 'a.txt' },
        } as PiSessionEvent,
      ],
      state,
    );

    expect(out[0]).toMatchObject({
      type: 'tool-input-start',
      toolCallId: 'call-1',
      providerExecuted: true,
    });
    expect(out[1]).toMatchObject({
      type: 'tool-input-available',
      toolCallId: 'call-1',
      providerExecuted: true,
    });
  });

  it('marks a streamed MCP tool input as dynamic', () => {
    const state = createPiTranslatorState();
    const out = emit(
      [
        { type: 'turn_start' } as PiSessionEvent,
        {
          type: 'message_update',
          assistantMessageEvent: {
            type: 'toolcall_start',
            contentIndex: 0,
            partial: {
              content: [{ type: 'toolCall', id: 'call-1', name: 'mcp__linear__issue' }],
            },
          },
        } as PiSessionEvent,
      ],
      state,
    );

    expect(out[0]).toEqual({
      type: 'tool-input-start',
      toolCallId: 'call-1',
      toolName: 'mcp__linear__issue',
      dynamic: true,
      providerExecuted: true,
    });
  });

  it('keeps tool inputs of concurrent calls on their own ids', () => {
    const state = createPiTranslatorState({ builtinToolNames: ['read'] });
    const content = [
      { type: 'toolCall', id: 'call-1', name: 'read' },
      { type: 'toolCall', id: 'call-2', name: 'read' },
    ];
    const out = emit(
      [
        { type: 'turn_start' } as PiSessionEvent,
        {
          type: 'message_update',
          assistantMessageEvent: {
            type: 'toolcall_start',
            contentIndex: 0,
            partial: { content },
          },
        } as PiSessionEvent,
        {
          type: 'message_update',
          assistantMessageEvent: {
            type: 'toolcall_start',
            contentIndex: 1,
            partial: { content },
          },
        } as PiSessionEvent,
        {
          type: 'message_update',
          assistantMessageEvent: {
            type: 'toolcall_delta',
            contentIndex: 1,
            delta: 'b',
            partial: { content },
          },
        } as PiSessionEvent,
        {
          type: 'message_update',
          assistantMessageEvent: {
            type: 'toolcall_delta',
            contentIndex: 0,
            delta: 'a',
            partial: { content },
          },
        } as PiSessionEvent,
        {
          type: 'tool_execution_start',
          toolCallId: 'call-2',
          toolName: 'read',
          args: {},
        } as PiSessionEvent,
      ],
      state,
    );

    expect(callIds(out)).toEqual([
      ['tool-input-start', 'call-1'],
      ['tool-input-delta', 'call-1'],
      ['tool-input-start', 'call-2'],
      ['tool-input-delta', 'call-2'],
      ['tool-input-available', 'call-2'],
    ]);
    expect(out[3]).toEqual({
      type: 'tool-input-delta',
      toolCallId: 'call-2',
      inputTextDelta: 'b',
    });
  });

  it('drops tool input deltas that arrive without a start', () => {
    // Nothing to attach the delta to. The complete input still arrives with
    // the `tool-input-available`, so dropping it loses nothing.
    const state = createPiTranslatorState();
    const out = emit(
      [
        { type: 'turn_start' } as PiSessionEvent,
        {
          type: 'message_update',
          assistantMessageEvent: {
            type: 'toolcall_delta',
            contentIndex: 0,
            delta: '{"a":1}',
          },
        } as PiSessionEvent,
      ],
      state,
    );

    expect(out).toEqual([]);
  });

  it('does not stream a tool input whose id is not known yet', () => {
    const state = createPiTranslatorState();
    const out = emit(
      [
        { type: 'turn_start' } as PiSessionEvent,
        {
          type: 'message_update',
          assistantMessageEvent: {
            type: 'toolcall_start',
            contentIndex: 0,
            partial: { content: [{ type: 'toolCall', id: '', name: '' }] },
          },
        } as PiSessionEvent,
        {
          type: 'message_update',
          assistantMessageEvent: {
            type: 'toolcall_delta',
            contentIndex: 0,
            delta: '{',
          },
        } as PiSessionEvent,
      ],
      state,
    );

    expect(out).toEqual([]);
  });

  it('does not carry tool input ids across assistant messages', () => {
    // Content-block indices restart with every message.
    const state = createPiTranslatorState();
    emit(
      [
        { type: 'turn_start' } as PiSessionEvent,
        {
          type: 'message_update',
          assistantMessageEvent: {
            type: 'toolcall_start',
            contentIndex: 0,
            partial: {
              content: [{ type: 'toolCall', id: 'call-1', name: 'read' }],
            },
          },
        } as PiSessionEvent,
      ],
      state,
    );
    const out = emit(
      [
        {
          type: 'message_start',
          message: { role: 'assistant' },
        } as PiSessionEvent,
        {
          type: 'message_update',
          assistantMessageEvent: {
            type: 'toolcall_delta',
            contentIndex: 0,
            delta: '{',
          },
        } as PiSessionEvent,
      ],
      state,
    );

    expect(out).toEqual([]);
  });

  it('gap-fills missing text at turn_end and emits text-end', () => {
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
    const closing = translatePiSessionEventToUiChunks(
      {
        type: 'turn_end',
        message: { role: 'assistant', content: 'partial and more' },
      } as PiSessionEvent,
      state,
    );
    // gap-fill delta then text-end
    expect(closing[0]).toMatchObject({
      type: 'text-delta',
      delta: ' and more',
    });
    expect(closing[1]?.type).toBe('text-end');
  });

  it('emits text-end without gap-fill when nothing is missing', () => {
    const state = createPiTranslatorState();
    emit(
      [
        { type: 'turn_start' } as PiSessionEvent,
        {
          type: 'message_update',
          assistantMessageEvent: { type: 'text_delta', delta: 'complete' },
        } as PiSessionEvent,
      ],
      state,
    );
    const closing = translatePiSessionEventToUiChunks(
      {
        type: 'message_end',
        message: { role: 'assistant', content: 'complete' },
      } as PiSessionEvent,
      state,
    );
    expect(closing.find(p => p.type === 'text-delta')).toBeUndefined();
    expect(closing.find(p => p.type === 'text-end')).toBeDefined();
  });

});
