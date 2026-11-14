import { createHash } from 'node:crypto';
import type { Dirent } from 'node:fs';
import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import {
  createMemory,
  type MemoryHost,
  type MemoryWiring,
  type RunSettledEvent,
  type MemoryEventApi,
} from '@sigrun/memory-markdown';
import type { Context } from '@earendil-works/chord/context';
import type { Conversation, Extension } from '@earendil-works/pi-durable';
import { PERSONAL_MEMORY_PROJECT_ID } from '../../shared/memory';
import type { Message } from '@earendil-works/pi-ai';
import { captureNativeMemoryRequestForE2e } from './memoryPromptE2eCapture';

type CurationTarget = MemoryWiring['curationTargets'][number];
export type MemoryMaintenanceBudget = Parameters<CurationTarget['maintain']>[2];

export interface DurableMemoryBinding {
  readonly extension: Extension;
  bindConversation(conversation: Conversation): void;
  runSettled(event: RunSettledEvent, api: MemoryEventApi, context: Context): void | Promise<void>;
  captureRequest?(messages: readonly Message[]): Promise<void>;
  maintain(
    budget: MemoryMaintenanceBudget,
    context: Context,
  ): ReturnType<CurationTarget['maintain']>;
}

/** Hosts the upstream Durable extension; Markdown files are the long-term store. */
export class MarkdownMemoryRuntime {
  private readonly shared: Promise<MemoryWiring>;

  constructor(private readonly root: string) {
    this.shared = createMemory(this.host());
  }

  private host(owner?: string): MemoryHost {
    return {
      settings: {
        declare: <S>() => ({
          // The upstream defaults, including its bounded prompt section.
          get: async () => ({ limits: { user: 1375, memory: 2200 } }) as S,
        }),
      },
      stores: {
        user: scope => ({ paths: { data: this.directory(scope) } }),
      },
      // This closure belongs to ONE Harness. Numeric conversation ids are not
      // globally unique and must never be used as a global ownership lookup.
      identity: { actingUser: async () => owner },
    };
  }

  directory(owner: string): string {
    if (!owner.trim()) throw new Error('A trusted memory owner is required.');
    const key = createHash('sha256').update(owner).digest('hex');
    return path.join(this.root, key);
  }

  async files(owner: string) {
    return (await this.shared).files(owner);
  }

  async undo(owner: string, changeId: string, context: Context): Promise<void> {
    await (await this.shared).curationTargets[0].undo(owner, changeId, context);
  }

  async purgeUndoHistory(owner: string): Promise<void> {
    // Removing one fact also removes snapshots containing it. Other current
    // facts remain intact; the scope's prior undo history is deliberately lost.
    const directory = this.directory(owner);
    await rm(path.join(directory, 'versions'), { recursive: true, force: true });
    // SIGKILL cannot run the atomic writer's finally block. Its noncanonical
    // staging bytes must also disappear when this scope is hard-deleted.
    const entries = await readdir(directory, { withFileTypes: true }).catch(
      (error: NodeJS.ErrnoException): Dirent[] => {
        if (error.code === 'ENOENT') return [];
        throw error;
      },
    );
    for (const entry of entries) {
      if (/^(USER|MEMORY)\.md\.[a-f0-9-]{36}\.tmp$/.test(entry.name))
        await rm(path.join(directory, entry.name), { force: true });
    }
  }

  async maintain(owner: string, budget: MemoryMaintenanceBudget, context: Context) {
    return (await this.shared).curationTargets[0].maintain(owner, context, budget);
  }

  async createBinding(
    owner: string,
    beforeRead?: () => Promise<void>,
    sessionId?: string,
  ): Promise<DurableMemoryBinding> {
    this.directory(owner);
    // Each Harness gets an independent native transcript backend. All writes
    // and curation use the shared factory's per-owner serialized MemoryFiles.
    const wiring = await createMemory(this.host(owner));
    const personal = await createMemory(this.host(PERSONAL_MEMORY_PROJECT_ID));
    const readers = new Map<number, MemoryEventApi['entries']>();
    const extension: Extension = {
      ...wiring.extension,
      // Upstream defines memory_write as curator-only. Ordinary Work exposes
      // native recall; explicit writes still pass the product confirmation API.
      tools: wiring.extension.tools?.filter(tool => tool.name !== 'memory_write'),
      sections: [
        ...(wiring.extension.sections ?? []),
        ...(personal.extension.sections ?? []).map(section => ({
          ...section,
          key: 'personal-long-term-memory',
        })),
      ].map(section => ({
        ...section,
        render: async (input, context) => {
          await beforeRead?.();
          return section.render(input, context);
        },
      })),
    };
    return {
      extension,
      bindConversation(conversation) {
        const entries = conversation.entries.bind(conversation);
        readers.set(conversation.id, entries);
        wiring.backend.bindRecallSource({
          id: conversation.id,
          entries,
        });
      },
      runSettled: (event, api, context) => {
        const entries = readers.get(event.conversationId);
        // Hook APIs expire after invocation. Only a persistent Conversation
        // reader may be retained by the upstream backend for later recall.
        if (entries) return wiring.runSettled({ ...event, owner }, { ...api, entries }, context);
      },
      maintain: (budget, context) => this.maintain(owner, budget, context),
      captureRequest: sessionId
        ? messages => captureNativeMemoryRequestForE2e({ sessionId, messages })
        : undefined,
    };
  }
}
