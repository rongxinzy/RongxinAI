export const CoworkUiEvent = {
  OpenShareOptions: 'cowork:open-share-options',
} as const;

export type CoworkUiEvent = (typeof CoworkUiEvent)[keyof typeof CoworkUiEvent];

export const CoworkSessionView = {
  Conversation: 'conversation',
  Trace: 'trace',
} as const;

export type CoworkSessionView = (typeof CoworkSessionView)[keyof typeof CoworkSessionView];

export const isCoworkSessionView = (value: unknown): value is CoworkSessionView =>
  Object.values(CoworkSessionView).includes(value as CoworkSessionView);

export interface CoworkOpenShareOptionsEventDetail {
  sessionId: string;
}
