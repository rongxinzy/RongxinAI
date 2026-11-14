import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { createModels } from '@earendil-works/pi-ai';
import {
  createRegistry,
  Harness,
  type Conversation,
  type TaskId,
  type Registry,
} from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import type { ScheduledTask } from '../../scheduledTask/types.js';
import { AutomationExtension, AutomationSchedule } from './automationScheduleTask.mjs';
import { AutomationDoc, jobJson, readJob } from './automationState.mjs';

export const automationContext = BACKGROUND_CONTEXT;

/** Inspect a native definition without scheduling work or resolving a model. */
export async function readAutomationFile(file: string): Promise<ScheduledTask | null> {
  const storage = await openNodeSqliteStorage(file);
  const harness = await Harness.open(
    storage,
    {
      models: createModels(),
      registry: createRegistry(),
      readOnly: true,
    },
    automationContext,
  );
  try {
    return readJob(await harness.snapshot(AutomationDoc, automationContext));
  } finally {
    await harness.close(automationContext);
  }
}

export async function writeAutomationDefinition(
  harness: Harness,
  conversation: Conversation,
  job: ScheduledTask,
  reschedule = true,
): Promise<TaskId | null> {
  return await harness.commit(async tx => {
    const state = await tx.doc(AutomationDoc);
    const old = state.scheduler;
    const current = readJob(state);
    if (current)
      job.state = {
        ...current.state,
        nextRunAtMs: reschedule ? job.state.nextRunAtMs : current.state.nextRunAtMs,
      };
    if (!reschedule && current) {
      state.job = jobJson(job);
      return null;
    }
    state.revision += 1;
    state.removed = false;
    job.scheduleVersion = String(state.revision);
    state.job = jobJson(job);
    state.scheduler =
      job.enabled && job.state.nextRunAtMs !== null
        ? await tx.createTask(
            AutomationSchedule,
            { revision: state.revision, at: job.state.nextRunAtMs },
            {
              ownership: { kind: 'conversation' },
              conversationId: conversation.id,
              background: true,
            },
          )
        : null;
    return old as TaskId | null;
  }, automationContext);
}

/** Write the definition and its pending native checkpoint before the model kernel is opened. */
export async function persistAutomationFile(file: string, job: ScheduledTask): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const registry = createRegistry();
  registry.install(AutomationExtension);
  const harness = await Harness.open(
    await openNodeSqliteStorage(file),
    {
      models: createModels(),
      registry,
    },
    automationContext,
  );
  try {
    const conversation = await harness.root(automationContext);
    await writeAutomationDefinition(harness, conversation, job);
    // This metadata transaction intentionally never calls resume() or submit().
  } finally {
    await harness.close(automationContext);
  }
}

export async function persistAutomationPark(file: string, error: string): Promise<void> {
  const registry = createRegistry();
  const harness = await Harness.open(
    await openNodeSqliteStorage(file),
    {
      models: createModels(),
      registry,
    },
    automationContext,
  );
  try {
    await harness.commit(async tx => {
      (await tx.doc(AutomationDoc)).parkedError = error;
    }, automationContext);
  } finally {
    await harness.close(automationContext);
  }
}

/** Paused native storage access; opening a definition never runs a model. */
export async function withAutomationFile<T>(
  file: string,
  operation: (harness: Harness, conversation: Conversation, registry: Registry) => Promise<T>,
  readOnly = false,
): Promise<T> {
  const registry = createRegistry();
  registry.install(AutomationExtension);
  const harness = await Harness.open(
    await openNodeSqliteStorage(file),
    {
      models: createModels(),
      registry,
      readOnly,
    },
    automationContext,
  );
  try {
    const conversation = await harness.root(automationContext);
    return await operation(harness, conversation, registry);
  } finally {
    await harness.close(automationContext);
  }
}
