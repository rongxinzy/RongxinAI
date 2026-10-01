import { toast } from 'sonner';

import { resolveArtifactPath } from '../../shared/cowork/artifactPath';
import { shouldRevealLiveArtifact } from '../store/slices/artifactSlice';
import type { Artifact } from '../types/artifact';
import type { ArtifactDetectionResult } from './artifactDetectionService';
import { i18nService } from './i18n';

/**
 * Outcome of a renderer→main readability probe.
 *
 * `Missing` is the only verdict that may drop an artifact: it is the main
 * process answering that the path is not a readable ordinary file. Timeouts,
 * rejections and deadlines stay `Unavailable` — unknown, never "absent" — so a
 * slow share can never silently discard a real output.
 */
export const ArtifactFileAvailability = {
  Available: 'available',
  Missing: 'missing',
  Unavailable: 'unavailable',
} as const;
export type ArtifactFileAvailability =
  (typeof ArtifactFileAvailability)[keyof typeof ArtifactFileAvailability];

/** Deadline for a single probe attempt. */
const PROBE_TIMEOUT_MS = 3_000;
/** How many probes may sit on the main process at once. */
export const ARTIFACT_FILE_PROBE_CONCURRENCY = 4;
/** Deadline for a whole batch; probes that cannot start inside it report `Unavailable`. */
const BATCH_TIMEOUT_MS = 8_000;
/** Transient probe failures are retried once inside the same budget. */
const PROBE_ATTEMPTS = 2;

async function probeOnce(filePath: string, timeoutMs: number): Promise<ArtifactFileAvailability> {
  const checkArtifactFile = window.electron?.dialog?.checkArtifactFile;
  if (typeof checkArtifactFile !== 'function') return ArtifactFileAvailability.Unavailable;

  let timer: number | undefined;
  try {
    const result = await Promise.race([
      checkArtifactFile(filePath),
      new Promise<null>(resolve => {
        timer = window.setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
    if (!result) return ArtifactFileAvailability.Unavailable;
    return result.success ? ArtifactFileAvailability.Available : ArtifactFileAvailability.Missing;
  } catch {
    // A rejected IPC call says nothing about the file itself.
    return ArtifactFileAvailability.Unavailable;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Probes whether the artifact path is a readable ordinary file, within a bounded
 * budget. Results are never cached, so a later batch, session reseed or preview
 * click revalidates a path that failed before.
 */
export async function probeArtifactFileAvailability(
  artifact: Artifact,
  cwd?: string | null,
  budgetMs: number = PROBE_TIMEOUT_MS * PROBE_ATTEMPTS,
): Promise<ArtifactFileAvailability> {
  if (!artifact.filePath) return ArtifactFileAvailability.Available;

  const filePath = resolveArtifactPath(artifact.filePath, cwd);
  const deadline = Date.now() + budgetMs;

  for (let attempt = 0; attempt < PROBE_ATTEMPTS; attempt += 1) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    const state = await probeOnce(filePath, Math.min(PROBE_TIMEOUT_MS, remaining));
    if (state !== ArtifactFileAvailability.Unavailable) return state;
  }
  return ArtifactFileAvailability.Unavailable;
}

/** Runs `worker` over `items` with bounded concurrency, keeping input order. */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  const runners = Array.from({ length: Math.min(Math.max(limit, 1), items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return results;
}

export interface PreparedArtifact {
  artifact: Artifact;
  reveal: boolean;
}

/**
 * Resolves a whole batch before insertion, preserving detection order and never
 * exceeding the batch deadline. Only a confirmed `Missing` verdict drops an
 * artifact; unconfirmed paths are kept and simply not revealed.
 */
export async function prepareAvailableArtifacts(
  detected: ArtifactDetectionResult[],
  isLiveSession: boolean,
  cwd?: string | null,
): Promise<PreparedArtifact[]> {
  const batchDeadline = Date.now() + BATCH_TIMEOUT_MS;
  const states = await mapWithConcurrency(
    detected,
    ARTIFACT_FILE_PROBE_CONCURRENCY,
    ({ artifact }) => probeArtifactFileAvailability(artifact, cwd, batchDeadline - Date.now()),
  );

  return detected.flatMap(({ artifact }, index) => {
    const state = states[index];
    if (state === ArtifactFileAvailability.Missing) return [];
    return [
      {
        artifact,
        reveal:
          state === ArtifactFileAvailability.Available &&
          shouldRevealLiveArtifact(artifact, { isLiveSession, previewable: true }),
      },
    ];
  });
}

export async function openAvailableArtifact(
  artifact: Artifact,
  open: () => void,
  cwd?: string | null,
  options?: { isCurrent?: () => boolean },
): Promise<void> {
  const state = await probeArtifactFileAvailability(artifact, cwd);
  // The verdict may land after the user switched sessions or left the view.
  if (options?.isCurrent && !options.isCurrent()) return;
  if (state === ArtifactFileAvailability.Missing) {
    toast.error(i18nService.t('fileNotFound'));
    return;
  }
  open();
}
