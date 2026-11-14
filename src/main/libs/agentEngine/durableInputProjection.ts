import type { PiRuntimeTurnHost } from './piRuntimeTurnEvents';
import type { ActivePiSession, PiEvent } from './piRuntimeSessionState';
import { WorkbenchContractKind, WorkbenchRunTrigger } from '../../../shared/workbenchTask';

/** Native automation inputs enter the product transcript as a projection of committed entries. */
export function projectDurableInput(
  host: PiRuntimeTurnHost,
  active: ActivePiSession,
  event: PiEvent,
): void {
  const message = event.message;
  if (!active.nativeInputProjection || message?.role !== 'user' || !message.id) return;
  const content =
    typeof message.content === 'string'
      ? message.content
      : message.content
          .flatMap(block => (block.type === 'text' && block.text ? [block.text] : []))
          .join('\n');
  active.summaryCheckpointGoal = content;
  const store = host.getStore();
  if (!store) return;
  const id = `native:${active.sessionId}:${message.id}`;
  const existed = store.getMessage(active.sessionId, id);
  const persisted = store.upsertMessage(active.sessionId, {
    id,
    type: 'user',
    content,
    timestamp: Date.now(),
    metadata: { nativeEntryId: message.id },
  });
  if (existed) return;
  host.emit('message', active.sessionId, persisted);
  const run = host.getWorkbench()?.beginRun({
    sessionId: active.sessionId,
    goal: content,
    trigger: WorkbenchRunTrigger.Message,
    contract: { kind: WorkbenchContractKind.GenericWork, requiresUserAcceptance: false },
  });
  active.workbenchRunId = run?.run.id ?? null;
  active.artifactRecorder?.onRunStart(active.workbenchRunId);
}
