import {
  MemoryScope,
  type MemoryKind as MemoryKindValue,
  type MemorySensitivity as MemorySensitivityValue,
  type MemorySourceKind as MemorySourceKindValue,
} from '../../shared/memory';

export interface ConfirmPayload {
  sessionId: string;
  projectId: string;
  projectRoot: string;
  type: MemoryKindValue;
  title: string;
  content: string;
  topicKey?: string;
  sourceKind: MemorySourceKindValue;
  scope: typeof MemoryScope.Project | typeof MemoryScope.Personal | typeof MemoryScope.Session;
  linkId: string;
  taskId?: string;
  runId?: string;
  artifactId?: string;
  approvalId?: string;
  importance?: number;
  confidence?: number;
  sensitivity?: MemorySensitivityValue;
  expiresAt?: string;
  supersedesLinkId?: string;
  supersededObservationId?: number;
  promotedFromLinkId?: string;
  promotionSourceProjectId?: string;
  promotionSourceSessionId?: string;
  promotionOriginSessionId?: string;
  candidateBacked?: boolean;
  metadata?: Record<string, unknown>;
}

export interface ForgetPayload {
  linkId: string;
  observationId: number;
  hardDelete: boolean;
  projectId?: string;
}

export function parseConfirmPayload(payload: Record<string, unknown>): ConfirmPayload | null {
  const required = [
    'sessionId',
    'projectId',
    'projectRoot',
    'type',
    'title',
    'content',
    'sourceKind',
    'scope',
    'linkId',
  ] as const;
  if (required.some(key => typeof payload[key] !== 'string' || !payload[key])) return null;
  return payload as unknown as ConfirmPayload;
}

export function parseForgetPayload(payload: Record<string, unknown>): ForgetPayload | null {
  if (
    typeof payload.linkId !== 'string' ||
    typeof payload.observationId !== 'number' ||
    typeof payload.hardDelete !== 'boolean'
  ) {
    return null;
  }
  return payload as unknown as ForgetPayload;
}
