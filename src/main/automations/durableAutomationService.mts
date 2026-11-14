import { randomUUID } from 'node:crypto';
import type { ScheduledTaskService } from '../../scheduledTask/scheduledTaskService.js';
import type {
  RunFilter,
  ScheduledTask,
  ScheduledTaskInput,
  ScheduledTaskRunWithName,
} from '../../scheduledTask/types.js';
import { createAutomation, normalizeAutomation } from './automationDefinitions.mjs';
import type { DurableAutomationOptions } from './automationHost.mjs';
import { AutomationRegistry, type AutomationRecord } from './automationRegistry.mjs';
import { AutomationRun } from './automationRunTask.mjs';
import { filterAutomationRuns, readAutomationRuns } from './automationRuns.mjs';
import { AutomationDoc, automationSessionId, jobJson, readJob } from './automationState.mjs';
import {
  automationContext,
  persistAutomationFile,
  withAutomationFile,
  writeAutomationDefinition,
} from './automationStorage.mjs';

/** Product API over native task checkpoints and the native conversation transcript. */
export class DurableAutomationService extends AutomationRegistry implements ScheduledTaskService {
  constructor(options: DurableAutomationOptions) {
    super(options);
  }
  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  async addJob(input: ScheduledTaskInput): Promise<ScheduledTask> {
    await this.start();
    const job = createAutomation(input, this.now());
    const file = this.options.fileForSession(automationSessionId(job.id));
    await persistAutomationFile(file, job);
    const record: AutomationRecord = { file, job, session: null, detach: () => {} };
    this.records.set(job.id, record);
    await this.mount(record);
    return structuredClone(record.job);
  }

  async updateJob(id: string, input: Partial<ScheduledTaskInput>): Promise<ScheduledTask> {
    await this.start();
    const record = this.requireRecord(id);
    const prior = record.job;
    const job = normalizeAutomation(
      { ...prior, ...input, state: { ...prior.state } },
      this.now(),
      input.schedule !== undefined || input.enabled === true,
    );
    const bindingChanged =
      job.workspaceId !== prior.workspaceId ||
      (job.payload.kind === 'agentTurn' ? job.payload.model : undefined) !==
        (prior.payload.kind === 'agentTurn' ? prior.payload.model : undefined);
    if (bindingChanged && prior.state.runningAtMs !== null)
      throw new Error('Stop the running automation before changing its model or workspace.');
    const reschedule = input.schedule !== undefined || input.enabled !== undefined;
    if (bindingChanged) {
      await this.stopJob(id);
      await this.unmount(record);
    }
    if (record.session) {
      const { harness, conversation } = record.session.getDurableHost();
      const previous = await writeAutomationDefinition(harness, conversation, job, reschedule);
      if (reschedule && previous !== null) await harness.abortTask(previous, automationContext);
    } else {
      await withAutomationFile(record.file, async (harness, conversation) => {
        await writeAutomationDefinition(harness, conversation, job, reschedule);
      });
    }
    record.job = job;
    if (!record.session) await this.mount(record);
    return structuredClone(record.job);
  }

  async removeJob(id: string): Promise<void> {
    await this.start();
    const record = this.requireRecord(id);
    const remove = async (
      host: ReturnType<NonNullable<AutomationRecord['session']>['getDurableHost']>,
    ) => {
      await host.harness.commit(async tx => {
        const state = await tx.doc(AutomationDoc);
        state.removed = true;
        state.stopEpoch += 1;
        state.revision += 1;
        state.scheduler = null;
        if (state.active !== null) state.activeError = 'Automation was removed.';
      }, automationContext);
      await host.conversation.abort(automationContext, { background: true });
    };
    if (record.session) await remove(record.session.getDurableHost());
    else
      await withAutomationFile(record.file, (harness, conversation, registry) =>
        remove({ harness, conversation, registry }),
      );
    await this.unmount(record);
    this.records.delete(id);
  }

  async listJobs(): Promise<ScheduledTask[]> {
    await this.start();
    return [...this.records.values()].map(record => structuredClone(record.job));
  }
  async getJob(id: string): Promise<ScheduledTask | null> {
    await this.start();
    const record = this.records.get(id);
    return record ? structuredClone(record.job) : null;
  }
  toggleJob(id: string, enabled: boolean): Promise<ScheduledTask> {
    return this.updateJob(id, { enabled });
  }

  async runJob(id: string): Promise<void> {
    await this.start();
    const record = this.requireRecord(id);
    const session = await this.mount(record);
    if (!session)
      throw new Error(
        record.job.state.lastError ?? 'Automation is waiting for its model or workspace.',
      );
    const { harness, conversation } = session.getDurableHost();
    const run = await harness.commit(async tx => {
      const state = await tx.doc(AutomationDoc);
      const job = readJob(state);
      if (!job) throw new Error('Automation was removed.');
      return tx.createTask(
        AutomationRun,
        {
          definition: jobJson(job),
          runId: randomUUID(),
          scheduledAt: this.now(),
          stopEpoch: state.stopEpoch,
        },
        { ownership: { kind: 'conversation' }, conversationId: conversation.id, background: true },
      );
    }, automationContext);
    const result = (await harness.waitForTask(run, automationContext)).state.outcome;
    if (result.status !== 'completed') throw new Error(`Automation ${result.status}.`);
    if (!result.result.ok) throw new Error(result.result.error ?? 'Automation failed.');
  }

  async stopJob(id: string): Promise<boolean> {
    await this.start();
    const record = this.requireRecord(id);
    let stopped = false;
    const stop = async (
      harness: import('@earendil-works/pi-durable').Harness,
      conversation: import('@earendil-works/pi-durable').Conversation,
    ) => {
      const live = await harness.inspect(automationContext);
      stopped = live.tasks.some(task => task.record.kind === AutomationRun.definition.name);
      await harness.commit(async tx => {
        const state = await tx.doc(AutomationDoc);
        state.stopEpoch += 1;
        state.revision += 1;
        state.scheduler = null;
        if (state.active !== null) state.activeError = 'Automation was stopped.';
      }, automationContext);
      // Native abort marks all ownership scopes before any resumable task can execute.
      await conversation.abort(automationContext, { background: true });
      const current = readJob(await harness.snapshot(AutomationDoc, automationContext));
      if (current) {
        const restored = normalizeAutomation(current, this.now());
        await writeAutomationDefinition(harness, conversation, restored);
        record.job = restored;
      }
    };
    if (record.session) {
      const { harness, conversation } = record.session.getDurableHost();
      await stop(harness, conversation);
    } else await withAutomationFile(record.file, stop);
    return stopped;
  }

  private async runs(
    record: AutomationRecord,
    maximum = Infinity,
    filter?: RunFilter,
  ): Promise<ScheduledTaskRunWithName[]> {
    if (record.session)
      return readAutomationRuns(record.session.getDurableHost().conversation, maximum, filter);
    return withAutomationFile(
      record.file,
      (_harness, conversation) => readAutomationRuns(conversation, maximum, filter),
      true,
    );
  }
  async listRuns(
    id: string,
    limit = 50,
    offset = 0,
    filter?: RunFilter,
  ): Promise<ScheduledTaskRunWithName[]> {
    await this.start();
    return filterAutomationRuns(
      await this.runs(this.requireRecord(id), offset + limit, filter),
      filter,
    ).slice(offset, offset + limit);
  }
  async countRuns(id: string): Promise<number> {
    await this.start();
    const record = this.requireRecord(id);
    const count = async (harness: import('@earendil-works/pi-durable').Harness) =>
      (await harness.snapshot(AutomationDoc, automationContext))?.runCount ?? 0;
    if (record.session) return count(record.session.getDurableHost().harness);
    return withAutomationFile(record.file, count, true);
  }
  async listAllRuns(
    limit = 50,
    offset = 0,
    filter?: RunFilter,
  ): Promise<ScheduledTaskRunWithName[]> {
    await this.start();
    const runs = (
      await Promise.all(
        [...this.records.values()].map(record => this.runs(record, offset + limit, filter)),
      )
    ).flat();
    runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    return filterAutomationRuns(runs, filter).slice(offset, offset + limit);
  }
  getJobNameSync(id: string): string | null {
    return this.records.get(id)?.job.name ?? null;
  }
  hasRunningJobs(): boolean {
    return [...this.records.values()].some(record => record.job.state.runningAtMs !== null);
  }
}
