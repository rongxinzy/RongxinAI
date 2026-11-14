import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, expect, test } from 'vitest';
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from '@earendil-works/pi-ai/providers/faux';
import { DurableModelCatalog } from './durableModelCatalog.mjs';
import { DurableSession } from './durableSession.mjs';
import {
  durableSessionFile,
  hasDurableSession,
  invalidateDurableSession,
  listDurableSessionFiles,
} from './durableSessionStore';

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function fixture(id = 'session:with/unsafe:characters') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'durable-native-store-'));
  cleanup.push(() => fs.rm(root, { recursive: true, force: true }));
  const faux = fauxProvider();
  const catalog = new DurableModelCatalog();
  catalog.models.setProvider(faux.provider);
  const options = {
    cwd: root,
    durableFile: durableSessionFile(root, id),
    model: faux.getModel() as unknown as Record<string, unknown>,
    modelRuntime: catalog,
  };
  const open = async () => {
    const session = await DurableSession.open(options);
    cleanup.push(() => session.close());
    return session;
  };
  return { root, id, faux, options, open };
}

test('native SQLite restores structured tool history after the owning session closes', async () => {
  const f = await fixture();
  f.faux.setResponses([
    fauxAssistantMessage(
      fauxToolCall('write', { path: 'result.txt', content: 'native tool result' }),
      { stopReason: 'toolUse' },
    ),
    fauxAssistantMessage('Stored answer.'),
  ]);
  const first = await f.open();
  await first.prompt('Write the result.');
  expect(await fs.readFile(path.join(f.root, 'result.txt'), 'utf8')).toBe('native tool result');
  expect(hasDurableSession(f.root, f.id)).toBe(true);
  expect(listDurableSessionFiles(f.root)).toEqual([f.options.durableFile]);
  await first.close();
  const reopened = await f.open();
  f.faux.setResponses([
    context => {
      expect(context.messages.some(message => message.role === 'toolResult')).toBe(true);
      expect(JSON.stringify(context.messages)).toContain('Stored answer.');
      return fauxAssistantMessage('Structured history is available.');
    },
  ]);
  await reopened.prompt('What happened before reopening?');
  expect(f.faux.state.callCount).toBe(3);
});

test('rejects a second active owner and permits reopening while the first owner is closing', async () => {
  const f = await fixture('single-owner');
  const first = await f.open();
  await expect(DurableSession.open(f.options)).rejects.toThrow('owner');
  const closing = first.close();
  const reopening = f.open();
  await closing;
  const reopened = await reopening;
  f.faux.setResponses([fauxAssistantMessage('Reopened.')]);
  await reopened.prompt('Continue after closing.');
  expect(JSON.stringify(reopened.messages)).toContain('Reopened.');
});

test('concurrent initial opens cannot claim the same native database twice', async () => {
  const f = await fixture('concurrent-open');
  const outcomes = await Promise.allSettled([
    DurableSession.open(f.options),
    DurableSession.open(f.options),
  ]);
  for (const outcome of outcomes) {
    if (outcome.status === 'fulfilled') cleanup.push(() => outcome.value.close());
  }
  expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1);
  expect(outcomes.filter(outcome => outcome.status === 'rejected')).toHaveLength(1);
});

test('invalidation after closure starts fresh without reading or removing retired JSONL', async () => {
  const f = await fixture('invalidate');
  const retired = path.join(f.root, 'pi-sessions', f.id, 'old.jsonl');
  await fs.mkdir(path.dirname(retired), { recursive: true });
  await fs.writeFile(retired, 'Retired history must remain untouched');
  const first = await f.open();
  f.faux.setResponses([fauxAssistantMessage('Forget this answer.')]);
  await first.prompt('Discarded input.');
  await first.close();
  await invalidateDurableSession(f.root, f.id);
  expect(hasDurableSession(f.root, f.id)).toBe(false);
  const fresh = await f.open();
  f.faux.setResponses([
    context => {
      expect(JSON.stringify(context.messages)).not.toContain('Discarded input.');
      expect(JSON.stringify(context.messages)).not.toContain('Retired history');
      return fauxAssistantMessage('New native context.');
    },
  ]);
  await fresh.prompt('Fresh input.');
  expect(await fs.readFile(retired, 'utf8')).toBe('Retired history must remain untouched');
});
