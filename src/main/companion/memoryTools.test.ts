import Database from 'better-sqlite3';
import { mkdtemp, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { expect, test, vi } from 'vitest';
import { awaitWithContext, BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createModels, type Message } from '@earendil-works/pi-ai';
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from '@earendil-works/pi-ai/providers/faux';
import {
  createRegistry,
  defineExtension,
  Harness,
  type Conversation,
} from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { MemoryKind, MemoryLifecycleStatus } from '../../shared/memory';
import { EngramManager } from '../memory/engramManager';
import { MemoryRepository } from '../memory/repository';
import { ProjectMemoryService } from '../memory/projectMemoryService';
import { resolveProjectIdentity } from '../memory/projectIdentity';
import { ZhiYuanEngramAdapter } from '../memory/zhiyuanEngramAdapter';
import { CompanionMemoryService } from './memory';
import { CompanionMemoryRetractions } from './memoryRetractions';
import { CompanionMemoryTool } from './constants';
import { companionMemoryTools, companionToolsRejected } from './memoryTools.mjs';

/** Synthetic facts only. Faux executes locally: no account, network model or user memory. */
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'companion-chat-memory-'));
  const manager = new EngramManager({ userDataPath: root, projectRoot: process.cwd() });
  const db = new Database(path.join(root, 'projection.sqlite'));
  const repository = new MemoryRepository(db);
  const adapter = new ZhiYuanEngramAdapter(manager);
  const shared = new ProjectMemoryService(repository, adapter, resolveProjectIdentity, root);
  const memory = new CompanionMemoryService(
    repository,
    adapter,
    shared,
    root,
    new CompanionMemoryRetractions(db),
  );
  const a = randomUUID(),
    b = randomUUID();
  const models = createModels();
  const faux = fauxProvider();
  models.setProvider(faux.provider);
  let harness: Harness;
  let conversation: Conversation;
  let pausedTool: string | null = null;
  let effectReached = false;
  const open = async (owner = a) => {
    const registry = createRegistry();
    registry.install(
      defineExtension({
        name: 'fixture.memory',
        tools: companionMemoryTools(owner, memory).map(tool => ({
          ...tool,
          execute: async (args, api, invocation) => {
            const result = await tool.execute(args, api, invocation);
            if (pausedTool === tool.name) {
              effectReached = true;
              await awaitWithContext(new Promise<never>(() => {}), invocation);
            }
            return result;
          },
        })),
      }),
    );
    harness = await Harness.open(
      await openNodeSqliteStorage(path.join(root, `${owner}.sqlite`)),
      { models, registry, settings: { retry: { enabled: false } } },
      context,
    );
    conversation = await harness.root(context, {
      agent: { model: { provider: faux.provider.id, modelId: faux.getModel().id } },
    });
  };
  let seen: Message[] = [];
  const finish = () => {
    faux.appendResponses([
      transcript => {
        seen = [...transcript.messages];
        return fauxAssistantMessage('Done');
      },
    ]);
  };
  const submit = async (name: string, args: Record<string, unknown>, key = randomUUID()) => {
    // Deliberately reuse the provider's call ID across distinct submissions.
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall(name, args, { id: 'reused-call' }), {
        stopReason: 'toolUse',
      }),
    ]);
    finish();
    return conversation.submit(
      { type: 'input', content: 'Synthetic memory request', requestId: key },
      context,
    );
  };
  const run = async (name: string, args: Record<string, unknown>) => {
    const submission = await submit(name, args);
    expect((await submission.wait(context)).status).toBe('done');
    const result = seen.findLast(message => message.role === 'toolResult');
    if (!result || result.role !== 'toolResult') throw new Error('Native tool result missing');
    return {
      result,
      text: result.content.flatMap(block => (block.type === 'text' ? [block.text] : [])).join('\n'),
    };
  };
  await open();
  return {
    root,
    a,
    b,
    memory,
    adapter,
    shared,
    repository,
    open,
    run,
    submit,
    finish,
    close: () => harness.close(context),
    resume: () => harness.resume(),
    receipt: (id: number) => harness.submission(id, context),
    pauseAfter: (name: string | null) => {
      pausedTool = name;
    },
    reached: () => effectReached,
    cleanup: async () => {
      vi.restoreAllMocks();
      await harness.close(context);
      await manager.stop();
      db.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

const fact = {
  title: 'Paper kite',
  content: 'The paper kite is blue.',
  kind: MemoryKind.Preference,
};

test('native calls save, search, correct and forget only the bound companion memory', async () => {
  const f = await fixture();
  try {
    const first = await f.run(CompanionMemoryTool.Save, fact);
    expect(first.result.isError).toBe(false);
    const saved = JSON.parse(first.text);
    expect(saved.available).toBe(true);
    expect(f.memory.list(f.a)).toHaveLength(1);
    expect(f.memory.list(f.b)).toEqual([]);
    const search = JSON.parse(
      (await f.run(CompanionMemoryTool.Search, { query: 'paper kite' })).text,
    );
    expect(search.memories.map((item: { id: string }) => item.id)).toEqual([saved.id]);
    expect(search.memories[0]).not.toHaveProperty('projectId');
    const changed = JSON.parse(
      (
        await f.run(CompanionMemoryTool.Save, {
          ...fact,
          content: 'The paper kite is green.',
          replacesId: saved.id,
        })
      ).text,
    );
    expect(changed.available).toBe(true);
    expect(changed.id).not.toBe(saved.id);
    expect(f.repository.getLink(saved.id)?.status).toBe(MemoryLifecycleStatus.Superseded);
    expect(await f.memory.context(f.a, 'paper kite')).toContain('is green');
    expect(await f.memory.context(f.a, 'paper kite')).not.toContain('is blue');
    expect(JSON.parse((await f.run(CompanionMemoryTool.Search, {})).text).memories).toHaveLength(1);
    expect(
      JSON.parse((await f.run(CompanionMemoryTool.Forget, { id: changed.id })).text).forgotten,
    ).toBe(true);
    expect(await f.memory.search(f.a)).toEqual([]);
    expect(f.shared.listManagedMemories()).toEqual([]);
  } finally {
    await f.cleanup();
  }
}, 60_000);

test('schema validation rejects owner injection, shared scope and unsupported memory kinds', async () => {
  const f = await fixture();
  try {
    for (const args of [
      { ...fact, petId: f.b },
      { ...fact, scope: 'personal' },
      { ...fact, kind: 'secret' },
    ]) {
      const result = await f.run(CompanionMemoryTool.Save, args);
      expect(result.result.isError).toBe(true);
    }
    expect(f.memory.list(f.a)).toEqual([]);
    expect(f.memory.list(f.b)).toEqual([]);
    expect(f.shared.listManagedMemories()).toEqual([]);
  } finally {
    await f.cleanup();
  }
}, 60_000);

test('another companion cannot edit or forget a known private ID', async () => {
  const f = await fixture();
  try {
    const saved = JSON.parse((await f.run(CompanionMemoryTool.Save, fact)).text);
    await f.close();
    await f.open(f.b);
    expect(JSON.parse((await f.run(CompanionMemoryTool.Search, {})).text).memories).toEqual([]);
    expect(
      (await f.run(CompanionMemoryTool.Save, { ...fact, replacesId: saved.id })).result.isError,
    ).toBe(true);
    expect((await f.run(CompanionMemoryTool.Forget, { id: saved.id })).result.isError).toBe(true);
    expect(f.repository.getLink(saved.id)?.status).toBe(MemoryLifecycleStatus.Active);
    expect(f.memory.list(f.b)).toEqual([]);
  } finally {
    await f.cleanup();
  }
}, 60_000);

test('offline saves report pending sync and withdrawn candidates survive repeated forgetting', async () => {
  const f = await fixture();
  try {
    vi.spyOn(f.adapter, 'confirmMemory').mockResolvedValueOnce(null);
    const saved = JSON.parse((await f.run(CompanionMemoryTool.Save, fact)).text);
    expect(saved.available).toBe(false);
    expect(saved.status).toBe(MemoryLifecycleStatus.NeedsReview);
    expect(JSON.parse((await f.run(CompanionMemoryTool.Search, {})).text).memories).toEqual([]);
    for (let attempt = 0; attempt < 2; attempt++)
      expect((await f.run(CompanionMemoryTool.Forget, { id: saved.id })).result.isError).toBe(
        false,
      );
    await f.shared.retryPendingOutbox();
    expect(f.memory.list(f.a)).toEqual([]);
  } finally {
    await f.cleanup();
  }
}, 60_000);

for (const operation of [CompanionMemoryTool.Save, CompanionMemoryTool.Forget]) {
  test(`reopening after ${operation} committed its effect safely replays the native task`, async () => {
    const f = await fixture();
    try {
      const original = await f.memory.save({ ...fact, petId: f.a, requestId: 'initial' });
      const saving = vi.spyOn(f.memory, 'save');
      const forgetting = vi.spyOn(f.memory, 'forget');
      f.pauseAfter(operation);
      const submission = await f.submit(
        operation,
        operation === CompanionMemoryTool.Save ? fact : { id: original.id },
      );
      await expect.poll(f.reached).toBe(true);
      const calls =
        operation === CompanionMemoryTool.Save
          ? saving.mock.calls.length
          : forgetting.mock.calls.length;
      await f.close();
      f.pauseAfter(null);
      await f.open();
      f.resume();
      const restored = await f.receipt(submission.id);
      expect((await restored!.wait(context)).status).toBe('done');
      if (operation === CompanionMemoryTool.Save) {
        expect(saving).toHaveBeenCalledTimes(calls + 1);
        expect(saving.mock.calls[0][0].requestId).toBe(saving.mock.calls[1][0].requestId);
        expect(f.memory.list(f.a)).toHaveLength(2);
      } else {
        expect(forgetting).toHaveBeenCalledTimes(calls + 1);
        expect(await f.memory.search(f.a)).toEqual([]);
      }
    } finally {
      await f.cleanup();
    }
  }, 60_000);
}

test('tool capability rejection excludes quota, auth and ordinary validation errors', () => {
  for (const error of [
    'This model does not support tools',
    'Unsupported parameter: tools',
    'tool_choice is not supported',
  ])
    expect(companionToolsRejected(error)).toBe(true);
  for (const error of [
    'Quota exhausted',
    'Invalid API key',
    'Tool arguments are invalid',
    'Model is unsupported',
  ])
    expect(companionToolsRejected(error)).toBe(false);
});
