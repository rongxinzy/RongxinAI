export const MemoryScope = {
  Project: 'project',
  Personal: 'personal',
  Session: 'session',
} as const;

export type MemoryScope = (typeof MemoryScope)[keyof typeof MemoryScope];

export const MemoryKind = {
  Decision: 'decision',
  Preference: 'preference',
  SessionSummary: 'session_summary',
} as const;

export type MemoryKind = (typeof MemoryKind)[keyof typeof MemoryKind];

export const MemoryLifecycleStatus = {
  Active: 'active',
  NeedsReview: 'needs_review',
  Superseded: 'superseded',
  Expired: 'expired',
  Archived: 'archived',
  Deleted: 'deleted',
} as const;

export type MemoryLifecycleStatus =
  (typeof MemoryLifecycleStatus)[keyof typeof MemoryLifecycleStatus];

export const MemorySensitivity = {
  Normal: 'normal',
  Sensitive: 'sensitive',
} as const;

export type MemorySensitivity = (typeof MemorySensitivity)[keyof typeof MemorySensitivity];

export const MemoryDeliveryStatus = {
  Pending: 'pending',
  Completed: 'completed',
  Failed: 'failed',
} as const;

export type MemoryDeliveryStatus = (typeof MemoryDeliveryStatus)[keyof typeof MemoryDeliveryStatus];

export const MemoryOutboxOperation = {
  Confirm: 'confirm',
  SessionSummary: 'session_summary',
  Supersede: 'supersede',
  Forget: 'forget',
} as const;

export type MemoryOutboxOperation =
  (typeof MemoryOutboxOperation)[keyof typeof MemoryOutboxOperation];

export const MemorySourceKind = {
  Explicit: 'explicit',
  SessionSummary: 'session_summary',
  TaskVerifier: 'task_verifier',
  ModelProposal: 'model_proposal',
  LegacyFileImport: 'legacy_file_import',
  LegacySqliteImport: 'legacy_sqlite_import',
} as const;

export type MemorySourceKind = (typeof MemorySourceKind)[keyof typeof MemorySourceKind];

export const MemoryIpcChannel = {
  List: 'memory:list',
  ResolveSessionTitles: 'memory:resolveSessionTitles',
  CreateManual: 'memory:createManual',
  UpdateManual: 'memory:updateManual',
  ConfirmCandidate: 'memory:confirmCandidate',
  Archive: 'memory:archive',
  Restore: 'memory:restore',
  Forget: 'memory:forget',
  DrainOutbox: 'memory:drainOutbox',
} as const;

export const PERSONAL_MEMORY_PROJECT_ID = 'personal://zhiyuan-agent/user';
