import type { ToolAnnotations, ToolDefinition } from '../libs/agentEngine/durableToolTypes';
import { Type, type Static } from 'typebox';

import { CONVERSATION_HISTORY_TOOL_NAME } from './constants';
import type { ConversationHistoryService } from './service';

export const ConversationHistoryParameters = Type.Object({
  query: Type.String({ description: 'Text or keywords to search in conversation history.' }),
  limit: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: 100,
      description: 'Maximum number of matching message excerpts.',
    }),
  ),
});

const ConversationHistoryAnnotations: ToolAnnotations = {
  readOnlyHint: true,
  openWorldHint: false,
  idempotentHint: true,
};

const ConversationHistoryMatchItemSchema = Type.Object({
  messageId: Type.String(),
  sessionId: Type.String(),
  sessionTitle: Type.String(),
  role: Type.String(),
  snippet: Type.String(),
  createdAt: Type.Number(),
});

const ConversationHistoryOutputSchema = Type.Object({
  count: Type.Optional(Type.Integer({ description: 'Number of matches found.' })),
  matches: Type.Optional(Type.Array(ConversationHistoryMatchItemSchema)),
  isError: Type.Optional(Type.Boolean()),
  error: Type.Optional(Type.String()),
});
export type ConversationHistoryOutput = Static<typeof ConversationHistoryOutputSchema>;

export function buildPiConversationHistoryTool(input: {
  service: ConversationHistoryService;
  workingDirectory: string;
  sessionId?: string;
}): ToolDefinition<typeof ConversationHistoryParameters, ConversationHistoryOutput> {
  return {
    name: CONVERSATION_HISTORY_TOOL_NAME,
    label: 'Conversation History',
    description:
      'Search raw user and assistant messages from conversations in the current project. ' +
      'This is separate from durable memory and excludes thinking and tool output.',
    promptSnippet:
      'Use conversation_history when the user asks for details from prior conversations that may not be durable memory.',
    parameters: ConversationHistoryParameters,
    outputSchema: ConversationHistoryOutputSchema,
    annotations: ConversationHistoryAnnotations,
    execute: async (_toolCallId: string, params: { query: string; limit?: number }) => {
      try {
        const query = requiredQuery(params.query);
        const matches = input.service.search({
          workingDirectory: input.workingDirectory,
          ...(input.sessionId ? { sessionId: input.sessionId } : {}),
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
        const details: ConversationHistoryOutput = { count: matches.length, matches };
        return toolResult(text, details);
      } catch (error) {
        const errorText = error instanceof Error ? error.message : String(error);
        const details: ConversationHistoryOutput = {
          isError: true,
          error: errorText,
        };
        return toolResult(errorText, details);
      }
    },
  };
}

function requiredQuery(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('query is required.');
  return value.trim();
}

function toolResult(text: string, details: ConversationHistoryOutput) {
  return {
    content: [{ type: 'text' as const, text }],
    details,
    structuredContent: details,
    ...(details.isError ? { isError: true } : {}),
  };
}
