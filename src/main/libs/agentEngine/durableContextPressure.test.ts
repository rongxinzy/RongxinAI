import { mkdtemp, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, expect, test } from 'vitest';
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from '@earendil-works/pi-ai/providers/faux';
import { getCurrentTools } from '@earendil-works/pi-ai/utils/transcript';
import type { TranscriptContext } from '@earendil-works/pi-ai';
import { DurableSession } from './durableSession.mjs';
import { DurableModelCatalog } from './durableModelCatalog.mjs';
import { durableCompactionPolicy } from './durableModelPolicy';

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

test.each([1024, 4096, 8192, 16000, 32768, 65536])(
  'native keep/reserve budgets fit a %i-token model',
  window => {
    const policy = durableCompactionPolicy({ contextWindow: window });
    expect(policy.reserveTokens! + policy.keepRecentTokens!).toBeLessThan(window);
    expect(policy.backgroundTokens! + policy.reserveTokens!).toBeLessThanOrEqual(window);
    expect(policy.reserveTokens).toBeGreaterThan(0);
  },
);

test('32 native tool rounds finish across compaction without losing committed files or ordering', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'durable-pressure-'));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const faux = fauxProvider({ models: [{ id: 'bounded', contextWindow: 16000, maxTokens: 1024 }] });
  const catalog = new DurableModelCatalog();
  catalog.models.setProvider(faux.provider);
  let writes = 0;
  let summaries = 0;
  const response = (context: TranscriptContext) => {
    if (!getCurrentTools(context.messages).length) {
      summaries++;
      return fauxAssistantMessage(
        `MARKER_ABCDEF. Files 1 through ${writes} are already committed. Continue remaining work.`,
        { timestamp: 1 },
      );
    }
    if (writes < 32) {
      const number = ++writes;
      return fauxAssistantMessage(
        fauxToolCall('write', {
          path: `step-${number}.txt`,
          content: `MARKER_ABCDEF ${number}\n${'证据与已完成事项。'.repeat(300)}`,
        }),
        { stopReason: 'toolUse', timestamp: 1 },
      );
    }
    return fauxAssistantMessage('All 32 files verified.', { timestamp: 1 });
  };
  faux.setResponses(Array.from({ length: 70 }, () => response));
  const session = await DurableSession.open({
    cwd: root,
    durableFile: path.join(root, 'native.sqlite'),
    model: faux.getModel() as unknown as Record<string, unknown>,
    modelRuntime: catalog,
    tools: ['write'],
  });
  cleanup.push(() => session.close());
  const terminal: string[] = [];
  session.subscribe(event => {
    if (event.type === 'agent_settled') terminal.push(event.type);
  });
  await session.prompt('Write 32 numbered files and report completion.');
  expect((await readdir(root)).filter(name => /^step-\d+\.txt$/.test(name))).toHaveLength(32);
  expect(writes).toBe(32);
  expect(summaries).toBeGreaterThan(0);
  expect(terminal).toHaveLength(1);
  expect(JSON.stringify(session.messages)).toContain('All 32 files verified.');
}, 20_000);
