/** Optional context must never hold up an agent request for service startup. */

import {
  MemoryDeliveryStatus,
  MemoryKind,
  MemoryOutboxOperation as SharedMemoryOutboxOperation,
  MemoryScope,
  MemorySourceKind as SharedMemorySourceKind,
  type MemoryDeliveryStatus as MemoryDeliveryStatusValue,
  type MemoryKind as MemoryKindValue,
  type MemoryOutboxOperation as MemoryOutboxOperationValue,
  type MemoryScope as MemoryScopeValue,
  type MemorySourceKind as MemorySourceKindValue,
} from '../../shared/memory';

export const MemoryBackendScope = MemoryScope;
export type MemoryBackendScope = MemoryScopeValue;

export const MemoryObservationType = MemoryKind;
export type MemoryObservationType = MemoryKindValue;

export const MemoryOutboxStatus = MemoryDeliveryStatus;
export type MemoryOutboxStatus = MemoryDeliveryStatusValue;

export const SessionCheckpointSyncState = {
  Pending: 'pending',
  Synced: 'synced',
  Superseded: 'superseded',
} as const;
export type SessionCheckpointSyncState =
  (typeof SessionCheckpointSyncState)[keyof typeof SessionCheckpointSyncState];

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
export const PERSONAL_MEMORY_SESSION_PREFIX = 'personal:';
export const MANUAL_MEMORY_SESSION_ID = 'settings-memory';

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

export const MemorySearchMatchMode = {
  All: 'all',
  Any: 'any',
} as const;

export type MemorySearchMatchMode =
  (typeof MemorySearchMatchMode)[keyof typeof MemorySearchMatchMode];

export const SESSION_SUMMARY_TTL_DAYS = 30;
