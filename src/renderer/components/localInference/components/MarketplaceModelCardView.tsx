import { Button } from '@shared/components/ui/button';
import { CardDescription, CardTitle } from '@shared/components/ui/card';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shared/components/ui/select';
import { cn } from '@shared/lib/utils';
import { Ban, BadgeCheck, CheckCircle2, CircleHelp, Download, Gauge, ThumbsUp } from 'lucide-react';
import type { MarketplaceModel } from '../../../../shared/marketplace';
import { i18nService } from '../../../services/i18n';
import {
  capabilityLabel,
  getMarketplaceCapabilityTags,
  getMarketplaceDisplayName,
  getMarketplacePublisher,
  marketplaceFitLabel,
  MARKETPLACE_GGUF_FORMAT,
  type MarketplaceVariant,
} from '../utils/marketplace';
import { formatBytes } from '../utils/progress';
import { MarketplaceCardLayout } from './MarketplaceCardLayout';
import { MarketplaceModelDetails, type MarketplaceDetailRow } from './MarketplaceModelDetails';
import { MarketplaceModelIcon } from './MarketplaceModelIcon';

interface MarketplaceModelCardViewProps {
  model: MarketplaceModel;
  details: MarketplaceDetailRow[];
  variants: MarketplaceVariant[];
  selectedVariant?: MarketplaceVariant;
  onSelectVariant: (id: string) => void;
  loading: boolean;
  installable: boolean;
  isDownloadActive: boolean;
  onOpenDownload: () => void;
  onInstall: () => void;
  onOpenModel: () => void;
}

const fitPresentation = {
  excellent: { icon: CheckCircle2, tone: 'text-success' },
  good: { icon: ThumbsUp, tone: 'text-muted-foreground' },
  limited: { icon: Gauge, tone: 'text-warning' },
  unsupported: { icon: Ban, tone: 'text-destructive' },
  unknown: { icon: CircleHelp, tone: 'text-muted-foreground' },
} satisfies Record<
  NonNullable<MarketplaceModel['fit']>['status'],
  { icon: typeof CheckCircle2; tone: string }
>;

function variantLabel(variant: MarketplaceVariant) {
  return `${variant.quantization ?? MARKETPLACE_GGUF_FORMAT} · ${formatBytes(variant.totalSizeBytes)}${variant.isSplit ? ` · ${variant.files.length}${i18nService.t('marketplaceVariantParts')}` : ''}`;
}

/** Stateless presentation: selection and download orchestration stay in the controller. */
export function MarketplaceModelCardView({
  model,
  details,
  variants,
  selectedVariant,
  onSelectVariant,
  loading,
  installable,
  isDownloadActive,
  onOpenDownload,
  onInstall,
  onOpenModel,
}: MarketplaceModelCardViewProps) {
  const displayName = getMarketplaceDisplayName(model.repoId);
  const publisher = getMarketplacePublisher(model.repoId);
  const capabilities = getMarketplaceCapabilityTags(model);
  const { icon: FitIcon, tone } = fitPresentation[model.fit?.status ?? 'unknown'];

  return (
    <MarketplaceCardLayout
      header={
        <>
          <span
            aria-hidden="true"
            className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
          >
            <MarketplaceModelIcon name={displayName} />
          </span>
          <div className="min-w-0 flex-1">
            <CardTitle className="theme-market-card-title">
              {model.detailUrl ? (
                <a
                  href={model.detailUrl}
                  target="_blank"
                  rel="noreferrer"
                  title={displayName}
                  className="theme-surface-market-link line-clamp-2 break-all"
                  onClick={event => {
                    event.preventDefault();
                    onOpenModel();
                  }}
                >
                  {displayName}
                </a>
              ) : (
                <span className="line-clamp-2 break-all" title={displayName}>
                  {displayName}
                </span>
              )}
            </CardTitle>
            <CardDescription className="theme-market-card-description mt-1 flex min-w-0 items-center gap-1.5">
              <span className="truncate" title={publisher ?? undefined}>
                {publisher
                  ? `${i18nService.t('marketplacePublisherLabel')}${publisher}`
                  : MARKETPLACE_GGUF_FORMAT}
              </span>
              {model.metadataStatus === 'verified' ? (
                <BadgeCheck className="size-3.5 shrink-0" aria-hidden="true" />
              ) : null}
            </CardDescription>
          </div>
          <MarketplaceModelDetails model={model} details={details} />
        </>
      }
      footer={
        <>
          {variants.length > 0 ? (
            <div className="min-w-0 flex-1 basis-40">
              <Select
                value={selectedVariant?.id ?? ''}
                onValueChange={value => {
                  if (value) onSelectVariant(value);
                }}
              >
                <SelectTrigger
                  aria-label={i18nService.t('marketplaceSelectQuantization')}
                  className="w-full min-w-0"
                >
                  <SelectValue className="min-w-0 truncate">
                    {selectedVariant ? variantLabel(selectedVariant) : MARKETPLACE_GGUF_FORMAT}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent
                  side="bottom"
                  sideOffset={4}
                  alignItemWithTrigger={false}
                  data-marketplace-model-select="true"
                  className="max-h-40"
                >
                  <SelectGroup>
                    {variants.map(variant => (
                      <SelectItem key={variant.id} value={variant.id}>
                        {variantLabel(variant)}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          ) : null}
          <Button
            type="button"
            variant={isDownloadActive ? 'secondary' : 'outline'}
            className="ml-auto min-w-20"
            disabled={!isDownloadActive && loading}
            onClick={isDownloadActive ? onOpenDownload : onInstall}
          >
            <Download data-icon="inline-start" />
            {isDownloadActive
              ? i18nService.t('marketplaceDownloadInProgress')
              : installable
                ? i18nService.t('marketplaceInstall')
                : i18nService.t('marketplaceVerifyAndInstall')}
          </Button>
        </>
      }
    >
      <p className="min-h-5 break-words text-xs leading-5 text-muted-foreground">
        {[MARKETPLACE_GGUF_FORMAT, ...capabilities.map(capabilityLabel)].join(' · ')}
      </p>
      <div className={cn('flex min-h-5 items-center gap-1.5 text-xs', tone)}>
        <FitIcon className="size-3.5 shrink-0" aria-hidden="true" />
        <span>{marketplaceFitLabel(model.fit?.status)}</span>
      </div>
    </MarketplaceCardLayout>
  );
}
