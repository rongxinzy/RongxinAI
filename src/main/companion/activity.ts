/** Internal lifecycle projection: no conversation text, tools or model calls. */
export const CompanionActivityState = {
  Replying: 'replying',
  Answered: 'answered',
  Failed: 'failed',
  Stopped: 'stopped',
  Inactive: 'inactive',
} as const;
export type CompanionActivityState =
  (typeof CompanionActivityState)[keyof typeof CompanionActivityState];

export interface CompanionActivity {
  petId: string;
  submissionId: number;
  state: CompanionActivityState;
}

export const CompanionNativeSettlement = {
  Done: 'done',
  Aborted: 'aborted',
} as const;
