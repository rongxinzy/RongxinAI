import { PiUiEventType, type PiUiEvent } from '../../shared/cowork/piUiEvent';
import { DesktopPetState } from '../../shared/desktopPet/constants';
import type { DesktopPetFailure } from '../../shared/desktopPet/types';

/** A projection only: it never starts work or sends instructions to the runtime. */
export class DesktopPetStatus {
  private readonly active = new Set<string>();
  private readonly approvals = new Map<string, string>();
  private terminal: DesktopPetState = DesktopPetState.Idle;
  private terminalSession: string | null = null;
  private readonly failures = new Map<string, string>();

  restoreFailures(entries: DesktopPetFailure[]): void {
    for (const entry of entries) {
      if (!this.failures.has(entry.sessionId)) this.failures.set(entry.sessionId, entry.eventId);
    }
  }

  get pendingFailures(): DesktopPetFailure[] {
    return Array.from(this.failures, ([sessionId, eventId]) => ({ sessionId, eventId }));
  }

  acknowledgeFailure(sessionId: string, eventId: string | undefined): void {
    if (eventId && this.failures.get(sessionId) === eventId) this.failures.delete(sessionId);
  }

  removeSession(sessionId: string): void {
    this.active.delete(sessionId);
    this.clearApprovals(sessionId);
    this.failures.delete(sessionId);
    if (this.terminalSession === sessionId) this.clearTerminal();
  }

  get targetSessionId(): string | null {
    return (
      this.approvals.values().next().value ??
      this.failures.keys().next().value ??
      this.active.values().next().value ??
      this.terminalSession
    );
  }

  observe(event: PiUiEvent): boolean {
    const before = `${this.state}:${this.targetSessionId}:${this.failures.size}`;
    const sessionId = event.sessionId;
    switch (event.type) {
      case PiUiEventType.Started:
        this.active.add(event.sessionId);
        this.clearApprovals(event.sessionId);
        this.terminal = DesktopPetState.Idle;
        this.terminalSession = null;
        break;
      case PiUiEventType.PermissionRequest:
        this.active.add(event.sessionId);
        this.approvals.set(event.request.requestId, event.sessionId);
        break;
      case PiUiEventType.PermissionDismiss:
        this.approvals.delete(event.requestId);
        break;
      case PiUiEventType.Completed:
      case PiUiEventType.Error:
      case PiUiEventType.Stopped:
      case PiUiEventType.Interrupted:
        if (sessionId) {
          this.active.delete(sessionId);
          this.clearApprovals(sessionId);
        }
        this.terminal =
          event.type === PiUiEventType.Completed ? DesktopPetState.Completed : DesktopPetState.Idle;
        this.terminalSession = event.type === PiUiEventType.Completed ? sessionId : null;
        if (event.type === PiUiEventType.Error && sessionId)
          this.failures.set(sessionId, event.eventId);
        if (event.type === PiUiEventType.Completed && sessionId) this.failures.delete(sessionId);
        break;
    }
    // Lifecycle changes also need persistence when the visible priority stays unchanged.
    return (
      before !== `${this.state}:${this.targetSessionId}:${this.failures.size}` ||
      event.type === PiUiEventType.Error ||
      event.type === PiUiEventType.Completed
    );
  }

  get state(): DesktopPetState {
    if (this.approvals.size > 0) return DesktopPetState.Waiting;
    if (this.failures.size > 0) return DesktopPetState.Error;
    if (this.active.size > 0) return DesktopPetState.Thinking;
    return this.terminal;
  }

  clearTerminal(): void {
    this.terminal = DesktopPetState.Idle;
    this.terminalSession = null;
  }

  private clearApprovals(sessionId: string): void {
    for (const [requestId, owner] of this.approvals) {
      if (owner === sessionId) this.approvals.delete(requestId);
    }
  }
}
