export const EngramManagerPhase = {
  Stopped: 'stopped',
  Starting: 'starting',
  Running: 'running',
  Degraded: 'degraded',
  Stopping: 'stopping',
} as const;

export type EngramManagerPhase = (typeof EngramManagerPhase)[keyof typeof EngramManagerPhase];

import {
  MemoryDeliveryStatus,
  MemoryKind,
  MemoryLifecycleStatus,
  MemoryOutboxOperation as SharedMemoryOutboxOperation,
  MemoryScope,
  MemorySourceKind as SharedMemorySourceKind,
  type MemoryDeliveryStatus as MemoryDeliveryStatusValue,
  type MemoryKind as MemoryKindValue,
  type MemoryLifecycleStatus as MemoryLifecycleStatusValue,
  type MemoryOutboxOperation as MemoryOutboxOperationValue,
  type MemoryScope as MemoryScopeValue,
  type MemorySourceKind as MemorySourceKindValue,
} from '../../shared/memory';

export const EngramMemoryScope = MemoryScope;
export type EngramMemoryScope = MemoryScopeValue;

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

export const EngramObservationType = MemoryKind;
export type EngramObservationType = MemoryKindValue;

export const MemoryLinkStatus = MemoryLifecycleStatus;
export type MemoryLinkStatus = MemoryLifecycleStatusValue;

export const MemoryOutboxStatus = MemoryDeliveryStatus;
export type MemoryOutboxStatus = MemoryDeliveryStatusValue;

export const MemoryOutboxOperation = SharedMemoryOutboxOperation;
export type MemoryOutboxOperation = MemoryOutboxOperationValue;

export const MemorySourceKind = SharedMemorySourceKind;
export type MemorySourceKind = MemorySourceKindValue;

export const PiMemoryAction = {
  Recall: 'recall',
  List: 'list',
  Save: 'save',
  ProposePersonal: 'propose_personal',
} as const;

export type PiMemoryAction = (typeof PiMemoryAction)[keyof typeof PiMemoryAction];

export const AtomicMemorySourceKind = {
  Conversation: 'conversation',
  TaskGoal: 'task_goal',
  FinalAnswer: 'final_answer',
  Verification: 'verification',
  Artifact: 'artifact',
  Approval: 'approval',
  ExistingMemory: 'existing_memory',
} as const;

export type AtomicMemorySourceKind =
  (typeof AtomicMemorySourceKind)[keyof typeof AtomicMemorySourceKind];

export const ATOMIC_MEMORY_EXTRACTOR_VERSION = 1;
export const SESSION_MEMORY_EXTRACTOR_VERSION = 1;
export const SEMANTIC_MEMORY_MIGRATION_VERSION = 1;
export const PERSONAL_MEMORY_SESSION_PREFIX = 'personal:';
export const MANUAL_MEMORY_SESSION_ID = 'settings-memory';
export const LEGACY_MEMORY_FILE_SESSION_ID = 'legacy-memory-file';
export const LEGACY_MEMORY_SQLITE_SESSION_ID = 'legacy-user-memories';
export const LEGACY_MEMORY_CANDIDATE_PREFIX = 'legacy-memory:';
export const LEGACY_MEMORY_FILE_IMPORT_VERSION = 1;
export const LEGACY_MEMORY_SQLITE_IMPORT_VERSION = 1;

export const MemoryExtractorKind = {
  Atomic: 'atomic_memory',
} as const;

export type MemoryExtractorKind = (typeof MemoryExtractorKind)[keyof typeof MemoryExtractorKind];

export const MemoryRecordStorageKind = {
  Link: 'link',
  Candidate: 'candidate',
} as const;

export type MemoryRecordStorageKind =
  (typeof MemoryRecordStorageKind)[keyof typeof MemoryRecordStorageKind];

export const SemanticMemoryMigrationStatus = {
  DeliveryPending: 'delivery_pending',
  PendingReview: 'pending_review',
  RetainedNoReplacement: 'retained_no_replacement',
  EvidenceUnavailable: 'evidence_unavailable',
} as const;

export type SemanticMemoryMigrationStatus =
  (typeof SemanticMemoryMigrationStatus)[keyof typeof SemanticMemoryMigrationStatus];

export const EngramSearchMatchMode = {
  All: 'all',
  Any: 'any',
} as const;

export type EngramSearchMatchMode =
  (typeof EngramSearchMatchMode)[keyof typeof EngramSearchMatchMode];

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
export const SESSION_SUMMARY_TTL_DAYS = 30;
