import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { fauxAssistantMessage, fauxProvider } from '@earendil-works/pi-ai/providers/faux';
import { afterEach, expect, test, vi } from 'vitest';
import { DurableModelCatalog } from './durableModelCatalog.mjs';
import { DurableSession, type DurableSessionOptions } from './durableSession.mjs';
import { readDurableRecovery } from './durableSessionMetadata.mjs';
import { WorkbenchApprovalMode } from '../../../shared/workbenchTask';
import { releaseDurableStorage, withClosedDurableStorage } from './durableSessionOwnership';
import type { PiResourceLoader } from './piRuntimeSessionState';

const context = BACKGROUND_CONTEXT;
const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'native-cleanup-'));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const faux = fauxProvider();
  const catalog = new DurableModelCatalog();
  catalog.models.setProvider(faux.provider);
  const options: DurableSessionOptions = {
    cwd: root,
    durableFile: path.join(root, 'session.sqlite'),
    model: faux.getModel() as unknown as Record<string, unknown>,
    modelRuntime: catalog,
  };
  return { faux, options };
}
const resources = (close: () => Promise<void>): PiResourceLoader => ({
  extensions: [],
  getSystemPrompt: () => '',
  getSkills: () => ({ skills: [], diagnostics: [] }),
  reload: async () => {},
  close,
});

test('resource close failure remains visible while confirmed closed SQLite can reopen concurrently', async () => {
  const f = await fixture();
  const release = Promise.withResolvers<void>();
  const closeResources = vi.fn(async () => {
    await release.promise;
    throw new Error('Resource shutdown failed.');
  });
  const first = await DurableSession.open({
    ...f.options,
    resourceLoader: resources(closeResources),
  });
  const closing = first.close();
  const reopening = DurableSession.open(f.options);
  release.resolve();
  await expect(closing).rejects.toThrow('Resource shutdown failed.');
  expect(first.storageClosed).toBe(true);
  const reopened = await reopening;
  cleanup.push(() => reopened.close());
  f.faux.setResponses([fauxAssistantMessage('Reopened safely.')]);
  await reopened.prompt('Continue.');
  expect(closeResources).toHaveBeenCalledOnce();
  expect(JSON.stringify(reopened.messages)).toContain('Reopened safely.');
});

test('initialization and resource cleanup failures both survive, with closed native ownership released', async () => {
  const f = await fixture();
  const closeResources = vi.fn(async () => {
    throw new Error('Resource cleanup failed.');
  });
  const failure = await DurableSession.open({
    ...f.options,
    model: { ...f.options.model, id: undefined },
    resourceLoader: resources(closeResources),
  }).catch(error => error);
  expect(failure).toBeInstanceOf(AggregateError);
  expect(failure.errors.map((error: Error) => error.message)).toEqual([
    'Invalid model identity.',
    'Resource cleanup failed.',
  ]);
  expect(closeResources).toHaveBeenCalledOnce();
  const reopened = await DurableSession.open(f.options);
  cleanup.push(() => reopened.close());
  f.faux.setResponses([fauxAssistantMessage('Initialization recovered.')]);
  await reopened.prompt('Continue.');
  expect(JSON.stringify(reopened.messages)).toContain('Initialization recovered.');
});

test('unconfirmed native close failure retains ownership through failed invalidation barriers', async () => {
  const f = await fixture();
  const closeResources = vi.fn(async () => {});
  const first = await DurableSession.open({
    ...f.options,
    resourceLoader: resources(closeResources),
  });
  const { harness } = first.getDurableHost();
  const closeNative = vi
    .spyOn(harness, 'close')
    .mockRejectedValue(new Error('Native backend close failed.'));
  try {
    await expect(first.close()).rejects.toThrow('Native backend close failed.');
    expect(first.storageClosed).toBe(false);
    expect(closeResources).toHaveBeenCalledOnce();
    // The real native store is still open: a rejected close cannot authorize deletion.
    await expect(harness.inspect(context)).resolves.toHaveProperty('scheduling');
    await expect(DurableSession.open(f.options)).rejects.toThrow('Native backend close failed.');
    const remove = vi.fn();
    await expect(withClosedDurableStorage(f.options.durableFile!, remove)).rejects.toThrow(
      'Native backend close failed.',
    );
    expect(remove).not.toHaveBeenCalled();
    await expect(DurableSession.open(f.options)).rejects.toThrow('Native backend close failed.');
  } finally {
    closeNative.mockRestore();
    await harness.close(context);
    expect(first.storageClosed).toBe(true);
    // Test-only recovery after the injected failure is removed and real SQLite closes.
    releaseDurableStorage(f.options.durableFile!, first);
  }
});

test('native close error after confirmed backend closure does not strand ownership', async () => {
  const f = await fixture();
  const first = await DurableSession.open(f.options);
  const { harness } = first.getDurableHost();
  const nativeClose = harness.close.bind(harness);
  const close = vi.spyOn(harness, 'close').mockImplementation(async ctx => {
    await nativeClose(ctx);
    throw new Error('Late native cleanup error.');
  });
  try {
    await expect(first.close()).rejects.toThrow('Late native cleanup error.');
  } finally {
    close.mockRestore();
  }
  expect(first.storageClosed).toBe(true);
  const reopened = await DurableSession.open(f.options);
  cleanup.push(() => reopened.close());
  f.faux.setResponses([fauxAssistantMessage('Confirmed closure is reopenable.')]);
  await reopened.prompt('Continue.');
});

test('latest model, skills and approval choices are persisted in native recovery metadata after close', async () => {
  const f = await fixture();
  const session = await DurableSession.open({
    ...f.options,
    runtimeOptions: {
      sessionId: 'configured-session',
      modelOverride: 'previous-model',
      skillIds: ['previous-skill'],
      approvalMode: WorkbenchApprovalMode.Ask,
      systemPrompt: 'Removed prompt override',
    },
  });
  await session.updateRuntimeOptions({
    modelOverride: 'updated-model',
    skillIds: ['docx', 'pdf'],
    approvalMode: WorkbenchApprovalMode.AllowAll,
    systemPrompt: undefined,
  });
  await session.close();
  const recovery = await readDurableRecovery(f.options.durableFile!);
  expect(recovery.pending).toBe(false);
  expect(recovery.options).toEqual({
    sessionId: 'configured-session',
    modelOverride: 'updated-model',
    skillIds: ['docx', 'pdf'],
    approvalMode: WorkbenchApprovalMode.AllowAll,
  });
  expect(f.faux.state.callCount).toBe(0);
});
