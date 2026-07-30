import * as fs from 'fs';
import path from 'path';

import type {
  PiAskUserQuestionInput,
  PiAskUserQuestionRequester,
  PiAskUserQuestionResponse,
} from './piAskUserQuestion';

export const WorkExecutionQuestion = '技能任务执行方式';
export const WorkExecutionOption = {
  SingleTurn: '完成本轮',
  Persistent: '持续执行至验收',
} as const;

export const PiWorkAcceptanceToolName = 'work_acceptance';

type WorkExecutionMode = 'pending' | 'single' | 'persistent';

interface WorkExecutionState {
  version: 1;
  sessionId: string;
  task: string;
  mode: WorkExecutionMode;
  status: 'running' | 'completion_requested' | 'completed';
  accepted: boolean;
  iteration: number;
  completionReason?: string;
  acceptanceFeedback?: string;
  updatedAt: string;
}

export const buildWorkExecutionQuestion = (): PiAskUserQuestionInput => ({
  questions: [
    {
      header: '执行方式',
      question: WorkExecutionQuestion,
      options: [
        {
          label: WorkExecutionOption.SingleTurn,
          description: '让技能完成当前一轮任务；模型结束后会结束会话。',
        },
        {
          label: WorkExecutionOption.Persistent,
          description: '持续推进复杂任务，并在模型申请完成时由你最终验收。',
        },
      ],
    },
  ],
});

export const chosePersistentWorkExecution = (response: PiAskUserQuestionResponse): boolean => {
  if (response.behavior !== 'allow') return false;
  const answers = response.updatedInput?.answers;
  if (!answers || typeof answers !== 'object') return false;
  return (
    (answers as Record<string, unknown>)[WorkExecutionQuestion] === WorkExecutionOption.Persistent
  );
};

const now = (): string => new Date().toISOString();

export class PiWorkExecutionController {
  readonly runDirectory: string;
  private readonly statePath: string;
  private state: WorkExecutionState;

  constructor(
    private readonly options: { sessionId: string; workspaceRoot: string; task: string },
  ) {
    this.runDirectory = path.join(
      options.workspaceRoot,
      '.zhiyuan',
      'work-executions',
      options.sessionId,
    );
    this.statePath = path.join(this.runDirectory, 'state.json');
    fs.mkdirSync(this.runDirectory, { recursive: true });
    this.state = this.loadOrCreate();
    this.writeState();
  }

  get goal(): string {
    return `Complete and obtain user acceptance for: ${this.state.task}`;
  }

  isPersistent(): boolean {
    return this.state.mode === 'persistent';
  }

  selectMode(persistent: boolean, task: string): void {
    this.state.mode = persistent ? 'persistent' : 'single';
    this.state.task = task;
    this.state.status = 'running';
    this.state.accepted = false;
    delete this.state.completionReason;
    delete this.state.acceptanceFeedback;
    this.writeState();
  }

  buildInitialPrompt(userPrompt: string): string {
    return [
      '## Persistent Work execution',
      `Durable state: ${this.runDirectory}`,
      'Continue until the requested work is implemented and verified.',
      `Before calling agent_loop done, call ${PiWorkAcceptanceToolName} with a concise result and validation summary.`,
      'Only an explicit user acceptance clears the completion gate.',
      '',
      userPrompt,
    ].join('\n');
  }

  resumeForPrompt(task: string): void {
    this.state.task = task;
    this.state.status = 'running';
    this.state.accepted = false;
    this.state.iteration += 1;
    delete this.state.completionReason;
    delete this.state.acceptanceFeedback;
    this.writeState();
  }

  requestCompletion(reason: string): string {
    this.state.status = 'completion_requested';
    this.state.completionReason = reason;
    this.writeState();
    return this.state.accepted
      ? 'Completion requested after user acceptance. End this turn now.'
      : `Completion remains blocked. Call ${PiWorkAcceptanceToolName} and wait for the user decision.`;
  }

  recordAcceptance(accepted: boolean, feedback: string): void {
    this.state.accepted = accepted;
    this.state.acceptanceFeedback = feedback;
    if (!accepted) this.state.status = 'running';
    this.writeState();
  }

  onAgentEnd(): { shouldFinish: boolean; reason?: string; nextPrompt?: string } {
    if (this.state.mode !== 'persistent') {
      return { shouldFinish: true, reason: 'Single-turn Work execution selected' };
    }
    if (this.state.status === 'completion_requested' && this.state.accepted) {
      this.state.status = 'completed';
      this.writeState();
      return {
        shouldFinish: true,
        reason: this.state.completionReason || 'User accepted the Work result',
      };
    }
    this.state.iteration += 1;
    this.writeState();
    if (this.state.accepted) {
      return {
        shouldFinish: false,
        nextPrompt:
          'The user accepted the result. Call agent_loop done with the final completion reason, then end the turn.',
      };
    }
    return {
      shouldFinish: false,
      nextPrompt: [
        '## Persistent Work continuation',
        this.state.acceptanceFeedback
          ? `Latest acceptance feedback: ${this.state.acceptanceFeedback}`
          : 'The task has not received explicit user acceptance.',
        `Continue concrete work and validation. When ready, call ${PiWorkAcceptanceToolName}; only after acceptance call agent_loop done.`,
      ].join('\n'),
    };
  }

  private loadOrCreate(): WorkExecutionState {
    try {
      if (fs.existsSync(this.statePath)) {
        const parsed = JSON.parse(fs.readFileSync(this.statePath, 'utf8')) as WorkExecutionState;
        if (parsed.version === 1 && parsed.sessionId === this.options.sessionId) return parsed;
      }
    } catch {}
    return {
      version: 1,
      sessionId: this.options.sessionId,
      task: this.options.task,
      mode: 'pending',
      status: 'running',
      accepted: false,
      iteration: 1,
      updatedAt: now(),
    };
  }

  private writeState(): void {
    this.state.updatedAt = now();
    fs.writeFileSync(this.statePath, JSON.stringify(this.state, null, 2));
  }
}

export function buildPiWorkAcceptanceTool(
  controller: PiWorkExecutionController,
  request: PiAskUserQuestionRequester,
): Record<string, unknown> {
  return {
    name: PiWorkAcceptanceToolName,
    label: 'Work Acceptance',
    description:
      'Request final user acceptance for a persistent Work task after implementation and validation are complete.',
    parameters: {
      type: 'object',
      properties: {
        summary: {
          type: 'string',
          description: 'Concise result and validation summary shown to the user.',
        },
      },
      required: ['summary'],
      additionalProperties: false,
    },
    executionMode: 'sequential',
    execute: async (toolCallId: string, params: Record<string, unknown>, signal?: AbortSignal) => {
      const summary = typeof params.summary === 'string' ? params.summary.trim() : '';
      const question = summary ? `当前结果是否达到要求？\n\n${summary}` : '当前结果是否达到要求？';
      const response = await request(
        toolCallId,
        {
          questions: [
            {
              header: '任务验收',
              question,
              options: [
                { label: '验收通过', description: '允许任务完成。' },
                { label: '继续完善', description: '保持任务运行并继续改进。' },
              ],
            },
          ],
        },
        signal,
      );
      const answers = response.updatedInput?.answers;
      const answer =
        response.behavior === 'allow' && answers && typeof answers === 'object'
          ? String((answers as Record<string, unknown>)[question] ?? '')
          : response.message || '验收请求未获批准';
      const accepted = answer === '验收通过';
      controller.recordAcceptance(accepted, answer);
      return {
        content: [
          {
            type: 'text',
            text: accepted
              ? 'User accepted the result. Call agent_loop done and end the turn.'
              : `User requested more work (${answer || '继续完善'}). Continue the task.`,
          },
        ],
        details: { accepted, answer },
      };
    },
  };
}
