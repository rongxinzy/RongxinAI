/** Default page size for session list pagination. */
export const COWORK_SESSION_PAGE_SIZE = 50;

/** Default page size for message history pagination. */
export const COWORK_MESSAGE_PAGE_SIZE = 30;

/** Background page size used to keep scroll-up history ahead of the viewport. */
export const COWORK_MESSAGE_HISTORY_PAGE_SIZE = 50;

export const CoworkSessionMode = {
  Work: 'work',
  Chat: 'chat',
} as const;

export type CoworkSessionMode = (typeof CoworkSessionMode)[keyof typeof CoworkSessionMode];

/**
 * Desktop permission mode for cowork sessions.
 * Ask: the agent requests authorization before acting (current behavior).
 * AllowAll: tools execute without asking for authorization.
 */
export const CoworkPermissionMode = {
  Ask: 'ask',
  AllowAll: 'allowAll',
} as const;

export type CoworkPermissionMode = (typeof CoworkPermissionMode)[keyof typeof CoworkPermissionMode];

export const CoworkPermissionBehavior = {
  Allow: 'allow',
  Deny: 'deny',
} as const;

export type CoworkPermissionBehavior =
  (typeof CoworkPermissionBehavior)[keyof typeof CoworkPermissionBehavior];

export const CoworkPermissionOrigin = {
  PiWorkbench: 'pi-workbench',
  OpenClawBridge: 'openclaw-bridge',
} as const;

export type CoworkPermissionOrigin =
  (typeof CoworkPermissionOrigin)[keyof typeof CoworkPermissionOrigin];

export const CoworkPermissionToolName = {
  AskUserQuestion: 'AskUserQuestion',
} as const;

export type CoworkPermissionToolName =
  (typeof CoworkPermissionToolName)[keyof typeof CoworkPermissionToolName];

export const CoworkPermissionSessionId = {
  OpenClawBridge: 'openclaw-bridge',
} as const;
