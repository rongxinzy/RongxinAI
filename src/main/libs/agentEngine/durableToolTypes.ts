import type { JsonValue } from '@earendil-works/chord/json';
import type { ToolResultMessage } from '@earendil-works/pi-ai';
import { defineTool, type Harness, type ToolRegistration } from '@earendil-works/pi-durable';
import type { Static } from '@earendil-works/pi-schema';
import { runWithDurableInvocation } from './durableInvocation.mjs';

/** Product-owned capability hints; execution and replay belong to Durable. */
export interface ToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface HostToolResult<Details = unknown> {
  content: ToolResultMessage['content'];
  details?: Details;
  structuredContent?: unknown;
  isError?: boolean;
}

type AgentToolUpdateCallback<Details = unknown> = (result: HostToolResult<Details>) => void;

/** The application tool contract, independent of a particular agent SDK. */
export interface ToolDefinition<Parameters extends object = object, Details = unknown> {
  name: string;
  label: string;
  description: string;
  promptSnippet?: string;
  promptGuidelines?: string[];
  parameters: Parameters;
  outputSchema?: object;
  annotations?: ToolAnnotations;
  executionMode?: 'parallel' | 'sequential';
  prepareArguments?(args: unknown): Static<Parameters>;
  execute(
    callId: string,
    params: Static<Parameters>,
    signal?: AbortSignal,
    onUpdate?: AgentToolUpdateCallback<Details>,
  ): Promise<HostToolResult<Details>>;
}

function json(value: unknown): JsonValue | undefined {
  const encoded = JSON.stringify(value);
  return encoded === undefined ? undefined : (JSON.parse(encoded) as JsonValue);
}

/** Register every application call as its own checkpointed Durable tool task. */
export function toDurableTool<Parameters extends object, Details>(
  definition: ToolDefinition<Parameters, Details>,
  observeConversation?: Harness['observeConversation'],
): ToolRegistration<Parameters> & { annotations?: ToolAnnotations } {
  const registered = defineTool<Parameters>({
    name: definition.name,
    description: [definition.description, ...(definition.promptGuidelines ?? [])].join('\n'),
    parameters: definition.parameters,
    ...(definition.outputSchema ? { structuredOutputSchema: definition.outputSchema } : {}),
    ...(definition.prepareArguments ? { prepareArguments: definition.prepareArguments } : {}),
    ...(definition.executionMode ? { executionMode: definition.executionMode } : {}),
    // An idempotency hint alone is not permission to repeat an external effect.
    replay:
      definition.annotations?.readOnlyHint === true &&
      definition.annotations.idempotentHint === true
        ? 'safe'
        : 'unsafe',
    execute: async (args, api, context) => {
      let streamedLength = 0;
      const result = await runWithDurableInvocation(
        api,
        context,
        () =>
          definition.execute(api.callId, args, context.abortSignal, update => {
            const output = update.content
              .flatMap(block => (block.type === 'text' ? [block.text] : []))
              .join('\n');
            if (output.length > streamedLength) {
              api.output(output.slice(streamedLength));
              streamedLength = output.length;
            }
          }),
        observeConversation,
      );
      return {
        output: result.content,
        ...(result.details === undefined ? {} : { details: json(result.details) }),
        ...(definition.outputSchema && result.structuredContent !== undefined
          ? { structuredOutput: json(result.structuredContent) }
          : {}),
        ...(result.isError ? { isError: true } : {}),
      };
    },
  });
  return Object.assign(registered, {
    ...(definition.annotations ? { annotations: definition.annotations } : {}),
  });
}
