import { Badge } from '@shared/components/ui/badge';
import { Button } from '@shared/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardFooter,
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
import { Download, ExternalLink, Star, X } from 'lucide-react';
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
import {
  localInferenceCompactButtonClass,
  localInferenceMutedTextClass,
} from '../constants';
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
    : { duration: 0.2, ease: [0.16, 1, 0.3, 1] as const };
  const hoverTransition = reduceMotion
    ? { duration: 0 }
    : { type: 'spring' as const, stiffness: 420, damping: 34, mass: 0.55 };
  const capabilities = getMarketplaceCapabilityTags(model);
  const publisher = getMarketplacePublisher(model.repoId);
  const displayName = getMarketplaceDisplayName(model.repoId);
  const modelProvider = resolveModelProviderName(displayName);
  const ModelIcon = modelProvider ? marketplaceModelIcons[modelProvider] : CustomProviderIcon;
  const variants = useMemo(() => groupMarketplaceVariants(model.files), [model.files]);
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);
  const selectedVariant = variants.find(variant => variant.id === selectedVariantId) ?? variants[0];
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
    <motion.div
      className="relative h-full w-full"
      whileHover={reduceMotion ? undefined : { y: -2 }}
      transition={hoverTransition}
    >
      <Card
        size="sm"
        className="group relative h-full w-full overflow-hidden border border-border/70 bg-card shadow-sm ring-0"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-6 top-0 z-10 h-px bg-gradient-to-r from-transparent via-foreground/25 to-transparent opacity-0 transition-opacity duration-200 group-hover:opacity-100 motion-reduce:transition-none"
        />
        <motion.div animate={{ opacity: progress ? 0.35 : 1 }} transition={motionTransition}>
          <CardHeader className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1">
            <div className="flex min-w-0 items-center gap-2">
              <span
                aria-hidden="true"
                className="relative flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted text-muted-foreground"
              >
                <span className="absolute inset-0 bg-foreground/[0.06] opacity-0 transition-opacity duration-200 group-hover:opacity-100 motion-reduce:transition-none" />
                <ModelIcon className="relative size-5 transition-transform duration-200 group-hover:-translate-y-px motion-reduce:transition-none" />
              </span>
              <CardTitle className="truncate text-base font-semibold leading-6 text-foreground">
                {displayName}
              </CardTitle>
            </div>

            {model.detailUrl ? (
              <CardAction>
                <Button
                  type="button"
                  className={localInferenceCompactButtonClass}
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
              <div className={cn('truncate text-xs leading-4', localInferenceMutedTextClass)}>
                {i18nService.t('marketplacePublisherLabel')}
                {publisher}
              </div>
            ) : null}
          </CardHeader>

          <CardContent className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <div className="inline-flex items-center gap-1 text-sm font-semibold text-warning">
                <Star className="size-3.5 fill-current" aria-hidden="true" />
                <span>{formatMarketplaceScore(model.score?.stars, model.score?.confidence)}</span>
              </div>
              <span className={cn('text-[11px]', model.fit?.status === 'unsupported' ? 'text-destructive' : 'text-muted-foreground')}>
                {marketplaceFitLabel(model.fit?.status)}
              </span>
            </div>

            <div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
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
                <HoverCardContent side="top" align="start" className="w-auto min-w-64 p-3">
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
                    {model.score?.reasons.map(reason => <div key={reason} className="text-[11px] text-muted-foreground">· {reason}</div>)}
                    {formatDownloadCount(model.downloads) ? <MetadataRow label={i18nService.t('marketplaceDownloadsLabel')} value={formatDownloadCount(model.downloads)} /> : null}
                  </div>
                </HoverCardContent>
              </HoverCard>
              {capabilities.map(capability => (
                <Badge key={capability} variant="secondary" className={marketplaceCardTagBaseClassName}>
                  {capabilityLabel(capability)}
                </Badge>
              ))}
            </div>

            {variants.length > 1 ? (
              <Select
                value={selectedVariant?.id ?? ''}
                onValueChange={value => { if (value) setSelectedVariantId(value); }}
              >
                <SelectTrigger
                  size="sm"
                  aria-label={i18nService.t('marketplaceSelectQuantization')}
                  className="h-7 w-full text-xs"
                >
                  <SelectValue>
                    {selectedVariant
                      ? `${selectedVariant.quantization ?? MARKETPLACE_GGUF_FORMAT} · ${formatBytes(selectedVariant.totalSizeBytes)}${selectedVariant.isSplit ? ` · ${selectedVariant.files.length}${i18nService.t('marketplaceVariantParts')}` : ''}`
                      : MARKETPLACE_GGUF_FORMAT}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {variants.map(variant => (
                    <SelectItem key={variant.id} value={variant.id}>
                      {variant.quantization ?? MARKETPLACE_GGUF_FORMAT} · {formatBytes(variant.totalSizeBytes)}
                      {variant.isSplit ? ` · ${variant.files.length}${i18nService.t('marketplaceVariantParts')}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
          </CardContent>

          <CardFooter className="justify-between border-t border-border/50">
            <Badge variant="outline">{runtimeLabel}</Badge>
            {installing ? (
                <Button type="button" onClick={() => void window.electron.llamacpp.cancelInstall(model.repoId)} size="sm" variant="outline">
                  <X data-icon="inline-start" />
                  {i18nService.t('marketplaceCancelInstall')}
                </Button>
              ) : (
                <Button type="button" disabled={loading} size="sm" onClick={() => void onInstall({ ...model, filePath: selectedVariant?.files[0]?.path ?? model.filePath })}>
                  <Download data-icon="inline-start" />
                  {installable
                    ? i18nService.t('marketplaceInstall')
                    : i18nService.t('marketplaceVerifyAndInstall')}
                </Button>
              )}
          </CardFooter>
        </motion.div>

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
    </motion.div>
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
