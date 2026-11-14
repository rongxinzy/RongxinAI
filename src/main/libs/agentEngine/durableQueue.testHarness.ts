import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { fauxAssistantMessage, fauxProvider } from '@earendil-works/pi-ai/providers/faux';
import { InboxDoc } from '@earendil-works/pi-durable';
import { afterEach, vi } from 'vitest';
import { DurableModelCatalog } from './durableModelCatalog.mjs';
import type { DurableSession } from './durableSession.mjs';
import { ModelCapabilityStatus } from '../../../shared/providers';
import type { CoworkMessage } from '../../coworkStore';

const selected = vi.hoisted(() => ({ resolve: vi.fn() }));
vi.mock('electron', async original => {
  const actual = await original<typeof import('electron')>();
  return { ...actual, app: { ...actual.app, getAppPath: () => process.cwd() } };
});
vi.mock('./piMagpiePiModel', () => ({
  DEFAULT_PI_LOCAL_MAX_TOKENS: 16_384,
  resolvePiModel: selected.resolve,
}));
vi.mock('../coworkUtil', async original => ({
  ...(await original<typeof import('../coworkUtil')>()),
  applyApplicationRuntimeEnv: async () => {},
}));
import { PiRuntimeAdapter } from './piRuntimeAdapter';

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

/** The entire application adapter, native kernel and SQLite run; only model resolution/I/O is scripted. */
export async function nativeQueueFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'native-ui-queue-'));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const faux = fauxProvider({ models: [{ id: 'queue', contextWindow: 128_000, maxTokens: 1024 }] });
  const catalog = new DurableModelCatalog();
  catalog.models.setProvider(faux.provider);
  selected.resolve.mockResolvedValue({
    model: faux.getModel(),
    modelRuntime: catalog,
    endpointKey: 'faux',
    maxOutputTokens: 1024,
    providerName: 'magpie',
    capabilities: { toolCalling: ModelCapabilityStatus.Supported },
  });
  const adapter = new PiRuntimeAdapter();
  adapter.setPiSessionStoreRoot(root);
  const release = Promise.withResolvers<void>();
  const messages: CoworkMessage[] = [];
  adapter.on('message', (_id, message) => messages.push(message));
  faux.setResponses([
    async () => {
      await release.promise;
      return fauxAssistantMessage('Initial work finished.');
    },
    ...Array.from({ length: 12 }, () => fauxAssistantMessage('Queued turn finished.')),
  ]);
  const pending = adapter
    .startSession('queue', 'Start', { sessionMode: 'work', workspaceRoot: root, skillIds: [] })
    .catch(error => error);
  cleanup.push(async () => {
    release.resolve();
    await adapter.closeSessions();
    await pending;
  });
  const session = async () => {
    const active = adapter.activeSessions.get('queue');
    if (!active) return undefined;
    return active.piSession as DurableSession;
  };
  const inbox = async () => {
    const native = await session();
    if (!native) return [];
    const { harness, conversation } = native.getDurableHost();
    return (await harness.snapshot(InboxDoc, conversation.id, BACKGROUND_CONTEXT))?.items ?? [];
  };
  const users = async () => {
    const native = await session();
    if (!native) return [];
    const page = await native
      .getDurableHost()
      .conversation.entries({ order: 'ascending' }, 100, undefined, BACKGROUND_CONTEXT);
    return page.items.flatMap(entry =>
      (entry.model ?? []).flatMap(message =>
        message.role === 'user'
          ? [
              typeof message.content === 'string'
                ? message.content
                : message.content.map(block => (block.type === 'text' ? block.text : '')).join(''),
            ]
          : [],
      ),
    );
  };
  const settle = async () => {
    release.resolve();
    await pending;
    const native = await session();
    await native?.getDurableHost().conversation.waitForIdle(BACKGROUND_CONTEXT);
    await adapter.activeSessions.get('queue')?.eventProjection?.drain();
  };
  return { adapter, faux, inbox, users, messages, release, settle, session };
}
