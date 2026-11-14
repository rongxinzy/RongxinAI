import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from '@earendil-works/pi-ai/providers/faux';
import { DurableModelCatalog } from '../libs/agentEngine/durableModelCatalog.mjs';
import { DurableSession } from '../libs/agentEngine/durableSession.mjs';
import { MarkdownMemoryRuntime } from './markdownMemoryRuntime';

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const close of cleanup.splice(0).reverse()) await close();
});

test('E2E capture reads native plugin sections from the real beforeRequest boundary', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'memory-native-capture-'));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  vi.stubEnv('ZHIYUAN_E2E_CAPTURE_MEMORY_PROMPT', '1');
  vi.stubEnv('ZHIYUAN_MEMORY_LEAK_TEST_USER_DATA', root);
  const runtime = new MarkdownMemoryRuntime(path.join(root, 'memory'));
  await (
    await runtime.files('workspace-a')
  ).apply('memory', [
    { op: 'add', text: 'CAPTURE_SQLITE_FACT is a confirmed native plugin memory.' },
  ]);
  const faux = fauxProvider();
  const catalog = new DurableModelCatalog();
  catalog.models.setProvider(faux.provider);
  const session = await DurableSession.open({
    cwd: root,
    model: faux.getModel() as unknown as Record<string, unknown>,
    modelRuntime: catalog,
    memoryBinding: await runtime.createBinding('workspace-a', undefined, 'capture-session'),
  });
  cleanup.push(() => session.close());
  let actualRequest = '';
  faux.setResponses([
    request => {
      actualRequest = JSON.stringify(request.messages);
      return fauxAssistantMessage('Captured native request.');
    },
  ]);
  await session.prompt('What is the recorded workspace fact?');
  const capture = JSON.parse(
    await readFile(path.join(root, 'e2e-memory-prompt-captures/capture-session.json'), 'utf8'),
  );
  expect(actualRequest).toContain('CAPTURE_SQLITE_FACT');
  expect(capture.source).toBe('durable-before-request');
  expect(capture.memoryContext).toContain('<long-term-memory>');
  expect(capture.memoryContext).toContain('CAPTURE_SQLITE_FACT');
  expect(capture.userPrompt).toBe('What is the recorded workspace fact?');
});

test('real session afterRun keeps native recall readable in the following tool round and after reopen', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'memory-session-'));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const runtime = new MarkdownMemoryRuntime(path.join(root, 'memory'));
  const faux = fauxProvider();
  const catalog = new DurableModelCatalog();
  catalog.models.setProvider(faux.provider);
  const open = async () => {
    const session = await DurableSession.open({
      cwd: root,
      durableFile: path.join(root, 'execution.sqlite'),
      model: faux.getModel() as unknown as Record<string, unknown>,
      modelRuntime: catalog,
      memoryBinding: await runtime.createBinding('workspace-a'),
    });
    cleanup.push(() => session.close());
    return session;
  };
  faux.setResponses([
    fauxAssistantMessage('opal history has the verified completion qualifier: cedar.'),
  ]);
  const first = await open();
  await first.prompt('Retain the opal history record.');
  const runRecall = async (session: DurableSession) => {
    let recalled = '';
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall('memory_recall', { query: 'opal history' }), {
        stopReason: 'toolUse',
      }),
      request => {
        recalled = JSON.stringify(
          request.messages.filter(message => message.role === 'toolResult'),
        );
        return fauxAssistantMessage('Native recall completed.');
      },
    ]);
    await session.prompt('Find the earlier record through the native recall tool.');
    expect(recalled).toContain('verified completion qualifier: cedar');
    expect(recalled).not.toContain('expired');
  };
  await runRecall(first);
  await first.close();
  await runRecall(await open());
});
