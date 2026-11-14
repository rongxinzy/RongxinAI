import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, expect, test } from 'vitest';
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from '@earendil-works/pi-ai/providers/faux';
import { Type } from 'typebox';
import { DurableModelCatalog } from './durableModelCatalog.mjs';
import { DurableSession } from './durableSession.mjs';
import type { PiEvent } from './piRuntimeSessionState';

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

async function fixture(tokensPerSecond?: number) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'durable-work-'));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const faux = fauxProvider({ ...(tokensPerSecond ? { tokensPerSecond } : {}) });
  const catalog = new DurableModelCatalog();
  catalog.models.setProvider(faux.provider);
  const options = {
    cwd: root,
    durableFile: path.join(root, 'execution.sqlite'),
    model: faux.getModel() as unknown as Record<string, unknown>,
    modelRuntime: catalog,
  };
  const open = async () => {
    const session = await DurableSession.open(options);
    cleanup.push(() => session.close());
    return session;
  };
  return { root, faux, options, open };
}

test('executes native file tools and restores structured model history from SQLite', async () => {
  const f = await fixture();
  f.faux.setResponses([
    fauxAssistantMessage(fauxToolCall('write', { path: 'result.txt', content: 'verified' }), {
      stopReason: 'toolUse',
    }),
    fauxAssistantMessage('The file is ready.'),
  ]);
  const session = await f.open();
  const events: PiEvent[] = [];
  session.subscribe(event => events.push(event));
  await session.prompt('Write a file.');
  expect(await readFile(path.join(f.root, 'result.txt'), 'utf8')).toBe('verified');
  expect(
    events.some(event => event.type === 'tool_execution_end' && event.toolName === 'write'),
  ).toBe(true);
  expect(events.filter(event => event.type === 'agent_settled')).toHaveLength(1);
  await session.close();
  const reopened = await f.open();
  f.faux.setResponses([
    context => {
      expect(context.messages.some(message => message.role === 'toolResult')).toBe(true);
      expect(JSON.stringify(context.messages)).toContain('The file is ready.');
      return fauxAssistantMessage('History restored.');
    },
  ]);
  await reopened.prompt('What happened?');
  expect(f.faux.state.callCount).toBe(3);
});

test('a persisted completed tool is not repeated when an unfinished response resumes', async () => {
  const f = await fixture(100);
  let effects = 0;
  Object.assign(f.options, {
    customTools: [
      {
        name: 'external_effect',
        label: 'External effect',
        description: 'Record an externally visible effect.',
        parameters: Type.Object({}),
        execute: async () => {
          effects++;
          return { content: [{ type: 'text', text: 'effect committed' }] };
        },
      },
    ],
  });
  f.faux.setResponses([
    fauxAssistantMessage(fauxToolCall('external_effect', {}), { stopReason: 'toolUse' }),
    fauxAssistantMessage('This response is deliberately long. '.repeat(100)),
  ]);
  const session = await f.open();
  const updates: PiEvent[] = [];
  session.subscribe(event => updates.push(event));
  const pending = session.prompt('Do the work.').catch(() => {});
  await expect.poll(() => effects).toBe(1);
  await expect.poll(() => updates.some(event => event.type === 'message_update')).toBe(true);
  await session.close();
  await pending;
  f.faux.setResponses([fauxAssistantMessage('Recovered after restart.')]);
  const reopened = await f.open();
  await reopened.resume();
  expect(effects).toBe(1);
  expect(JSON.stringify(reopened.messages)).toContain('Recovered after restart.');
});

test('explicit abort settles work and reopening cannot revive the withdrawn input', async () => {
  const f = await fixture(100);
  f.faux.setResponses([fauxAssistantMessage('Slow response. '.repeat(200))]);
  const session = await f.open();
  const pending = session.prompt('Start.').catch(() => {});
  await expect.poll(() => f.faux.state.callCount).toBe(1);
  await session.abort();
  await pending;
  await session.close();
  const reopened = await f.open();
  await reopened.resume();
  expect(f.faux.state.callCount).toBe(1);
});
