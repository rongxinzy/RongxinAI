export const CoworkUiEvent = {
  OpenShareOptions: 'cowork:open-share-options',
} as const;

export type CoworkUiEvent = (typeof CoworkUiEvent)[keyof typeof CoworkUiEvent];

export interface CoworkOpenShareOptionsEventDetail {
  sessionId: string;
}
