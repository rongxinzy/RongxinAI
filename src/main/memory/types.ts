import type { MemoryBackendScope, MemoryObservationType } from './constants';

export interface MemoryObservation {
  id: number;
  sync_id: string;
  session_id: string;
  type: string;
  title: string;
  content: string;
  project?: string;
  scope: string;
  topic_key?: string;
  revision_count: number;
  duplicate_count: number;
  created_at: string;
  updated_at: string;
  deleted_at?: string;
  rank?: number;
}

export interface MemoryCandidate {
  id: string;
  sessionId: string;
  project: string;
  scope: MemoryBackendScope;
  type: MemoryObservationType;
  title: string;
  content: string;
  topicKey?: string;
  /** Stable idempotency key for save-result recovery across outbox retries
   * and process restarts (defaults to the candidate id when unset). */
  operationId?: string;
  runtimeSessionId?: string;
  recoverExistingResult?: boolean;
  createdAt: string;
}
