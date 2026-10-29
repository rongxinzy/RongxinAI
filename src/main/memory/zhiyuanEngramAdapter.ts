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
  operationId?: string;
  runtimeSessionId?: string;
  recoverExistingResult?: boolean;
}

export class EngramRequestError extends Error {
  constructor(
    readonly status: number,
    readonly method: string,
    readonly pathname: string,
    readonly code: string | undefined,
    detail: string,
  ) {
    super(
      `Memory service request failed with HTTP ${status} for ${method} ${pathname}. ${detail.slice(0, 300)}`,
    );
    this.name = 'EngramRequestError';
  }
}

export class ZhiYuanEngramAdapter {
  private readonly registeredSessions = new Map<string, string>();

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
    return {
      id: randomUUID(),
      ...input,
      title: redactPrivateBlocks(input.title),
      content: redactPrivateBlocks(input.content),
      createdAt: new Date().toISOString(),
    };
  }

  async confirmMemory(
    candidate: MemoryCandidate,
    workingDirectory: string,
    onRuntimeSession?: (runtimeSessionId: string) => void,
  ): Promise<number | null> {
    const connection = await this.getConnection();
    if (!connection) return null;
    const operationId = candidate.operationId ?? candidate.id;
    if (candidate.recoverExistingResult && !candidate.runtimeSessionId) {
      const recovered = await this.recoverObservation(connection, operationId);
      if (recovered !== null) return recovered;
    }
    const runtimeSessionId = await this.ensureSession(
      connection,
      candidate.sessionId,
      candidate.project,
      workingDirectory,
      candidate.runtimeSessionId,
    );
    onRuntimeSession?.(runtimeSessionId);
    try {
      const saved = await this.request<{ id: number }>(connection, '/observations', {
        method: 'POST',
        body: JSON.stringify({
          session_id: runtimeSessionId,
          project: candidate.project,
          scope: candidate.scope,
          type: candidate.type,
          title: candidate.title,
          content: candidate.content,
          topic_key: candidate.topicKey,
          operation_id: operationId,
        }),
      });
      return saved.id;
    } catch (error) {
      if (!isTimeoutError(error)) throw error;
      return await this.recoverObservation(connection, operationId);
    }
  }

  /** Close a session with a caller-authored summary, once per session close
   * (never per turn). The runtime makes this idempotent per session. */
  async finalizeSession(input: { sessionId: string; project: string; summary: string }): Promise<{
    sessionId: string;
    state: string;
    summaryId: number;
    alreadyFinalized: boolean;
  } | null> {
    const connection = await this.getConnection();
    if (!connection) return null;
    const result = await this.request<{
      session_id: string;
      state: string;
      summary_id: number;
      already_finalized: boolean;
    }>(connection, `/sessions/${encodeURIComponent(input.sessionId)}/finalize`, {
      method: 'POST',
      body: JSON.stringify({ project: input.project, summary: input.summary }),
    });
    for (const [localId, runtimeId] of this.registeredSessions) {
      if (runtimeId === input.sessionId) this.registeredSessions.delete(localId);
    }
    return {
      sessionId: result.session_id,
      state: result.state,
      summaryId: result.summary_id,
      alreadyFinalized: result.already_finalized,
    };
  }

  /** Surface conflicts between candidate and existing memories. Semantic
   * runner scans are opt-in only (never requested here). */
  async scanConflicts(input: {
    project?: string;
    scope?: string;
  }): Promise<Record<string, unknown>> {
    const connection = await this.getConnection();
    if (!connection) throw new Error('Memory runtime is unavailable.');
    return await this.request(connection, '/conflicts/scan', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  async judgeConflict(input: {
    relationIds: number[];
    decision: 'keep_new' | 'keep_old' | 'keep_both' | 'delete_old';
  }): Promise<Record<string, unknown>> {
    const connection = await this.getConnection();
    if (!connection) throw new Error('Memory runtime is unavailable.');
    return await this.request(connection, '/conflicts/judge-many', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  async supersede(input: {
    observationId: number;
    candidate: MemoryCandidate;
    workingDirectory: string;
    onRuntimeSession?: (runtimeSessionId: string) => void;
  }): Promise<number | null> {
    const replacementId = await this.confirmMemory(
      input.candidate,
      input.workingDirectory,
      input.onRuntimeSession,
    );
    if (replacementId === null) return null;
    // Same-topic upserts update in place and return the original id: deleting
    // it would erase the content we just wrote.
    if (replacementId === input.observationId) return replacementId;
    await this.forget(input.observationId, false, input.candidate.project);
    return replacementId;
  }

  async forget(
    observationId: number,
    hardDelete: boolean,
    expectedProject?: string,
  ): Promise<boolean> {
    const connection = await this.getConnection();
    if (!connection) return false;
    const owner = expectedProject?.trim();
    const query = owner ? `&expected_project=${encodeURIComponent(owner)}` : '';
    await this.request(connection, `/observations/${observationId}?hard=${hardDelete}${query}`, {
      method: 'DELETE',
    });
    return true;
  }

  private async recoverObservation(
    connection: EngramConnection,
    operationId: string,
  ): Promise<number | null> {
    try {
      const recovered = await this.request<{ id: number }>(
        connection,
        `/observations/save-result?operation_id=${encodeURIComponent(operationId)}`,
      );
      return recovered.id;
    } catch (error) {
      if (error instanceof EngramRequestError && error.status === 404) return null;
      throw error;
    }
  }

  private async getConnection(): Promise<EngramConnection | null> {
    return this.manager.getConnection() ?? (await this.manager.start());
  }

  async resumeSession(
    sessionId: string,
    project: string,
    workingDirectory: string,
    runtimeSessionId?: string,
  ): Promise<string> {
    const connection = await this.getConnection();
    if (!connection) throw new Error('Memory runtime is unavailable.');
    return await this.ensureSession(
      connection,
      sessionId,
      project,
      workingDirectory,
      runtimeSessionId,
    );
  }

  private async ensureSession(
    connection: EngramConnection,
    sessionId: string,
    project: string,
    workingDirectory: string,
    runtimeSessionId?: string,
  ): Promise<string> {
    const cached = this.registeredSessions.get(sessionId);
    if (cached) return cached;
    const registered = await this.request<{ id: string }>(connection, '/sessions', {
      method: 'POST',
      body: JSON.stringify({
        id: runtimeSessionId ?? sessionId,
        project,
        directory: workingDirectory,
        resume: true,
      }),
    });
    this.registeredSessions.set(sessionId, registered.id);
    return registered.id;
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
      const detail = await response.text().catch(() => '');
      let code: string | undefined;
      try {
        const parsed = JSON.parse(detail) as { code?: unknown };
        if (typeof parsed.code === 'string') code = parsed.code;
      } catch {
        // Non-JSON error bodies stay without a code.
      }
      throw new EngramRequestError(response.status, method, pathname, code, detail);
    }
    return (await response.json()) as T;
  }
}

export function redactPrivateBlocks(value: string): string {
  return value.replace(/<private>[\s\S]*?<\/private>/gi, '[REDACTED]');
}

function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.name === 'AbortError' ||
    /abort|timeout|timed out|network|socket|ECONNRESET|ETIMEDOUT/i.test(error.message)
  );
}
