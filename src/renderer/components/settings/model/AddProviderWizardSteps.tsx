import { ProviderAvatar } from '@shared/components/model-picker/ProviderAvatar';
import { Button } from '@shared/components/ui/button';
import { Checkbox } from '@shared/components/ui/checkbox';
import { Input } from '@shared/components/ui/input';
import { Label } from '@shared/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shared/components/ui/select';
import { CheckCircle2, ChevronDown, Eye, EyeOff, Loader2, Plus, Search } from 'lucide-react';
import type { RefObject } from 'react';
import type { MagpieProviderApi } from '../../../../shared/magpie/types';
import { i18nService } from '../../../services/i18n';
import type {
  ClassifiedProviderError,
  ProviderErrorAction,
} from '../../../services/modelSettings/providerErrorClassifier';
import type { ConsolidatedProviderPreset } from '../../../services/modelSettings/providerPresets';
import { ProviderErrorBanner } from './ProviderErrorBanner';
import { formatContextTokens } from './modelContextValue';

export function WizardStepSelectPreset({
  searchQuery,
  filteredPresets,
  onSearchChange,
  onChoosePreset,
  onChooseCustom,
}: {
  searchQuery: string;
  filteredPresets: readonly ConsolidatedProviderPreset[];
  onSearchChange: (value: string) => void;
  onChoosePreset: (preset: ConsolidatedProviderPreset) => void;
  onChooseCustom?: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground" />
        <Input
          value={searchQuery}
          onChange={e => onSearchChange(e.target.value)}
          placeholder={i18nService.t('providerWizardSearchPlaceholder')}
          className="pl-9"
        />
      </div>
      {filteredPresets.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-muted/20 px-4 py-8 text-center">
          <p className="text-sm text-muted-foreground">
            {i18nService.t('providerWizardSearchEmpty')}
          </p>
          {onChooseCustom && (
            <Button type="button" variant="outline" size="sm" onClick={onChooseCustom}>
              {i18nService.t('providerWizardUseCustomFallback')}
            </Button>
          )}
        </div>
      ) : (
        <div className="grid max-h-[360px] grid-cols-2 gap-2.5 overflow-y-auto pr-1">
          {filteredPresets.map(item => (
            <button
              key={item.key}
              type="button"
              onClick={() => onChoosePreset(item)}
              className="flex items-center gap-3 rounded-lg border border-border bg-card p-3 text-left transition-colors hover:border-foreground/25 hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <ProviderAvatar name={item.name} providerKey={item.key} size="md" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-foreground">{item.name}</div>
                <div className="truncate text-xs text-muted-foreground">{item.shortDesc}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function WizardStepConfigureConnection({
  preset,
  name,
  api,
  baseUrl,
  usePlanEndpoint,
  apiKey,
  showKey,
  testing,
  testPassed,
  discoveredCount,
  testError,
  keyInputRef,
  onBackToPresets,
  onTogglePlanEndpoint,
  onNameChange,
  onBaseUrlChange,
  onApiChange,
  onKeyChange,
  onToggleShowKey,
  onTest,
  onErrorAction,
}: {
  preset: ConsolidatedProviderPreset;
  name: string;
  api: MagpieProviderApi;
  baseUrl: string;
  usePlanEndpoint: boolean;
  apiKey: string;
  showKey: boolean;
  testing: boolean;
  testPassed: boolean;
  discoveredCount: number;
  testError: ClassifiedProviderError | null;
  keyInputRef: RefObject<HTMLInputElement | null>;
  onBackToPresets: () => void;
  onTogglePlanEndpoint: (checked: boolean) => void;
  onNameChange: (value: string) => void;
  onBaseUrlChange: (value: string) => void;
  onApiChange: (value: MagpieProviderApi) => void;
  onKeyChange: (value: string) => void;
  onToggleShowKey: () => void;
  onTest: () => void;
  onErrorAction: (action: ProviderErrorAction, suggestedUrl?: string) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-3 py-2.5">
        <div className="flex items-center gap-2.5">
          <ProviderAvatar
            name={preset.name}
            providerKey={preset.key}
            baseUrl={baseUrl || preset.baseUrl}
            size="md"
          />
          <div>
            <div className="text-sm font-medium text-foreground">{preset.name}</div>
            <div className="text-xs text-muted-foreground">{preset.shortDesc}</div>
          </div>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onBackToPresets}>
          {i18nService.t('providerWizardBack')}
        </Button>
      </div>

      {preset.planVariant && (
        <label className="flex cursor-pointer items-center gap-2.5 rounded-md border border-border px-3 py-2 text-sm">
          <Checkbox
            checked={usePlanEndpoint}
            onCheckedChange={c => onTogglePlanEndpoint(Boolean(c))}
          />
          <span>{preset.planVariant.label}</span>
        </label>
      )}

      {preset.requiresKey && (
        <div className="space-y-2">
          <Label htmlFor="wizard-api-key">{i18nService.t('magpieProviderKey')}</Label>
          <div className="flex gap-2">
            <Input
              ref={keyInputRef}
              id="wizard-api-key"
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={e => onKeyChange(e.target.value)}
              placeholder={i18nService.t('magpieProviderKeyPlaceholder')}
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label={showKey ? 'Hide key' : 'Show key'}
              onClick={onToggleShowKey}
            >
              {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={testing || !apiKey.trim()}
              onClick={onTest}
            >
              {testing ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                i18nService.t('providerWizardTestFirst')
              )}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {i18nService.t('providerWizardApiKeyNotice')}
          </p>
        </div>
      )}

      {!preset.requiresKey && (
        <div className="flex items-center justify-between rounded-md border border-border px-3 py-2.5 text-sm">
          <span className="text-muted-foreground">{i18nService.t('modelsZeroNoConfigNeeded')}</span>
          <Button type="button" variant="outline" size="sm" disabled={testing} onClick={onTest}>
            {testing ? i18nService.t('magpieTesting') : i18nService.t('providerWizardTestFirst')}
          </Button>
        </div>
      )}

      {testing && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          <span>{i18nService.t('providerWizardTestingConnection')}</span>
        </div>
      )}

      {testPassed && (
        <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-foreground">
          <CheckCircle2 className="size-4 shrink-0 text-primary" />
          <span>
            {i18nService
              .t('providerWizardAutoTestSuccess')
              .replace('{count}', String(discoveredCount))}
          </span>
        </div>
      )}

      {testError && <ProviderErrorBanner classified={testError} onAction={onErrorAction} />}

      <details className="group rounded-lg border border-border px-3 py-2 text-sm">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 font-medium text-muted-foreground select-none hover:text-foreground">
          <ChevronDown className="size-4 transition-transform group-open:rotate-180" />
          <span>{i18nService.t('providerEditMoreOptions')}</span>
        </summary>
        <div className="mt-3 space-y-3 border-t border-border pt-3">
          <div className="space-y-1.5">
            <Label htmlFor="wizard-name">{i18nService.t('magpieProviderName')}</Label>
            <Input id="wizard-name" value={name} onChange={e => onNameChange(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wizard-url">{i18nService.t('magpieProviderBaseUrl')}</Label>
            <Input
              id="wizard-url"
              value={baseUrl}
              onChange={e => onBaseUrlChange(e.target.value)}
              placeholder="https://api.example.com/v1"
            />
          </div>
          <div className="space-y-1.5">
            <Label>{i18nService.t('magpieProviderApi')}</Label>
            <Select value={api} onValueChange={v => onApiChange(v as MagpieProviderApi)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="openai-completions">
                  {i18nService.t('magpieProviderApiOpenAIChat')}
                </SelectItem>
                <SelectItem value="anthropic-messages">
                  {i18nService.t('magpieProviderApiAnthropicMessages')}
                </SelectItem>
                <SelectItem value="openai-responses">
                  {i18nService.t('magpieProviderApiOpenAIResponses')}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </details>
    </div>
  );
}

export function WizardStepSelectModels({
  allModelCandidates,
  selectedModels,
  discoveredModelContexts,
  customModelInput,
  setAsDefault,
  contextInput,
  contextOk,
  onSelectAll,
  onClearSelection,
  onCustomModelInputChange,
  onAddCustomModel,
  onToggleModel,
  onSetAsDefaultChange,
  onContextInputChange,
}: {
  allModelCandidates: string[];
  selectedModels: string[];
  discoveredModelContexts?: Record<string, number>;
  customModelInput: string;
  setAsDefault: boolean;
  contextInput: string;
  contextOk: boolean;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onCustomModelInputChange: (value: string) => void;
  onAddCustomModel: (modelId: string) => void;
  onToggleModel: (modelId: string, checked: boolean) => void;
  onSetAsDefaultChange: (checked: boolean) => void;
  onContextInputChange: (value: string) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {i18nService
            .t('providerWizardSelectModels')
            .replace('{selected}', String(selectedModels.length))
            .replace('{total}', String(allModelCandidates.length))}
        </span>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" size="xs" onClick={onSelectAll}>
            {i18nService.t('providerWizardSelectAll')}
          </Button>
          <Button type="button" variant="ghost" size="xs" onClick={onClearSelection}>
            {i18nService.t('providerWizardClearSelection')}
          </Button>
        </div>
      </div>

      <div className="flex gap-2">
        <Input
          value={customModelInput}
          onChange={e => onCustomModelInputChange(e.target.value)}
          placeholder={i18nService.t('magpieModelAddPlaceholder')}
          onKeyDown={e => {
            if (e.key === 'Enter' && customModelInput.trim()) {
              e.preventDefault();
              onAddCustomModel(customModelInput.trim());
            }
          }}
        />
        <Button
          type="button"
          variant="outline"
          disabled={!customModelInput.trim()}
          onClick={() => {
            if (customModelInput.trim()) onAddCustomModel(customModelInput.trim());
          }}
        >
          <Plus className="size-4" />
        </Button>
      </div>

      <div className="max-h-56 divide-y divide-border overflow-y-auto rounded-lg border border-border">
        {allModelCandidates.map(modelId => {
          const detectedContext = discoveredModelContexts?.[modelId];
          return (
            <label
              key={modelId}
              className="flex cursor-pointer items-center gap-3 px-3 py-2.5 text-sm hover:bg-muted/40"
            >
              <Checkbox
                checked={selectedModels.includes(modelId)}
                onCheckedChange={next => onToggleModel(modelId, Boolean(next))}
              />
              <span className="min-w-0 flex-1 truncate font-mono text-xs">{modelId}</span>
              {detectedContext ? (
                <span className="shrink-0 font-mono text-xs text-muted-foreground">
                  {formatContextTokens(detectedContext).toUpperCase()}
                </span>
              ) : null}
            </label>
          );
        })}
      </div>

      <label className="flex cursor-pointer items-center gap-2.5 text-sm">
        <Checkbox checked={setAsDefault} onCheckedChange={c => onSetAsDefaultChange(Boolean(c))} />
        <span>{i18nService.t('providerWizardSetDefaultModel')}</span>
      </label>

      <details className="group rounded-lg border border-border px-3 py-2 text-sm">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 font-medium text-muted-foreground select-none hover:text-foreground">
          <ChevronDown className="size-4 transition-transform group-open:rotate-180" />
          <span>{i18nService.t('providerAdvancedSummary')}</span>
        </summary>
        <div className="mt-3 space-y-2 border-t border-border pt-3">
          <Label htmlFor="wizard-ctx">{i18nService.t('magpieProviderContext')}</Label>
          <Input
            id="wizard-ctx"
            value={contextInput}
            onChange={e => onContextInputChange(e.target.value)}
            placeholder={i18nService.t('magpieProviderContextPlaceholder')}
          />
          <p className="text-xs text-muted-foreground">
            {contextOk
              ? i18nService.t('magpieProviderContextHint')
              : i18nService.t('magpieProviderContextInvalid')}
          </p>
        </div>
      </details>
    </div>
  );
}
