import { randomUUID } from 'crypto';

import {
  EngramMemoryScope,
  EngramObservationType,
  type EngramSearchMatchMode as EngramSearchMatchModeValue,
  type EngramMemoryScope as EngramMemoryScopeValue,
  type EngramObservationType as EngramObservationTypeValue,
} from './constants';
import type { EngramManager } from './engramManager';
import type { EngramConnection, EngramObservation, MemoryCandidate } from './types';

interface CandidateInput {
  sessionId: string;
  project: string;
  scope: EngramMemoryScopeValue;
  type: EngramObservationTypeValue;
  title: string;
  content: string;
  topicKey?: string;
}

export class ZhiYuanEngramAdapter {
  private readonly candidates = new Map<string, MemoryCandidate>();
  private readonly registeredSessions = new Set<string>();

  constructor(private readonly manager: EngramManager) {}

  async recall(input: {
    query: string;
    project: string;
    scope?: EngramMemoryScopeValue;
    limit?: number;
    matchMode?: EngramSearchMatchModeValue;
  }): Promise<EngramObservation[]> {
    const connection = await this.getConnection();
    if (!connection) return [];
    const params = new URLSearchParams({
      q: input.query,
      project: input.project,
      scope: input.scope ?? EngramMemoryScope.Project,
      limit: String(Math.min(Math.max(input.limit ?? 8, 1), 20)),
    });
    if (input.matchMode) params.set('match_mode', input.matchMode);
    const observations = await this.request<EngramObservation[] | null>(
      connection,
      `/search?${params.toString()}`,
    );
    return Array.isArray(observations) ? observations : [];
  }

  async recent(input: {
    project: string;
    scope?: EngramMemoryScopeValue;
    limit?: number;
  }): Promise<EngramObservation[]> {
    const connection = await this.getConnection();
    if (!connection) return [];
    const params = new URLSearchParams({
      project: input.project,
      scope: input.scope ?? EngramMemoryScope.Project,
      limit: String(Math.min(Math.max(input.limit ?? 8, 1), 20)),
    });
    const observations = await this.request<EngramObservation[] | null>(
      connection,
      `/observations/recent?${params.toString()}`,
    );
    return Array.isArray(observations) ? observations : [];
  }

  saveCandidate(input: CandidateInput): MemoryCandidate {
    const candidate: MemoryCandidate = {
      id: randomUUID(),
      ...input,
      title: redactPrivateBlocks(input.title),
      content: redactPrivateBlocks(input.content),
      createdAt: new Date().toISOString(),
    };
    this.candidates.set(candidate.id, candidate);
    return candidate;
  }

  discardCandidate(candidateId: string): void {
    this.candidates.delete(candidateId);
  }

  async confirmMemory(candidateId: string, workingDirectory: string): Promise<number | null> {
    const candidate = this.candidates.get(candidateId);
    if (!candidate) throw new Error('Memory candidate not found.');
    const connection = await this.getConnection();
    if (!connection) return null;
    await this.ensureSession(connection, candidate.sessionId, candidate.project, workingDirectory);
    const saved = await this.request<{ id: number }>(connection, '/observations', {
      method: 'POST',
      body: JSON.stringify({
        session_id: candidate.sessionId,
        project: candidate.project,
        scope: candidate.scope,
        type: candidate.type,
        title: candidate.title,
        content: candidate.content,
        topic_key: candidate.topicKey,
      }),
    });
    this.candidates.delete(candidateId);
    return saved.id;
  }

  async supersede(input: {
    observationId: number;
    replacementCandidateId: string;
    workingDirectory: string;
  }): Promise<number | null> {
    const replacementId = await this.confirmMemory(
      input.replacementCandidateId,
      input.workingDirectory,
    );
    if (replacementId === null) return null;
    await this.forget(input.observationId, false);
    return replacementId;
  }

  async forget(observationId: number, hardDelete: boolean): Promise<boolean> {
    const connection = await this.getConnection();
    if (!connection) return false;
    await this.request(connection, `/observations/${observationId}?hard=${hardDelete}`, {
      method: 'DELETE',
    });
    return true;
  }

  async sessionSummary(input: {
    sessionId: string;
    project: string;
    workingDirectory: string;
    summary: string;
  }): Promise<number | null> {
    const candidate = this.saveCandidate({
      sessionId: input.sessionId,
      project: input.project,
      scope: EngramMemoryScope.Session,
      type: EngramObservationType.SessionSummary,
      title: 'Session summary',
      content: input.summary,
      topicKey: `session/${input.sessionId}`,
    });
    return await this.confirmMemory(candidate.id, input.workingDirectory);
  }

  private async getConnection(): Promise<EngramConnection | null> {
    return this.manager.getConnection() ?? (await this.manager.start());
  }

  private async ensureSession(
    connection: EngramConnection,
    sessionId: string,
    project: string,
    workingDirectory: string,
  ): Promise<void> {
    if (this.registeredSessions.has(sessionId)) return;
    await this.request(connection, '/sessions', {
      method: 'POST',
      body: JSON.stringify({ id: sessionId, project, directory: workingDirectory }),
    });
    this.registeredSessions.add(sessionId);
  }

  private async request<T = unknown>(
    connection: EngramConnection,
    pathname: string,
    init: RequestInit = {},
  ): Promise<T> {
    const response = await fetch(`${connection.url}${pathname}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${connection.token}`,
        'Content-Type': 'application/json',
        ...init.headers,
      },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      const method = init.method ?? 'GET';
      throw new Error(
        `Memory service request failed with HTTP ${response.status} for ${method} ${pathname}.`,
      );
    }
    return (await response.json()) as T;
  }
}

export function redactPrivateBlocks(value: string): string {
  return value.replace(/<private>[\s\S]*?<\/private>/gi, '[REDACTED]');
}
