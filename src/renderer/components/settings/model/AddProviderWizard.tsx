import { Button } from '@shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shared/components/ui/dialog';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { MagpieProviderApi, MagpieSaveProviderInput } from '../../../../shared/magpie/types';
import { i18nService } from '../../../services/i18n';
import {
  classifyProviderError,
  type ClassifiedProviderError,
  type ProviderErrorAction,
} from '../../../services/modelSettings/providerErrorClassifier';
import {
  CONSOLIDATED_PROVIDER_PRESETS,
  type ConsolidatedProviderPreset,
} from '../../../services/modelSettings/providerPresets';
import {
  WizardStepConfigureConnection,
  WizardStepSelectModels,
  WizardStepSelectPreset,
} from './AddProviderWizardSteps';
import { parseContextTokens } from './modelContextValue';

export interface AddProviderWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialPreset?: ConsolidatedProviderPreset | null;
  onSave: (input: MagpieSaveProviderInput, defaultModelToSelect?: string) => Promise<void>;
  onOpenNetworkSettings?: () => void;
  onOpenUsageSettings?: () => void;
}

export function AddProviderWizard({
  open,
  onOpenChange,
  initialPreset,
  onSave,
  onOpenNetworkSettings,
  onOpenUsageSettings,
}: AddProviderWizardProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [preset, setPreset] = useState<ConsolidatedProviderPreset>(
    initialPreset ?? CONSOLIDATED_PROVIDER_PRESETS[0],
  );
  const [name, setName] = useState('');
  const [api, setApi] = useState<MagpieProviderApi>('openai-completions');
  const [baseUrl, setBaseUrl] = useState('');
  const [usePlanEndpoint, setUsePlanEndpoint] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [discoveredModels, setDiscoveredModels] = useState<string[]>([]);
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [customModelInput, setCustomModelInput] = useState('');
  const [testError, setTestError] = useState<ClassifiedProviderError | null>(null);
  const [testPassed, setTestPassed] = useState(false);
  const [setAsDefault, setSetAsDefault] = useState(true);
  const [contextInput, setContextInput] = useState('');
  const [saving, setSaving] = useState(false);
  const autoTestTimerRef = useRef<number | null>(null);
  const keyInputRef = useRef<HTMLInputElement | null>(null);

  const applyPreset = (chosen: ConsolidatedProviderPreset) => {
    setPreset(chosen);
    setName(chosen.key === 'custom' ? i18nService.t('magpieProviderDefaultName') : chosen.name);
    setApi(chosen.api);
    setBaseUrl(chosen.baseUrl);
    setUsePlanEndpoint(false);
    setDiscoveredModels([]);
    const defaults = chosen.defaultModels
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    setSelectedModels(defaults);
    setTestError(null);
    setTestPassed(false);
  };

  useEffect(() => {
    if (!open) {
      if (autoTestTimerRef.current) window.clearTimeout(autoTestTimerRef.current);
      return;
    }
    setApiKey('');
    setShowKey(false);
    setSearchQuery('');
    setCustomModelInput('');
    setContextInput('');
    setSetAsDefault(true);
    if (initialPreset) {
      applyPreset(initialPreset);
      setStep(2);
    } else {
      applyPreset(CONSOLIDATED_PROVIDER_PRESETS[0]);
      setStep(1);
    }
  }, [open, initialPreset]);

  const filteredPresets = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return CONSOLIDATED_PROVIDER_PRESETS;
    return CONSOLIDATED_PROVIDER_PRESETS.filter(p =>
      `${p.name} ${p.key} ${p.shortDesc}`.toLowerCase().includes(q),
    );
  }, [searchQuery]);

  const buildDraft = (
    overrideBaseUrl?: string,
    overrideApiKey?: string,
  ): MagpieSaveProviderInput => ({
    name: name.trim() || preset.name,
    api,
    baseUrl: (overrideBaseUrl ?? baseUrl).trim(),
    key: (overrideApiKey ?? apiKey).trim() || undefined,
    models: selectedModels,
  });

  const runTest = async (overrideBaseUrl?: string, overrideApiKey?: string) => {
    const candidateKey = overrideApiKey ?? apiKey;
    if (!window.electron?.magpie?.testProvider) return;
    if (preset.requiresKey && !candidateKey.trim()) return;
    setTesting(true);
    setTestError(null);
    setTestPassed(false);
    try {
      const result = await window.electron.magpie.testProvider(
        buildDraft(overrideBaseUrl, overrideApiKey),
      );
      if (result.ok) {
        const models = result.discoveredModels ?? [];
        setDiscoveredModels(models);
        if (models.length > 0) {
          setSelectedModels(models.length <= 12 ? models : models.slice(0, 8));
        }
        setTestPassed(true);
      } else {
        setTestError(
          classifyProviderError({
            testResult: result,
            providerName: name || preset.name,
            baseUrl: overrideBaseUrl ?? baseUrl,
          }),
        );
      }
    } catch (error) {
      setTestError(
        classifyProviderError({
          raw: error instanceof Error ? error.message : String(error),
          providerName: name || preset.name,
          baseUrl: overrideBaseUrl ?? baseUrl,
        }),
      );
    } finally {
      setTesting(false);
    }
  };

  const handleKeyChange = (value: string) => {
    setApiKey(value);
    setTestError(null);
    setTestPassed(false);
    if (autoTestTimerRef.current) window.clearTimeout(autoTestTimerRef.current);
    if (value.trim().length >= 8 && baseUrl.trim()) {
      autoTestTimerRef.current = window.setTimeout(() => {
        void runTest(undefined, value);
      }, 500);
    }
  };

  const closeAndNavigate = (fn: () => void) => {
    onOpenChange(false);
    fn();
  };

  const handleErrorAction = (action: ProviderErrorAction, suggestedUrl?: string) => {
    if (action === 'fix_v1' && suggestedUrl) {
      setBaseUrl(suggestedUrl);
      void runTest(suggestedUrl);
    } else if (action === 'reenter_key') {
      keyInputRef.current?.focus();
    } else if (action === 'open_network' && onOpenNetworkSettings) {
      closeAndNavigate(onOpenNetworkSettings);
    } else if (action === 'open_usage' && onOpenUsageSettings) {
      closeAndNavigate(onOpenUsageSettings);
    } else if (action === 'manual_models') {
      setStep(3);
    } else if (action === 'retry') {
      void runTest();
    }
  };

  const allModelCandidates = useMemo(
    () => Array.from(new Set([...discoveredModels, ...selectedModels])),
    [discoveredModels, selectedModels],
  );

  const parsedContext = parseContextTokens(contextInput);

  const handleSave = async () => {
    if (selectedModels.length === 0 || !parsedContext.ok) return;
    setSaving(true);
    try {
      const payload: MagpieSaveProviderInput = {
        ...buildDraft(),
        contexts: parsedContext.value ? { '*': parsedContext.value } : undefined,
      };
      await onSave(payload, setAsDefault ? selectedModels[0] : undefined);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  const stepTitle =
    step === 1
      ? i18nService.t('providerWizardStep1Title')
      : step === 2
        ? i18nService.t('providerWizardStep2Title')
        : i18nService.t('providerWizardStep3Title');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <div className="flex items-center justify-between pr-6">
            <DialogTitle>{stepTitle}</DialogTitle>
            <span className="text-xs text-muted-foreground">
              {i18nService
                .t('providerWizardStepProgress')
                .replace('{step}', String(step))
                .replace('{total}', '3')}
            </span>
          </div>
        </DialogHeader>

        {step === 1 && (
          <WizardStepSelectPreset
            searchQuery={searchQuery}
            filteredPresets={filteredPresets}
            onSearchChange={setSearchQuery}
            onChoosePreset={item => {
              applyPreset(item);
              setStep(2);
            }}
          />
        )}

        {step === 2 && (
          <WizardStepConfigureConnection
            preset={preset}
            name={name}
            api={api}
            baseUrl={baseUrl}
            usePlanEndpoint={usePlanEndpoint}
            apiKey={apiKey}
            showKey={showKey}
            testing={testing}
            testPassed={testPassed}
            discoveredCount={discoveredModels.length || selectedModels.length}
            testError={testError}
            keyInputRef={keyInputRef}
            onBackToPresets={() => setStep(1)}
            onTogglePlanEndpoint={next => {
              setUsePlanEndpoint(next);
              if (next && preset.planVariant) {
                setBaseUrl(preset.planVariant.baseUrl);
                if (preset.planVariant.api) setApi(preset.planVariant.api);
              } else {
                setBaseUrl(preset.baseUrl);
                setApi(preset.api);
              }
            }}
            onNameChange={setName}
            onBaseUrlChange={setBaseUrl}
            onApiChange={setApi}
            onKeyChange={handleKeyChange}
            onToggleShowKey={() => setShowKey(v => !v)}
            onTest={() => void runTest()}
            onErrorAction={handleErrorAction}
          />
        )}

        {step === 3 && (
          <WizardStepSelectModels
            allModelCandidates={allModelCandidates}
            selectedModels={selectedModels}
            customModelInput={customModelInput}
            setAsDefault={setAsDefault}
            contextInput={contextInput}
            contextOk={parsedContext.ok}
            onSelectAll={() => setSelectedModels(allModelCandidates)}
            onClearSelection={() => setSelectedModels([])}
            onCustomModelInputChange={setCustomModelInput}
            onAddCustomModel={id => {
              if (!selectedModels.includes(id)) {
                setSelectedModels(prev => [...prev, id]);
              }
              setCustomModelInput('');
            }}
            onToggleModel={(modelId, checked) => {
              setSelectedModels(prev =>
                checked ? [...prev, modelId] : prev.filter(id => id !== modelId),
              );
            }}
            onSetAsDefaultChange={setSetAsDefault}
            onContextInputChange={setContextInput}
          />
        )}

        <DialogFooter>
          {step > 1 && (
            <Button type="button" variant="outline" onClick={() => setStep(step === 3 ? 2 : 1)}>
              {i18nService.t('providerWizardBack')}
            </Button>
          )}
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {i18nService.t('cancel')}
          </Button>
          {step === 2 && (
            <Button
              type="button"
              disabled={(preset.requiresKey && !apiKey.trim()) || !baseUrl.trim()}
              onClick={() => setStep(3)}
            >
              {i18nService.t('providerWizardNext')}
            </Button>
          )}
          {step === 3 && (
            <Button
              type="button"
              disabled={saving || selectedModels.length === 0 || !parsedContext.ok}
              onClick={() => void handleSave()}
            >
              {i18nService.t('providerWizardSaveAndEnable')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
