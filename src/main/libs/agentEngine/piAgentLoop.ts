/**
 * Pi Agent Loop
 *
 * Long-horizon loop mechanism for Pi SDK (in-process) cowork sessions.
 * Ports the core semantics of the pi-agent-loop package to the embedded Pi
 * runtime: the LLM drives a multi-iteration loop through the `agent_loop`
 * tool, and the adapter continues the session at agent_end instead of the
 * package's sendMessage(triggerTurn) mechanism.
 *
 * Modes:
 *   goal     — open-ended; the LLM decides when the goal is met (action done)
 *   passes   — fixed N refinement passes; the final pass auto-completes
 *   pipeline — ordered stages, one per iteration; the last stage auto-completes
 *
 * Lifecycle:
 *   1. The LLM calls agent_loop {action: "start", ...} inside a normal turn.
 *      That turn is iteration 1.
 *   2. At the end of each iteration the LLM calls agent_loop with action
 *      "next" (more work) or "done" (goal met).
 *   3. PiRuntimeAdapter asks controller.handleAgentEnd() on agent_end; when
 *      the previous iteration ended with "next", it prompts the Pi session
 *      with the next-iteration prompt instead of completing the session.
 *
 * Generic loops are memory-only. Academic-research loops additionally attach
 * a persistent PiResearchRunController, which owns the evidence and review
 * gates before a model may finish.
 */

import { HarnessActivationType, type HarnessActivationEvent } from '../../../shared/harness';

// ── Constants ──

export const PiAgentLoopToolName = 'agent_loop';

/** Hard cap on total loop iterations (the start turn counts as iteration 1). */
export const AGENT_LOOP_MAX_ITERATIONS = 20;

export const PiAgentLoopAction = {
  Start: 'start',
  Next: 'next',
  Done: 'done',
} as const;
export type PiAgentLoopAction = (typeof PiAgentLoopAction)[keyof typeof PiAgentLoopAction];

export const PiAgentLoopMode = {
  Goal: 'goal',
  Passes: 'passes',
  Pipeline: 'pipeline',
} as const;
export type PiAgentLoopMode = (typeof PiAgentLoopMode)[keyof typeof PiAgentLoopMode];

// ── Types ──

export interface PiAgentLoopState {
  /** A loop has been started and not yet finished or stopped. */
  active: boolean;
  /** The loop finished (LLM done, auto-complete, limit, or stop). */
  done: boolean;
  mode: PiAgentLoopMode;
  goal: string;
  /** Total passes for passes mode. */
  passes: number;
  /** Ordered stage names for pipeline mode. */
  stages: string[];
  /** 0-based index of the iteration currently in progress. */
  currentStep: number;
  reasonDone?: string;
  lastSummary?: string;
}

export interface PiAgentLoopContinueDecision {
  shouldContinue: boolean;
  nextPrompt?: string;
}

/**
 * What the domain completion workflow needs to know when an iteration ends:
 * whether the model explicitly signaled `agent_loop next` (with its summary)
 * or ended the turn without a loop signal (a protocol omission).
 */
export interface PiAgentLoopEndSignal {
  next: boolean;
  summary?: string;
}

interface PiAgentLoopToolResult {
  content: Array<{ type: 'text'; text: string }>;
  details: Record<string, unknown>;
}

interface StartParams {
  mode: PiAgentLoopMode;
  goal: string;
  passes: number;
  stages: string[];
}

// ── Controller ──

/**
 * Per-cowork-session loop state machine. One instance is created per
 * PiRuntimeAdapter session and shared between the agent_loop tool and the
 * adapter's agent_end handling.
 */
export class PiAgentLoopController {
  private state: PiAgentLoopState = {
    active: false,
    done: false,
    mode: PiAgentLoopMode.Goal,
    goal: '',
    passes: 0,
    stages: [],
    currentStep: 0,
  };

  /** True when the current iteration ended with action "next". */
  private pendingNext = false;
  /**
   * True while the final (wrap-up) iteration issued after reaching
   * AGENT_LOOP_MAX_ITERATIONS is in flight; the next agent_end force-closes
   * the loop regardless of what the LLM signals.
   */
  private wrapUpPending = false;

  constructor(
    private readonly researchRun?: {
      onAgentEnd(signal: PiAgentLoopEndSignal): {
        shouldFinish: boolean;
        reason?: string;
        nextPrompt?: string;
      };
      requestCompletion(reason: string): string;
    },
    private readonly onActivation?: (event: HarnessActivationEvent) => void,
  ) {}

  /** Read-only snapshot of the current loop state. */
  getState(): PiAgentLoopState {
    return { ...this.state, stages: [...this.state.stages] };
  }

  /** Start (or restart) a loop. Any active loop is replaced. */
  start(params: StartParams): string {
    const replaced = this.state.active;
    this.state = {
      active: true,
      done: false,
      mode: params.mode,
      goal: params.goal,
      passes: params.passes,
      stages: params.stages,
      currentStep: 0,
    };
    this.pendingNext = false;
    this.wrapUpPending = false;
    console.log(
      `[PiAgentLoop] started ${params.mode} loop${replaced ? ' (replacing the previous loop)' : ''}`,
    );
    const position = this.describePosition();
    const prefix = replaced ? 'Previous loop replaced. New loop started. ' : 'Loop started. ';
    return (
      `${prefix}${position}\n` +
      'Work on this iteration now. When finished, call agent_loop with action "next" ' +
      '(more work remains) or "done" (the goal is fully met).'
    );
  }

  /** Signal that the current iteration finished and more work remains. */
  next(summary: string): string {
    if (!this.state.active) {
      return 'No active loop. Start one with agent_loop action "start".';
    }
    this.state.lastSummary = summary;

    // Auto-complete when the final pass/stage just finished.
    if (this.isFinalStep(this.state.currentStep)) {
      this.finish(
        `Completed all ${this.state.mode === PiAgentLoopMode.Passes ? 'passes' : 'stages'}`,
      );
      return `Loop complete — all iterations done. Final summary: ${summary}`;
    }

    this.pendingNext = true;
    console.debug(
      `[PiAgentLoop] iteration ${this.state.currentStep + 1} ended with next: ${summary}`,
    );
    return (
      `Iteration ${this.state.currentStep + 1} recorded. ` +
      'End your turn now; the next iteration will start automatically.'
    );
  }

  /** Signal that the goal is met and close the loop. */
  done(reason: string): string {
    if (!this.state.active) {
      return 'No active loop. Start one with agent_loop action "start".';
    }
    if (this.researchRun) {
      this.state.lastSummary = reason;
      return this.researchRun.requestCompletion(reason);
    }
    this.finish(reason);
    return `Loop complete after ${this.state.currentStep + 1} iteration(s). Reason: ${reason}`;
  }

  /**
   * Called by the adapter on agent_end. When the finished iteration signaled
   * "next", returns the prompt for the following iteration; otherwise the
   * session is allowed to complete.
   */
  handleAgentEnd(): PiAgentLoopContinueDecision {
    if (!this.state.active) {
      return { shouldContinue: false };
    }

    if (this.researchRun) {
      const researchDecision = this.researchRun.onAgentEnd({
        next: this.pendingNext,
        summary: this.state.lastSummary,
      });
      if (researchDecision.shouldFinish) {
        this.finish(researchDecision.reason || 'Academic research completion gate passed');
        return { shouldContinue: false };
      }
      this.state.currentStep += 1;
      this.pendingNext = false;

      // The wrap-up iteration just ended — close the loop unconditionally,
      // even if the domain workflow keeps nudging.
      if (this.wrapUpPending) {
        this.finish(
          `Iteration limit of ${AGENT_LOOP_MAX_ITERATIONS} reached; loop closed after the wrap-up iteration`,
        );
        console.warn(
          `[PiAgentLoop] force-closed loop after the ${AGENT_LOOP_MAX_ITERATIONS}-iteration limit`,
        );
        return { shouldContinue: false };
      }

      // The iteration-limit safety cap applies to completion-workflow loops
      // too: the last allowed iteration becomes a forced wrap-up turn.
      if (this.state.currentStep >= AGENT_LOOP_MAX_ITERATIONS - 1) {
        this.wrapUpPending = true;
        this.onActivation?.({
          activation: HarnessActivationType.RecoveryTriggered,
          iteration: this.state.currentStep + 1,
          mechanism: 'iteration_limit_wrap_up',
        });
        return { shouldContinue: true, nextPrompt: this.buildWrapUpPrompt() };
      }
      return {
        shouldContinue: true,
        nextPrompt:
          researchDecision.nextPrompt ||
          'Continue the academic research run and follow its persisted evidence protocol.',
      };
    }

    // The dedicated wrap-up turn is the only generic-loop exception: it is
    // intentionally terminal after the safety cap, even if the model omits a
    // final tool call.
    if (this.wrapUpPending) {
      this.finish(
        `Iteration limit of ${AGENT_LOOP_MAX_ITERATIONS} reached; loop closed after the wrap-up iteration`,
      );
      return { shouldContinue: false };
    }

    // A loop is a protocol, not a suggestion. If a model ends its turn without
    // next/done, keep the loop alive and make the omission visible in the next
    // prompt instead of silently emitting a completed session.
    if (!this.pendingNext) {
      const nextStep = this.state.currentStep + 1;
      this.onActivation?.({
        activation: HarnessActivationType.PrematureFinalizeBlocked,
        iteration: nextStep,
        mechanism: 'agent_loop_protocol',
      });
      this.state.currentStep = nextStep;
      if (nextStep >= AGENT_LOOP_MAX_ITERATIONS - 1) {
        this.wrapUpPending = true;
        this.onActivation?.({
          activation: HarnessActivationType.RecoveryTriggered,
          iteration: nextStep + 1,
          mechanism: 'iteration_limit_wrap_up',
        });
        return { shouldContinue: true, nextPrompt: this.buildWrapUpPrompt() };
      }
      return {
        shouldContinue: true,
        nextPrompt:
          `## Agent Loop — protocol omission\nYou ended iteration ${nextStep} without calling agent_loop next or done. ` +
          'The loop remains active. Continue the work now, then call next or done explicitly.\n\n' +
          this.buildIterationPrompt(nextStep),
      };
    }

    // The wrap-up iteration just ended — close the loop unconditionally.
    if (this.wrapUpPending) {
      this.finish(
        `Iteration limit of ${AGENT_LOOP_MAX_ITERATIONS} reached; loop closed after the wrap-up iteration`,
      );
      console.warn(
        `[PiAgentLoop] force-closed loop after the ${AGENT_LOOP_MAX_ITERATIONS}-iteration limit`,
      );
      return { shouldContinue: false };
    }

    const nextStep = this.state.currentStep + 1;
    this.state.currentStep = nextStep;
    this.pendingNext = false;

    // The last allowed iteration becomes a wrap-up turn; the loop is
    // force-closed when it ends.
    if (nextStep >= AGENT_LOOP_MAX_ITERATIONS - 1) {
      this.wrapUpPending = true;
      this.onActivation?.({
        activation: HarnessActivationType.RecoveryTriggered,
        iteration: nextStep + 1,
        mechanism: 'iteration_limit_wrap_up',
      });
      console.warn(
        `[PiAgentLoop] reached the ${AGENT_LOOP_MAX_ITERATIONS}-iteration limit, issuing wrap-up iteration`,
      );
      return { shouldContinue: true, nextPrompt: this.buildWrapUpPrompt() };
    }

    return { shouldContinue: true, nextPrompt: this.buildIterationPrompt(nextStep) };
  }

  /** Abort the loop (session stopped/aborted). Idempotent. */
  stop(): void {
    if (!this.state.active) {
      return;
    }
    this.finish('Session stopped');
  }

  // ── Internals ──

  private finish(reason: string): void {
    this.state.active = false;
    this.state.done = true;
    this.state.reasonDone = reason;
    this.pendingNext = false;
    console.log(`[PiAgentLoop] loop finished: ${reason}`);
  }

  /** Whether the iteration at the given 0-based index is the last one for fixed-length modes. */
  private isFinalStep(step: number): boolean {
    if (this.state.mode === PiAgentLoopMode.Passes) {
      return step + 1 >= this.state.passes;
    }
    if (this.state.mode === PiAgentLoopMode.Pipeline) {
      return step + 1 >= this.state.stages.length;
    }
    return false;
  }

  /** Human/LLM-readable description of the current loop position. */
  private describePosition(): string {
    if (this.state.mode === PiAgentLoopMode.Passes) {
      return `Pass ${this.state.currentStep + 1} of ${this.state.passes}. Task: ${this.state.goal || '(see conversation)'}`;
    }
    if (this.state.mode === PiAgentLoopMode.Pipeline) {
      const stage = this.state.stages[this.state.currentStep] ?? '';
      return `Pipeline stage ${this.state.currentStep + 1}/${this.state.stages.length}: **${stage}**. Overall goal: ${this.state.goal}`;
    }
    return `Iteration ${this.state.currentStep + 1}. Goal: ${this.state.goal}`;
  }

  /** Build the prompt that starts the iteration at the given 0-based index. */
  private buildIterationPrompt(step: number): string {
    const lines: string[] = [];
    if (this.state.mode === PiAgentLoopMode.Pipeline) {
      const stage = this.state.stages[step] ?? '';
      const isLast = step + 1 >= this.state.stages.length;
      lines.push(
        `## Agent Loop — Pipeline stage ${step + 1}/${this.state.stages.length}`,
        `Overall goal: ${this.state.goal}`,
        `Current stage: **${stage}**`,
      );
      if (!isLast) {
        lines.push(`Remaining stages: ${this.state.stages.slice(step + 1).join(' → ')}`);
      }
    } else if (this.state.mode === PiAgentLoopMode.Passes) {
      lines.push(
        `## Agent Loop — Pass ${step + 1} of ${this.state.passes}`,
        `Task: ${this.state.goal || '(see conversation)'}`,
        step + 1 >= this.state.passes
          ? 'This is the **final pass**. Do a final polish.'
          : 'This is a refinement pass. Review and improve on the previous pass.',
      );
    } else {
      lines.push(`## Agent Loop — Iteration ${step + 1}`, `Goal: ${this.state.goal}`);
    }

    if (this.state.lastSummary) {
      lines.push(`Previous iteration summary: ${this.state.lastSummary}`);
    }
    lines.push(
      '',
      'Execute this iteration now. When finished, you MUST call the agent_loop tool: ' +
        'use action "done" with a reason if the goal is fully met, ' +
        'otherwise action "next" with a brief summary of what was accomplished and what remains.',
    );
    return lines.join('\n');
  }

  /** Build the wrap-up prompt issued when the iteration limit is reached. */
  private buildWrapUpPrompt(): string {
    return [
      `## Agent Loop — iteration limit reached`,
      `The loop reached the safety limit of ${AGENT_LOOP_MAX_ITERATIONS} iterations. ` +
        'Do NOT start new work. Wrap up now: summarize what was accomplished, ' +
        'what remains unfinished, and any partial results worth keeping.',
      `Then call the agent_loop tool with action "done" and a closing reason.`,
    ].join('\n');
  }
}

// ── Parameter parsing ──

function parseStages(raw: unknown): string[] | string {
  if (!Array.isArray(raw) || raw.length === 0) {
    return '"stages" must be a non-empty array of stage name strings.';
  }
  const stages: string[] = [];
  for (let index = 0; index < raw.length; index++) {
    const stage = typeof raw[index] === 'string' ? (raw[index] as string).trim() : '';
    if (!stage) {
      return `"stages" entry ${index + 1} must be a non-empty string.`;
    }
    stages.push(stage);
  }
  return stages;
}

function parseStartParams(params: Record<string, unknown>): StartParams | string {
  const mode = typeof params.mode === 'string' ? params.mode.trim() : '';
  if (
    mode !== PiAgentLoopMode.Goal &&
    mode !== PiAgentLoopMode.Passes &&
    mode !== PiAgentLoopMode.Pipeline
  ) {
    return `action "start" requires "mode" to be one of: ${PiAgentLoopMode.Goal}, ${PiAgentLoopMode.Passes}, ${PiAgentLoopMode.Pipeline}.`;
  }
  const goal = typeof params.goal === 'string' ? params.goal.trim() : '';
  if (mode !== PiAgentLoopMode.Passes && !goal) {
    return `action "start" with mode "${mode}" requires a non-empty "goal".`;
  }

  let passes = 0;
  if (mode === PiAgentLoopMode.Passes) {
    passes = typeof params.passes === 'number' ? Math.floor(params.passes) : NaN;
    if (!Number.isFinite(passes) || passes < 1) {
      return 'action "start" with mode "passes" requires "passes" to be a positive integer.';
    }
  }

  let stages: string[] = [];
  if (mode === PiAgentLoopMode.Pipeline) {
    const parsed = parseStages(params.stages);
    if (typeof parsed === 'string') {
      return parsed;
    }
    stages = parsed;
  }

  return { mode, goal, passes, stages };
}

// ── Tool factory ──

/**
 * Build the `agent_loop` tool for a Pi cowork session. The tool mutates the
 * given controller; the adapter consults the same controller on agent_end to
 * decide whether to continue the session with the next iteration.
 */
export function buildPiAgentLoopTool(controller: PiAgentLoopController): Record<string, unknown> {
  const textResult = (text: string): PiAgentLoopToolResult => ({
    content: [{ type: 'text', text }],
    details: { ...controller.getState() },
  });

  return {
    name: PiAgentLoopToolName,
    label: 'Agent Loop',
    description:
      'Drive a long-horizon loop across multiple iterations of this session.\n' +
      'Actions:\n' +
      '- start: begin a loop. The current turn becomes iteration 1.\n' +
      '  Modes: "goal" (loop until you judge the goal met; requires goal), ' +
      '"passes" (exactly N refinement passes; requires passes; goal optional), ' +
      '"pipeline" (one stage per iteration, in order; requires stages and goal).\n' +
      '- next: end the current iteration and continue with the next one (requires summary).\n' +
      '- done: close the loop because the goal is met (requires reason).\n' +
      `Loops are capped at ${AGENT_LOOP_MAX_ITERATIONS} iterations; the final iteration is a forced wrap-up.`,

    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [PiAgentLoopAction.Start, PiAgentLoopAction.Next, PiAgentLoopAction.Done],
          description:
            'start: begin a loop; next: advance to the next iteration; done: close the loop.',
        },
        mode: {
          type: 'string',
          enum: [PiAgentLoopMode.Goal, PiAgentLoopMode.Passes, PiAgentLoopMode.Pipeline],
          description: 'Loop mode (start only).',
        },
        goal: {
          type: 'string',
          description:
            'What the loop is trying to achieve (start only; required for goal and pipeline modes).',
        },
        passes: {
          type: 'number',
          description: 'Number of refinement passes (start only; required for passes mode).',
        },
        stages: {
          type: 'array',
          description:
            'Ordered stage names, one per iteration (start only; required for pipeline mode).',
          items: { type: 'string' },
        },
        summary: {
          type: 'string',
          description:
            'Brief summary of what this iteration accomplished and what remains (next only).',
        },
        reason: {
          type: 'string',
          description: 'Why the loop is complete (done only).',
        },
      },
      required: ['action'],
      additionalProperties: false,
    },

    execute: async (
      _toolCallId: string,
      params: Record<string, unknown>,
    ): Promise<PiAgentLoopToolResult> => {
      const action = typeof params.action === 'string' ? params.action.trim() : '';

      if (action === PiAgentLoopAction.Start) {
        const parsed = parseStartParams(params);
        if (typeof parsed === 'string') {
          return textResult(parsed);
        }
        return textResult(controller.start(parsed));
      }

      if (action === PiAgentLoopAction.Next) {
        const summary = typeof params.summary === 'string' ? params.summary.trim() : '';
        if (!summary) {
          return textResult('action "next" requires a non-empty "summary".');
        }
        return textResult(controller.next(summary));
      }

      if (action === PiAgentLoopAction.Done) {
        const reason = typeof params.reason === 'string' ? params.reason.trim() : '';
        if (!reason) {
          return textResult('action "done" requires a non-empty "reason".');
        }
        return textResult(controller.done(reason));
      }

      return textResult(
        `"action" must be one of: ${PiAgentLoopAction.Start}, ${PiAgentLoopAction.Next}, ${PiAgentLoopAction.Done}.`,
      );
    },
  };
}
