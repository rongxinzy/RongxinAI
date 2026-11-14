import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { AssistantEntry, InboxDoc, type Submission } from '@earendil-works/pi-durable';
import type { ModelThinkingLevel } from '@earendil-works/pi-ai';
import { updateDurableRuntimeOptions } from './durableSessionMetadata.mjs';
import { DurableEventProjector } from './durableEventProjector.mjs';
import type { PiEvent, PiSession } from './piRuntimeSessionState.js';
import { appendDurableContextEdit, forkDurableConversation } from './durableSessionActions.mjs';
import { claimDurableStorage, releaseDurableStorage } from './durableSessionOwnership.js';
import { DurableSessionHost, type DurableSessionOptions } from './durableSessionHost.mjs';
export type { DurableSessionOptions } from './durableSessionHost.mjs';
const context = BACKGROUND_CONTEXT;
/** Application lifecycle and UI binding; every execution step belongs to the native Harness. */
export class DurableSession extends DurableSessionHost implements PiSession {
  private readonly listeners = new Set<(event: PiEvent) => void>();
  private readonly projector = new DurableEventProjector(event => {
    for (const listener of this.listeners) listener(event);
  });
  private detach = (): void => {};
  private closePromise: Promise<void> | null = null;
  private cleanupPromise: Promise<void> | null = null;
  private finishInitialization!: () => void;
  private readonly initialized = new Promise<void>(resolve => {
    this.finishInitialization = resolve;
  });
  private readonly submissions = new Set<Submission>();

  private constructor(options: DurableSessionOptions) {
    super(options);
  }

  get closing(): Promise<void> | null {
    return this.closePromise;
  }
  get storageClosed(): boolean {
    return this.nativeStorageClosed;
  }

  static async open(options: DurableSessionOptions): Promise<DurableSession> {
    if (!options.modelRuntime?.models) throw new Error('Durable model catalog is missing.');
    const session = new DurableSession(options);
    if (options.durableFile) await claimDurableStorage(options.durableFile, session);
    try {
      if (options.durableFile) await mkdir(path.dirname(options.durableFile), { recursive: true });
      await session.initializeNative();
      await session.observe();
      return session;
    } catch (error) {
      session.closePromise = session.disposeNativeResources();
      try {
        await session.closePromise;
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          error instanceof Error ? error.message : 'Native session initialization failed.',
        );
      }
      throw error;
    } finally {
      session.finishInitialization();
    }
  }

  private async observe(): Promise<void> {
    const observation = await this.harness.observeConversation(
      this.conversation.id,
      {
        advance: call => {
          if (call.kind === 'value') this.projector.advance(call.value, call.ops);
        },
        end: end => {
          if (end.kind === 'failed') console.error('[DurableRuntime] observation failed:', end);
        },
      },
      context,
    );
    this.projector.seed(observation.value);
    this.detach = observation.detach;
  }

  get messages() {
    return this.projector.messages;
  }

  subscribe(listener: (event: PiEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async prompt(
    text: string,
    options?: { streamingBehavior?: 'steer' | 'followUp' },
  ): Promise<void> {
    await this.sendUserMessage(text, { deliverAs: options?.streamingBehavior });
  }

  async sendUserMessage(
    content: Parameters<NonNullable<PiSession['sendUserMessage']>>[0],
    options?: { deliverAs?: 'steer' | 'followUp' },
  ): Promise<void> {
    const submission = await this.conversation.submit(
      {
        type: 'input',
        content,
        requestId: randomUUID(),
        whenBusy: options?.deliverAs ?? 'followUp',
      },
      context,
    );
    this.submissions.add(submission);
    try {
      const settled = await submission.wait(context);
      if (settled.status === 'unanswered' && settled.reason !== 'aborted')
        throw new Error(typeof settled.detail === 'string' ? settled.detail : settled.reason);
      if (settled.status === 'done' && settled.type !== 'write') {
        const entry = await this.harness.commit(
          tx => tx.entry(AssistantEntry, settled.answer),
          context,
        );
        if (
          entry?.model?.some(
            message => message.role === 'assistant' && message.stopReason === 'length',
          )
        )
          throw new Error(
            'Model response reached its output token limit; completion is incomplete.',
          );
      }
    } finally {
      this.submissions.delete(submission);
    }
  }

  steer(text: string): Promise<void> {
    return this.sendUserMessage(text, { deliverAs: 'steer' });
  }
  followUp(text: string): Promise<void> {
    return this.sendUserMessage(text, { deliverAs: 'followUp' });
  }

  async clearQueue(): Promise<{ steering: string[]; followUp: string[] }> {
    if (this.closePromise) return { steering: [], followUp: [] };
    try {
      // Withdraw the current native inbox in ONE commit. A snapshot followed by
      // individual aborts can interleave with edits/re-enqueues and replay deleted input.
      await this.harness.commit(async tx => {
        const inbox = await tx.doc(InboxDoc, this.conversation.id);
        for (let index = inbox.items.length - 1; index >= 0; index--) {
          const item = inbox.items[index];
          if (item.mode === 'write') continue;
          tx.settleSubmission(item.id, { status: 'unanswered', reason: 'aborted' });
          inbox.items.splice(index, 1);
        }
      }, context);
    } catch (error) {
      if (!this.closePromise) throw error;
    }
    return { steering: [], followUp: [] };
  }

  async resume(): Promise<void> {
    this.harness.resume();
    await this.conversation.waitForIdle(context);
  }

  async abort(): Promise<void> {
    if (this.closePromise) return;
    try {
      await this.conversation.abort(context);
    } catch (error) {
      if (!this.closePromise) throw error;
    }
  }
  abortBash(): void {
    void this.abort().catch(error => console.warn('[DurableRuntime] abort failed:', error));
  }

  async reload(): Promise<void> {
    await this.options.resourceLoader?.reload();
    this.installResources();
    await this.configure();
  }

  async setModel(model: unknown): Promise<void> {
    this.options.model = model as Record<string, unknown>;
    await this.configure();
  }

  async setThinkingLevel(level: string): Promise<void> {
    this.options.thinkingLevel = level as ModelThinkingLevel;
    await this.configure();
  }

  getSessionStats() {
    return this.harness.usage(context);
  }

  getContextUsage() {
    const usage = this.messages.findLast(
      message => message.role === 'assistant' && message.usage,
    )?.usage;
    const contextWindow = Number(this.options.model.contextWindow) || 0;
    const tokens = usage ? usage.input + usage.output + usage.cacheRead + usage.cacheWrite : null;
    return {
      tokens,
      contextWindow,
      percent: tokens !== null && contextWindow ? (tokens / contextWindow) * 100 : null,
    };
  }

  appendContextEdit(targetId: string, replacement: { content: unknown } | null) {
    return appendDurableContextEdit(this.conversation, targetId, replacement);
  }

  async navigateTree(targetId: string) {
    const fork = await forkDurableConversation(this.harness, this.conversation, targetId);
    this.detach();
    this.conversation = fork;
    this.options.memoryBinding?.bindConversation(this.conversation);
    await this.observe();
    return { cancelled: false };
  }

  async compact(instructions?: string): Promise<{ cancelled: boolean }> {
    const task = await this.conversation.compact(instructions, context);
    const outcome = await this.harness.waitForTask(task, context);
    return { cancelled: outcome.state.outcome.status !== 'completed' };
  }

  async updateRuntimeOptions(change: Record<string, unknown>): Promise<void> {
    await updateDurableRuntimeOptions(this.harness, change);
  }

  private disposeNativeResources(): Promise<void> {
    this.cleanupPromise ??= this.cleanupNativeResources();
    return this.cleanupPromise;
  }

  private async cleanupNativeResources(): Promise<void> {
    this.detach();
    const errors: unknown[] = [];
    try {
      await this.harness?.close(context);
    } catch (error) {
      errors.push(error);
    }
    try {
      await this.options.resourceLoader?.close?.();
    } catch (error) {
      errors.push(error);
    } finally {
      // A failed resource worker must not retain a CLOSED SQLite owner. A failed
      // backend close retains ownership: Harness.closed alone does not prove safety.
      if (this.nativeStorageClosed && this.options.durableFile)
        releaseDurableStorage(this.options.durableFile, this);
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length) throw new AggregateError(errors, 'Native session cleanup failed.');
  }

  close(): Promise<void> {
    this.closePromise ??= this.initialized.then(() => this.disposeNativeResources());
    return this.closePromise;
  }

  dispose(): void {
    void this.close().catch(error => console.error('[DurableRuntime] close failed:', error));
  }
}

export async function createDurableSession(
  options: Record<string, unknown>,
): Promise<{ session: DurableSession }> {
  return { session: await DurableSession.open(options as unknown as DurableSessionOptions) };
}
