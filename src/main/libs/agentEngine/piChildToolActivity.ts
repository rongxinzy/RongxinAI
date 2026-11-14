import { CoworkToolActivityPhase } from '../../../shared/cowork/toolActivity';
import type { PiRuntimeAdapterHost } from './piRuntimeAdapterHost';
import { toToolActivityInput } from './toolActivity';
import type { PiSubagentChildToolEvent } from './piSubagentConstants';

export function createChildToolActivityForwarder(host: PiRuntimeAdapterHost, sessionId: string) {
  return (event: PiSubagentChildToolEvent): void => {
    const active = host.activeSessions.get(sessionId);
    if (!active) return;
    const activity =
      event.type === 'tool_execution_end'
        ? active.toolActivityTracker.remove(event.toolCallId)
        : active.toolActivityTracker.upsert(
            {
              toolCallId: event.toolCallId,
              parentToolCallId: event.parentToolCallId,
              toolName: event.toolName,
              toolInput: toToolActivityInput(event.args),
              ...(event.partialResult === undefined ? {} : { partialResult: event.partialResult }),
            },
            CoworkToolActivityPhase.Running,
          );
    if (activity) host.emit('toolActivity', sessionId, activity);
  };
}
