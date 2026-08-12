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
      'Recall project and confirmed personal memory, explicitly save durable project memory, ' +
      'list controlled active memory, propose personal memory for user review, or save a short-lived session summary.',
    promptSnippet:
      'Use memory to recall prior project decisions or save durable facts only when they are useful later.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: Object.values(PiMemoryAction),
          description: 'recall, list, save, propose_personal, or session_summary',
        },
        query: { type: 'string', description: 'Search query for recall.' },
        limit: { type: 'number', description: 'Maximum number of memories to list.' },
        title: { type: 'string', description: 'Short title for a saved project memory.' },
        content: { type: 'string', description: 'Atomic memory content or session summary.' },
        topicKey: { type: 'string', description: 'Stable topic key for project memory upsert.' },
        supersedesMemoryId: {
          type: 'number',
          description: 'Observation ID replaced by a proposed personal memory.',
        },
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
          const [project, personal] = await Promise.all([
            input.service.recallProject({ workingDirectory: input.workingDirectory, query }),
            input.service.recallPersonal({ query }),
          ]);
          const observations = [...project, ...personal];
          const text = observations.length
            ? observations
                .map(item => `[memory:${item.id}] ${item.title}: ${item.content}`)
                .join('\n')
            : 'No relevant project memory found.';
          return toolResult(text, { count: observations.length });
        }
        if (action === PiMemoryAction.List) {
          const memories = input.service.listRecallableMemories({
            workingDirectory: input.workingDirectory,
            query: typeof params.query === 'string' ? params.query.trim() || undefined : undefined,
            limit: typeof params.limit === 'number' ? params.limit : undefined,
          });
          const text = memories.length
            ? memories
                .map(
                  memory =>
                    `[memory:${memory.memoryId ?? memory.id}] [${memory.scope}] ${memory.title}: ${memory.content}`,
                )
                .join('\n')
            : 'No active project or confirmed personal memory found.';
          return toolResult(text, { count: memories.length });
        }
        if (action === PiMemoryAction.ProposePersonal) {
          const candidateId = input.service.proposePersonalMemory({
            sessionId: input.sessionId,
            type: normalizeKind(params.kind),
            title: requiredString(params.title, 'title'),
            content: requiredString(params.content, 'content'),
            topicKey: typeof params.topicKey === 'string' ? params.topicKey.trim() : undefined,
            supersedesMemoryId:
              typeof params.supersedesMemoryId === 'number' ? params.supersedesMemoryId : undefined,
          });
          return toolResult('Personal memory was proposed and requires user confirmation.', {
            candidateId,
            needsReview: true,
          });
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
