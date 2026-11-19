import type { ToolAnnotations, ToolDefinition } from '@earendil-works/pi-coding-agent';
import { Type, type Static } from 'typebox';

import {
  recordSessionCheckpoint,
  type SessionCheckpointInput,
} from '../memory/sessionCheckpointService';
import type { ProjectMemoryService } from '../memory/projectMemoryService';

const SessionSummaryToolName = 'session_summary';

const SessionSummaryPromptSnippet = 'Record a session checkpoint after substantial work.';

const RelevantFileItemSchema = Type.Object({
  path: Type.String(),
  role: Type.Optional(Type.String()),
});

export const SessionSummaryParameters = Type.Object({
  goal: Type.Optional(Type.String()),
  instructions: Type.Optional(Type.String()),
  discoveries: Type.Optional(Type.Array(Type.String())),
  accomplished: Type.Optional(Type.String()),
  nextSteps: Type.Optional(Type.Array(Type.String())),
  relevantFiles: Type.Optional(Type.Array(RelevantFileItemSchema)),
  skip: Type.Optional(Type.Boolean()),
  reason: Type.Optional(Type.String()),
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
      'Optionally write one concise session checkpoint from current context after substantial multi-step work or durable deliverables (or set skip=true with reason). Do not call on simple Q&A or minor edits.',
    promptSnippet: SessionSummaryPromptSnippet,
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
