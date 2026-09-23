import { PiUiEventType, type PiUiEventPayload } from '../shared/cowork/piUiEvent';

/** Coalesce full-content replacements before assigning wire sequence numbers. */
export function createPiUiEventBatcher(
  emit: (payload: PiUiEventPayload) => void,
): (payload: PiUiEventPayload) => void {
  const pending = new Map<string, PiUiEventPayload>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = (): void => {
    clearTimeout(timer);
    timer = undefined;
    const updates = [...pending.values()];
    pending.clear();
    for (const update of updates) emit(update);
  };

  return payload => {
    if (payload.type === PiUiEventType.MessageUpdate) {
      const key = JSON.stringify([payload.sessionId, payload.messageId]);
      pending.set(key, payload);
      timer ??= setTimeout(flush, 32);
      return;
    }
    // Preserve ordering at every message, permission, and lifecycle boundary.
    flush();
    emit(payload);
  };
}
