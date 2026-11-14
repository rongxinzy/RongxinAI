import { MemoryKind, MemoryScope } from '../../shared/memory';
import { MemorySearchMatchMode } from './constants';
import { planRecallQuery, rankRecallResults } from './recallQueryPlanner';
import type { MemoryRepository } from './repository';
import type { MemoryBackend } from './memoryBackendTypes';

const MAX_MEMORY_RECALL_LIMIT = 20;

export interface MemoryRecallScopeInput {
  query: string;
  projectId: string;
  scope: typeof MemoryScope.Project | typeof MemoryScope.Personal | typeof MemoryScope.Session;
  sessionId?: string;
  limit?: number;
  signal?: AbortSignal;
}

export async function recallMemoryScope(
  repository: MemoryRepository,
  adapter: MemoryBackend,
  input: MemoryRecallScopeInput,
) {
  const plan = planRecallQuery(input.query);
  if (!plan.exactQuery) return [];
  const limit = Math.min(Math.max(input.limit ?? 8, 1), 20);
  const retrievalLimit = input.scope === MemoryScope.Session ? MAX_MEMORY_RECALL_LIMIT : limit;
  let observations;
  {
    observations = filterRecallable(
      repository,
      input,
      await adapter.recall({
        query: plan.exactQuery,
        project: input.projectId,
        scope: input.scope,
        limit: retrievalLimit,
        matchMode: MemorySearchMatchMode.All,
        signal: input.signal,
      }),
    );
    if (observations.length === 0 && plan.broadQuery) {
      observations = filterRecallable(
        repository,
        input,
        await adapter.recall({
          query: plan.broadQuery,
          project: input.projectId,
          scope: input.scope,
          limit: retrievalLimit,
          matchMode: MemorySearchMatchMode.Any,
          signal: input.signal,
        }),
      );
    }
    if (observations.length === 0 && plan.allowRecentFallback) {
      observations = filterRecallable(
        repository,
        input,
        await adapter.recent({
          project: input.projectId,
          scope: input.scope,
          limit: retrievalLimit,
          signal: input.signal,
        }),
      );
    }
  }
  const unique = [
    ...new Map(observations.map(observation => [observation.id, observation])).values(),
  ];
  if (unique.length === 0) return [];
  const metadata = repository.getRecallMetadata(
    input.projectId,
    unique.map(observation => observation.id),
  );
  return rankRecallResults(plan.broadQuery ?? plan.exactQuery, unique, metadata).slice(0, limit);
}

function filterRecallable<T extends { id: number; type?: string; session_id?: string }>(
  repository: MemoryRepository,
  input: Pick<MemoryRecallScopeInput, 'projectId' | 'scope' | 'sessionId'>,
  observations: T[],
): T[] {
  const observationsInScope = observations.filter(observation => {
    if (input.scope === MemoryScope.Session) {
      const owner =
        repository.lifecycle?.getLocalSessionIdByRuntimeId(observation.session_id) ??
        observation.session_id;
      return Boolean(input.sessionId) && owner === input.sessionId;
    }
    return observation.type !== MemoryKind.SessionSummary;
  });
  const allowed = repository.filterRecallableMemoryIds({
    projectId: input.projectId,
    memoryIds: observationsInScope.map(observation => observation.id),
    scope: input.scope,
    sessionId: input.sessionId,
  });
  return observationsInScope.filter(observation => allowed.has(observation.id));
}

export function fitObservations(
  observations: Array<{ id: number; title: string; content: string }>,
  budget: number,
): string[] {
  let usedTokens = 0;
  const lines: string[] = [];
  for (const observation of observations) {
    // Even ASCII cannot fit above this size under the estimator below. Avoid
    // formatting or scanning oversized stored notes on the request path.
    if (observation.title.length + observation.content.length > budget * 4) continue;
    // Continuation lines remain data, never scope headers or other records.
    const line =
      `- [memory:${observation.id}] ${observation.title}: ${observation.content}`.replace(
        /\r?\n/g,
        '\n  ',
      );
    const estimatedTokens = estimateMemoryTokens(line);
    if (usedTokens + estimatedTokens > budget) continue;
    lines.push(line);
    usedTokens += estimatedTokens;
  }
  return lines;
}

function estimateMemoryTokens(value: string): number {
  const cjkCharacters =
    value.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)
      ?.length ?? 0;
  return Math.ceil(cjkCharacters + (value.length - cjkCharacters) / 4);
}
