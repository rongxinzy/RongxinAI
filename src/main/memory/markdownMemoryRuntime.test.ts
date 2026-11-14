import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, expect, test } from 'vitest';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { createModels } from '@earendil-works/pi-ai';
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from '@earendil-works/pi-ai/providers/faux';
import { createRegistry, Harness, type Conversation } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { PERSONAL_MEMORY_PROJECT_ID } from '../../shared/memory';
import { MarkdownMemoryRuntime, type DurableMemoryBinding } from './markdownMemoryRuntime';

const context = BACKGROUND_CONTEXT;
const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'native-markdown-'));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const runtime = new MarkdownMemoryRuntime(path.join(root, 'memory'));
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  const open = async (name: string, owner: string) => {
    const binding = await runtime.createBinding(owner);
    const registry = createRegistry();
    registry.install(binding.extension);
    const storage = await openNodeSqliteStorage(path.join(root, `${name}.sqlite`));
    const harness = await Harness.open(storage, { models, registry }, context);
    cleanup.push(() => harness.close(context));
    const conversation = await harness.root(context);
    binding.bindConversation(conversation);
    const model = faux.getModel();
    await conversation.configure(
      {
        model: { provider: model.provider, modelId: model.id },
        tools: binding.extension.tools ?? [],
      },
      context,
    );
    return { harness, conversation, binding };
  };
  return { root, runtime, faux, open };
}

async function submit(conversation: Conversation, content: string) {
  const submission = await conversation.submit({ type: 'input', content }, context);
  return submission.wait(context);
}

async function recall(binding: DurableMemoryBinding, conversation: Conversation, query: string) {
  const tool = binding.extension.tools!.find(tool => tool.name === 'memory_recall')!;
  return tool.execute({ query }, { conversationId: conversation.id } as never, context);
}

test('native prompt reads bounded local files with workspace and confirmed personal scopes', async () => {
  const f = await fixture();
  const files = await f.runtime.files('workspace-a');
  await files.apply('memory', [{ op: 'add', text: 'Workspace A chooses SQLite.' }]);
  await (
    await f.runtime.files(PERSONAL_MEMORY_PROJECT_ID)
  ).apply('user', [{ op: 'add', text: 'The user explicitly confirmed a preference for Chinese.' }]);
  const a = await f.open('a', 'workspace-a');
  let capturedPrompt = '';
  f.faux.setResponses([
    request => {
      capturedPrompt = JSON.stringify(
        request.messages.filter(message => message.role === 'system'),
      );
      return fauxAssistantMessage('Native section verified.');
    },
  ]);
  const outcome = await submit(a.conversation, 'Review current memory.');
  expect(outcome).toMatchObject({ status: 'done' });
  expect(capturedPrompt).toContain('Workspace A chooses SQLite.');
  expect(capturedPrompt).toContain('preference for Chinese');
  expect(capturedPrompt).toContain('/2200 chars');
  expect(capturedPrompt).not.toContain('memory_write');
  const b = await f.open('b', 'workspace-b');
  expect(a.conversation.id).toBe(b.conversation.id);
  f.faux.setResponses([
    request => {
      expect(JSON.stringify(request.messages)).not.toContain('Workspace A chooses SQLite.');
      expect(JSON.stringify(request.messages)).toContain('preference for Chinese');
      return fauxAssistantMessage('Isolated.');
    },
  ]);
  await submit(b.conversation, 'Review this workspace.');
  expect(await readFile(files.path('memory'), 'utf8')).toContain('SQLite');
});

test('native recall reaches persisted transcript before the first post-restart settlement', async () => {
  const f = await fixture();
  const first = await f.open('persisted', 'workspace-a');
  f.faux.setResponses([fauxAssistantMessage('The durable transcript needle is amber.')]);
  await submit(first.conversation, 'Record a transcript needle.');
  await first.harness.close(context);
  const reopened = await f.open('persisted', 'workspace-a');
  expect(JSON.stringify(await recall(reopened.binding, reopened.conversation, 'needle'))).toContain(
    'amber',
  );
  const other = await f.open('other', 'workspace-b');
  expect(JSON.stringify(await recall(other.binding, other.conversation, 'needle'))).toContain(
    'No matches found',
  );
});

test('the model cannot call curator-only writes through an ordinary native binding', async () => {
  const f = await fixture();
  const work = await f.open('write-policy', 'workspace-a');
  f.faux.setResponses([
    fauxAssistantMessage(
      fauxToolCall('memory_write', {
        file: 'user',
        ops: [{ op: 'add', text: 'Unconfirmed personal data.' }],
      }),
      { stopReason: 'toolUse' },
    ),
    fauxAssistantMessage('Write unavailable.'),
  ]);
  await submit(work.conversation, 'Try an unconfirmed write.');
  expect((await (await f.runtime.files('workspace-a')).read('user')).entries).toEqual([]);
  expect((await (await f.runtime.files(PERSONAL_MEMORY_PROJECT_ID)).read('user')).entries).toEqual(
    [],
  );
});

test('upstream curation uses its bounded native operation pipeline and supports undo', async () => {
  const f = await fixture();
  const files = await f.runtime.files('workspace-a');
  await files.apply('memory', [{ op: 'add', text: 'Prefer SQLite for this workspace.' }]);
  const binding = await f.runtime.createBinding('workspace-a');
  const result = await binding.maintain(
    {
      runs: 1,
      deadline: Date.now() + 5000,
      run: async (input, tools) => {
        expect(input).toContain('Prefer SQLite');
        expect(tools).toEqual([]);
        return {
          status: 'completed',
          text: JSON.stringify([
            { op: 'replace', match: 'Prefer SQLite', text: 'Use SQLite for this workspace.' },
          ]),
        };
      },
    },
    context,
  );
  expect(result.changes).toHaveLength(1);
  expect((await files.read('memory')).entries).toEqual(['Use SQLite for this workspace.']);
  await f.runtime.undo('workspace-a', result.changes[0].changeId, context);
  expect((await files.read('memory')).entries).toEqual(['Prefer SQLite for this workspace.']);
  await binding.maintain(
    {
      runs: 1,
      deadline: Date.now() + 5000,
      run: async () => ({ status: 'completed', text: '[{"op":"remove","match":"*"}]' }),
    },
    context,
  );
  expect((await files.read('memory')).entries).toEqual(['Prefer SQLite for this workspace.']);
});

test('upstream file limit rejects a batch without partially replacing existing memory', async () => {
  const f = await fixture();
  const files = await f.runtime.files('workspace-a');
  await files.apply('memory', [{ op: 'add', text: 'Kept fact.' }]);
  await expect(
    files.apply('memory', [
      { op: 'replace', match: 'Kept fact.', text: 'x'.repeat(2201) },
      { op: 'add', text: 'Must not partially appear.' },
    ]),
  ).rejects.toThrow();
  const restarted = new MarkdownMemoryRuntime(path.join(f.root, 'memory'));
  expect((await (await restarted.files('workspace-a')).read('memory')).entries).toEqual([
    'Kept fact.',
  ]);
});
