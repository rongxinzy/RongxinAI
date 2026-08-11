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
  SessionSummary: 'session_summary',
} as const;

export type PiMemoryAction = (typeof PiMemoryAction)[keyof typeof PiMemoryAction];

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
