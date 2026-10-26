import { BACKGROUND_CONTEXT, withCancel } from '@earendil-works/chord/context';
import type { Submission } from '@earendil-works/pi-durable';
import {
  CompanionActivityState,
  CompanionNativeSettlement,
  type CompanionActivity,
} from './activity.js';

/** One native cancellable waiter for the single active companion. No polling or generation. */
export class CompanionSubmissionActivity {
  private readonly listeners = new Set<(activity: CompanionActivity) => void>();
  private current?: { petId: string; submissionId: number; cancel(): void };

  subscribe(listener: (activity: CompanionActivity) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  track(petId: string, submission: Submission): void {
    if (this.current?.petId === petId && this.current.submissionId === submission.id) return;
    this.clear();
    const waiter = withCancel(BACKGROUND_CONTEXT);
    const current = { petId, submissionId: submission.id, cancel: waiter.cancel };
    this.current = current;
    this.emit({ petId, submissionId: submission.id, state: CompanionActivityState.Replying });
    void submission
      .wait(waiter.context)
      .then(record => {
        if (this.current !== current) return;
        this.emit({
          petId,
          submissionId: submission.id,
          state:
            record.status === CompanionNativeSettlement.Done
              ? CompanionActivityState.Answered
              : record.reason === CompanionNativeSettlement.Aborted
                ? CompanionActivityState.Stopped
                : CompanionActivityState.Failed,
        });
      })
      .catch(error => {
        if (this.current !== current) return;
        console.warn(
          `[Companion] Activity observation failed for submission ${submission.id}:`,
          error,
        );
        this.emit({ petId, submissionId: submission.id, state: CompanionActivityState.Failed });
      });
  }

  clear(): void {
    const current = this.current;
    if (!current) return;
    this.current = undefined;
    current.cancel();
    this.emit({
      petId: current.petId,
      submissionId: current.submissionId,
      state: CompanionActivityState.Inactive,
    });
  }

  private emit(activity: CompanionActivity): void {
    for (const listener of this.listeners) {
      try {
        listener(activity);
      } catch (error) {
        console.warn(
          `[Companion] Activity listener failed for submission ${activity.submissionId}:`,
          error,
        );
      }
    }
  }
}
