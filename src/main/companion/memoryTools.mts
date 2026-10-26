import { createHash } from 'node:crypto';
import { Type } from '@earendil-works/pi-ai';
import { defineTool } from '@earendil-works/pi-durable';
import { MemoryKind, MemoryLifecycleStatus } from '../../shared/memory/index.js';
import { CompanionMemoryTool } from './constants.js';
import type { CompanionMemoryBackend as CompanionMemoryService } from '../../shared/companion/memory.js';

export type CompanionChatMemory = Pick<
  CompanionMemoryService,
  'context' | 'search' | 'save' | 'forget'
>;

/** The host binds the owner; model arguments cannot select another companion or shared scope. */
export function companionMemoryTools(petId: string, memory: CompanionChatMemory) {
  const output = (value: object) => ({
    output: [{ type: 'text' as const, text: JSON.stringify(value) }],
  });
  return [
    defineTool({
      name: CompanionMemoryTool.Search,
      description:
        "Search this companion's saved private memories. Omit query to list recent saved memories. Returns IDs for editing or forgetting; unconfirmed candidates are excluded. Shared personal memory is read-only context, managed in Settings.",
      parameters: Type.Object(
        { query: Type.Optional(Type.String({ maxLength: 4000 })) },
        { additionalProperties: false },
      ),
      replay: 'safe',
      outputLimits: { maxBytes: 16_000 },
      execute: async args =>
        output({
          memories: (await memory.search(petId, args.query)).map(record => ({
            id: record.id,
            title: record.title,
            content: record.content,
            kind: record.kind,
          })),
        }),
    }),
    defineTool({
      name: CompanionMemoryTool.Save,
      description:
        'Save a preference or decision when the user asks you to remember it. Private to this companion. To correct an existing memory, search first and pass its ID as replacesId. available=false means queued for sync, not yet recallable. Sharing requires the user to confirm in the memory dialog.',
      parameters: Type.Object(
        {
          title: Type.String({ minLength: 1, maxLength: 120 }),
          content: Type.String({ minLength: 1, maxLength: 3000 }),
          kind: Type.Union([
            Type.Literal(MemoryKind.Preference),
            Type.Literal(MemoryKind.Decision),
          ]),
          replacesId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
        },
        { additionalProperties: false },
      ),
      replay: 'safe',
      executionMode: 'sequential',
      execute: async (args, api) => {
        // Native task IDs survive recovery and do not depend on provider-reused tool call IDs.
        const requestId = createHash('sha256')
          .update(`${api.conversationId}:${api.taskId}`)
          .digest('hex');
        const record = await memory.save({ ...args, petId, requestId });
        return output({
          id: record.id,
          title: record.title,
          content: record.content,
          status: record.status,
          available: record.status === MemoryLifecycleStatus.Active && record.memoryId !== null,
        });
      },
    }),
    defineTool({
      name: CompanionMemoryTool.Forget,
      description:
        'Forget a private memory when the user asks. Use an ID returned by search or save. Existing conversation messages and previously shared copies remain.',
      parameters: Type.Object(
        { id: Type.String({ minLength: 1, maxLength: 128 }) },
        { additionalProperties: false },
      ),
      replay: 'safe',
      executionMode: 'sequential',
      execute: async args => {
        await memory.forget(petId, args.id);
        return output({ id: args.id, forgotten: true });
      },
    }),
  ];
}

/** Only explicit tool-parameter rejection changes tool support; quota/auth failures do not. */
export function companionToolsRejected(error: string): boolean {
  return (
    /\b(?:tools?|tool_choice|function.calling)\b[^\n]{0,120}\b(?:not supported|unsupported|not allowed|not permitted)\b/i.test(
      error,
    ) ||
    /\b(?:unsupported|unknown|unrecognized) (?:parameter|field|argument)[:\s'"]+\b(?:tools|tool_choice)\b/i.test(
      error,
    ) ||
    /\bdoes not support (?:tools|tool use|function calling)\b/i.test(error)
  );
}
