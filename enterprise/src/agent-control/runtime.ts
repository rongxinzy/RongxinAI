import { randomUUID } from 'node:crypto';

import type { ControlEvent, JsonObject } from '@aep/sdk-node';

import type { AgentControlState } from './state.js';
import {
  type AgentControlClient,
  ControlTaskType,
  type InboxItem,
  InboxState,
  type SkillReconciler,
} from './types.js';

const CONTROL_CURSOR_KEY = 'control_cursor';
const DEFAULT_RETRY_DELAY_MS = 5_000;
const MAX_HEARTBEAT_DELAY_MS = 5 * 60_000;
const MAX_ERROR_MESSAGE_LENGTH = 1_024;

export interface AgentControlRuntimeOptions {
  readonly client: AgentControlClient;
  readonly state: AgentControlState;
  readonly reconciler: SkillReconciler;
  readonly agentVersion: string;
  readonly platform: 'windows' | 'macos' | 'linux';
  readonly retryDelayMs?: number;
  readonly now?: () => Date;
  readonly createEventId?: () => string;
  readonly onError?: (error: unknown) => void;
}

export class AgentControlRuntime {
  readonly #options: AgentControlRuntimeOptions;
  readonly #now: () => Date;
  readonly #createEventId: () => string;
  #timer: NodeJS.Timeout | null = null;
  #cycle: Promise<number> | null = null;
  #running = false;

  constructor(options: AgentControlRuntimeOptions) {
    this.#options = options;
    this.#now = options.now ?? (() => new Date());
    this.#createEventId = options.createEventId ?? randomUUID;
  }

  start(): void {
    if (this.#running) return;
    this.#running = true;
    this.#schedule(0);
  }

  async stop(): Promise<void> {
    this.#running = false;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    await this.#cycle?.catch(() => undefined);
  }

  runOnce(): Promise<number> {
    if (this.#cycle) return this.#cycle;
    const cycle = this.#runCycle().finally(() => {
      if (this.#cycle === cycle) this.#cycle = null;
    });
    this.#cycle = cycle;
    return cycle;
  }

  async #runCycle(): Promise<number> {
    await this.flushTelemetry();
    await this.#resumeInbox();
    const heartbeat = await this.#options.client.heartbeat({
      status: 'online',
      lastControlEventCursor: this.#options.state.getValue(CONTROL_CURSOR_KEY),
    });
    if (heartbeat.controlEvents.pending) await this.#receiveControlEvents();
    await this.#resumeInbox();
    await this.flushTelemetry();
    return Math.min(
      MAX_HEARTBEAT_DELAY_MS,
      Math.max(1_000, heartbeat.nextHeartbeatAfterSeconds * 1_000),
    );
  }

  async reconcileSkills(): Promise<void> {
    const result = await this.#options.reconciler.reconcile();
    await this.#options.client.reportSkillSyncResult({
      revision: result.revision,
      status: 'succeeded',
      items: result.items.map(item => ({ skillId: item.skillId, status: item.status })),
    });
  }

  async flushTelemetry(): Promise<void> {
    const events = this.#options.state.listTelemetry();
    if (events.length === 0) return;
    const response = await this.#options.client.uploadEventBatch(events);
    const accepted = Array.isArray(response.accepted) ? response.accepted.map(String) : [];
    this.#options.state.removeTelemetry(accepted);
  }

  #schedule(delayMs: number): void {
    if (!this.#running) return;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      void this.runOnce()
        .then(nextDelay => this.#schedule(nextDelay))
        .catch(error => {
          this.#options.onError?.(error);
          this.#schedule(this.#options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS);
        });
    }, delayMs);
    this.#timer.unref?.();
  }

  async #receiveControlEvents(): Promise<void> {
    let cursor = this.#options.state.getValue(CONTROL_CURSOR_KEY) ?? undefined;
    do {
      const page = await this.#options.client.listControlEvents(cursor);
      for (const event of page.items) {
        this.#options.state.persistInbox(event);
        await this.#options.client.acknowledgeControlEvent(
          event.deliveryId,
          this.#now().toISOString(),
        );
        cursor = event.cursor;
        this.#options.state.setValue(CONTROL_CURSOR_KEY, cursor);
      }
      if (page.nextCursor === null || page.nextCursor === cursor) return;
      cursor = page.nextCursor;
    } while (cursor);
  }

  async #resumeInbox(): Promise<void> {
    for (const item of this.#options.state.listPendingInbox()) {
      await this.#options.client.acknowledgeControlEvent(
        item.deliveryId,
        this.#now().toISOString(),
      );
      await this.#execute(item);
    }
  }

  async #execute(item: InboxItem): Promise<void> {
    if (isExpired(item.event, this.#now())) {
      await this.#reportTerminalFailure(item, 'EVENT_EXPIRED', 'The control event has expired.');
      return;
    }

    if (item.state !== InboxState.Running) {
      this.#options.state.setInboxState(item.deliveryId, InboxState.Running);
      await this.#options.client.reportControlEventResult(item.deliveryId, {
        status: 'running',
        startedAt: this.#now().toISOString(),
      });
    }

    try {
      const appliedRevision = await this.#executeTask(item.event);
      await this.#options.client.reportControlEventResult(item.deliveryId, {
        status: 'succeeded',
        completedAt: this.#now().toISOString(),
        appliedRevision,
      });
      this.#options.state.setInboxState(item.deliveryId, InboxState.Succeeded);
      this.#queueTelemetry(item.event, 'success');
    } catch (error) {
      const message = boundedErrorMessage(error);
      const retryable = !(error instanceof UnsupportedControlTaskError);
      await this.#options.client.reportControlEventResult(item.deliveryId, {
        status: 'failed',
        completedAt: this.#now().toISOString(),
        errorCode: retryable ? 'TASK_FAILED' : 'UNSUPPORTED_TASK',
        message,
        retryable,
      });
      this.#options.state.setInboxState(
        item.deliveryId,
        retryable ? InboxState.Failed : InboxState.Terminal,
      );
      this.#queueTelemetry(item.event, 'failure', message);
    }
  }

  async #executeTask(event: ControlEvent): Promise<string> {
    if (event.task.type !== ControlTaskType.SkillReconcile) {
      throw new UnsupportedControlTaskError(
        `Unsupported enterprise control task ${event.task.type}.`,
      );
    }
    const result = await this.#options.reconciler.reconcile();
    await this.#options.client.reportSkillSyncResult({
      revision: result.revision,
      status: 'succeeded',
      items: result.items.map(item => ({ skillId: item.skillId, status: item.status })),
    });
    return result.revision;
  }

  async #reportTerminalFailure(item: InboxItem, errorCode: string, message: string): Promise<void> {
    await this.#options.client.reportControlEventResult(item.deliveryId, {
      status: 'failed',
      completedAt: this.#now().toISOString(),
      errorCode,
      message,
      retryable: false,
    });
    this.#options.state.setInboxState(item.deliveryId, InboxState.Terminal);
    this.#queueTelemetry(item.event, 'failure', message);
  }

  #queueTelemetry(event: ControlEvent, result: 'success' | 'failure', message?: string): void {
    const telemetry: JsonObject = {
      eventId: this.#createEventId(),
      type: result === 'success' ? 'skill.sync.completed' : 'skill.sync.failed',
      occurredAt: this.#now().toISOString(),
      result,
      data: message ? { message } : {},
    };
    if (event.resource) {
      telemetry.resource = { type: event.resource.type, id: event.resource.id };
    }
    this.#options.state.enqueueTelemetry(telemetry);
  }
}

class UnsupportedControlTaskError extends Error {}

function isExpired(event: ControlEvent, now: Date): boolean {
  const expiresAt = Date.parse(event.expiresAt);
  return !Number.isFinite(expiresAt) || expiresAt <= now.getTime();
}

function boundedErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, MAX_ERROR_MESSAGE_LENGTH);
}
