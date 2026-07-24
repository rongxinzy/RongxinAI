/** Default page size for session list pagination. */
export const COWORK_SESSION_PAGE_SIZE = 50;

/** Default page size for message history pagination. */
export const COWORK_MESSAGE_PAGE_SIZE = 30;

export const CoworkSessionMode = {
  Work: 'work',
  Chat: 'chat',
} as const;

export type CoworkSessionMode = (typeof CoworkSessionMode)[keyof typeof CoworkSessionMode];
