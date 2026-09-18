import { Button } from '@shared/components/ui/button';
import { cn } from '@shared/lib/utils';
import { Pencil, Trash2 } from 'lucide-react';
import { memo } from 'react';

import {
  ModelCapabilityStatus,
  ProviderName,
  type ProviderConfig,
} from '../../../shared/providers';
import { isCustomProvider } from '../../config';
import { i18nService } from '../../services/i18n';
import { MODEL_CAPABILITY_FIELDS } from './ModelCapabilitiesFields';
import { formatDetectedTokenLimit } from './tokenFormat';
import { ModelConnectionStatus } from './useModelConnectionStatus';

export type ProviderModelEntry = NonNullable<ProviderConfig['models']>[number];

/** 稳定引用的行回调集合，见 Settings 里的 modelRowActions。 */
export interface ProviderModelRowActions {
  testModel: (model: ProviderModelEntry) => void;
  editModel: (model: ProviderModelEntry) => void;
  deleteModel: (model: ProviderModelEntry) => void;
}

export interface ProviderModelRowProps {
  providerId: string;
  model: ProviderModelEntry;
  connectionStatus: ModelConnectionStatus;
  onTestModel: (model: ProviderModelEntry) => void;
  onEditModel: (model: ProviderModelEntry) => void;
  onDeleteModel: (model: ProviderModelEntry) => void;
}

/**
 * 模型列表行。memo 在这里是必需的：设置面板任何一次状态更新都会重渲染整棵树，
 * 而把连通性结果逐条写到状态点上会让整张列表跟着重渲染，几百个模型时就是卡顿。
 * 传入的 model / connectionStatus 之外的回调必须保持引用稳定（见 Settings 里的 modelRowActions）。
 */
export const ProviderModelRow = memo(function ProviderModelRow({
  providerId,
  model,
  connectionStatus,
  onTestModel,
  onEditModel,
  onDeleteModel,
}: ProviderModelRowProps) {
  const isLlamaCpp = providerId === ProviderName.LlamaCpp;
  const statusClassName =
    connectionStatus === ModelConnectionStatus.Failure
      ? 'bg-destructive'
      : isLlamaCpp || connectionStatus === ModelConnectionStatus.Success
        ? 'bg-success'
        : 'bg-muted-foreground';
  const hasCapabilityDetails =
    isCustomProvider(providerId) &&
    Boolean(
      model.maxTokens ||
        Object.values(model.capabilities ?? {}).some(
          status => status === ModelCapabilityStatus.Supported,
        ),
    );

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${i18nService.t('testConnection')} ${model.name}`}
      className="theme-surface-settings-row flex min-h-12 cursor-pointer items-center px-3 py-2"
      onClick={event => {
        if (event.target instanceof Element && event.target.closest('button')) {
          return;
        }
        onTestModel(model);
      }}
      onKeyDown={event => {
        if (event.target !== event.currentTarget) return;
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        onTestModel(model);
      }}
    >
      <div className="flex w-full min-w-0 items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <div className={cn('h-1.5 w-1.5 shrink-0 rounded-full', statusClassName)} />
          <div className="min-w-0">
            <div className={cn('truncate font-medium text-foreground', 'text-sm')}>
              {model.name}
            </div>
            {!isLlamaCpp ? (
              <div className={cn('truncate text-muted-foreground', 'text-xs')}>{model.id}</div>
            ) : null}
            {hasCapabilityDetails && (
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                {model.maxTokens && (
                  <span>
                    {i18nService.t('modelMaxOutputTokensShort')}:{' '}
                    {formatDetectedTokenLimit(model.maxTokens)}
                  </span>
                )}
                {MODEL_CAPABILITY_FIELDS.filter(
                  field =>
                    field.key !== 'imageInput' &&
                    model.capabilities?.[field.key] === ModelCapabilityStatus.Supported,
                ).map(field => (
                  <span key={field.key}>{i18nService.t(field.labelKey)}</span>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="ml-auto flex shrink-0 items-center justify-end gap-1">
          {model.supportsImage && (
            <span
              className={cn(
                'rounded-md bg-primary-muted px-1.5 py-0.5 text-primary',
                'text-xs',
              )}
            >
              {i18nService.t('imageInput')}
            </span>
          )}
          {!isLlamaCpp && (
            <>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={() => onEditModel(model)}
                aria-label={`${i18nService.t('editModel')} ${model.name}`}
                title={i18nService.t('editModel')}
                className="theme-page-settings-button-8"
              >
                <Pencil />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={() => onDeleteModel(model)}
                aria-label={`${i18nService.t('delete')} ${model.name}`}
                title={i18nService.t('delete')}
                className="theme-page-settings-button-9"
              >
                <Trash2 />
              </Button>
            </>
          )}
          {isLlamaCpp && (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={() => onEditModel(model)}
              aria-label={`${i18nService.t('editModel')} ${model.name}`}
              title={i18nService.t('editModel')}
              className="theme-page-settings-button-10 [&_svg]:size-3.5"
            >
              <Pencil />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
});
