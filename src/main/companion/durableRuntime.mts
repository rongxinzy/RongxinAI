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
  type Conversation,
  type Submission,
} from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { z } from 'zod';
import { CompanionCapability, CompanionRequestState } from '../../shared/companion/constants.js';
import type {
  CompanionAnswer,
  CompanionAvailability,
  CompanionProfile,
  CompanionReceipt,
} from '../../shared/companion/types.js';
import { CompanionModelAssignment } from './modelAssignment.mjs';
import { companionInstructions } from './personas.js';

const owners = new Set<string>();
const requestIdSchema = z.string().trim().min(1).max(128);
const promptSchema = z.string().trim().min(1).max(32_000);

interface ActiveCompanion {
  petId: string;
  file: string;
  harness: Harness;
  conversation: Conversation;
  models: Models;
  modelId: string | null;
  availability: CompanionAvailability;
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

  constructor(
    private readonly root: string,
    private readonly assignment: CompanionModelAssignment,
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
      const registry = createRegistry();
      registry.install(
        defineExtension({
          name: 'zhiyuan.companion',
          hooks: [
            hook(GenerationTask, {
              afterResponse: message => {
                if (message.stopReason === 'error') this.assignment.failed(message.model);
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
          agent: { instructions: companionInstructions(profile.personaId), tools: [] },
        });
        const active: ActiveCompanion = {
          petId: profile.petId,
          file,
          harness,
          conversation,
          get models() {
            return models;
          },
          set models(value) {
            models = value;
          },
          modelId: null,
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

  private async configure(active: ActiveCompanion): Promise<CompanionAvailability> {
    const resolved = await this.assignment.resolve(active.petId);
    active.models = resolved.models;
    active.modelId = resolved.availability.modelId;
    active.availability = resolved.availability;
    await active.conversation.configure({ model: resolved.model }, context);
    return resolved.availability;
  }

  submit(
    profile: CompanionProfile,
    requestId: string,
    prompt: string,
  ): Promise<CompanionAdmission> {
    return this.serialize(async () => {
      const key = requestIdSchema.parse(requestId);
      const text = promptSchema.parse(prompt);
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
      const availability = await this.configure(active);
      if (!active.modelId) return { availability, receipt: null };
      const submission = await active.conversation.submit(
        { type: 'input', content: text, requestId: key, whenBusy: 'reject' },
        context,
      );
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
        state:
          record.status === 'done'
            ? CompanionRequestState.Answered
            : record.status === 'unanswered'
              ? CompanionRequestState.Unanswered
              : CompanionRequestState.Accepted,
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
      if (active.modelId) active.harness.resume();
      return availability;
    });
  }

  stop(profile: CompanionProfile): Promise<void> {
    return this.serialize(async () => {
      await (await this.open(profile)).conversation.abort(context);
    });
  }

  /** Close pauses unfinished work; only explicit stop withdraws it. */
  async close(): Promise<void> {
    this.closing = true;
    await this.line;
    if (this.active) {
      await this.active.harness.close(context);
      owners.delete(this.active.file);
      this.active = null;
    }
  }
}
