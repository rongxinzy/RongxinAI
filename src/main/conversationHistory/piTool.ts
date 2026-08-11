import { CONVERSATION_HISTORY_TOOL_NAME } from './constants';
import type { ConversationHistoryService } from './service';

export function buildPiConversationHistoryTool(input: {
  service: ConversationHistoryService;
  workingDirectory: string;
}): Record<string, unknown> {
  return {
    name: CONVERSATION_HISTORY_TOOL_NAME,
    label: 'Conversation History',
    description:
      'Search raw user and assistant messages from conversations in the current project. ' +
      'This is separate from durable memory and excludes thinking and tool output.',
    promptSnippet:
      'Use conversation_history when the user asks for details from prior conversations that may not be durable memory.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Text or keywords to search in conversation history.',
        },
        limit: { type: 'number', description: 'Maximum number of matching message excerpts.' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    execute: async (_toolCallId: string, params: Record<string, unknown>) => {
      try {
        const query = requiredQuery(params.query);
        const matches = input.service.search({
          workingDirectory: input.workingDirectory,
          query,
          limit: typeof params.limit === 'number' ? params.limit : undefined,
        });
        const text = matches.length
          ? matches
              .map(
                match =>
                  `[history:${match.messageId}] [${match.role}] ${match.sessionTitle} (${new Date(match.createdAt).toISOString()}): ${match.snippet}`,
              )
              .join('\n')
          : 'No matching conversation history found in the current project.';
        return toolResult(text, { count: matches.length });
      } catch (error) {
        return toolResult(error instanceof Error ? error.message : String(error), {
          isError: true,
        });
      }
    },
  };
}

function requiredQuery(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('query is required.');
  return value.trim();
}

function toolResult(text: string, details: Record<string, unknown>) {
  return { content: [{ type: 'text', text }], details };
}
