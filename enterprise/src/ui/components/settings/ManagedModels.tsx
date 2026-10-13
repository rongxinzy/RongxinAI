import { CloudAlert, CloudOff, Cpu, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  type ManagedProviderCatalogModel,
  type ModelCapabilities,
  ModelCapabilityStatus,
} from '../../../host-contract.js';
import type { EnterpriseRendererLanguage } from '../../../renderer-contract.js';
import { type TranslationKey, translate } from '../../i18n.js';
import { Badge } from '../ui/badge.js';
import { Button } from '../ui/button.js';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '../ui/empty.js';
import { Skeleton } from '../ui/skeleton.js';

export const ZHIYUAN_MODEL_PROVIDER_KEY = 'custom_enterprise';

export const ManagedModelLoadStatus = {
  Loading: 'loading',
  Ready: 'ready',
  Error: 'error',
} as const;

type ManagedModelLoadState =
  | { readonly status: typeof ManagedModelLoadStatus.Loading }
  | {
      readonly status: typeof ManagedModelLoadStatus.Ready;
      readonly models: readonly ManagedProviderCatalogModel[];
    }
  | { readonly status: typeof ManagedModelLoadStatus.Error };

const CapabilityTranslationKeys = {
  toolCalling: 'modelCapabilityTools',
  imageInput: 'modelCapabilityImages',
  videoInput: 'modelCapabilityVideo',
  audioInput: 'modelCapabilityAudio',
  documentInput: 'modelCapabilityDocuments',
  reasoning: 'modelCapabilityReasoning',
} as const satisfies Record<keyof ModelCapabilities, TranslationKey>;

interface ManagedModelsProps {
  readonly language: EnterpriseRendererLanguage;
  readonly loadModels: () => Promise<readonly ManagedProviderCatalogModel[]>;
}

export function ManagedModels({ language, loadModels }: ManagedModelsProps) {
  const [state, setState] = useState<ManagedModelLoadState>({
    status: ManagedModelLoadStatus.Loading,
  });
  const requestSequence = useRef(0);

  const refresh = useCallback(async () => {
    const request = ++requestSequence.current;
    setState({ status: ManagedModelLoadStatus.Loading });
    try {
      const models = (await loadModels()).filter(
        model => model.providerKey === ZHIYUAN_MODEL_PROVIDER_KEY,
      );
      if (request === requestSequence.current) {
        setState({ status: ManagedModelLoadStatus.Ready, models });
      }
    } catch {
      if (request === requestSequence.current) {
        setState({ status: ManagedModelLoadStatus.Error });
      }
    }
  }, [loadModels]);

  useEffect(() => {
    void refresh();
    return () => {
      requestSequence.current += 1;
    };
  }, [refresh]);

  return (
    <main
      className="flex h-full flex-col gap-4 overflow-y-auto bg-background px-4 py-4 sm:px-6"
      aria-label={translate(language, 'managedModelsTitle')}
    >
      <header className="flex items-start justify-between gap-4">
        <p className="min-w-0 text-sm text-muted-foreground">
          {translate(language, 'managedModelsDescription')}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={translate(language, 'refreshModels')}
          title={translate(language, 'refreshModels')}
          disabled={state.status === ManagedModelLoadStatus.Loading}
          onClick={() => void refresh()}
        >
          <RefreshCw aria-hidden="true" />
        </Button>
      </header>

      {state.status === ManagedModelLoadStatus.Loading ? (
        <ModelListSkeleton language={language} />
      ) : state.status === ManagedModelLoadStatus.Error ? (
        <ModelCatalogMessage
          icon={CloudAlert}
          title={translate(language, 'modelsUnavailableTitle')}
          description={translate(language, 'modelsUnavailableDescription')}
          action={translate(language, 'retryModels')}
          onAction={() => void refresh()}
        />
      ) : state.models.length === 0 ? (
        <ModelCatalogMessage
          icon={CloudOff}
          title={translate(language, 'noManagedModelsTitle')}
          description={translate(language, 'noManagedModelsDescription')}
          action={translate(language, 'refreshModels')}
          onAction={() => void refresh()}
        />
      ) : (
        <div role="list">
          {state.models.map(model => (
            <ModelRow key={`${model.providerKey}/${model.id}`} language={language} model={model} />
          ))}
        </div>
      )}
    </main>
  );
}

function ModelRow({
  language,
  model,
}: {
  readonly language: EnterpriseRendererLanguage;
  readonly model: ManagedProviderCatalogModel;
}) {
  const capabilities = supportedCapabilities(model.capabilities);
  return (
    <article
      className="flex flex-col gap-3 border-b border-border-subtle py-4 first:pt-0 last:border-b-0"
      role="listitem"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <Cpu className="size-4" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="break-words text-sm font-semibold">{model.displayName}</h2>
              {model.isDefault ? (
                <Badge variant="secondary">{translate(language, 'defaultModel')}</Badge>
              ) : null}
            </div>
            <p className="break-all text-xs text-tertiary-foreground">{model.id}</p>
          </div>
        </div>
      </div>

      <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-tertiary-foreground">
            {translate(language, 'modelProvider')}
          </dt>
          <dd className="font-normal">{model.providerDisplayName}</dd>
        </div>
        <div>
          <dt className="text-xs text-tertiary-foreground">
            {translate(language, 'contextWindow')}
          </dt>
          <dd className="font-normal">
            {model.contextWindow
              ? `${new Intl.NumberFormat(language).format(model.contextWindow)} ${translate(language, 'tokens')}`
              : translate(language, 'notProvided')}
          </dd>
        </div>
      </dl>

      <div className="flex flex-wrap gap-2" aria-label={translate(language, 'modelCapabilities')}>
        {capabilities.length > 0 ? (
          capabilities.map(capability => (
            <Badge key={capability} variant="outline">
              {translate(language, CapabilityTranslationKeys[capability])}
            </Badge>
          ))
        ) : (
          <span className="text-xs text-tertiary-foreground">
            {translate(language, 'noDeclaredCapabilities')}
          </span>
        )}
      </div>
    </article>
  );
}

function ModelCatalogMessage({
  icon: Icon,
  title,
  description,
  action,
  onAction,
}: {
  readonly icon: typeof CloudOff;
  readonly title: string;
  readonly description: string;
  readonly action: string;
  readonly onAction: () => void;
}) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia>
          <Icon aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>
          <h2>{title}</h2>
        </EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button type="button" variant="outline" size="sm" onClick={onAction}>
          <RefreshCw data-icon="inline-start" aria-hidden="true" />
          {action}
        </Button>
      </EmptyContent>
    </Empty>
  );
}

function ModelListSkeleton({ language }: { readonly language: EnterpriseRendererLanguage }) {
  return (
    <div role="status" aria-label={translate(language, 'loadingModels')}>
      {[0, 1, 2].map(item => (
        <div
          key={item}
          className="flex gap-3 border-b border-border-subtle py-4 first:pt-0 last:border-b-0"
        >
          <Skeleton className="size-8 shrink-0" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-2/5" />
            <Skeleton className="h-3 w-3/5" />
            <Skeleton className="mt-1 h-6 w-4/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

function supportedCapabilities(
  capabilities: Partial<ModelCapabilities> | undefined,
): Array<keyof ModelCapabilities> {
  if (!capabilities) return [];
  return (Object.keys(CapabilityTranslationKeys) as Array<keyof ModelCapabilities>).filter(
    capability => capabilities[capability] === ModelCapabilityStatus.Supported,
  );
}
