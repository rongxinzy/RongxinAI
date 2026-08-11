export const CoworkInterruptionCause = {
  UserStop: 'user_stop',
  ApprovalDenied: 'approval_denied',
  RuntimePaused: 'runtime_paused',
} as const;

export type CoworkInterruptionCause =
  (typeof CoworkInterruptionCause)[keyof typeof CoworkInterruptionCause];

export interface CoworkSessionInterruption {
  sessionId: string;
  interruptionId: string;
  cause: CoworkInterruptionCause;
  taskId: string | null;
  recoverable: boolean;
}
