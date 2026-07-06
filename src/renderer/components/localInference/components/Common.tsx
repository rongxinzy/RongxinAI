import { CheckCircle, Info, Server, TriangleAlert, X } from 'lucide-react';
import type { ReactNode } from 'react';

import type { LlamaCppInstallProgress } from '../../../../shared/llamacpp';
import { i18nService } from '../../../services/i18n';
import { type LocalInferenceToast,LocalInferenceToastKind } from '../types';
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
          borderClass: 'border-red-500/30',
          iconClass: 'bg-red-500/15 text-red-500',
          messageClass: 'text-red-700 dark:text-red-200',
        }
      : toast.kind === LocalInferenceToastKind.Success
        ? {
            Icon: CheckCircle,
            borderClass: 'border-emerald-500/30',
            iconClass: 'bg-emerald-500/15 text-emerald-500',
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
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-secondary transition-colors hover:bg-surface-raised hover:text-foreground"
          aria-label={i18nService.t('close')}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'success';
}) {
  return (
    <span
      className={`inline-flex h-5 items-center rounded-md px-1.5 text-[11px] font-medium ${
        tone === 'success'
          ? 'bg-green-500/10 text-green-600 dark:text-green-400'
          : 'bg-surface-raised text-secondary'
      }`}
    >
      {children}
    </span>
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
      <Server className="h-7 w-7 text-secondary" />
      <p className="text-sm font-medium text-secondary">{title}</p>
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
    <div className={className}>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-border/80">
        <div
          className="h-full rounded-full bg-primary transition-all duration-200"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

