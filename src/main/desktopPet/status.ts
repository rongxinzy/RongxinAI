import { PiUiEventType, type PiUiEvent } from '../../shared/cowork/piUiEvent';
import { piUiLifecycleStatus } from '../../shared/cowork/piUiRuntimeSnapshot';
import { DesktopPetState } from '../../shared/desktopPet/constants';
import type { DesktopPetFailure } from '../../shared/desktopPet/types';

/** A projection only: it never starts work or sends instructions to the runtime. */
export class DesktopPetStatus {
  private terminal: DesktopPetState = DesktopPetState.Idle;
  private terminalSession: string | null = null;
  private readonly failures = new Map<string, string>();

  constructor(
    private readonly runningSessionId: () => string | undefined,
    private readonly pendingPermissionSessionId: () => string | undefined,
  ) {}

  restoreFailures(entries: DesktopPetFailure[]): void {
    for (const entry of entries) {
      if (!this.failures.has(entry.sessionId)) this.failures.set(entry.sessionId, entry.eventId);
    }
  }

  get pendingFailures(): DesktopPetFailure[] {
    return Array.from(this.failures, ([sessionId, eventId]) => ({ sessionId, eventId }));
  }

  acknowledgeFailure(sessionId: string, eventId: string | undefined): boolean {
    return eventId !== undefined && this.failures.get(sessionId) === eventId
      ? this.failures.delete(sessionId)
      : false;
  }

  removeSession(sessionId: string): boolean {
    if (this.terminalSession === sessionId) this.clearTerminal();
    return this.failures.delete(sessionId);
  }

  get targetSessionId(): string | null {
    return (
      this.pendingPermissionSessionId() ??
      this.failures.keys().next().value ??
      this.runningSessionId() ??
      this.terminalSession
    );
  }

  observe(event: PiUiEvent): { presentationChanged: boolean; failuresChanged: boolean } {
    const lifecycleChanged = piUiLifecycleStatus(event) !== null;
    if (
      !lifecycleChanged &&
      event.type !== PiUiEventType.PermissionRequest &&
      event.type !== PiUiEventType.PermissionDismiss
    ) {
      return { presentationChanged: false, failuresChanged: false };
    }
    if (!lifecycleChanged) return { presentationChanged: true, failuresChanged: false };
    const sessionId = event.sessionId;
    const previousFailure = sessionId ? this.failures.get(sessionId) : undefined;
    switch (event.type) {
      case PiUiEventType.Started:
        this.terminal = DesktopPetState.Idle;
        this.terminalSession = null;
        break;
      case PiUiEventType.Completed:
      case PiUiEventType.Error:
      case PiUiEventType.Stopped:
      case PiUiEventType.Interrupted:
        this.terminal =
          event.type === PiUiEventType.Completed ? DesktopPetState.Completed : DesktopPetState.Idle;
        this.terminalSession = event.type === PiUiEventType.Completed ? sessionId : null;
        if (event.type === PiUiEventType.Error && sessionId)
          this.failures.set(sessionId, event.eventId);
        if (event.type === PiUiEventType.Completed && sessionId) this.failures.delete(sessionId);
        break;
    }
    return {
      presentationChanged: true,
      failuresChanged: !!sessionId && previousFailure !== this.failures.get(sessionId),
    };
  }

  get state(): DesktopPetState {
    if (this.pendingPermissionSessionId()) return DesktopPetState.Waiting;
    if (this.failures.size > 0) return DesktopPetState.Error;
    if (this.runningSessionId()) return DesktopPetState.Thinking;
    return this.terminal;
  }

  clearTerminal(): void {
    this.terminal = DesktopPetState.Idle;
    this.terminalSession = null;
  }
}
