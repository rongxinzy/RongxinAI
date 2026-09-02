import {
  MemoryKind,
  MemoryScope,
  type MemoryDeliveryStatus,
  type MemoryLifecycleStatus,
  type MemorySensitivity,
  type MemorySummaryFormat,
  type MemorySourceKind,
} from './constants';

export interface ManagedMemoryRecord {
  id: string;
  memoryId: number | null;
  projectId: string;
  scope: MemoryScope;
  sessionId: string;
  sourceKind: MemorySourceKind;
  taskId: string | null;
  runId: string | null;
  artifactId: string | null;
  approvalId: string | null;
  status: MemoryLifecycleStatus;
  title: string;
  content: string;
  kind: MemoryKind;
  topicKey: string | null;
  importance: number;
  confidence: number;
  sensitivity: MemorySensitivity;
  expiresAt: string | null;
  supersededBy: string | null;
  promotedFromLinkId: string | null;
  promotionSourceProjectId: string | null;
  promotionSourceSessionId: string | null;
  createdAt: string;
  updatedAt: string;
  deliveryStatus: MemoryDeliveryStatus | null;
  deliveryError: string | null;
  summaryFormat?: MemorySummaryFormat | null;
}

export interface ManagedMemoryListInput {
  workingDirectory?: string;
  scope?: MemoryScope;
  status?: MemoryLifecycleStatus;
  query?: string;
}

export interface MemorySessionTitleResolveInput {
  sessionIds: string[];
}

export interface MemorySessionTitle {
  sessionId: string;
  title: string;
}

export type ManualMemoryScope = typeof MemoryScope.Project | typeof MemoryScope.Personal;

export interface ManualMemoryCreateInput {
  workingDirectory: string;
  scope: ManualMemoryScope;
  title: string;
  content: string;
  kind: typeof MemoryKind.Decision | typeof MemoryKind.Preference;
  sensitivity: MemorySensitivity;
}

export interface ManualMemoryUpdateInput {
  id: string;
  workingDirectory: string;
  title: string;
  content: string;
  kind: typeof MemoryKind.Decision | typeof MemoryKind.Preference;
  sensitivity: MemorySensitivity;
}

export interface MemoryIpcResult<T = undefined> {
  success: boolean;
  data?: T;
  error?: string;
}
