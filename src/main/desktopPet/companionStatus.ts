import { CompanionActivityState, type CompanionActivity } from '../companion/activity';
import { DESKTOP_PET_TERMINAL_MS, DesktopPetState } from '../../shared/desktopPet/constants';

/** Chat is subordinate to every workbench state and never creates task reminders. */
export class DesktopPetCompanionStatus {
  private state: DesktopPetState = DesktopPetState.Idle;
  private visible = false;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(private readonly changed: () => void) {}

  observe(activity: CompanionActivity): void {
    clearTimeout(this.timer);
    this.state =
      activity.state === CompanionActivityState.Replying
        ? DesktopPetState.Thinking
        : !this.visible
          ? DesktopPetState.Idle
          : activity.state === CompanionActivityState.Answered
            ? DesktopPetState.Completed
            : activity.state === CompanionActivityState.Failed
              ? DesktopPetState.Error
              : DesktopPetState.Idle;
    if (this.state === DesktopPetState.Completed || this.state === DesktopPetState.Error) {
      this.timer = setTimeout(() => {
        this.state = DesktopPetState.Idle;
        this.changed();
      }, DESKTOP_PET_TERMINAL_MS);
    }
    this.changed();
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    if (!visible && this.state !== DesktopPetState.Thinking) this.reset();
  }

  project(taskState: DesktopPetState): DesktopPetState {
    return taskState === DesktopPetState.Idle ? this.state : taskState;
  }

  labelKey(taskState: DesktopPetState): string | null {
    if (taskState !== DesktopPetState.Idle) return null;
    if (this.state === DesktopPetState.Thinking) return 'companionWorking';
    if (this.state === DesktopPetState.Completed) return 'companionReplyReady';
    if (this.state === DesktopPetState.Error) return 'companionReplyInterrupted';
    return null;
  }

  reset(): void {
    clearTimeout(this.timer);
    this.state = DesktopPetState.Idle;
  }
}
