import { Badge } from '@shared/components/ui/badge';
import { Button } from '@shared/components/ui/button';
import { Card, CardAction, CardHeader, CardTitle } from '@shared/components/ui/card';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@shared/components/ui/hover-card';
import { cn } from '@shared/lib/utils';
import { Download, ExternalLink, X } from 'lucide-react';
import type { ComponentType } from 'react';

import type { MarketplaceModel } from '../../../../shared/marketplace';
import { i18nService } from '../../../services/i18n';
import { CustomProviderIcon, DeepSeekIcon, QwenIcon, ZhipuIcon } from '../../icons/providers';
import { localInferenceMutedTextClass } from '../constants';
import type { InstallProgressState } from '../types';
import {
  capabilityLabel,
  getMarketplaceCapabilityTags,
  getMarketplaceDisplayName,
  getMarketplaceInstallProgress,
  getMarketplacePublisher,
  getMarketplaceRecommendedQuantization,
  MARKETPLACE_GGUF_FORMAT,
  openExternalUrl,
} from '../utils/marketplace';
import { formatPullProgress } from '../utils/progress';
import { InstallProgressBar } from './Common';

const marketplaceCardTagBaseClassName = 'h-6 rounded-md px-2 py-0 text-xs font-normal shadow-none';

const marketplacePublisherIcons: Record<string, ComponentType<{ className?: string }>> = {
  deepseek: DeepSeekIcon,
  qwen: QwenIcon,
  zhipuai: ZhipuIcon,
};

export function MarketplaceModelCard({
  model,
  loading,
  installing,
  installProgress,
  onInstall,
}: {
  model: MarketplaceModel;
  loading: boolean;
  installing: boolean;
  installProgress: InstallProgressState;
  onInstall: (model: MarketplaceModel) => Promise<void>;
}) {
  const progress = getMarketplaceInstallProgress(installProgress, model);
  const capabilities = getMarketplaceCapabilityTags(model);
  const publisher = getMarketplacePublisher(model.repoId);
  const PublisherIcon = publisher
    ? (marketplacePublisherIcons[publisher.toLocaleLowerCase()] ?? CustomProviderIcon)
    : CustomProviderIcon;
  const details = [
    { label: i18nService.t('marketplaceModelSizeLabel'), value: model.sizes[0]?.trim() || null },
    {
      label: i18nService.t('marketplaceRecommendedQuantizationLabel'),
      value: getMarketplaceRecommendedQuantization(model.recommendedTag),
    },
    { label: i18nService.t('marketplaceFormatLabel'), value: MARKETPLACE_GGUF_FORMAT },
  ];

  return (
    <Card
      size="sm"
      className="relative h-full w-full border border-border/70 bg-card p-0 shadow-sm ring-0 transition-all duration-200 hover:border-border hover:bg-muted/20 hover:shadow-md"
    >
      <CardHeader className="relative grid flex-1 grid-cols-[minmax(0,1fr)_auto] grid-rows-[auto_auto_1fr] gap-x-4 gap-y-1 p-4">
        <div className="col-start-1 row-start-1 flex min-w-0 items-center gap-2">
          <PublisherIcon
            aria-hidden="true"
            className={`size-4 shrink-0 ${localInferenceMutedTextClass}`}
          />
          <CardTitle className="truncate text-base font-semibold leading-6 text-foreground">
            {getMarketplaceDisplayName(model.repoId)}
          </CardTitle>
        </div>

        {model.detailUrl ? (
          <CardAction className="relative z-20 col-start-2 row-start-1 self-start justify-self-end">
            <Button
              type="button"
              onClick={() => void openExternalUrl(model.detailUrl!)}
              size="sm"
              variant="outline"
            >
              <ExternalLink data-icon="inline-start" />
              {i18nService.t('marketplaceModelScopeLink')}
            </Button>
          </CardAction>
        ) : null}

        {publisher ? (
          <div
            className={`col-start-1 row-start-2 truncate text-xs leading-4 ${localInferenceMutedTextClass}`}
          >
            {i18nService.t('marketplacePublisherLabel')}
            {publisher}
          </div>
        ) : null}

        <div className="col-start-1 row-start-3 flex min-w-0 self-end flex-wrap items-center gap-1.5 pr-1">
          <HoverCard>
            <HoverCardTrigger
              delay={200}
              closeDelay={100}
              render={
                <Badge
                  variant="secondary"
                  className={cn(marketplaceCardTagBaseClassName, 'cursor-default')}
                >
                  {i18nService.t('marketplaceDetails')}
                </Badge>
              }
            />
            <HoverCardContent side="right" align="start" className="w-auto min-w-52 p-3">
              <div className="flex flex-col gap-2">
                {details.map(item => (
                  <MetadataRow
                    key={item.label}
                    label={item.label}
                    value={item.value ?? i18nService.t('marketplaceMetadataUnavailable')}
                  />
                ))}
              </div>
            </HoverCardContent>
          </HoverCard>
          {capabilities.map(capability => (
            <Badge key={capability} variant="secondary" className={marketplaceCardTagBaseClassName}>
              {capabilityLabel(capability)}
            </Badge>
          ))}
        </div>

        <CardAction className="relative z-20 col-start-2 row-start-3 self-end justify-self-end">
          {installing ? (
            <Button
              type="button"
              onClick={() => void window.electron.llamacpp.cancelInstall(model.repoId)}
              size="sm"
              variant="outline"
            >
              <X data-icon="inline-start" />
              {i18nService.t('marketplaceCancelInstall')}
            </Button>
          ) : (
            <Button
              type="button"
              disabled={loading}
              size="sm"
              variant="outline"
              onClick={() => void onInstall(model)}
            >
              <Download data-icon="inline-start" />
              {i18nService.t('marketplaceInstall')}
            </Button>
          )}
        </CardAction>

        {progress ? (
          <div className="absolute inset-y-4 left-4 z-10 flex w-2/3 items-center justify-center rounded-lg border border-border bg-card p-4">
            <div className="w-full">
              <div
                className={`mb-1.5 flex items-center justify-between gap-2 text-[11px] ${localInferenceMutedTextClass}`}
              >
                <span className="min-w-0 truncate">{formatPullProgress(progress)}</span>
                {typeof progress.percent === 'number' ? <span>{progress.percent}%</span> : null}
              </div>
              <InstallProgressBar progress={progress} />
            </div>
          </div>
        ) : null}
      </CardHeader>
    </Card>
  );
}

function MetadataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[68px_minmax(0,1fr)] items-start gap-2.5">
      <div className={cn('pt-0.5 text-[11px] font-medium leading-4', localInferenceMutedTextClass)}>
        {label}
      </div>
      <div className="min-w-0 text-[13px] font-medium leading-5 text-foreground">
        <span className="block break-all">{value}</span>
      </div>
    </div>
  );
}
