import { Progress } from '@shared/components/ui/progress';
import { Server } from 'lucide-react';
import type { ReactNode } from 'react';

import type { LlamaCppInstallProgress } from '../../../../shared/llamacpp';
import { i18nService } from '../../../services/i18n';
import { localInferenceMutedTextClass } from '../constants';
import { progressBarPercent } from '../utils/progress';

export function EmptyState({
  title,
  action,
  className = '',
}: {
  title: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex min-h-[260px] flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-surface px-4 py-8 text-center ${className}`.trim()}
    >
      <Server className={`h-7 w-7 ${localInferenceMutedTextClass}`} />
      <p className={`text-sm font-medium ${localInferenceMutedTextClass}`}>{title}</p>
      {action}
    </div>
  );
}

export function InstallProgressBar({
  progress,
  className = '',
}: {
  progress?: LlamaCppInstallProgress;
  className?: string;
}) {
  const percent = progressBarPercent(progress);
  return (
    <Progress
      aria-label={i18nService.t('marketplaceInstallPulling')}
      className={className}
      value={percent}
    />
  );
}
