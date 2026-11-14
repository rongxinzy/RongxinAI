import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, expect, test } from 'vitest';
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from '@earendil-works/pi-ai/providers/faux';
import type { ConversationView } from '@earendil-works/pi-durable';
import { Type } from 'typebox';
import { DurableModelCatalog } from './durableModelCatalog.mjs';
import { DurableSession } from './durableSession.mjs';
import { DurableEventProjector } from './durableEventProjector.mjs';
import type { PiEvent } from './piRuntimeSessionState';
import { getDurableInvocation } from './durableInvocation.mjs';

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
const view = (live: unknown = {}, entries: unknown[] = []) =>
  ({
    entries,
    docs: { 'pi.live': live },
  }) as unknown as ConversationView;

test('real SQLite write/read emits one start/end per tool and never reopens a completed spinner', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'durable-tool-events-'));
  cleanup.push(() => rm(cwd, { recursive: true, force: true }));
  const faux = fauxProvider();
  const catalog = new DurableModelCatalog();
  catalog.models.setProvider(faux.provider);
  const session = await DurableSession.open({
    cwd,
    durableFile: path.join(cwd, 'native.sqlite'),
    model: faux.getModel() as unknown as Record<string, unknown>,
    modelRuntime: catalog,
  });
  cleanup.push(() => session.close());
  const events: PiEvent[] = [];
  session.subscribe(event => events.push(event));
  faux.setResponses([
    fauxAssistantMessage(
      fauxToolCall(
        'write',
        { path: 'evidence.txt', content: 'native evidence' },
        { id: 'write-evidence' },
      ),
      { stopReason: 'toolUse' },
    ),
    fauxAssistantMessage(fauxToolCall('read', { path: 'evidence.txt' }, { id: 'read-evidence' }), {
      stopReason: 'toolUse',
    }),
    fauxAssistantMessage('The evidence was written and read.'),
  ]);
  await session.prompt('Write and read the evidence.');
  expect(await readFile(path.join(cwd, 'evidence.txt'), 'utf8')).toBe('native evidence');
  for (const id of ['write-evidence', 'read-evidence']) {
    const starts = events.filter(
      event => event.type === 'tool_execution_start' && event.toolCallId === id,
    );
    const ends = events.filter(
      event => event.type === 'tool_execution_end' && event.toolCallId === id,
    );
    expect(starts, `${id} starts`).toHaveLength(1);
    expect(ends, `${id} ends`).toHaveLength(1);
    const end = events.findIndex(event => event === ends[0]);
    expect(
      events
        .slice(end + 1)
        .filter(
          event =>
            event.toolCallId === id &&
            ['tool_execution_start', 'tool_execution_update'].includes(event.type),
        ),
    ).toEqual([]);
  }
  expect(events.filter(event => event.type === 'agent_settled')).toHaveLength(1);
});

test('retry starts once per native run/attempt despite unrelated repeated view updates', () => {
  const events: PiEvent[] = [];
  const projector = new DurableEventProjector(event => events.push(event));
  projector.seed(view());
  const retry = (taskId: number, attempt: number) =>
    view({
      run: { taskId },
      generation: { attempt, retry: { at: 100, error: 'retryable failure' } },
    });
  for (let index = 0; index < 20; index++) projector.advance(retry(1, 1), []);
  expect(events.filter(event => event.type === 'auto_retry_start')).toHaveLength(1);
  projector.advance(view({ run: { taskId: 1 }, generation: { attempt: 1 } }), []);
  projector.advance(retry(1, 1), []);
  expect(events.filter(event => event.type === 'auto_retry_start')).toHaveLength(1);
  projector.advance(retry(1, 2), []);
  projector.advance(retry(2, 1), []);
  expect(
    events.filter(event => event.type === 'auto_retry_start').map(event => event.attempt),
  ).toEqual([1, 2, 1]);
});

test('native nested read has one terminal event even though its result is outside the model journal', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'durable-nested-events-'));
  cleanup.push(() => rm(cwd, { recursive: true, force: true }));
  await writeFile(path.join(cwd, 'nested.txt'), 'nested native evidence');
  const faux = fauxProvider();
  const catalog = new DurableModelCatalog();
  catalog.models.setProvider(faux.provider);
  const session = await DurableSession.open({
    cwd,
    durableFile: path.join(cwd, 'native.sqlite'),
    model: faux.getModel() as unknown as Record<string, unknown>,
    modelRuntime: catalog,
    customTools: [
      {
        name: 'nested_reader',
        label: 'Nested reader',
        description: 'Read through a native owned tool.',
        parameters: Type.Object({}),
        execute: async () => {
          const { api, context } = getDurableInvocation();
          const result = await api.executeTool('read', { path: 'nested.txt' }, context, {
            key: 'inner-read',
          });
          expect(result.isError).toBe(false);
          return {
            content: [{ type: 'text', text: JSON.stringify(result.structuredOutput) }],
            details: { source: 'native-result', nestedRead: true },
          };
        },
      },
    ],
  });
  cleanup.push(() => session.close());
  const events: PiEvent[] = [];
  session.subscribe(event => events.push(event));
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall('nested_reader', {}, { id: 'parent-read' }), {
      stopReason: 'toolUse',
    }),
    fauxAssistantMessage('Nested read completed.'),
  ]);
  await session.prompt('Read the native evidence through the nested tool.');
  const starts = events.filter(
    event => event.type === 'tool_execution_start' && event.toolName === 'read',
  );
  const ends = events.filter(
    event => event.type === 'tool_execution_end' && event.toolName === 'read',
  );
  expect(starts).toHaveLength(1);
  expect(ends).toHaveLength(1);
  expect(starts[0].toolCallId).toBe('parent-read/inner-read');
  expect(ends[0].isError).toBe(false);
  expect(
    events.find(event => event.type === 'tool_execution_end' && event.toolName === 'nested_reader'),
  ).toMatchObject({ result: { details: { source: 'native-result', nestedRead: true } } });
  const terminal = events.indexOf(ends[0]);
  expect(
    events
      .slice(terminal + 1)
      .some(event => event.type === 'tool_execution_start' && event.toolName === 'read'),
  ).toBe(false);
});

test('compaction tracking retains only currently live task identities', () => {
  const events: PiEvent[] = [];
  const projector = new DurableEventProjector(event => events.push(event));
  const tracking = projector as unknown as { compactions: Set<number> };
  projector.seed(view());
  for (let taskId = 1; taskId <= 100; taskId++) {
    const active = view({
      compactions: [{ taskId, trigger: 'threshold', blocking: true, attempt: 1 }],
    });
    projector.advance(active, []);
    projector.advance(active, []);
    expect(tracking.compactions.size).toBe(1);
    projector.advance(view(), []);
    expect(tracking.compactions.size).toBe(0);
  }
  expect(events.filter(event => event.type === 'compaction_start')).toHaveLength(100);
});

test('fork/reopen seed clears tools, compactions, retry identity and the prior assistant arguments', () => {
  const events: PiEvent[] = [];
  const projector = new DurableEventProjector(event => events.push(event));
  projector.seed(view());
  const state = {
    run: { taskId: 1 },
    generation: {
      attempt: 1,
      retry: { at: 100, error: 'backoff' },
      message: fauxAssistantMessage(
        fauxToolCall('read', { path: 'old-branch-secret' }, { id: 'shared-call' }),
      ),
    },
    tools: [{ callId: 'shared-call', name: 'read', taskId: 2, status: 'running' }],
    compactions: [{ taskId: 3, trigger: 'manual', blocking: true, attempt: 1 }],
  };
  projector.advance(view(state), []);
  projector.seed(view());
  const { message: _message, ...generation } = state.generation;
  projector.advance(view({ ...state, generation }), []);
  const starts = events.filter(event => event.type === 'tool_execution_start');
  expect(starts).toHaveLength(2);
  expect(starts[0].args).toEqual({ path: 'old-branch-secret' });
  expect(starts[1].args).toEqual({});
  expect(events.filter(event => event.type === 'compaction_start')).toHaveLength(2);
  expect(events.filter(event => event.type === 'auto_retry_start')).toHaveLength(2);
});
