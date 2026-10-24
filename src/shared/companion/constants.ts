export const CompanionCapability = {
  Local: 'local',
  Chat: 'chat',
} as const;
export type CompanionCapability = (typeof CompanionCapability)[keyof typeof CompanionCapability];

export const CompanionRequestState = {
  Accepted: 'accepted',
  Answered: 'answered',
  Unanswered: 'unanswered',
} as const;
export type CompanionRequestState =
  (typeof CompanionRequestState)[keyof typeof CompanionRequestState];

export const CompanionUnavailableReason = {
  NoModel: 'no_model',
  ModelFailed: 'model_failed',
} as const;
export type CompanionUnavailableReason =
  (typeof CompanionUnavailableReason)[keyof typeof CompanionUnavailableReason];
