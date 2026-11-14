import { randomUUID } from 'node:crypto';
import { defineExtension, defineTask, type NextTaskState } from '@earendil-works/pi-durable';
import { ScheduleKind } from '../../scheduledTask/constants.js';
import { AutomationDeadline } from './automationDeadline.mjs';
import { AutomationRun } from './automationRunTask.mjs';
import { nextAutomationTime } from './automationSchedule.mjs';
import { AutomationDoc, AutomationTaskKind, jobJson, readJob } from './automationState.mjs';

type ScheduleInput = { revision: number; at: number };
type SchedulePhase = { phase: 'wait'; at: number } | { phase: 'launch'; at: number };

export const AutomationSchedule = defineTask<ScheduleInput, SchedulePhase, null>({
  name: AutomationTaskKind.Schedule,
  version: 1,
  initial: input => ({ phase: 'wait', at: input.at }),
  phases: {
    wait: async (task, runtime, context) => {
      await runtime.sleepUntil(
        task.state.checkpoint.at,
        { phase: 'launch', at: task.state.checkpoint.at },
        context,
      );
    },
    launch: async (task, runtime, context) => {
      await runtime.commit(async (tx): Promise<NextTaskState<SchedulePhase, null>> => {
        const state = await tx.doc(AutomationDoc);
        const job = readJob(state);
        if (!job || !job.enabled || state.revision !== task.input.revision)
          return { status: 'terminal', outcome: { status: 'completed', result: null } };
        if (state.active === null || job.schedule.kind === ScheduleKind.At) {
          await tx.createTask(
            AutomationRun,
            {
              definition: jobJson(job),
              runId: randomUUID(),
              scheduledAt: task.state.checkpoint.at,
              stopEpoch: state.stopEpoch,
            },
            { ownership: { kind: 'conversation' }, background: true },
          );
        }
        const next =
          job.schedule.kind === ScheduleKind.At
            ? null
            : nextAutomationTime(
                job.schedule,
                Math.max(runtime.now(), task.state.checkpoint.at),
                job.id,
              );
        job.state.nextRunAtMs = next;
        state.job = jobJson(job);
        if (next === null) {
          state.scheduler = null;
          return { status: 'terminal', outcome: { status: 'completed', result: null } };
        }
        return { status: 'sleeping', until: next, checkpoint: { phase: 'launch', at: next } };
      }, context);
    },
  },
  abort: async (_task, runtime, context) => {
    await runtime.commit(() => ({ status: 'terminal', outcome: { status: 'aborted' } }), context);
  },
});

export const AutomationExtension = defineExtension({
  name: 'zhiyuan.automations',
  tasks: [AutomationSchedule, AutomationRun, AutomationDeadline],
});
