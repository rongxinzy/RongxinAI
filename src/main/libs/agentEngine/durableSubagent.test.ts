import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, expect, test } from 'vitest';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type FauxResponseFactory,
} from '@earendil-works/pi-ai/providers/faux';
import { getCurrentTools } from '@earendil-works/pi-ai/utils/transcript';
import { DurableModelCatalog } from './durableModelCatalog.mjs';
import { DurableSession } from './durableSession.mjs';
import { buildPiSubagentTool, SUBAGENT_PARALLEL_LIMIT } from './piSubagentTool';
import type { ToolDefinition } from './durableToolTypes';
import type { PiSubagentChildToolEvent } from './piSubagentConstants';

const context = BACKGROUND_CONTEXT;
const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

async function fixture(args: Record<string, unknown>, child: FauxResponseFactory) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'durable-children-'));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const faux = fauxProvider();
  const catalog = new DurableModelCatalog();
  catalog.models.setProvider(faux.provider);
  const response: FauxResponseFactory = async (request, options, state, model) => {
    const user = request.messages.findLast(message => message.role === 'user');
    if (JSON.stringify(user?.content).includes('parent secret')) {
      return request.messages.some(message => message.role === 'toolResult')
        ? fauxAssistantMessage('Parent finished.')
        : fauxAssistantMessage(fauxToolCall('subagent', args, { id: 'delegate' }), {
            stopReason: 'toolUse',
          });
    }
    return child(request, options, state, model);
  };
  faux.setResponses(Array.from({ length: 100 }, () => response));
  const activity: PiSubagentChildToolEvent[] = [];
  const options = {
    cwd: root,
    durableFile: path.join(root, 'session.sqlite'),
    model: faux.getModel() as unknown as Record<string, unknown>,
    modelRuntime: catalog,
    customTools: [
      buildPiSubagentTool({
        getPiAgentsDir: () => root,
        onChildToolActivity: event => activity.push(event),
      }) as unknown as ToolDefinition,
    ],
    settings: { retry: { enabled: false } },
  };
  const open = async () => {
    const session = await DurableSession.open(options);
    cleanup.push(() => session.close());
    return session;
  };
  const session = await open();
  const host = session.getDurableHost();
  const children = () =>
    host.harness.commit(
      tx => tx.scanConversations({ ownerConversationId: host.conversation.id }, 100),
      context,
    );
  const result = () =>
    host.conversation
      .entries({}, 1000, undefined, context)
      .then(page =>
        page.items
          .flatMap(entry => entry.model ?? [])
          .findLast(message => message.role === 'toolResult'),
      );
  return { session, open, children, result, faux, activity };
}

test('runs an isolated native owned child and enforces reviewer read-only tools', async () => {
  const f = await fixture({ agent: 'reviewer', task: 'child review' }, request => {
    expect(JSON.stringify(request.messages)).not.toContain('parent secret');
    const names = getCurrentTools(request.messages).map(tool => tool.name);
    expect(names.sort()).toEqual(['find', 'grep', 'ls', 'read']);
    expect(JSON.stringify(request.messages)).toContain('code review subagent');
    return fauxAssistantMessage('Reviewed with evidence.');
  });
  await f.session.prompt('parent secret: delegate this work');
  const children = await f.children();
  expect(children.items).toHaveLength(1);
  expect(children.items[0].owner?.taskId).toBeTypeOf('number');
  expect(JSON.stringify(await f.result())).toContain('Reviewed with evidence.');
});

test('parallel duplicates remain distinct children and respect the concurrency cap', async () => {
  let active = 0;
  let maximum = 0;
  let started = 0;
  const releases: Array<() => void> = [];
  const f = await fixture(
    { parallel: Array.from({ length: 6 }, () => ({ agent: 'scout', task: 'same child task' })) },
    async () => {
      started++;
      maximum = Math.max(maximum, ++active);
      await new Promise<void>(resolve => releases.push(resolve));
      active--;
      return fauxAssistantMessage('Child finished.');
    },
  );
  const pending = f.session.prompt('parent secret: delegate');
  await expect.poll(() => started).toBe(SUBAGENT_PARALLEL_LIMIT);
  releases.shift()?.();
  await expect.poll(() => started).toBe(5);
  for (const release of releases.splice(0)) release();
  await expect.poll(() => started).toBe(6);
  for (const release of releases.splice(0)) release();
  await pending;
  expect(maximum).toBe(SUBAGENT_PARALLEL_LIMIT);
  expect((await f.children()).items).toHaveLength(6);
  expect(JSON.stringify(await f.result())).toContain('6/6 subagents succeeded');
});

test('native parent abort cancels the child subtree and does not launch queued children', async () => {
  let started = 0;
  const f = await fixture(
    {
      parallel: Array.from({ length: 8 }, (_, index) => ({
        agent: 'scout',
        task: `child ${index}`,
      })),
    },
    async (_request, options) => {
      started++;
      await new Promise<void>(resolve =>
        options?.signal?.addEventListener('abort', () => resolve(), { once: true }),
      );
      return fauxAssistantMessage('Cancelled.', { stopReason: 'aborted' });
    },
  );
  const pending = f.session.prompt('parent secret: delegate').catch(() => {});
  await expect.poll(() => started).toBe(SUBAGENT_PARALLEL_LIMIT);
  await f.session.abort();
  await pending;
  expect((await f.children()).items).toHaveLength(SUBAGENT_PARALLEL_LIMIT);
  await f.session.close();
  const before = f.faux.state.callCount;
  const reopened = await f.open();
  await reopened.resume();
  expect(f.faux.state.callCount).toBe(before);
});

test('completed native children are reused when the parent tool resumes after close', async () => {
  let calls = 0;
  const f = await fixture({ agent: 'scout', task: 'child once' }, () => {
    calls++;
    return fauxAssistantMessage('One committed child result.');
  });
  await f.session.prompt('parent secret: delegate');
  await f.session.close();
  const reopened = await f.open();
  await reopened.resume();
  expect(calls).toBe(1);
});

test('a child provider failure is a failed delegation, not a fabricated answer', async () => {
  const f = await fixture({ agent: 'scout', task: 'child fail' }, () =>
    fauxAssistantMessage('', {
      stopReason: 'error',
      errorMessage: 'provider exploded',
    }),
  );
  await f.session.prompt('parent secret: delegate');
  expect(JSON.stringify(await f.result())).toContain('Error:');
  expect((await f.result())?.isError).toBe(true);
});

test('projects native child tool activity with its owning parent identity', async () => {
  const f = await fixture({ agent: 'scout', task: 'child list' }, request =>
    request.messages.some(message => message.role === 'toolResult')
      ? fauxAssistantMessage('Listed.')
      : fauxAssistantMessage(fauxToolCall('ls', { path: '.' }, { id: 'list-call' }), {
          stopReason: 'toolUse',
        }),
  );
  await f.session.prompt('parent secret: delegate');
  expect(
    f.activity.some(event => event.type === 'tool_execution_start' && event.toolName === 'ls'),
  ).toBe(true);
  expect(
    f.activity.some(event => event.type === 'tool_execution_end' && event.toolName === 'ls'),
  ).toBe(true);
  expect(f.activity.every(event => event.parentToolCallId === 'delegate')).toBe(true);
  expect(f.activity[0].toolCallId).toMatch(/^\d+:list-call$/);
});
