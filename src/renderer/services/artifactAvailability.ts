import { resolveArtifactPath } from '../../shared/cowork/artifactPath';
import type { Artifact } from '../types/artifact';
import { showAppError } from './appToast';
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
    showAppError(i18nService.t('fileNotFound'));
    return;
  }
  open();
}
