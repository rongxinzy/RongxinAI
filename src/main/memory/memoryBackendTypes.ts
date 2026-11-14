import type { MemoryScope, MemoryKind } from '../../shared/memory';
import type { MemorySearchMatchMode } from './constants';
import type { MemoryCandidate, MemoryObservation } from './types';

export interface MemoryCandidateInput {
  sessionId: string;
  project: string;
  scope: MemoryScope;
  type: MemoryKind;
  title: string;
  content: string;
  topicKey?: string;
  operationId?: string;
  runtimeSessionId?: string;
  recoverExistingResult?: boolean;
}

export interface MemoryRecallInput {
  query: string;
  project: string;
  scope?: MemoryScope;
  limit?: number;
  matchMode?: MemorySearchMatchMode;
  signal?: AbortSignal;
}

export type MemorySessionObserver = (sessionId: string, recovered?: boolean) => void;

export interface MemoryBackend {
  recall(input: MemoryRecallInput): Promise<MemoryObservation[]>;
  recent(input: Omit<MemoryRecallInput, 'query' | 'matchMode'>): Promise<MemoryObservation[]>;
  saveCandidate(input: MemoryCandidateInput): MemoryCandidate;
  confirmMemory(
    candidate: MemoryCandidate,
    directory: string,
    observer?: MemorySessionObserver,
  ): Promise<number | null>;
  resumeSession(
    localId: string,
    project: string,
    directory: string,
    runtimeId?: string,
  ): Promise<string>;
  finalizeSession(input: { sessionId: string; project: string; summary: string }): Promise<{
    sessionId: string;
    state: string;
    summaryId: number;
    alreadyFinalized: boolean;
  } | null>;
  supersede(input: {
    observationId: number;
    candidate: MemoryCandidate;
    workingDirectory: string;
    onRuntimeSession?: MemorySessionObserver;
  }): Promise<number | null>;
  forget(id: number, hardDelete: boolean, expectedProject?: string): Promise<boolean>;
}
