import path from 'path';

import {
  HarnessPathClass,
  type HarnessPathDecision,
  type HarnessPatchManifest,
} from '../../shared/harness';

const SURFACE_PREFIXES = [
  'SKILLs/',
  'src/main/coworkPrompt/',
  'src/main/harness/surface/',
  'src/shared/harness/surface/',
] as const;

const KERNEL_PREFIXES = [
  'src/main/workbenchTask/',
  'src/shared/workbenchTask/',
  'src/main/productionLoop/',
  'src/shared/productionLoop/',
  'src/main/libs/agentEngine/',
  'src/main/ipcHandlers/',
  'src/main/preload.ts',
  'src/main/main.ts',
  'src/main/sqliteStore.ts',
  'src/renderer/',
  'tools/zhiyuan/',
  'tests/',
] as const;

const normalizeRepositoryPath = (candidate: string): string =>
  path.posix.normalize(candidate.trim().replaceAll('\\', '/')).replace(/^\.\//, '');

export function classifyHarnessPath(candidate: string): HarnessPathDecision {
  const normalized = normalizeRepositoryPath(candidate);
  if (
    !normalized ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    path.isAbsolute(candidate)
  ) {
    return {
      path: normalized,
      classification: HarnessPathClass.OutsideBoundary,
      allowed: false,
      reason: 'Candidate paths must be repository-relative and remain inside the repository.',
    };
  }
  if (SURFACE_PREFIXES.some(prefix => normalized.startsWith(prefix))) {
    return {
      path: normalized,
      classification: HarnessPathClass.Surface,
      allowed: true,
      reason: 'The path is part of the controlled Harness Surface.',
    };
  }
  if (KERNEL_PREFIXES.some(prefix => normalized.startsWith(prefix))) {
    return {
      path: normalized,
      classification: HarnessPathClass.Kernel,
      allowed: false,
      reason: 'The path is part of the immutable Harness Kernel.',
    };
  }
  return {
    path: normalized,
    classification: HarnessPathClass.OutsideBoundary,
    allowed: false,
    reason: 'The path is not present in the Harness Surface allowlist.',
  };
}

export function validateHarnessPatchBoundary(
  manifest: HarnessPatchManifest,
): HarnessPathDecision[] {
  if (!manifest.defaultOff) {
    throw new Error('Harness candidates must be default-off.');
  }
  const decisions = manifest.touchedFiles.map(classifyHarnessPath);
  const rejected = decisions.find(decision => !decision.allowed);
  if (rejected)
    throw new Error(`Harness candidate path rejected: ${rejected.path}. ${rejected.reason}`);
  return decisions;
}
