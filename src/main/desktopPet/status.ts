import { PiUiEventType, type PiUiEvent } from '../../shared/cowork/piUiEvent';
import { DesktopPetState } from '../../shared/desktopPet/constants';

/** A projection only: it never starts work or sends instructions to the runtime. */
export class DesktopPetStatus {
  private readonly active = new Set<string>();
  private readonly approvals = new Map<string, string>();
  private terminal: DesktopPetState = DesktopPetState.Idle;

  observe(event: PiUiEvent): boolean {
    const before = this.state;
    const sessionId = event.sessionId;
    switch (event.type) {
      case PiUiEventType.Started:
        this.active.add(event.sessionId);
        this.clearApprovals(event.sessionId);
        this.terminal = DesktopPetState.Idle;
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
          event.type === PiUiEventType.Completed
            ? DesktopPetState.Completed
            : event.type === PiUiEventType.Error
              ? DesktopPetState.Error
              : DesktopPetState.Idle;
        break;
    }
    return before !== this.state;
  }

  get state(): DesktopPetState {
    if (this.approvals.size > 0) return DesktopPetState.Waiting;
    if (this.active.size > 0) return DesktopPetState.Thinking;
    return this.terminal;
  }

  clearTerminal(): void {
    this.terminal = DesktopPetState.Idle;
  }

  private clearApprovals(sessionId: string): void {
    for (const [requestId, owner] of this.approvals) {
      if (owner === sessionId) this.approvals.delete(requestId);
    }
  }
}
