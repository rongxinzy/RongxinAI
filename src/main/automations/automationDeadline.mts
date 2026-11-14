import { defineTask } from '@earendil-works/pi-durable';
import { AutomationDoc, AutomationTaskKind } from './automationState.mjs';

type DeadlineInput = { run: number; until: number; timeoutSeconds: number };
type DeadlinePhase = { phase: 'wait' } | { phase: 'abort' };

export const AutomationDeadline = defineTask<DeadlineInput, DeadlinePhase, null>({
  name: AutomationTaskKind.Deadline,
  version: 1,
  initial: () => ({ phase: 'wait' }),
  phases: {
    wait: async (task, runtime, context) => {
      await runtime.sleepUntil(task.input.until, { phase: 'abort' }, context);
    },
    abort: async (task, runtime, context) => {
      let active = false;
      await runtime.commit(async tx => {
        const state = await tx.doc(AutomationDoc);
        active = state.active === task.input.run;
        if (active) state.activeError = `Automation timed out after ${task.input.timeoutSeconds}s.`;
        return { status: 'running', checkpoint: { phase: 'abort' } };
      }, context);
      if (active)
        await (await runtime.conversation(runtime.conversationId, context))?.abort(context);
      await runtime.commit(
        () => ({ status: 'terminal', outcome: { status: 'completed', result: null } }),
        context,
      );
    },
  },
  abort: async (_task, runtime, context) => {
    await runtime.commit(() => ({ status: 'terminal', outcome: { status: 'aborted' } }), context);
  },
});
