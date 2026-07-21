export const WorkMode = {
  Work: 'work',
  Chat: 'chat',
} as const;

export type WorkMode = (typeof WorkMode)[keyof typeof WorkMode];
