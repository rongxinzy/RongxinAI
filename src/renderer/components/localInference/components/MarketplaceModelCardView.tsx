import { Button } from '@shared/components/ui/button';
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

  const actionLabel = i18nService.t(
    isDownloadActive
      ? 'marketplaceDownloadInProgress'
      : installable
        ? 'marketplaceInstall'
        : 'marketplaceVerifyAndInstall',
  );
  return (
    <MarketplaceCardLayout
      name={
        <div className="flex min-w-0 items-center gap-3">
          <span aria-hidden="true" className="theme-control-muted shrink-0">
            <MarketplaceModelIcon name={displayName} />
          </span>
          <div className="min-w-0">
            <div className="theme-heading flex min-w-0 items-center gap-1.5">
              {model.detailUrl ? (
                <a
                  href={model.detailUrl}
                  target="_blank"
                  rel="noreferrer"
                  title={displayName}
                  className="theme-surface-market-link truncate"
                  onClick={event => {
                    event.preventDefault();
                    onOpenModel();
                  }}
                >
                  {displayName}
                </a>
              ) : (
                <span className="truncate" title={displayName}>
                  {displayName}
                </span>
              )}
              {model.metadataStatus === 'verified' && (
                <BadgeCheck
                  className="theme-control-muted size-3.5 shrink-0"
                  aria-label={publisher ?? undefined}
                />
              )}
            </div>
            <div
              className="theme-control-caption-muted mt-1 truncate"
              title={[publisher, model.description, ...capabilities.map(capabilityLabel)]
                .filter(Boolean)
                .join(' · ')}
            >
              {model.description ||
                [publisher, ...capabilities.map(capabilityLabel)].filter(Boolean).join(' · ')}
            </div>
          </div>
        </div>
      }
      quantization={
        variants.length > 1 ? (
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
                {selectedVariant
                  ? (selectedVariant.quantization ?? MARKETPLACE_GGUF_FORMAT)
                  : MARKETPLACE_GGUF_FORMAT}
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
        ) : selectedVariant ? (
          <span className="theme-control-caption-muted" title={variantLabel(selectedVariant)}>
            {selectedVariant.quantization ?? MARKETPLACE_GGUF_FORMAT}
          </span>
        ) : (
          '—'
        )
      }
      size={selectedVariant?.totalSizeBytes ? formatBytes(selectedVariant.totalSizeBytes) : '—'}
      fit={
        <div className={cn('theme-control-caption flex items-center gap-1', tone)}>
          <FitIcon className="size-3.5 shrink-0" aria-hidden="true" />
          <span>{marketplaceFitLabel(model.fit?.status)}</span>
        </div>
      }
      actions={
        <>
          <MarketplaceModelDetails model={model} details={details} />
          <Button
            type="button"
            size="icon"
            variant={isDownloadActive ? 'secondary' : 'ghost'}
            title={actionLabel}
            disabled={!isDownloadActive && loading}
            onClick={isDownloadActive ? onOpenDownload : onInstall}
          >
            <Download />
            <span className="sr-only">{actionLabel}</span>
          </Button>
        </>
      }
    />
  );
}
