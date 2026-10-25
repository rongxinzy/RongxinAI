import path from 'node:path';
import { mkdir, realpath } from 'node:fs/promises';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createModels, type Models } from '@earendil-works/pi-ai';
import {
  AssistantEntry,
  createRegistry,
  defineExtension,
  GenerationTask,
  Harness,
  hook,
  section,
  type Conversation,
  type Submission,
  type Storage,
} from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { z } from 'zod';
import type { CompanionPreparedImage } from '../../shared/companion/images.js';
import { CompanionImageEntry } from '../../shared/companion/images.js';
import {
  companionImageMetadata,
  companionNeedsImages,
  isCompanionUserEntry,
} from './imageConversation.mjs';
import { CompanionCapability } from '../../shared/companion/constants.js';
import type {
  CompanionAnswer,
  CompanionAvailability,
  CompanionConversation,
  CompanionProfile,
  CompanionReceipt,
} from '../../shared/companion/types.js';
import { CompanionModelAssignment } from './modelAssignment.mjs';
import { companionInstructions } from './personas.js';
import {
  companionMemoryTools,
  companionToolsRejected,
  type CompanionChatMemory,
} from './memoryTools.mjs';

import { CompanionSubmissionActivity } from './submissionActivity.mjs';
import type { CompanionActivity } from './activity.js';
import { companionReplyState, latestCompanionReply } from './replyOutcome.mjs';

const owners = new Set<string>();
const requestIdSchema = z.string().trim().min(1).max(128);
const promptSchema = z.string().trim().max(32_000);

interface ImageInput {
  ids: readonly string[];
  resolve(): Promise<CompanionPreparedImage[]>;
}

interface ActiveCompanion {
  petId: string;
  file: string;
  harness: Harness;
  storage: Storage;
  conversation: Conversation;
  models: Models;
  modelId: string | null;
  availability: CompanionAvailability;
  memoryQuery: string;
  memoryTools: ReturnType<typeof companionMemoryTools>;
}

export interface CompanionAdmission {
  availability: CompanionAvailability;
  /** Present only after Durable has committed the input or found its existing receipt. */
  receipt: CompanionReceipt | null;
}

/** Adapter-owned, single-writer persistent conversations. It installs no independent task tools. */
export class PiCompanionRuntime {
  private active: ActiveCompanion | null = null;
  private line: Promise<unknown> = Promise.resolve();
  private closing = false;
  private readonly activity = new CompanionSubmissionActivity();

  onActivity(listener: (activity: CompanionActivity) => void): () => void {
    return this.activity.subscribe(listener);
  }

  constructor(
    private readonly root: string,
    private readonly assignment: CompanionModelAssignment,
    private readonly memory?: Pick<CompanionChatMemory, 'context'> & Partial<CompanionChatMemory>,
  ) {}

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closing) return Promise.reject(new Error('Companion runtime is closing'));
    const next = this.line.then(operation);
    this.line = next.catch(() => {});
    return next;
  }

  private async open(profile: CompanionProfile): Promise<ActiveCompanion> {
    z.uuid().parse(profile.petId);
    if (this.active?.petId === profile.petId) return this.active;
    if (this.active) {
      this.activity.clear();
      await this.active.harness.close(context);
      owners.delete(this.active.file);
      this.active = null;
    }
    await mkdir(this.root, { recursive: true });
    const file = path.join(await realpath(this.root), `${profile.petId}.sqlite`);
    if (owners.has(file)) throw new Error('Companion storage already has an owner');
    owners.add(file);
    try {
      let models: Models = createModels();
      let memoryQuery = '';
      const memoryTools =
        this.memory?.search && this.memory.save && this.memory.forget
          ? companionMemoryTools(profile.petId, {
              context: this.memory.context.bind(this.memory),
              search: this.memory.search.bind(this.memory),
              save: this.memory.save.bind(this.memory),
              forget: this.memory.forget.bind(this.memory),
            })
          : [];
      const registry = createRegistry();
      registry.install(
        defineExtension({
          name: 'zhiyuan.companion',
          tools: memoryTools,
          sections: this.memory
            ? [
                section('companion-memory', async () => {
                  if (!memoryQuery) return undefined;
                  try {
                    return (await this.memory!.context(profile.petId, memoryQuery)) || undefined;
                  } catch (error) {
                    console.warn(
                      `[CompanionMemory] Recall failed for companion ${profile.petId}:`,
                      error,
                    );
                    return undefined;
                  }
                }),
              ]
            : [],
          hooks: [
            hook(GenerationTask, {
              afterResponse: message => {
                if (message.stopReason === 'error') {
                  if (companionToolsRejected(message.errorMessage ?? ''))
                    this.assignment.observeTools(message.model, false);
                  else this.assignment.failed(message.model);
                } else if (message.content.some(block => block.type === 'toolCall')) {
                  this.assignment.observeTools(message.model, true);
                }
              },
            }),
          ],
        }),
      );
      const storage = await openNodeSqliteStorage(file);
      let harness: Harness;
      try {
        harness = await Harness.open(
          storage,
          {
            models: () => models,
            registry,
            identity: { attribution: null },
            settings: {
              retry: { enabled: false },
              stream: { maxRetries: 0, timeoutMs: 60_000 },
              afterFailedRun: 'withdraw',
            },
          },
          context,
        );
      } catch (error) {
        await storage.close(context);
        throw error;
      }
      try {
        const conversation = await harness.root(context, {
          agent: {
            instructions: companionInstructions(profile.personaId),
            tools: memoryTools,
          },
        });
        const restored = await conversation.entries({}, 32, undefined, context);
        const latestUser = restored.items.find(isCompanionUserEntry);
        memoryQuery =
          latestUser?.model
            ?.flatMap(message =>
              message.role === 'user'
                ? typeof message.content === 'string'
                  ? [message.content]
                  : message.content.flatMap(block => (block.type === 'text' ? [block.text] : []))
                : [],
            )
            .join('\n') ?? '';
        const active: ActiveCompanion = {
          petId: profile.petId,
          file,
          harness,
          storage,
          conversation,
          get models() {
            return models;
          },
          set models(value) {
            models = value;
          },
          modelId: null,
          memoryTools,
          get memoryQuery() {
            return memoryQuery;
          },
          set memoryQuery(value) {
            memoryQuery = value;
          },
          availability: {
            capability: CompanionCapability.Local,
            modelId: null,
            imageInput: false,
            toolUse: false,
          },
        };
        this.active = active;
        return active;
      } catch (error) {
        await harness.close(context);
        throw error;
      }
    } catch (error) {
      owners.delete(file);
      throw error;
    }
  }

  private async configure(active: ActiveCompanion, images = false): Promise<CompanionAvailability> {
    const resolved = await this.assignment.resolve(
      active.petId,
      images || (await companionNeedsImages(active.conversation)),
    );
    active.models = resolved.models;
    active.modelId = resolved.availability.modelId;
    active.availability = resolved.availability;
    const tools =
      active.modelId && this.assignment.permitsTools(active.modelId) ? active.memoryTools : [];
    await active.conversation.configure({ model: resolved.model, tools }, context);
    return resolved.availability;
  }

  submit(
    profile: CompanionProfile,
    requestId: string,
    prompt: string,
    imageInput?: ImageInput,
  ): Promise<CompanionAdmission> {
    return this.serialize(async () => {
      const key = requestIdSchema.parse(requestId);
      const text = promptSchema.parse(prompt);
      if (!text && !imageInput?.ids.length) throw new Error('Companion input is empty');
      const active = await this.open(profile);
      const existing = await active.conversation.commit(
        tx => tx.submissionByRequest(active.conversation.id, key),
        context,
      );
      if (existing) {
        // A retry acknowledges the original receipt even if a model disappeared meanwhile.
        return {
          availability: (await this.assignment.resolve(profile.petId)).availability,
          receipt: { petId: profile.petId, requestId: key, submissionId: existing.id },
        };
      }
      if ((await active.harness.inspect(context)).submissions.length)
        throw new Error('Companion has an unfinished request');
      const availability = await this.configure(active, Boolean(imageInput?.ids.length));
      if (!active.modelId) return { availability, receipt: null };
      const images = imageInput?.ids.length ? await imageInput.resolve() : [];
      if (
        imageInput?.ids.length &&
        (images.length !== new Set(imageInput.ids).size ||
          images.some(image => !imageInput.ids.includes(image.id)))
      )
        throw new Error('Companion image selection changed');
      active.memoryQuery = text;
      const submission = await active.conversation.submit(
        {
          type: 'input',
          content: images.length
            ? [
                ...(text ? [{ type: 'text' as const, text }] : []),
                ...images.map(image => ({
                  type: 'image' as const,
                  data: image.data,
                  mimeType: image.mimeType,
                })),
              ]
            : text,
          ...(images.length
            ? {
                entry: {
                  kind: CompanionImageEntry.User,
                  data: { attachments: images.map(({ id, name }) => ({ id, name })) },
                },
              }
            : {}),
          requestId: key,
          whenBusy: 'reject',
        },
        context,
      );
      this.activity.track(active.petId, submission);
      return {
        availability,
        receipt: { petId: profile.petId, requestId: key, submissionId: submission.id },
      };
    });
  }

  /** Read committed state without starting a model or an idle polling generation. */
  answer(profile: CompanionProfile, receipt: CompanionReceipt): Promise<CompanionAnswer> {
    return this.serialize(async () => {
      const active = await this.open(profile);
      const submission = await this.ownedSubmission(active, receipt);
      const record = await submission.status(context);
      let text = '';
      if (record.type === 'input' && record.status === 'done') {
        const entry = await active.conversation.commit(
          tx => tx.entry(AssistantEntry, record.answer),
          context,
        );
        text =
          entry?.model
            ?.flatMap(message =>
              message.role === 'assistant'
                ? message.content.flatMap(block => (block.type === 'text' ? [block.text] : []))
                : [],
            )
            .join('\n') ?? '';
      }
      return {
        ...receipt,
        state: companionReplyState(record),
        text,
      };
    });
  }

  private async ownedSubmission(
    active: ActiveCompanion,
    receipt: CompanionReceipt,
  ): Promise<Submission> {
    if (receipt.petId !== active.petId) throw new Error('Receipt belongs to another companion');
    const record = await active.conversation.commit(
      tx =>
        tx.submissionByRequest(active.conversation.id, requestIdSchema.parse(receipt.requestId)),
      context,
    );
    if (!record || record.id !== receipt.submissionId) throw new Error('Unknown companion receipt');
    const submission = await active.harness.submission(record.id, context);
    if (!submission) throw new Error('Unknown companion submission');
    return submission;
  }

  resume(profile: CompanionProfile): Promise<CompanionAvailability> {
    return this.serialize(async () => {
      const active = await this.open(profile);
      const inspection = await active.harness.inspect(context);
      if (active.modelId && inspection.scheduling === 'running' && inspection.submissions.length)
        return active.availability;
      const availability = await this.configure(active);
      if (active.modelId) {
        const pending = inspection.submissions.find(item => item.type === 'input');
        if (pending) {
          const submission = await active.harness.submission(pending.id, context);
          if (submission) this.activity.track(active.petId, submission);
        }
        active.harness.resume();
      }
      return availability;
    });
  }

  stop(profile: CompanionProfile): Promise<void> {
    return this.serialize(async () => {
      await (await this.open(profile)).conversation.abort(context);
    });
  }

  history(profile: CompanionProfile): Promise<CompanionConversation> {
    return this.serialize(async () => {
      const active = await this.open(profile);
      const page = await active.conversation.entries({}, 32, undefined, context);
      const pending = (await active.harness.inspect(context)).submissions.find(
        item => item.type === 'input' && item.requestId,
      );
      const lastReply = await latestCompanionReply(
        active.storage,
        active.conversation.id,
        active.petId,
      );
      return {
        ...(lastReply ? { lastReply } : {}),
        messages: [...page.items]
          .reverse()
          .filter(entry => isCompanionUserEntry(entry) || AssistantEntry.is(entry))
          .flatMap(entry =>
            (entry.model ?? []).flatMap(message => {
              if (message.role !== 'user' && message.role !== 'assistant') return [];
              const text =
                typeof message.content === 'string'
                  ? message.content
                  : message.content
                      .flatMap(block => (block.type === 'text' ? [block.text] : []))
                      .join('\n');
              const attachments = companionImageMetadata(entry);
              return text || attachments?.length
                ? [
                    {
                      id: entry.id,
                      role: message.role,
                      text,
                      ...(attachments?.length ? { attachments } : {}),
                    },
                  ]
                : [];
            }),
          ),
        pending: pending
          ? {
              petId: profile.petId,
              requestId: pending.requestId!,
              submissionId: pending.id,
            }
          : null,
      };
    });
  }

  /** Close pauses unfinished work; only explicit stop withdraws it. */
  async close(): Promise<void> {
    this.closing = true;
    await this.line;
    this.activity.clear();
    if (this.active) {
      await this.active.harness.close(context);
      owners.delete(this.active.file);
      this.active = null;
    }
  }
}
