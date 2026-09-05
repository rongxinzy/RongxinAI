import { Button } from '@shared/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from '@shared/components/ui/popover';
import { Info } from 'lucide-react';
import type { MarketplaceModel } from '../../../../shared/marketplace';
import { i18nService } from '../../../services/i18n';
import {
  formatDownloadCount,
  formatMarketplaceScore,
  marketplaceFitLabel,
} from '../utils/marketplace';

export interface MarketplaceDetailRow {
  label: string;
  value: string | null;
}

export function MarketplaceModelDetails({
  model,
  details,
}: {
  model: MarketplaceModel;
  details: MarketplaceDetailRow[];
}) {
  const runtimeLabel =
    model.runtime?.status === 'verified'
      ? i18nService.t('marketplaceRuntimeVerified')
      : model.runtime?.status === 'documented'
        ? i18nService.t('marketplaceRuntimeDocumented')
        : i18nService.t('marketplaceRuntimePending');
  const rows = [
    ...details,
    { label: i18nService.t('marketplaceRuntimeLabel'), value: runtimeLabel },
    {
      label: i18nService.t('marketplaceScoreLabel'),
      value: formatMarketplaceScore(model.score?.stars, model.score?.confidence),
    },
    { label: i18nService.t('marketplaceFitLabel'), value: marketplaceFitLabel(model.fit?.status) },
  ];
  const downloads = formatDownloadCount(model.downloads);
  const scoreReasons = model.score?.reasons ?? [];
  if (downloads) rows.push({ label: i18nService.t('marketplaceDownloadsLabel'), value: downloads });

  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={200}
        closeDelay={100}
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={i18nService.t('marketplaceDetails')}
          />
        }
      >
        <Info />
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="end"
        className="theme-control-sizing-21 max-h-96 w-80 max-w-[calc(100vw-2rem)] overflow-y-auto"
      >
        <PopoverTitle>{i18nService.t('marketplaceDetails')}</PopoverTitle>
        <p className="break-all text-xs text-muted-foreground">{model.repoId}</p>
        <dl className="flex flex-col gap-2">
          {rows.map(row => (
            <div key={row.label} className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3">
              <dt className="text-xs text-muted-foreground">{row.label}</dt>
              <dd className="min-w-0 break-words text-right text-sm text-foreground">
                {row.value ?? i18nService.t('marketplaceMetadataUnavailable')}
              </dd>
            </div>
          ))}
        </dl>
        {scoreReasons.length ? (
          <div className="flex flex-col gap-2 border-t border-border-subtle pt-3">
            <p className="text-xs font-medium text-muted-foreground">
              {i18nService.t('marketplaceScoreReasons')}
            </p>
            {scoreReasons.map(reason => (
              <p key={reason} className="break-words text-xs text-muted-foreground">
                {reason}
              </p>
            ))}
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
