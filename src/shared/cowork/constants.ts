/** Default page size for session list pagination. */
export const COWORK_SESSION_PAGE_SIZE = 50;

/** Default page size for message history pagination. */
export const COWORK_MESSAGE_PAGE_SIZE = 30;

/** Background page size used to keep scroll-up history ahead of the viewport. */
export const COWORK_MESSAGE_HISTORY_PAGE_SIZE = 50;

export const CoworkExecutionMode = {
  Auto: 'auto',
  Local: 'local',
} as const;

export type CoworkExecutionMode = (typeof CoworkExecutionMode)[keyof typeof CoworkExecutionMode];

export const CoworkMessageType = {
  User: 'user',
  Assistant: 'assistant',
  ToolUse: 'tool_use',
  ToolResult: 'tool_result',
  System: 'system',
} as const;

export const CoworkDisplayItemType = {
  Message: 'message',
  ToolGroup: 'tool_group',
} as const;

export const CoworkSessionStatus = {
  Idle: 'idle',
  Running: 'running',
  Completed: 'completed',
  Error: 'error',
} as const;

export const CoworkSessionMode = {
  Work: 'work',
  Chat: 'chat',
} as const;

export type CoworkSessionMode = (typeof CoworkSessionMode)[keyof typeof CoworkSessionMode];

export const CoworkSessionSource = {
  Manual: 'manual',
  Scheduled: 'scheduled',
  Im: 'im',
} as const;

export type CoworkSessionSource = (typeof CoworkSessionSource)[keyof typeof CoworkSessionSource];

export const CoworkScheduledSessionTitlePrefix = {
  Chinese: '[定时]',
  English: '[Cron]',
  Legacy: 'Scheduled: ',
} as const;

/**
 * Canonical stored form of a scheduled session title. Storage is language
 * independent (`[定时]`) so creation, rename and migration cannot disagree; the
 * renderer re-prefixes it per UI language for display.
 */
export const buildScheduledSessionTitle = (name: string): string =>
  `${CoworkScheduledSessionTitlePrefix.Chinese}${name}`;

/** Drops a known scheduled prefix (and the spacing after it) from a title. */
export const stripScheduledSessionTitlePrefix = (title: string): string => {
  const trimmed = title.trim();
  const prefix = Object.values(CoworkScheduledSessionTitlePrefix).find(candidate =>
    trimmed.startsWith(candidate),
  );
  return prefix ? trimmed.slice(prefix.length).trimStart() : trimmed;
};

/**
 * Session titles are stored with the canonical prefix so search, backfill and
 * rename agree on one form; a rename that drops the prefix would also drop the
 * row's scheduled marker.
 */
export const normalizeRenamedSessionTitle = (title: string, isScheduled: boolean): string =>
  isScheduled ? buildScheduledSessionTitle(stripScheduledSessionTitlePrefix(title)) : title;

/**
 * Desktop permission mode for cowork sessions.
 * Ask: the agent requests authorization before acting.
 * AllowAll: tools execute without asking for authorization.
 */
export const CoworkPermissionMode = {
  Ask: 'ask',
  AllowAll: 'allowAll',
} as const;

export type CoworkPermissionMode = (typeof CoworkPermissionMode)[keyof typeof CoworkPermissionMode];

export const DEFAULT_COWORK_PERMISSION_MODE = CoworkPermissionMode.AllowAll;

export const CoworkPermissionBehavior = {
  Allow: 'allow',
  Deny: 'deny',
} as const;

export type CoworkPermissionBehavior =
  (typeof CoworkPermissionBehavior)[keyof typeof CoworkPermissionBehavior];

export const CoworkPermissionOrigin = {
  PiWorkbench: 'pi-workbench',
} as const;

export type CoworkPermissionOrigin =
  (typeof CoworkPermissionOrigin)[keyof typeof CoworkPermissionOrigin];

export const CoworkPermissionToolName = {
  AskUserQuestion: 'AskUserQuestion',
} as const;

export type CoworkPermissionToolName =
  (typeof CoworkPermissionToolName)[keyof typeof CoworkPermissionToolName];

export const CoworkPermissionSessionId = {
  LegacyBridge: 'legacy-bridge',
} as const;
