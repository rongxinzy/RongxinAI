import type { EntryId } from '@earendil-works/pi-durable';
import type { ScheduledTask } from '../../scheduledTask/types.js';
import type { AutomationSession, DurableAutomationOptions } from './automationHost.mjs';
import { AutomationExtension } from './automationScheduleTask.mjs';
import { AutomationDoc, AutomationEntry, readJob } from './automationState.mjs';
import {
  automationContext,
  persistAutomationPark,
  readAutomationFile,
} from './automationStorage.mjs';

export interface AutomationRecord {
  file: string;
  job: ScheduledTask;
  session: AutomationSession | null;
  detach: () => void;
}

export class AutomationRegistry {
  protected readonly records = new Map<string, AutomationRecord>();
  private starting: Promise<void> | null = null;
  private readonly mounting = new Map<string, Promise<AutomationSession | null>>();

  constructor(protected readonly options: DurableAutomationOptions) {}

  start(): Promise<void> {
    if (!this.starting) this.starting = this.discover();
    return this.starting;
  }

  /** Resource readiness may change after app startup; retain and reattach native checkpoints. */
  async retryParked(): Promise<void> {
    await this.start();
    for (const record of this.records.values()) {
      if (!record.session) await this.mount(record);
    }
  }

  private async discover(): Promise<void> {
    for (const file of await this.options.listSessionFiles()) {
      try {
        const job = await readAutomationFile(file);
        if (!job || this.records.has(job.id)) continue;
        const record: AutomationRecord = { file, job, session: null, detach: () => {} };
        this.records.set(job.id, record);
        await this.mount(record);
      } catch (error) {
        console.warn('[Automations] Could not inspect execution store:', file, error);
      }
    }
  }

  protected mount(record: AutomationRecord): Promise<AutomationSession | null> {
    if (record.session) return Promise.resolve(record.session);
    const current = this.mounting.get(record.job.id);
    if (current) return current;
    const pending = this.mountOnce(record).finally(() => this.mounting.delete(record.job.id));
    this.mounting.set(record.job.id, pending);
    return pending;
  }

  private async mountOnce(record: AutomationRecord): Promise<AutomationSession | null> {
    try {
      const session = await this.options.openAutomationSession(record.job, record.file);
      const { harness, registry, conversation } = session.getDurableHost();
      registry.install(AutomationExtension);
      record.session = session;
      await harness.commit(async tx => {
        (await tx.doc(AutomationDoc)).parkedError = null;
      }, automationContext);
      const state = await harness.observeDoc(
        AutomationDoc,
        {
          advance: call => {
            if (call.kind !== 'value') return;
            const job = readJob(call.value);
            if (!job) return;
            record.job = job;
            try {
              this.options.onTaskState?.(job.id, job.state);
            } catch (error) {
              console.warn('[Automations] State listener failed:', error);
            }
          },
          end: () => {},
        },
        automationContext,
      );
      const initial = readJob(state?.value);
      if (initial) record.job = initial;
      const known = new Set<EntryId>();
      const entries = await harness.observeConversation(
        conversation.id,
        {
          advance: call => {
            if (call.kind !== 'value') return;
            const visible = new Set(call.value.entries.map(entry => entry.id));
            for (const id of known) if (!visible.has(id)) known.delete(id);
            for (const entry of call.value.entries) {
              if (known.has(entry.id) || entry.kind !== AutomationEntry.Run) continue;
              known.add(entry.id);
              try {
                this.options.onRun?.(
                  entry.data as unknown as Parameters<
                    NonNullable<DurableAutomationOptions['onRun']>
                  >[0],
                );
              } catch (error) {
                console.warn('[Automations] Run listener failed:', error);
              }
            }
          },
          end: () => {},
        },
        automationContext,
      );
      for (const entry of entries.value.entries) known.add(entry.id);
      record.detach = () => {
        state?.detach();
        entries.detach();
      };
      harness.resume();
      return session;
    } catch (error) {
      record.detach();
      await record.session
        ?.close()
        .catch(closeError =>
          console.warn('[Automations] Close after failed preparation failed:', closeError),
        );
      record.session = null;
      const reason = error instanceof Error ? error.message : String(error);
      await persistAutomationPark(record.file, reason);
      record.job.state.lastError = reason;
      try {
        this.options.onTaskState?.(record.job.id, record.job.state);
      } catch (listenerError) {
        console.warn('[Automations] State listener failed:', listenerError);
      }
      console.warn(`[Automations] Parked automation ${record.job.id}:`, error);
      return null;
    }
  }

  protected async unmount(record: AutomationRecord): Promise<void> {
    record.detach();
    await record.session?.close();
    record.session = null;
  }

  protected requireRecord(id: string): AutomationRecord {
    const record = this.records.get(id);
    if (!record) throw new Error(`Automation not found: ${id}`);
    return record;
  }

  async stop(): Promise<void> {
    await this.starting;
    await Promise.all(this.mounting.values());
    for (const record of this.records.values()) await this.unmount(record);
    this.records.clear();
    this.starting = null;
  }
}
