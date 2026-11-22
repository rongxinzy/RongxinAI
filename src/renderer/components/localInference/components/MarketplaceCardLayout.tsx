import { Separator } from '@shared/components/ui/separator';
import { Skeleton } from '@shared/components/ui/skeleton';
import type { ReactNode } from 'react';
import { i18nService } from '../../../services/i18n';

const columns =
  'grid items-center gap-x-4 gap-y-2 py-4 grid-cols-[minmax(0,1fr)_auto] @min-[43rem]/marketplace:grid-cols-[minmax(0,1fr)_7rem_5rem_6rem_4.5rem]';

export function MarketplaceListHeader() {
  return (
    <div className={`theme-control-caption-muted ${columns} hidden @min-[43rem]/marketplace:grid`}>
      {[
        'model',
        'localInferenceQuantization',
        'marketplaceDownloadSize',
        'marketplaceFitLabel',
      ].map(label => (
        <span key={label}>{i18nService.t(label)}</span>
      ))}
    </div>
  );
}

export function MarketplaceCardLayout({
  name,
  quantization,
  size,
  fit,
  actions,
  loading = false,
}: {
  name: ReactNode;
  quantization: ReactNode;
  size: ReactNode;
  fit: ReactNode;
  actions: ReactNode;
  loading?: boolean;
}) {
  return (
    <div
      data-marketplace-model-card={loading ? undefined : 'true'}
      aria-hidden={loading || undefined}
    >
      <div className={columns}>
        <div className="min-w-0">{name}</div>
        <div className="flex items-center gap-3 @min-[43rem]/marketplace:contents">
          <div className="min-w-0">{quantization}</div>
          <span className="theme-control-caption-muted whitespace-nowrap tabular-nums">{size}</span>
        </div>
        <div className="justify-self-end @min-[43rem]/marketplace:justify-self-start">{fit}</div>
        <div className="col-start-2 row-start-1 flex items-center justify-end @min-[43rem]/marketplace:col-auto @min-[43rem]/marketplace:row-auto">
          {actions}
        </div>
      </div>
      <Separator />
    </div>
  );
}

export function MarketplaceModelCardSkeleton() {
  return (
    <MarketplaceCardLayout
      loading
      name={<Skeleton className="h-5 w-3/4" />}
      quantization={<Skeleton className="h-6 w-20" />}
      size={<Skeleton className="h-4 w-12" />}
      fit={<Skeleton className="h-4 w-16" />}
      actions={<Skeleton className="size-7" />}
    />
  );
}
