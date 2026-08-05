export const EngramManagerPhase = {
  Stopped: 'stopped',
  Starting: 'starting',
  Running: 'running',
  Degraded: 'degraded',
  Stopping: 'stopping',
} as const;

export type EngramManagerPhase = (typeof EngramManagerPhase)[keyof typeof EngramManagerPhase];

export const EngramMemoryScope = {
  Project: 'project',
  Personal: 'personal',
  Session: 'session',
} as const;

export type EngramMemoryScope = (typeof EngramMemoryScope)[keyof typeof EngramMemoryScope];

export const EngramMemoryCapability = {
  Recall: 'recall',
  SaveCandidate: 'saveCandidate',
  ConfirmMemory: 'confirmMemory',
  Supersede: 'supersede',
  Forget: 'forget',
  SessionSummary: 'sessionSummary',
} as const;

export type EngramMemoryCapability =
  (typeof EngramMemoryCapability)[keyof typeof EngramMemoryCapability];

export const EngramObservationType = {
  Decision: 'decision',
  Preference: 'preference',
  SessionSummary: 'session_summary',
} as const;

export type EngramObservationType =
  (typeof EngramObservationType)[keyof typeof EngramObservationType];

export const MemoryLinkStatus = {
  Active: 'active',
  Deleted: 'deleted',
} as const;

export type MemoryLinkStatus = (typeof MemoryLinkStatus)[keyof typeof MemoryLinkStatus];

export const MemoryOutboxStatus = {
  Pending: 'pending',
  Completed: 'completed',
  Failed: 'failed',
} as const;

export type MemoryOutboxStatus = (typeof MemoryOutboxStatus)[keyof typeof MemoryOutboxStatus];

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
} as const;

export type MemorySourceKind = (typeof MemorySourceKind)[keyof typeof MemorySourceKind];

export const PiMemoryAction = {
  Recall: 'recall',
  Save: 'save',
  SessionSummary: 'session_summary',
} as const;

export type PiMemoryAction = (typeof PiMemoryAction)[keyof typeof PiMemoryAction];

export const EngramEnvironment = {
  BinaryPath: 'ZHIYUAN_ENGRAM_BIN',
  DataDirectory: 'ENGRAM_DATA_DIR',
  Port: 'ENGRAM_PORT',
  HttpToken: 'ENGRAM_HTTP_TOKEN',
  CloudAutosync: 'ENGRAM_CLOUD_AUTOSYNC',
} as const;

export const ENGRAM_RUNTIME_DIRECTORY = 'engram-runtime';
export const ENGRAM_PACKAGED_DIRECTORY = 'memory';
export const ENGRAM_DATA_DIRECTORY_SEGMENTS = ['memory', 'engram'] as const;
export const ENGRAM_LOOPBACK_HOST = '127.0.0.1';
