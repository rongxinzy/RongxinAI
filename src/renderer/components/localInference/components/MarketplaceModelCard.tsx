import { Badge } from '@shared/components/ui/badge';
import { Button21st } from '@shared/components/ui/button-21st';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@shared/components/ui/card';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@shared/components/ui/hover-card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shared/components/ui/select';
import { cn } from '@shared/lib/utils';
import {
  Ban,
  BadgeCheck,
  CheckCircle2,
  CircleHelp,
  Download,
  Gauge,
  Info,
  Star,
  ThumbsUp,
  X,
} from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import type { ComponentType } from 'react';
import { useMemo, useState } from 'react';

import type { MarketplaceModel } from '../../../../shared/marketplace';
import { ProviderName } from '../../../../shared/providers';
import { i18nService } from '../../../services/i18n';
import {
  AnthropicIcon,
  CustomProviderIcon,
  DeepSeekIcon,
  GeminiIcon,
  MiniMaxIcon,
  MoonshotIcon,
  OpenAIIcon,
  QianfanIcon,
  QwenIcon,
  StepfunIcon,
  VolcengineIcon,
  XiaomiIcon,
  ZhipuIcon,
} from '../../icons/providers';
import { localInferenceMutedTextClass } from '../constants';
import type { InstallProgressState } from '../types';
import {
  capabilityLabel,
  getMarketplaceCapabilityTags,
  getMarketplaceDisplayName,
  getMarketplaceInstallProgress,
  getMarketplacePublisher,
  getMarketplaceRecommendedQuantization,
  formatDownloadCount,
  formatMarketplaceScore,
  groupMarketplaceVariants,
  marketplaceFitLabel,
  MARKETPLACE_GGUF_FORMAT,
  openExternalUrl,
} from '../utils/marketplace';
import { resolveModelProviderName, type LocalModelProvider } from '../utils/modelProvider';
import { formatBytes, formatPullProgress } from '../utils/progress';
import { InstallProgressBar } from './Common';

const marketplaceCardTagBaseClassName = 'h-6 rounded-md px-2 py-0 text-xs font-normal shadow-none';
const marketplaceModelIcons = {
  [ProviderName.Anthropic]: AnthropicIcon,
  [ProviderName.DeepSeek]: DeepSeekIcon,
  [ProviderName.Gemini]: GeminiIcon,
  [ProviderName.Minimax]: MiniMaxIcon,
  [ProviderName.Moonshot]: MoonshotIcon,
  [ProviderName.OpenAI]: OpenAIIcon,
  [ProviderName.Qianfan]: QianfanIcon,
  [ProviderName.Qwen]: QwenIcon,
  [ProviderName.StepFun]: StepfunIcon,
  [ProviderName.Volcengine]: VolcengineIcon,
  [ProviderName.Xiaomi]: XiaomiIcon,
  [ProviderName.Zhipu]: ZhipuIcon,
} satisfies Record<LocalModelProvider, ComponentType<{ className?: string }>>;

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
  const reduceMotion = useReducedMotion();
  const motionTransition = reduceMotion
    ? { duration: 0 }
    : { duration: 0.18, ease: [0.16, 1, 0.3, 1] as const };
  const capabilities = getMarketplaceCapabilityTags(model);
  const publisher = getMarketplacePublisher(model.repoId);
  const displayName = getMarketplaceDisplayName(model.repoId);
  const modelProvider = resolveModelProviderName(displayName);
  const ModelIcon = modelProvider ? marketplaceModelIcons[modelProvider] : CustomProviderIcon;
  const variants = useMemo(() => groupMarketplaceVariants(model.files), [model.files]);
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);
  const selectedVariant = variants.find(variant => variant.id === selectedVariantId) ?? variants[0];
  const scoreReasons = model.score?.reasons ?? [];
  const details = [
    {
      label: i18nService.t('marketplaceModelSizeLabel'),
      value: selectedVariant?.totalSizeBytes
        ? formatBytes(selectedVariant.totalSizeBytes)
        : model.sizes[0]?.trim() || null,
    },
    {
      label: i18nService.t('marketplaceRecommendedQuantizationLabel'),
      value: selectedVariant?.quantization || getMarketplaceRecommendedQuantization(model.recommendedTag),
    },
    { label: i18nService.t('marketplaceFormatLabel'), value: MARKETPLACE_GGUF_FORMAT },
  ];
  const installable = Boolean(
    model.metadataStatus === 'verified' &&
      selectedVariant &&
      selectedVariant.files.length > 0 &&
      selectedVariant.files.every(
        file => file.downloadUrl && file.sha256 && (file.sizeBytes ?? 0) > 0,
      ),
  );
  const runtimeLabel = model.runtime?.status === 'verified'
    ? i18nService.t('marketplaceRuntimeVerified')
    : model.runtime?.status === 'documented'
      ? i18nService.t('marketplaceRuntimeDocumented')
      : i18nService.t('marketplaceRuntimePending');

  return (
    <div data-marketplace-model-card="true" className="group relative z-0 h-full w-full rounded-xl transition-[box-shadow,z-index] duration-200 hover:z-20 hover:shadow-xl hover:shadow-foreground/20 focus-within:z-20">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-0 rounded-xl border border-border/70 bg-card ring-1 ring-border"
      >
      </div>
      <Card
        size="sm"
        className="relative z-10 h-full w-full gap-0 overflow-visible rounded-xl bg-transparent p-0 ring-0"
      >
        <motion.div animate={{ opacity: progress ? 0.35 : 1 }} transition={motionTransition}>
          <CardHeader className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-4 gap-y-2 px-5 pt-3 pb-0">
            <span
              aria-hidden="true"
              className="relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-muted text-muted-foreground"
            >
              <ModelIcon className="relative size-7" />
            </span>

            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <CardTitle className="truncate text-base font-semibold leading-6 text-foreground">
                  {model.detailUrl ? (
                    <a
                      href={model.detailUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="cursor-pointer hover:underline"
                      onClick={event => {
                        event.preventDefault();
                        void openExternalUrl(model.detailUrl!);
                      }}
                    >
                      {displayName}
                    </a>
                  ) : (
                    displayName
                  )}
                </CardTitle>
                {model.metadataStatus === 'verified' ? (
                  <BadgeCheck className="size-5 shrink-0 text-success" aria-hidden="true" />
                ) : null}
              </div>
              <div className="inline-flex items-center gap-1 text-sm font-semibold text-warning">
                <Star className="size-3.5 fill-current" aria-hidden="true" />
                <span>{formatMarketplaceScore(model.score?.stars, model.score?.confidence)}</span>
              </div>
            </div>

            <div className="flex min-w-0 flex-col items-end gap-2 text-right">
              {publisher ? (
                <div className={cn('max-w-40 truncate text-sm leading-5', localInferenceMutedTextClass)}>
                  {i18nService.t('marketplacePublisherLabel')}
                  {publisher}
                </div>
              ) : null}
              <MarketplaceFitStatusBadge status={model.fit?.status} />
            </div>
          </CardHeader>

          <CardContent className="flex flex-col gap-3 px-5 pb-3">
            <div className="-mt-2 flex min-w-0 flex-wrap items-center gap-2">
              <HoverCard>
                <HoverCardTrigger
                  delay={200}
                  closeDelay={100}
                  render={
                    <Badge
                      variant="secondary"
                      className={cn(marketplaceCardTagBaseClassName, 'shrink-0 cursor-default')}
                    >
                      {i18nService.t('marketplaceDetails')}
                    </Badge>
                  }
                />
                <HoverCardContent
                  side="top"
                  align="start"
                  className="w-96 rounded-lg border border-border bg-popover p-4 text-sm text-popover-foreground shadow-2xl"
                >
                  <div className="flex flex-col gap-3">
                    <div className="border-b border-border-subtle pb-2 text-sm font-semibold text-foreground">
                      {i18nService.t('marketplaceDetails')}
                    </div>
                    <div className="flex flex-col gap-2">
                      {details.map(item => (
                        <MetadataRow
                          key={item.label}
                          label={item.label}
                          value={item.value ?? i18nService.t('marketplaceMetadataUnavailable')}
                        />
                      ))}
                      <MetadataRow label={i18nService.t('marketplaceRuntimeLabel')} value={runtimeLabel} />
                      <MetadataRow label={i18nService.t('marketplaceScoreLabel')} value={formatMarketplaceScore(model.score?.stars, model.score?.confidence)} />
                      <MetadataRow label={i18nService.t('marketplaceFitLabel')} value={marketplaceFitLabel(model.fit?.status)} />
                      {scoreReasons.length ? (
                        <div className="border-t border-border-subtle pt-3">
                          <div className="mb-2 text-xs font-medium text-muted-foreground">
                            {i18nService.t('marketplaceScoreReasons')}
                          </div>
                          <div className="flex flex-col gap-2">
                            {scoreReasons.map(reason => (
                              <div key={reason} className="flex items-center gap-2 text-xs leading-5 text-muted-foreground">
                                <Info className="size-3.5 shrink-0" aria-hidden="true" />
                                <span className="min-w-0 break-words">{reason}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                      {formatDownloadCount(model.downloads) ? <MetadataRow label={i18nService.t('marketplaceDownloadsLabel')} value={formatDownloadCount(model.downloads)} /> : null}
                    </div>
                  </div>
                </HoverCardContent>
              </HoverCard>
              <Badge variant="outline" className={marketplaceCardTagBaseClassName}>
                {MARKETPLACE_GGUF_FORMAT}
              </Badge>
              {capabilities.map(capability => (
                <Badge key={capability} variant="outline" className={marketplaceCardTagBaseClassName}>
                  {capabilityLabel(capability)}
                </Badge>
              ))}
            </div>


          </CardContent>

        </motion.div>

          <div className="flex min-w-0 items-center gap-3 px-5 pb-3">
            <div className="min-w-0 flex-1">
              {variants.length > 0 ? (
                <Select
                  value={selectedVariant?.id ?? ''}
                  onValueChange={value => { if (value) setSelectedVariantId(value); }}
                >
                  <SelectTrigger
                    size="sm"
                    aria-label={i18nService.t('marketplaceSelectQuantization')}
                    className="h-8 min-h-8 max-h-8 w-full py-0 pl-2 text-left text-sm"
                  >
                    <SelectValue>
                      {selectedVariant
                        ? `${selectedVariant.quantization ?? MARKETPLACE_GGUF_FORMAT} · ${formatBytes(selectedVariant.totalSizeBytes)}${selectedVariant.isSplit ? ` · ${selectedVariant.files.length}${i18nService.t('marketplaceVariantParts')}` : ''}`
                        : MARKETPLACE_GGUF_FORMAT}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent
                    side="bottom"
                    sideOffset={4}
                    alignItemWithTrigger={false}
                    data-marketplace-model-select="true"
                    className={cn(
                      '!max-h-[140px]',
                      variants.length > 5 ? 'overflow-y-auto' : 'overflow-hidden',
                    )}
                  >
                    {variants.map(variant => (
                      <SelectItem key={variant.id} value={variant.id}>
                        {variant.quantization ?? MARKETPLACE_GGUF_FORMAT} · {formatBytes(variant.totalSizeBytes)}
                        {variant.isSplit ? ` · ${variant.files.length}${i18nService.t('marketplaceVariantParts')}` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
            </div>

            <div className="ml-auto flex shrink-0 items-center gap-2">
              {installing ? (
                <Button21st type="button" variant="danger" size="sm" className="h-8 min-w-16 border-destructive/40 bg-destructive/10 px-3 font-semibold hover:border-destructive/60 hover:bg-destructive/15" onClick={() => void window.electron.llamacpp.cancelInstall(model.repoId)}>
                  <X data-icon="inline-start" />
                  {i18nService.t('marketplaceCancelInstall')}
                </Button21st>
              ) : (
                <Button21st
                  type="button"
                  variant="primary"
                  size="sm"
                  className="h-8 min-w-16 px-3"
                  isDisabled={loading}
                  onClick={() => void onInstall({ ...model, filePath: selectedVariant?.files[0]?.path ?? model.filePath })}
                >
                  <Download data-icon="inline-start" />
                  {installable ? i18nService.t('marketplaceInstall') : i18nService.t('marketplaceVerifyAndInstall')}
                </Button21st>
              )}
            </div>
          </div>

        <AnimatePresence initial={false}>
          {progress ? (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={motionTransition}
              className="pointer-events-none absolute inset-x-4 top-1/2 z-10 -translate-y-1/2"
            >
              <div className="w-full">
                <div className={cn('mb-1.5 flex items-center justify-between gap-2 text-[11px]', localInferenceMutedTextClass)}>
                  <span className="min-w-0 truncate">{formatPullProgress(progress)}</span>
                  {typeof progress.percent === 'number' ? <span>{progress.percent}%</span> : null}
                </div>
                <InstallProgressBar progress={progress} />
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </Card>
    </div>
  );
}

type MarketplaceFitStatus = NonNullable<MarketplaceModel['fit']>['status'];

function MarketplaceFitStatusBadge({ status }: { status?: MarketplaceFitStatus }) {
  const normalizedStatus = status ?? 'unknown';
  const statusPresentation = {
    excellent: { icon: CheckCircle2, className: 'border-success/35 bg-success/10 text-success' },
    good: { icon: ThumbsUp, className: 'border-blue-500/35 bg-blue-500/10 text-blue-600 dark:text-blue-400' },
    limited: { icon: Gauge, className: 'border-warning/35 bg-warning/10 text-warning' },
    unsupported: { icon: Ban, className: 'border-destructive/35 bg-destructive/10 text-destructive' },
    unknown: { icon: CircleHelp, className: 'border-muted-foreground/30 bg-muted/40 text-muted-foreground' },
  } satisfies Record<MarketplaceFitStatus, { icon: typeof CheckCircle2; className: string }>;
  const { icon: StatusIcon, className } = statusPresentation[normalizedStatus];

  return (
    <div
      className={cn(
        'inline-flex h-8 min-w-16 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border px-3 py-0 text-sm font-medium',
        className,
      )}
    >
      <StatusIcon className="size-4 shrink-0" aria-hidden="true" />
      <span>{marketplaceFitLabel(normalizedStatus)}</span>
    </div>
  );
}
function MetadataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[68px_minmax(0,1fr)] items-start gap-2.5">
      <div className={cn('pt-0.5 text-xs font-medium leading-4', localInferenceMutedTextClass)}>
        {label}
      </div>
      <div className="min-w-0 text-sm font-medium leading-5 text-foreground">
        <span className="block break-all">{value}</span>
      </div>
    </div>
  );
}
