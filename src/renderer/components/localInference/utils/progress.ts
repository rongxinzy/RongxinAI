import type { LlamaCppInstallProgress } from '../../../../shared/llamacpp';
import { i18nService } from '../../../services/i18n';

export function isPullInProgress(progress?: Record<string, unknown>): boolean {
  if (!progress) return false;
  const status = readProgressStatus(progress);
  return !['success', 'done', 'cancelled', 'error', 'failed', 'needs-manual'].includes(status);
}

export function formatPullProgress(progress: Record<string, unknown>): string {
  const summary = formatInstallProgressSummary(progress);
  return summary.primary || summary.phase || i18nService.t('loading');
}

export function formatInstallProgressSummary(progress: Record<string, unknown>): {
  primary: string;
  phase?: string;
  error?: string;
} {
  const status = readProgressStatus(progress);
  const error = typeof progress.error === 'string' ? progress.error : '';
  const completed = typeof progress.completed === 'number' ? progress.completed : undefined;
  const total = typeof progress.total === 'number' ? progress.total : undefined;
  const percent = typeof progress.percent === 'number' ? progress.percent : undefined;
  const speed = typeof progress.speed === 'number' ? progress.speed : undefined;
  const phase = humanizeInstallPhase(status);

  if (error) {
    return {
      primary: phase || i18nService.t('marketplaceInstallFailed'),
      phase,
      error,
    };
  }

  if (completed !== undefined && total !== undefined && total > 0) {
    const parts = [
      percent !== undefined ? `${percent}%` : undefined,
      `${formatBytes(completed)} / ${formatBytes(total)}`,
      speed && speed > 0 ? `${formatBytes(speed)}/s` : undefined,
    ].filter(Boolean);
    return {
      primary: parts.join(' | '),
      phase,
    };
  }

  return {
    primary: phase || i18nService.t('loading'),
    phase,
  };
}

export function readProgressStatus(progress: Record<string, unknown>): string {
  if (typeof progress.status === 'string') return progress.status;
  if (typeof progress.phase === 'string') return progress.phase;
  return '';
}

export function normalizeInstallProgress(
  name: string,
  chunk: Record<string, unknown>,
): LlamaCppInstallProgress {
  return {
    modelId: typeof chunk.modelId === 'string' && chunk.modelId.trim() ? chunk.modelId : name,
    modelName:
      typeof chunk.modelName === 'string' && chunk.modelName.trim() ? chunk.modelName : name,
    phase:
      typeof chunk.phase === 'string'
        ? (chunk.phase as LlamaCppInstallProgress['phase'])
        : 'downloading',
    message: typeof chunk.message === 'string' ? chunk.message : undefined,
    percent: typeof chunk.percent === 'number' ? chunk.percent : undefined,
    completed: typeof chunk.completed === 'number' ? chunk.completed : undefined,
    total: typeof chunk.total === 'number' ? chunk.total : undefined,
    speed: typeof chunk.speed === 'number' ? chunk.speed : undefined,
    targetPath: typeof chunk.targetPath === 'string' ? chunk.targetPath : undefined,
    error: typeof chunk.error === 'string' ? chunk.error : undefined,
  };
}

export function isInstallTerminalPhase(phase: LlamaCppInstallProgress['phase']): boolean {
  return ['done', 'failed', 'cancelled', 'needs-manual'].includes(phase);
}

export function isSuccessfulMarketplaceInstallProgress(
  progress: Pick<LlamaCppInstallProgress, 'phase' | 'modelId' | 'modelName' | 'targetPath'> | Record<string, unknown>,
  localModels: Array<{
    name?: string;
    id?: string;
    model?: string;
    path?: string;
    repoId?: string;
  }> = [],
): boolean {
  const phase = typeof progress.phase === 'string' ? progress.phase : readProgressStatus(progress);
  if (phase !== 'done') return false;

  const normalizedTargetPath = typeof progress.targetPath === 'string' ? progress.targetPath.trim() : '';
  const targetFileName = normalizedTargetPath
    ? normalizedTargetPath.split(/[\\/]+/).pop()?.toLowerCase() ?? ''
    : '';

  const progressNames = [
    typeof progress.modelId === 'string' ? progress.modelId.trim() : '',
    typeof progress.modelName === 'string' ? progress.modelName.trim() : '',
  ].filter(Boolean).map(value => value.toLowerCase());

  return localModels.some(model => {
    const candidateNames = [model.name, model.id, model.model, model.repoId]
      .filter((value): value is string => Boolean(value && value.trim()))
      .map(value => value.trim().toLowerCase());
    const candidatePath = model.path?.trim().toLowerCase() ?? '';

    if (normalizedTargetPath) {
      const samePath = candidatePath === normalizedTargetPath.toLowerCase();
      const sameFileName = targetFileName
        ? candidatePath.endsWith(`/${targetFileName}`) || candidatePath.endsWith(`\\${targetFileName}`)
        : false;
      if (samePath || sameFileName) return true;
    }

    return progressNames.some(progressName => {
      const normalizedProgressName = progressName.trim().toLowerCase();
      const progressVariants = new Set([
        normalizedProgressName,
        normalizedProgressName.split('/').at(-1) ?? '',
        ...candidateNames,
      ]);
      return candidateNames.some(candidate => {
        const candidateVariants = new Set([
          candidate,
          candidate.split('/').at(-1) ?? '',
          ...Array.from(progressVariants),
        ]);
        return Array.from(candidateVariants).some(value => value && (
          value === normalizedProgressName ||
          value === normalizedProgressName.split('/').at(-1) ||
          normalizedProgressName.endsWith(`/${value}`) ||
          normalizedProgressName.includes(`/${value}`)
        ));
      });
    });
  });
}

export function humanizeInstallPhase(phase: string): string {
  switch (phase) {
    case 'starting':
      return i18nService.t('marketplaceInstallStarting');
    case 'detecting':
      return i18nService.t('localInferenceInstallVerifying');
    case 'downloading':
    case 'downloading-progress':
      return i18nService.t('marketplaceInstallPulling');
    case 'installing':
      return i18nService.t('localInferenceInstallExtracting');
    case 'cancelling':
      return i18nService.t('marketplaceCancelling');
    case 'cancelled':
      return i18nService.t('marketplacePullCancelled');
    case 'done':
      return i18nService.t('marketplaceInstallDone');
    case 'failed':
      return i18nService.t('marketplaceInstallFailed');
    default:
      return phase || i18nService.t('loading');
  }
}

export function progressBarPercent(progress?: LlamaCppInstallProgress): number {
  if (!progress) return 0;
  if (typeof progress.percent === 'number') {
    return Math.max(0, Math.min(100, progress.percent));
  }
  if (
    typeof progress.completed === 'number' &&
    typeof progress.total === 'number' &&
    progress.total > 0
  ) {
    return Math.max(0, Math.min(100, Math.round((progress.completed / progress.total) * 100)));
  }
  if (progress.phase === 'done') return 100;
  if (progress.phase === 'starting') return 10;
  if (progress.phase === 'downloading') return 35;
  if (progress.phase === 'installing') return 80;
  if (progress.phase === 'failed' || progress.phase === 'cancelled') return 100;
  return 0;
}

export function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}
