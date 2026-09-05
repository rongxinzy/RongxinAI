import { Button } from '@shared/components/ui/button';
import { Progress } from '@shared/components/ui/progress';
import { CheckCircle, Info, Server, TriangleAlert, X } from 'lucide-react';
import type { ReactNode } from 'react';

import type { LlamaCppInstallProgress } from '../../../../shared/llamacpp';
import { i18nService } from '../../../services/i18n';
import { localInferenceMutedTextClass } from '../constants';
import { type LocalInferenceToast, LocalInferenceToastKind } from '../types';
import { progressBarPercent } from '../utils/progress';

export function LocalInferenceToastView({
  toast,
  onClose,
}: {
  toast: LocalInferenceToast;
  onClose: () => void;
}) {
  const tone =
    toast.kind === LocalInferenceToastKind.Error
      ? {
          Icon: TriangleAlert,
          borderClass: 'border-destructive/30',
          iconClass: 'bg-destructive/15 text-destructive',
          messageClass: 'text-destructive',
        }
      : toast.kind === LocalInferenceToastKind.Success
        ? {
            Icon: CheckCircle,
            borderClass: 'border-success/30',
            iconClass: 'bg-success/15 text-success',
            messageClass: 'text-foreground',
          }
        : {
            Icon: Info,
            borderClass: 'border-primary/30',
            iconClass: 'bg-primary/15 text-primary',
            messageClass: 'text-foreground',
          };

  return (
    <div
      className={`pointer-events-auto w-full max-w-sm rounded-xl border bg-background/95 px-4 py-3 shadow-2xl backdrop-blur ${tone.borderClass}`}
    >
      <div className="flex items-start gap-3">
        <span
          className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${tone.iconClass}`}
        >
          <tone.Icon className="h-4 w-4" />
        </span>
        <div className={`min-w-0 flex-1 text-sm leading-6 ${tone.messageClass}`}>
          {toast.message}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onClose}
          className="theme-page-common-button-1 shrink-0"
          aria-label={i18nService.t('close')}
        >
          <X />
        </Button>
      </div>
    </div>
  );
}

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
