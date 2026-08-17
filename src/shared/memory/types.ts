import type {
  MemoryDeliveryStatus,
  MemoryKind,
  MemoryLifecycleStatus,
  MemoryScope,
  MemorySensitivity,
  MemorySourceKind,
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
}

export interface ManagedMemoryListInput {
  scope?: MemoryScope;
  status?: MemoryLifecycleStatus;
  query?: string;
}

export interface MemoryIpcResult<T = undefined> {
  success: boolean;
  data?: T;
  error?: string;
}
