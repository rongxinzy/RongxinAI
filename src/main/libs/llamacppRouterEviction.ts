import type { LlamaCppRouterModelSlots } from './llamacppRouterStatus';
import { LLAMACPP_ROUTER_SLOTS_BUSY_UNKNOWN } from './llamacppRouterStatus';

/**
 * App-side capacity planning for the llama-server router. The router's own
 * --models-max LRU is unsafe (it evicts models mid-stream and evicts healthy
 * models before a doomed load), so the router runs with `--models-max 0` and
 * the app decides evictions: candidates are ordered least-recently-used first,
 * and a model is only evictable when its /slots probe succeeded and reports no
 * slot processing. Unknown or busy slot state always blocks eviction.
 */
export type LlamaCppRouterEvictionCandidate = {
  modelName: string;
  /** Residency last-used timestamp (ms); missing entries sort as never used. */
  lastUsedAt?: number;
  /** Lower bound position from the router's listing order as an LRU fallback. */
  routerOrder: number;
};

export type LlamaCppRouterEvictionPlan = {
  /** Evictable models in eviction order (LRU first). */
  evictable: string[];
  /** Candidates that must be kept, with the reason they are protected. */
  protected: Array<{ modelName: string; reason: 'busy' | 'unknown' }>;
};

const LLAMACPP_ROUTER_EVICTION_NEVER_USED_LAST_USED_AT = Number.NEGATIVE_INFINITY;

export function planLlamaCppRouterEviction(input: {
  candidates: LlamaCppRouterEvictionCandidate[];
  slotsByModel: ReadonlyMap<string, LlamaCppRouterModelSlots>;
}): LlamaCppRouterEvictionPlan {
  const ordered = [...input.candidates].sort(compareEvictionCandidates);
  const evictable: string[] = [];
  const protectedEntries: LlamaCppRouterEvictionPlan['protected'] = [];
  const seen = new Set<string>();

  for (const candidate of ordered) {
    const modelName = candidate.modelName.trim();
    if (!modelName || seen.has(modelName)) continue;
    seen.add(modelName);

    const slots = input.slotsByModel.get(modelName);
    if (!slots || slots === LLAMACPP_ROUTER_SLOTS_BUSY_UNKNOWN) {
      protectedEntries.push({ modelName, reason: 'unknown' });
      continue;
    }
    if (slots.busy) {
      protectedEntries.push({ modelName, reason: 'busy' });
      continue;
    }
    evictable.push(modelName);
  }

  return { evictable, protected: protectedEntries };
}

function compareEvictionCandidates(
  left: LlamaCppRouterEvictionCandidate,
  right: LlamaCppRouterEvictionCandidate,
): number {
  const leftLastUsed = left.lastUsedAt ?? LLAMACPP_ROUTER_EVICTION_NEVER_USED_LAST_USED_AT;
  const rightLastUsed = right.lastUsedAt ?? LLAMACPP_ROUTER_EVICTION_NEVER_USED_LAST_USED_AT;
  if (leftLastUsed !== rightLastUsed) return leftLastUsed - rightLastUsed;
  return left.routerOrder - right.routerOrder;
}

/**
 * Router-mode capacity recovery during a model load: evicts idle models
 * (LRU first, guarded by the /slots probe — never busy or unknown ones) until
 * the running count drops below `limit`, re-checking after each eviction.
 * Returns the evicted names in order; when the list is shorter than needed
 * the caller still fails with its existing limit-reached error.
 */
export async function evictIdleLlamaCppRouterModelsForLoad(input: {
  limit: number;
  runningModelNames: string[];
  targetModelName: string;
  slotsBusy: (modelName: string) => Promise<boolean>;
  stopModel: (modelName: string) => Promise<unknown>;
}): Promise<string[]> {
  const evicted: string[] = [];
  let running = input.runningModelNames.filter(
    name => name && name !== input.targetModelName,
  );
  if (running.length < input.limit) return evicted;

  // Probe slots once per candidate; a model that turns busy after its probe
  // is still protected by the probe result at eviction time.
  const candidates: LlamaCppRouterEvictionCandidate[] = [];
  const slotsByModel = new Map<string, LlamaCppRouterModelSlots>();
  for (const [routerOrder, modelName] of running.entries()) {
    candidates.push({ modelName, routerOrder });
    slotsByModel.set(modelName, {
      busy: await input.slotsBusy(modelName),
      processingSlots: 0,
      totalSlots: 0,
    });
  }
  const plan = planLlamaCppRouterEviction({ candidates, slotsByModel });

  for (const modelName of plan.evictable) {
    if (running.length < input.limit) break;
    await input.stopModel(modelName);
    evicted.push(modelName);
    running = running.filter(name => name !== modelName);
  }
  return evicted;
}
