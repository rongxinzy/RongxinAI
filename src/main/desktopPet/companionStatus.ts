import { CompanionRequestState } from '../../shared/companion/constants';
import { DESKTOP_PET_TERMINAL_MS, DesktopPetState } from '../../shared/desktopPet/constants';

/** Chat is subordinate to every workbench state and never creates task reminders. */
export class DesktopPetCompanionStatus {
  private terminalState: DesktopPetState = DesktopPetState.Idle;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(
    private readonly hasPendingReply: () => boolean,
    private readonly changed: () => void,
  ) {}

  observe(activity: CompanionRequestState | null, visible: boolean): void {
    clearTimeout(this.timer);
    this.terminalState = !visible
      ? DesktopPetState.Idle
      : activity === CompanionRequestState.Answered
        ? DesktopPetState.Completed
        : activity === CompanionRequestState.Unanswered
          ? DesktopPetState.Error
          : DesktopPetState.Idle;
    if (this.terminalState !== DesktopPetState.Idle) {
      this.timer = setTimeout(() => {
        this.terminalState = DesktopPetState.Idle;
        this.changed();
      }, DESKTOP_PET_TERMINAL_MS);
    }
    this.changed();
  }

  project(taskState: DesktopPetState): DesktopPetState {
    if (taskState !== DesktopPetState.Idle) return taskState;
    return this.hasPendingReply() ? DesktopPetState.Thinking : this.terminalState;
  }

  labelKey(taskState: DesktopPetState, projected: DesktopPetState): string | null {
    if (taskState !== DesktopPetState.Idle) return null;
    if (projected === DesktopPetState.Thinking) return 'companionWorking';
    if (projected === DesktopPetState.Completed) return 'companionReplyReady';
    if (projected === DesktopPetState.Error) return 'companionReplyInterrupted';
    return null;
  }

  reset(): void {
    clearTimeout(this.timer);
    this.terminalState = DesktopPetState.Idle;
  }
}
