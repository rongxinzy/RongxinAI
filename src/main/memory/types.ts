import type { EngramManagerPhase, EngramMemoryScope, EngramObservationType } from './constants';

export interface EngramConnection {
  url: string;
  token: string;
}

export interface EngramManagerStatus {
  phase: EngramManagerPhase;
  available: boolean;
  restartAttempts: number;
  error?: string;
}

export interface EngramObservation {
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
  scope: EngramMemoryScope;
  type: EngramObservationType;
  title: string;
  content: string;
  topicKey?: string;
  createdAt: string;
}
