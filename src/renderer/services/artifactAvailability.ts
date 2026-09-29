import { toast } from 'sonner';

import { shouldRevealLiveArtifact } from '../store/slices/artifactSlice';
import type { Artifact } from '../types/artifact';
import type { ArtifactDetectionResult } from './artifactDetectionService';
import { i18nService } from './i18n';
import { resolveFilePath } from './artifactFileLoader';

export async function isArtifactFileAvailable(
  artifact: Artifact,
  cwd?: string | null,
): Promise<boolean> {
  if (!artifact.filePath) return true;
  try {
    const result = await window.electron.dialog.checkArtifactFile(
      resolveFilePath(artifact.filePath, cwd),
    );
    return result.success;
  } catch {
    return false;
  }
}

export async function openAvailableArtifact(
  artifact: Artifact,
  open: () => void,
  cwd?: string | null,
): Promise<void> {
  if (await isArtifactFileAvailable(artifact, cwd)) open();
  else toast.error(i18nService.t('fileNotFound'));
}

/** Resolve the whole batch before insertion, preserving detection order. */
export async function prepareAvailableArtifacts(
  detected: ArtifactDetectionResult[],
  isLiveSession: boolean,
  cwd?: string | null,
): Promise<{ artifact: Artifact; reveal: boolean }[]> {
  const checked = await Promise.all(
    detected.map(async ({ artifact }) => {
      if (!(await isArtifactFileAvailable(artifact, cwd))) return null;
      return {
        artifact,
        reveal: shouldRevealLiveArtifact(artifact, { isLiveSession, previewable: true }),
      };
    }),
  );
  return checked.filter(item => item !== null);
}
