import {
  recordSessionCheckpoint,
  type SessionCheckpointInput,
} from '../memory/sessionCheckpointService';
import type { ProjectMemoryService } from '../memory/projectMemoryService';

const SessionSummaryToolName = 'session_summary';

export const SessionSummarySystemPrompt = [
  '## Session checkpoint',
  '',
  '- When you finish a task with substantive output, write one session checkpoint with `session_summary`: goal, what was accomplished, discoveries, next steps, relevant files. The host injects session/run identity; you only write the content.',
  '- Write it from your current context, not by re-reading the transcript. Do not call any other model or tool to summarize.',
  '- If the turn produced nothing worth remembering, call `session_summary` with `skip: true` and a short reason instead of writing empty content. Skip is an explicit, valid outcome, not an omission.',
].join('\n');

type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  details: Record<string, unknown>;
};

const failure = (message: string): ToolResult => ({
  content: [{ type: 'text', text: message }],
  details: { isError: true, error: message },
});

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const textList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter(item => typeof item === 'string' && item.trim()) : [];

export interface SessionSummaryToolOptions {
  getProjectMemoryService: () => ProjectMemoryService;
  sessionId: string;
  workingDirectory: string;
  runId?: string | null;
  turnId?: string | null;
  getExecutionIdentity?: (toolCallId: string) => {
    runId?: string | null;
    turnId?: string | null;
  };
  onOutcome?: (outcome: 'written' | 'skipped', reason?: string) => void;
}

export function buildSessionSummaryTool(
  options: SessionSummaryToolOptions,
): Record<string, unknown> {
  return {
    name: SessionSummaryToolName,
    label: 'Session Summary',
    description:
      'Write a session checkpoint (goal, accomplishments, discoveries, next steps, relevant files), or explicitly skip it with a reason. The host persists it with session/run identity and sequence; no separate summarization call happens.',
    parameters: {
      type: 'object',
      properties: {
        goal: { type: 'string', description: 'What this turn/task was working on.' },
        instructions: {
          type: 'string',
          description: 'User preferences or constraints discovered.',
        },
        discoveries: {
          type: 'array',
          items: { type: 'string' },
          description: 'Technical findings, gotchas, non-obvious learnings.',
        },
        accomplished: { type: 'string', description: 'Completed items with key details.' },
        nextSteps: {
          type: 'array',
          items: { type: 'string' },
          description: 'What remains to be done for the next session.',
        },
        relevantFiles: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              role: { type: 'string' },
            },
            required: ['path'],
          },
          description: 'Files central to the work, with optional role notes.',
        },
        skip: {
          type: 'boolean',
          description: 'Set true when this turn produced nothing worth remembering.',
        },
        reason: {
          type: 'string',
          description: 'Reason for skipping or context for the checkpoint.',
        },
      },
      additionalProperties: false,
    },
    execute: async (
      toolCallId: string,
      params: Record<string, unknown>,
      _signal?: AbortSignal,
    ): Promise<ToolResult> => {
      const reason = text(params.reason);
      if (params.skip === true) {
        if (!reason) return failure('session_summary(skip=true) requires a short reason.');
        options.onOutcome?.('skipped', reason);
        return {
          content: [{ type: 'text', text: `Session checkpoint skipped: ${reason}` }],
          details: { status: 'skipped', reason },
        };
      }
      const goal = text(params.goal);
      const accomplished = text(params.accomplished);
      if (!goal || !accomplished) {
        return failure(
          'session_summary requires non-empty goal and accomplished, or skip=true with a reason.',
        );
      }
      const input: SessionCheckpointInput = {
        goal,
        accomplished,
        ...(text(params.instructions) ? { instructions: text(params.instructions) } : {}),
        ...(textList(params.discoveries).length
          ? { discoveries: textList(params.discoveries) }
          : {}),
        ...(textList(params.nextSteps).length ? { nextSteps: textList(params.nextSteps) } : {}),
      };
      if (Array.isArray(params.relevantFiles)) {
        input.relevantFiles = params.relevantFiles
          .filter(
            (file): file is { path: string; role?: string } =>
              typeof file === 'object' &&
              file !== null &&
              typeof (file as { path?: unknown }).path === 'string',
          )
          .map(file => ({ path: file.path, ...(file.role ? { role: file.role } : {}) }));
      }
      const executionIdentity = options.getExecutionIdentity?.(toolCallId);
      try {
        const result = await recordSessionCheckpoint(
          options.getProjectMemoryService(),
          {
            sessionId: options.sessionId,
            workingDirectory: options.workingDirectory,
            runId: executionIdentity?.runId ?? options.runId,
            turnId: executionIdentity?.turnId ?? options.turnId ?? toolCallId,
          },
          input,
        );
        options.onOutcome?.('written', reason || undefined);
        return {
          content: [{ type: 'text', text: 'Session checkpoint saved.' }],
          details: {
            status: 'written',
            checkpointId: result.checkpointId,
            syncState: result.syncState,
          },
        };
      } catch (error) {
        return failure(
          `session_summary failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  };
}
