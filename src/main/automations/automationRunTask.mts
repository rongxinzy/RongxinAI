import {
  AssistantEntry,
  defineTask,
  ResetEntry,
  type TaskId,
  type NextTaskState,
} from '@earendil-works/pi-durable';
import { PayloadKind, SessionTarget, TaskStatus } from '../../scheduledTask/constants.js';
import { AutomationDeadline } from './automationDeadline.mjs';
import {
  finishAutomationRun,
  inputJob,
  runRecord,
  type AutomationRunInput,
  type AutomationRunPhase,
  type AutomationRunResult,
} from './automationRunRecords.mjs';
import {
  AutomationDoc,
  AutomationEntry,
  AutomationTaskKind,
  jobJson,
  readJob,
  runJson,
} from './automationState.mjs';

export const AutomationRun = defineTask<
  AutomationRunInput,
  AutomationRunPhase,
  AutomationRunResult
>({
  name: AutomationTaskKind.Run,
  version: 1,
  initial: () => ({ phase: 'acquire' }),
  phases: {
    acquire: async (task, runtime, context) => {
      const snapshot = await runtime.snapshot(AutomationDoc, context);
      const previous = snapshot?.active
        ? await runtime.getTask(snapshot.active as TaskId, context)
        : undefined;
      const stale = previous?.state.status === 'terminal' ? previous.id : null;
      await runtime.commit(
        async (tx): Promise<NextTaskState<AutomationRunPhase, AutomationRunResult>> => {
          const state = await tx.doc(AutomationDoc);
          if (state.removed || state.stopEpoch !== task.input.stopEpoch)
            return {
              status: 'terminal',
              outcome: {
                status: 'completed',
                result: { ok: false, error: 'Automation was stopped before execution.' },
              },
            };
          if (state.active !== null && state.active !== runtime.taskId && state.active !== stale)
            return {
              status: 'waiting',
              on: [state.active as TaskId],
              policy: 'allSettled',
              checkpoint: { phase: 'acquire' },
            };
          const now = runtime.now();
          const job = readJob(state);
          if (!job) throw new Error('Automation definition is missing.');
          state.active = runtime.taskId;
          state.activeError = null;
          state.runCount += 1;
          job.state.runningAtMs = now;
          job.state.lastStatus = TaskStatus.Running;
          job.state.lastError = null;
          state.job = jobJson(job);
          await tx.appendEntry(runtime.conversationId, {
            kind: AutomationEntry.Run,
            data: runJson(runRecord(task.input, now)),
          });
          return { status: 'running', checkpoint: { phase: 'reset', startedAt: now } };
        },
        context,
      );
    },
    reset: async (task, runtime, context) => {
      const conversation = await runtime.conversation(runtime.conversationId, context);
      if (!conversation) throw new Error('Automation conversation is missing.');
      if (inputJob(task.input).sessionTarget === SessionTarget.Isolated) {
        await conversation.waitForIdle(context);
        const reset = await conversation.submit(
          {
            type: 'write',
            requestId: `automation:${task.input.runId}:reset`,
            entry: { kind: ResetEntry.kind, head: 'self' },
          },
          context,
        );
        await reset.wait(context);
      }
      await runtime.commit(
        () => ({
          status: 'running',
          checkpoint: { phase: 'submit', startedAt: task.state.checkpoint.startedAt },
        }),
        context,
      );
    },
    submit: async (task, runtime, context) => {
      const conversation = await runtime.conversation(runtime.conversationId, context);
      if (!conversation) throw new Error('Automation conversation is missing.');
      const job = inputJob(task.input);
      const prompt =
        job.payload.kind === PayloadKind.AgentTurn ? job.payload.message : job.payload.text;
      const timeout =
        job.payload.kind === PayloadKind.AgentTurn ? (job.payload.timeoutSeconds ?? 300) : 300;
      await runtime.commit(
        async (tx): Promise<NextTaskState<AutomationRunPhase, AutomationRunResult>> => {
          const state = await tx.doc(AutomationDoc);
          if (state.removed || state.stopEpoch !== task.input.stopEpoch) {
            const result = await finishAutomationRun(
              tx,
              runtime.conversationId,
              task.input,
              runtime.taskId,
              task.state.checkpoint.startedAt,
              runtime.now(),
              'Automation was stopped before execution.',
            );
            return { status: 'terminal', outcome: { status: 'completed', result } };
          }
          await conversation.submit(tx, {
            type: 'input',
            requestId: `automation:${task.input.runId}:input`,
            content: prompt,
          });
          const deadline = await tx.createTask(
            AutomationDeadline,
            {
              run: runtime.taskId,
              until: task.state.checkpoint.startedAt + timeout * 1000,
              timeoutSeconds: timeout,
            },
            { ownership: { kind: 'task', taskId: runtime.taskId } },
          );
          return {
            status: 'running',
            checkpoint: {
              phase: 'await',
              startedAt: task.state.checkpoint.startedAt,
              deadline,
            },
          };
        },
        context,
      );
    },
    await: async (task, runtime, context) => {
      const conversation = await runtime.conversation(runtime.conversationId, context);
      if (!conversation) throw new Error('Automation conversation is missing.');
      const job = inputJob(task.input);
      const submission = await conversation.submit(
        {
          type: 'input',
          requestId: `automation:${task.input.runId}:input`,
          content:
            job.payload.kind === PayloadKind.AgentTurn ? job.payload.message : job.payload.text,
        },
        context,
      );
      const result = await submission.wait(context);
      await runtime.abortOwned(task.state.checkpoint.deadline as TaskId, context);
      let error =
        result.status === 'done'
          ? null
          : typeof result.detail === 'string'
            ? result.detail
            : `Automation input was unanswered: ${result.reason}`;
      if (result.status === 'done' && result.type !== 'write') {
        const answer = await runtime.entry(AssistantEntry, result.answer, context);
        if (
          answer?.model?.some(
            message => message.role === 'assistant' && message.stopReason === 'length',
          )
        )
          error = 'Model response reached its output token limit; completion is incomplete.';
      }
      await runtime.commit(
        async tx => ({
          status: 'terminal',
          outcome: {
            status: 'completed',
            result: await finishAutomationRun(
              tx,
              runtime.conversationId,
              task.input,
              runtime.taskId,
              task.state.checkpoint.startedAt,
              runtime.now(),
              error,
            ),
          },
        }),
        context,
      );
    },
  },
  abort: async (task, runtime, context) => {
    const state = await runtime.snapshot(AutomationDoc, context);
    if (state?.active === runtime.taskId)
      await (await runtime.conversation(runtime.conversationId, context))?.abort(context);
    const started =
      'startedAt' in task.state.checkpoint ? task.state.checkpoint.startedAt : runtime.now();
    await runtime.commit(
      async (tx): Promise<NextTaskState<AutomationRunPhase, AutomationRunResult>> => {
        await finishAutomationRun(
          tx,
          runtime.conversationId,
          task.input,
          runtime.taskId,
          started,
          runtime.now(),
          'Automation was stopped.',
        );
        return { status: 'terminal', outcome: { status: 'aborted' } };
      },
      context,
    );
  },
});
