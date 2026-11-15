import { Button } from '@shared/components/ui/button';
import { AlertTriangle, ChevronDown } from 'lucide-react';
import type {
  ClassifiedProviderError,
  ProviderErrorAction,
} from '../../../services/modelSettings/providerErrorClassifier';
import { i18nService } from '../../../services/i18n';

export interface ProviderErrorBannerProps {
  classified: ClassifiedProviderError;
  onAction?: (action: ProviderErrorAction, suggestedBaseUrl?: string) => void;
}

function getActionLabel(action: ProviderErrorAction): string | null {
  switch (action) {
    case 'fix_v1':
      return i18nService.t('providerErrFixV1');
    case 'reenter_key':
      return i18nService.t('providerErrReenterKey');
    case 'open_network':
      return i18nService.t('providerErrOpenNetwork');
    case 'open_usage':
      return i18nService.t('providerErrOpenUsage');
    case 'manual_models':
      return i18nService.t('providerErrManualModels');
    case 'retry':
      return i18nService.t('providerErrRetry');
    default:
      return null;
  }
}

export function ProviderErrorBanner({ classified, onAction }: ProviderErrorBannerProps) {
  const actionLabel = getActionLabel(classified.action);

  return (
    <div
      role="alert"
      className="flex flex-col gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm"
    >
      <div className="flex items-start gap-2.5">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="font-medium text-foreground">{classified.title}</div>
          <p className="text-xs leading-relaxed text-muted-foreground">{classified.hint}</p>
        </div>
        {actionLabel && onAction && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={() => onAction(classified.action, classified.suggestedBaseUrl)}
          >
            {actionLabel}
          </Button>
        )}
      </div>
      {classified.technicalDetail && (
        <details className="pl-6 text-xs text-muted-foreground">
          <summary className="inline-flex cursor-pointer list-none items-center gap-1 select-none hover:text-foreground">
            <ChevronDown className="size-3.5" aria-hidden="true" />
            <span>{i18nService.t('providerErrShowDetail')}</span>
          </summary>
          <pre className="mt-1.5 overflow-x-auto rounded bg-muted/60 p-2 font-mono text-[11px] break-all whitespace-pre-wrap text-foreground">
            {classified.technicalDetail}
          </pre>
        </details>
      )}
    </div>
  );
}
