import type { Context } from '@earendil-works/chord/context';
import type { ConversationId } from '@earendil-works/pi-durable';
import { getDurableInvocation } from './durableInvocation.mjs';
import { DurableEventProjector } from './durableEventProjector.mjs';
import type { PiSubagentChildToolEvent } from './piSubagentConstants.js';

/** Observe native child commits for display; execution still belongs to the owned tasks. */
export async function observeDurableChildActivity(
  childId: ConversationId,
  context: Context,
  parentToolCallId: string,
  emit?: (event: PiSubagentChildToolEvent) => void,
): Promise<() => Promise<void>> {
  const observe = getDurableInvocation().observeConversation;
  if (!emit || !observe) return async () => {};
  const pending = new Map<string, string>();
  const projector = new DurableEventProjector(event => {
    if (!event.type.startsWith('tool_execution_') || !event.toolCallId || !event.toolName) return;
    const toolCallId = `${childId}:${event.toolCallId}`;
    if (event.type === 'tool_execution_end') pending.delete(toolCallId);
    else pending.set(toolCallId, event.toolName);
    emit({
      ...event,
      type: event.type as PiSubagentChildToolEvent['type'],
      toolCallId,
      toolName: event.toolName,
      parentToolCallId,
    });
  });
  const observation = await observe(
    childId,
    {
      advance: call => {
        if (call.kind === 'value') projector.advance(call.value, call.ops);
      },
      end: () => {},
    },
    context,
  );
  projector.seed(observation.value);
  return async () => {
    observation.detach();
    for (const [toolCallId, toolName] of pending)
      emit({ type: 'tool_execution_end', toolCallId, toolName, parentToolCallId });
  };
}
