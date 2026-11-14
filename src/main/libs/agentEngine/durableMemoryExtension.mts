import {
  defineExtension,
  GenerationTask,
  hook,
  type ConversationDocToken,
  type ConversationId,
  type JsonObject,
} from '@earendil-works/pi-durable';
import type { DurableMemoryBinding } from '../../memory/markdownMemoryRuntime.js';

/** Native afterRun wiring supplies the ecosystem plugin with committed history. */
export function durableMemoryEvents(binding: DurableMemoryBinding) {
  return defineExtension({
    name: 'zhiyuan.memory-events',
    hooks: [
      hook(GenerationTask, {
        beforeRequest: async request => {
          await binding.captureRequest?.(request.messages);
          return undefined;
        },
        afterRun: async (run, api, context) => {
          const answerEntry = await api.entry(run.answer, context);
          const answer = answerEntry?.model?.find(message => message.role === 'assistant');
          if (!answer || answer.role !== 'assistant') return;
          const page = await api.entries(
            { minEntryId: run.first, maxEntryId: run.last },
            256,
            undefined,
            context,
          );
          const inputTexts = page.items.flatMap(entry =>
            (entry.model ?? []).flatMap(message =>
              message.role === 'user'
                ? [
                    typeof message.content === 'string'
                      ? message.content
                      : message.content
                          .flatMap(block => (block.type === 'text' ? [block.text] : []))
                          .join('\n'),
                  ]
                : [],
            ),
          );
          await binding.runSettled(
            {
              conversationId: api.conversationId,
              inputs: [],
              inputTexts,
              outcome: { status: 'answered', answerEntryId: run.answer, answer },
            },
            {
              entry: api.entry.bind(api),
              entries: api.entries.bind(api),
              document: (token, conversationId, ctx) =>
                api.snapshot(
                  token as ConversationDocToken<JsonObject>,
                  conversationId as ConversationId,
                  ctx,
                ),
            },
            context,
          );
          return undefined;
        },
      }),
    ],
  });
}
