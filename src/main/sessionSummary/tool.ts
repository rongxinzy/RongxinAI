import type { ToolAnnotations, ToolDefinition } from '@earendil-works/pi-coding-agent';
import { Type, type Static } from 'typebox';

import {
  recordSessionCheckpoint,
  type SessionCheckpointInput,
} from '../memory/sessionCheckpointService';
import type { ProjectMemoryService } from '../memory/projectMemoryService';

const SessionSummaryToolName = 'session_summary';

const SessionSummaryPromptSnippet =
  'Write a session checkpoint (goal, accomplishments, discoveries, next steps, relevant files), or explicitly skip it with a reason.';

const SessionSummaryPromptGuidelines = [
  'When you finish a task with substantive output, write one session checkpoint with `session_summary`: goal, what was accomplished, discoveries, next steps, relevant files. The host injects session/run identity; you only write the content.',
  'Write it from your current context, not by re-reading the transcript. Do not call any other model or tool to summarize.',
  'If the turn produced nothing worth remembering, call `session_summary` with `skip: true` and a short reason instead of writing empty content. Skip is an explicit, valid outcome, not an omission.',
];

export const SessionSummarySystemPrompt = [
  '## Session checkpoint',
  '',
  '- Checkpoints preserve progress and discoveries across turns and sessions. The host persists them with session/run identity and sequence.',
].join('\n');

const RelevantFileItemSchema = Type.Object({
  path: Type.String({ description: 'Workspace-relative file path.' }),
  role: Type.Optional(Type.String({ description: 'Role of the file in the turn.' })),
});

export const SessionSummaryParameters = Type.Object({
  goal: Type.Optional(Type.String({ description: 'What this turn/task was working on.' })),
  instructions: Type.Optional(
    Type.String({
      description: 'User preferences or constraints discovered.',
    }),
  ),
  discoveries: Type.Optional(
    Type.Array(Type.String(), {
      description: 'Technical findings, gotchas, non-obvious learnings.',
    }),
  ),
  accomplished: Type.Optional(Type.String({ description: 'Completed items with key details.' })),
  nextSteps: Type.Optional(
    Type.Array(Type.String(), {
      description: 'What remains to be done for the next session.',
    }),
  ),
  relevantFiles: Type.Optional(
    Type.Array(RelevantFileItemSchema, {
      description: 'Files central to the work, with optional role notes.',
    }),
  ),
  skip: Type.Optional(
    Type.Boolean({
      description: 'Set true when this turn produced nothing worth remembering.',
    }),
  ),
  reason: Type.Optional(
    Type.String({
      description: 'Reason for skipping or context for the checkpoint.',
    }),
  ),
});

const SessionSummaryAnnotations: ToolAnnotations = {
  readOnlyHint: true,
  openWorldHint: false,
};

const SessionSummaryOutputSchema = Type.Object({
  status: Type.Optional(Type.Union([Type.Literal('written'), Type.Literal('skipped')])),
  reason: Type.Optional(Type.String()),
  checkpointId: Type.Optional(Type.String()),
  syncState: Type.Optional(Type.String()),
  isError: Type.Optional(Type.Boolean()),
  error: Type.Optional(Type.String()),
});
export type SessionSummaryOutput = Static<typeof SessionSummaryOutputSchema>;

type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  details: SessionSummaryOutput;
  structuredContent: SessionSummaryOutput;
};

const failure = (message: string): ToolResult => {
  const details: SessionSummaryOutput = { isError: true, error: message };
  return {
    content: [{ type: 'text', text: message }],
    details,
    structuredContent: details,
  };
};

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
): ToolDefinition<typeof SessionSummaryParameters, SessionSummaryOutput> {
  return {
    name: SessionSummaryToolName,
    label: 'Session Summary',
    description:
      'Write a session checkpoint (goal, accomplishments, discoveries, next steps, relevant files), or explicitly skip it with a reason. The host persists it with session/run identity and sequence; no separate summarization call happens.',
    promptSnippet: SessionSummaryPromptSnippet,
    promptGuidelines: [...SessionSummaryPromptGuidelines],
    parameters: SessionSummaryParameters,
    outputSchema: SessionSummaryOutputSchema,
    annotations: SessionSummaryAnnotations,
    execute: async (
      toolCallId: string,
      params: Static<typeof SessionSummaryParameters>,
      _signal?: AbortSignal,
    ): Promise<ToolResult> => {
      const reason = text(params.reason);
      if (params.skip === true) {
        if (!reason) return failure('session_summary(skip=true) requires a short reason.');
        options.onOutcome?.('skipped', reason);
        const details: SessionSummaryOutput = { status: 'skipped', reason };
        return {
          content: [{ type: 'text', text: `Session checkpoint skipped: ${reason}` }],
          details,
          structuredContent: details,
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
        const details: SessionSummaryOutput = {
          status: 'written',
          checkpointId: result.checkpointId,
          syncState: result.syncState,
        };
        return {
          content: [{ type: 'text', text: 'Session checkpoint saved.' }],
          details,
          structuredContent: details,
        };
      } catch (error) {
        return failure(
          `session_summary failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  };
}
