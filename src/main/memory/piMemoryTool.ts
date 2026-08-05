import {
  EngramObservationType,
  PiMemoryAction,
  type EngramObservationType as EngramObservationTypeValue,
} from './constants';
import type { ProjectMemoryService } from './projectMemoryService';

export function buildPiProjectMemoryTool(input: {
  service: ProjectMemoryService;
  sessionId: string;
  workingDirectory: string;
}): Record<string, unknown> {
  return {
    name: 'memory',
    label: 'Memory',
    description:
      'Recall or explicitly save durable project memory, or save a short-lived session summary. ' +
      'Project memory is isolated to the current project.',
    promptSnippet:
      'Use memory to recall prior project decisions or save durable facts only when they are useful later.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: Object.values(PiMemoryAction),
          description: 'recall, save, or session_summary',
        },
        query: { type: 'string', description: 'Search query for recall.' },
        title: { type: 'string', description: 'Short title for a saved project memory.' },
        content: { type: 'string', description: 'Atomic memory content or session summary.' },
        topicKey: { type: 'string', description: 'Stable topic key for project memory upsert.' },
        kind: {
          type: 'string',
          enum: [EngramObservationType.Decision, EngramObservationType.Preference],
          description: 'Memory kind for save.',
        },
      },
      required: ['action'],
      additionalProperties: false,
    },
    execute: async (_toolCallId: string, params: Record<string, unknown>) => {
      try {
        const action = typeof params.action === 'string' ? params.action : '';
        if (action === PiMemoryAction.Recall) {
          const query = requiredString(params.query, 'query');
          const observations = await input.service.recallProject({
            workingDirectory: input.workingDirectory,
            query,
          });
          const text = observations.length
            ? observations
                .map(item => `[memory:${item.id}] ${item.title}: ${item.content}`)
                .join('\n')
            : 'No relevant project memory found.';
          return toolResult(text, { count: observations.length });
        }
        if (action === PiMemoryAction.Save) {
          const title = requiredString(params.title, 'title');
          const content = requiredString(params.content, 'content');
          const kind = normalizeKind(params.kind);
          const memoryId = await input.service.saveProjectMemory({
            sessionId: input.sessionId,
            workingDirectory: input.workingDirectory,
            type: kind,
            title,
            content,
            topicKey: typeof params.topicKey === 'string' ? params.topicKey.trim() : undefined,
          });
          return memoryId === null
            ? toolResult('Project memory was queued and will retry when memory is available.', {
                queued: true,
              })
            : toolResult(`Saved project memory ${memoryId}.`, { memoryId });
        }
        if (action === PiMemoryAction.SessionSummary) {
          const summary = requiredString(params.content, 'content');
          const memoryId = await input.service.saveSessionSummary({
            sessionId: input.sessionId,
            workingDirectory: input.workingDirectory,
            summary,
          });
          return memoryId === null
            ? toolResult('Session summary was queued for retry.', { queued: true })
            : toolResult(`Saved session summary ${memoryId}.`, { memoryId });
        }
        return toolResult('Unsupported memory action.', { isError: true });
      } catch (error) {
        return toolResult(error instanceof Error ? error.message : String(error), {
          isError: true,
        });
      }
    },
  };
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${field} is required.`);
  }
  return value.trim();
}

function normalizeKind(value: unknown): EngramObservationTypeValue {
  return value === EngramObservationType.Preference
    ? EngramObservationType.Preference
    : EngramObservationType.Decision;
}

function toolResult(text: string, details: Record<string, unknown>) {
  return { content: [{ type: 'text', text }], details };
}
