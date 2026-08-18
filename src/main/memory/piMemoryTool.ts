import { MemoryScope } from '../../shared/memory';
import type { CoworkMessage } from '../coworkStore';
import { AtomicMemorySourceKind, EngramObservationType, PiMemoryAction } from './constants';
import { AtomicMemoryExtractor, type AtomicMemoryExtractionResult } from './atomicMemoryExtractor';
import type { ProjectMemoryService } from './projectMemoryService';
import { buildSessionMemorySource, type SessionMemoryCompletion } from './sessionMemoryExtractor';

export function buildPiProjectMemoryTool(input: {
  service: ProjectMemoryService;
  sessionId: string;
  workingDirectory: string;
  getMessages: () => CoworkMessage[];
  complete: SessionMemoryCompletion;
  extractor?: AtomicMemoryExtractor;
}): Record<string, unknown> {
  const extractor = input.extractor ?? new AtomicMemoryExtractor();
  return {
    name: 'memory',
    label: 'Memory',
    description:
      'Recall workspace, current-session, and confirmed personal memory; explicitly save durable workspace memory; ' +
      'list controlled active memory; or propose personal memory for user review.',
    promptSnippet:
      'Use memory to recall prior workspace decisions or save durable facts only when they are useful later.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: Object.values(PiMemoryAction),
          description: 'recall, list, save, or propose_personal',
        },
        query: { type: 'string', description: 'Search query for recall.' },
        limit: { type: 'number', description: 'Maximum number of memories to list.' },
        title: { type: 'string', description: 'Short title for a saved workspace memory.' },
        content: { type: 'string', description: 'Proposed atomic memory content.' },
        topicKey: { type: 'string', description: 'Stable topic key for workspace memory upsert.' },
        supersedesMemoryId: {
          type: 'number',
          description: 'Active Personal observation ID replaced by the proposed Personal memory.',
        },
        promotesMemoryId: {
          type: 'number',
          description:
            'Active Project observation from this workspace, or Session observation from this session, promoted into Personal memory without replacing the source.',
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
          const [workspace, personal, session] = await Promise.all([
            input.service.recallProject({ workingDirectory: input.workingDirectory, query }),
            input.service.recallPersonal({ query }),
            input.service.recallSession({
              workingDirectory: input.workingDirectory,
              sessionId: input.sessionId,
              query,
            }),
          ]);
          const observations = [...workspace, ...personal, ...session];
          const text = observations.length
            ? observations
                .map(item => `[memory:${item.id}] ${item.title}: ${item.content}`)
                .join('\n')
            : 'No relevant workspace, session, or personal memory found.';
          return toolResult(text, { count: observations.length });
        }
        if (action === PiMemoryAction.List) {
          const memories = input.service.listRecallableMemories({
            workingDirectory: input.workingDirectory,
            sessionId: input.sessionId,
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
            : 'No active workspace, current-session, or confirmed personal memory found.';
          return toolResult(text, { count: memories.length });
        }
        if (action === PiMemoryAction.ProposePersonal) {
          const requestedMemory = {
            title: requiredString(params.title, 'title'),
            content: requiredString(params.content, 'content'),
            kind: normalizeKind(params.kind),
          };
          const extracted = await extractRequestedMemory(
            extractor,
            MemoryScope.Personal,
            requestedMemory,
            input,
            [params.supersedesMemoryId, params.promotesMemoryId],
          );
          if (!extracted) {
            return toolResult('The proposed personal memory was not durable enough to save.', {
              skipped: true,
            });
          }
          const memory = extracted.memories[0];
          const candidateId = input.service.proposePersonalMemory({
            sessionId: input.sessionId,
            workingDirectory: input.workingDirectory,
            type: memory.kind,
            title: memory.title,
            content: memory.content,
            topicKey: typeof params.topicKey === 'string' ? params.topicKey.trim() : undefined,
            importance: memory.importance,
            confidence: memory.confidence,
            sensitivity: memory.sensitivity,
            supersedesMemoryId:
              typeof params.supersedesMemoryId === 'number' ? params.supersedesMemoryId : undefined,
            promotesMemoryId:
              typeof params.promotesMemoryId === 'number' ? params.promotesMemoryId : undefined,
            metadata: extracted.metadataFor(memory),
          });
          return toolResult('Personal memory was proposed and requires user confirmation.', {
            candidateId,
            needsReview: true,
          });
        }
        if (action === PiMemoryAction.Save) {
          const requestedMemory = {
            title: requiredString(params.title, 'title'),
            content: requiredString(params.content, 'content'),
            kind: normalizeKind(params.kind),
          };
          const extracted = await extractRequestedMemory(
            extractor,
            MemoryScope.Project,
            requestedMemory,
            input,
          );
          if (!extracted) {
            return toolResult('The proposed project memory was not durable enough to save.', {
              skipped: true,
            });
          }
          const memory = extracted.memories[0];
          const memoryId = await input.service.saveProjectMemory({
            sessionId: input.sessionId,
            workingDirectory: input.workingDirectory,
            type: memory.kind,
            title: memory.title,
            content: memory.content,
            topicKey: typeof params.topicKey === 'string' ? params.topicKey.trim() : undefined,
            importance: memory.importance,
            confidence: memory.confidence,
            sensitivity: memory.sensitivity,
            metadata: extracted.metadataFor(memory),
          });
          return memoryId === null
            ? toolResult('Project memory was queued and will retry when memory is available.', {
                queued: true,
              })
            : toolResult(`Saved workspace memory ${memoryId}.`, { memoryId });
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

async function extractRequestedMemory(
  extractor: AtomicMemoryExtractor,
  scope: typeof MemoryScope.Project | typeof MemoryScope.Personal,
  requestedMemory: {
    title: string;
    content: string;
    kind: typeof EngramObservationType.Decision | typeof EngramObservationType.Preference;
  },
  input: {
    service: ProjectMemoryService;
    sessionId: string;
    workingDirectory: string;
    getMessages: () => CoworkMessage[];
    complete: SessionMemoryCompletion;
  },
  referencedMemoryIds: unknown[] = [],
): Promise<AtomicMemoryExtractionResult | null> {
  const conversationSources = buildSessionMemorySource(input.getMessages()).map(message => ({
    id: message.id,
    kind: AtomicMemorySourceKind.Conversation,
    content: message.content,
  }));
  const memorySources = referencedMemoryIds.flatMap(value => {
    if (typeof value !== 'number') return [];
    const memory = input.service.getRecallableMemoryById({
      workingDirectory: input.workingDirectory,
      sessionId: input.sessionId,
      memoryId: value,
    });
    return memory
      ? [
          {
            id: `memory:${value}`,
            kind: AtomicMemorySourceKind.ExistingMemory,
            content: `${memory.title}: ${memory.content}`,
          },
        ]
      : [];
  });
  return await extractor.extract({
    scope,
    sources: [...conversationSources, ...memorySources],
    requestedMemory,
    maxItems: 1,
    complete: input.complete,
  });
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${field} is required.`);
  }
  return value.trim();
}

function normalizeKind(
  value: unknown,
): typeof EngramObservationType.Decision | typeof EngramObservationType.Preference {
  return value === EngramObservationType.Preference
    ? EngramObservationType.Preference
    : EngramObservationType.Decision;
}

function toolResult(text: string, details: Record<string, unknown>) {
  return { content: [{ type: 'text', text }], details };
}
