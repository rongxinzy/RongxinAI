import { CoworkSessionStatus } from './constants';
import { PiUiEventType, type PiUiEvent } from './piUiEvent';

export interface PiUiRuntimeSnapshot {
  sessionId: string;
  sequence: number;
  status: (typeof CoworkSessionStatus)[keyof typeof CoworkSessionStatus];
}

export function piUiLifecycleStatus(event: PiUiEvent): PiUiRuntimeSnapshot['status'] | null {
  switch (event.type) {
    case PiUiEventType.Started:
      return CoworkSessionStatus.Running;
    case PiUiEventType.Completed:
      return CoworkSessionStatus.Completed;
    case PiUiEventType.Error:
      return CoworkSessionStatus.Error;
    case PiUiEventType.Interrupted:
    case PiUiEventType.Stopped:
      return CoworkSessionStatus.Idle;
    default:
      return null;
  }
}

/** Main-process projection of actual Pi events; never inferred from SQLite. */
export class PiUiRuntimeSnapshots {
  private readonly sessions = new Map<string, PiUiRuntimeSnapshot>();

  observe(event: PiUiEvent): void {
    if (!event.sessionId) return;
    const previous = this.sessions.get(event.sessionId);
    this.sessions.set(event.sessionId, {
      sessionId: event.sessionId,
      sequence: event.sequence,
      status: piUiLifecycleStatus(event) ?? previous?.status ?? CoworkSessionStatus.Idle,
    });
  }

  read(sessionId?: string): PiUiRuntimeSnapshot[] {
    const snapshots = sessionId
      ? [
          this.sessions.get(sessionId) ?? {
            sessionId,
            sequence: 0,
            status: CoworkSessionStatus.Idle,
          },
        ]
      : [...this.sessions.values()];
    return snapshots.map(snapshot => ({ ...snapshot }));
  }
}
