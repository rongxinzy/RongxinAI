import { Badge } from '@shared/components/ui/badge';
import { Button } from '@shared/components/ui/button';
import { Card, CardAction, CardHeader, CardTitle } from '@shared/components/ui/card';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@shared/components/ui/hover-card';
import { cn } from '@shared/lib/utils';
import { Download, ExternalLink, X } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import type { ComponentType } from 'react';

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
  MARKETPLACE_GGUF_FORMAT,
  openExternalUrl,
} from '../utils/marketplace';
import { resolveModelProviderName, type LocalModelProvider } from '../utils/modelProvider';
import { formatPullProgress } from '../utils/progress';
import { InstallProgressBar } from './Common';

const marketplaceCardTagBaseClassName = 'h-6 rounded-md px-2 py-0 text-xs font-normal shadow-none';
const marketplaceCardActionClassName =
  'relative z-20 transition-[opacity,transform] duration-200 ease-out group-hover/card:translate-x-0 group-hover/card:opacity-100 group-hover/card:pointer-events-auto';
const marketplaceCardHiddenActionClassName = 'pointer-events-none translate-x-1 opacity-0';

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
  const capabilities = getMarketplaceCapabilityTags(model);
  const publisher = getMarketplacePublisher(model.repoId);
  const displayName = getMarketplaceDisplayName(model.repoId);
  const modelProvider = resolveModelProviderName(displayName);
  const ModelIcon = modelProvider ? marketplaceModelIcons[modelProvider] : CustomProviderIcon;
  const details = [
    { label: i18nService.t('marketplaceModelSizeLabel'), value: model.sizes[0]?.trim() || null },
    {
      label: i18nService.t('marketplaceRecommendedQuantizationLabel'),
      value: getMarketplaceRecommendedQuantization(model.recommendedTag),
    },
    { label: i18nService.t('marketplaceFormatLabel'), value: MARKETPLACE_GGUF_FORMAT },
  ];

  return (
    <motion.div
      className="relative h-full w-full"
      whileHover={reduceMotion || progress ? undefined : { scale: 1.02, zIndex: 1 }}
      transition={motionTransition}
    >
      <Card
        size="sm"
        className="relative h-full w-full border border-border/70 bg-card p-0 shadow-sm ring-0 transition-all duration-200 hover:border-border hover:bg-muted/20 hover:shadow-md"
      >
        <CardHeader className="relative grid flex-1 grid-cols-[minmax(0,1fr)_auto] grid-rows-[auto_auto_1fr] gap-x-4 gap-y-1 p-4">
          <motion.div
            className="col-start-1 row-start-1 flex min-w-0 items-center gap-2"
            animate={
              progress
                ? { filter: 'blur(4px)', opacity: 0.45 }
                : { filter: 'blur(0px)', opacity: 1 }
            }
            transition={motionTransition}
          >
            <span
              aria-hidden="true"
              className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
            >
              <ModelIcon className="size-5" />
            </span>
            <CardTitle className="truncate text-base font-semibold leading-6 text-foreground">
              {displayName}
            </CardTitle>
          </motion.div>

          {model.detailUrl ? (
            <CardAction
              className={cn(
                marketplaceCardActionClassName,
                marketplaceCardHiddenActionClassName,
                'col-start-2 row-start-1 self-start justify-self-end',
              )}
            >
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
            <motion.div
              className={`col-start-1 row-start-2 truncate text-xs leading-4 ${localInferenceMutedTextClass}`}
              animate={
                progress
                  ? { filter: 'blur(4px)', opacity: 0.45 }
                  : { filter: 'blur(0px)', opacity: 1 }
              }
              transition={motionTransition}
            >
              {i18nService.t('marketplacePublisherLabel')}
              {publisher}
            </motion.div>
          ) : null}

          <motion.div
            className="col-start-1 row-start-3 flex min-w-0 self-end flex-wrap items-center gap-1.5 pr-1"
            animate={
              progress
                ? { filter: 'blur(4px)', opacity: 0.45 }
                : { filter: 'blur(0px)', opacity: 1 }
            }
            transition={motionTransition}
          >
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
              <Badge
                key={capability}
                variant="secondary"
                className={marketplaceCardTagBaseClassName}
              >
                {capabilityLabel(capability)}
              </Badge>
            ))}
          </motion.div>

          <CardAction
            className={cn(
              marketplaceCardActionClassName,
              !installing && marketplaceCardHiddenActionClassName,
              'col-start-2 row-start-3 self-end justify-self-end',
            )}
          >
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

          <AnimatePresence initial={false}>
            {progress ? (
              <motion.div
                initial={{ filter: 'blur(4px)', opacity: 0, y: 6 }}
                animate={{ filter: 'blur(0px)', opacity: 1, y: 0 }}
                exit={{ filter: 'blur(4px)', opacity: 0, y: -6 }}
                transition={motionTransition}
                className="pointer-events-none absolute inset-y-4 left-4 z-10 flex w-2/3 items-center justify-center"
              >
                <div className="w-full">
                  <div
                    className={`mb-1.5 flex items-center justify-between gap-2 text-[11px] ${localInferenceMutedTextClass}`}
                  >
                    <span className="min-w-0 truncate">{formatPullProgress(progress)}</span>
                    {typeof progress.percent === 'number' ? <span>{progress.percent}%</span> : null}
                  </div>
                  <InstallProgressBar progress={progress} />
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </CardHeader>
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
