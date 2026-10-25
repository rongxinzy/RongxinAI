import { useLayoutEffect, useRef, useState } from 'react';
import type {
  MagpieProviderApi,
  MagpieProviderSummary,
  MagpieSaveProviderInput,
  MagpieTestProviderResult,
} from '../../../../../shared/magpie/types';
import { i18nService } from '../../../../services/i18n';
import { PRESETS, type PresetKey } from '../providerPresets';
import {
  CUSTOM_PROVIDER_PRESET,
  ProviderDiscoveryResolution,
  ProviderModelView,
  ProviderProtocol,
  parseProviderModels,
} from './constants';

export interface ProviderEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider?: MagpieProviderSummary | null;
  onSave: (input: MagpieSaveProviderInput) => Promise<boolean>;
  onTest?: (input: MagpieSaveProviderInput) => Promise<MagpieTestProviderResult>;
}
interface Draft {
  name: string;
  api: MagpieProviderApi;
  baseUrl: string;
  apiKey: string;
  models: string[];
  modelsText: string;
  fallbackText: string;
}
function draftFor(provider?: MagpieProviderSummary | null): Draft {
  return {
    name: provider?.name ?? '',
    api: provider?.api ?? ProviderProtocol.Chat,
    baseUrl: provider?.baseUrl ?? '',
    apiKey: '',
    models: [...(provider?.models ?? [])],
    modelsText: provider?.models.join(', ') ?? '',
    fallbackText: provider?.fallback?.join(', ') ?? '',
  };
}
function isLocalAddress(value: string): boolean {
  try {
    return ['localhost', '127.0.0.1', '[::1]', '0.0.0.0'].includes(new URL(value).hostname);
  } catch {
    return false;
  }
}

export function useProviderEditor({
  open,
  provider,
  onOpenChange,
  onSave,
  onTest,
}: ProviderEditorProps) {
  const [draft, setDraft] = useState(() => draftFor(provider));
  const [preset, setPreset] = useState<PresetKey>(CUSTOM_PROVIDER_PRESET);
  const [modelView, setModelView] = useState<
    (typeof ProviderModelView)[keyof typeof ProviderModelView]
  >(ProviderModelView.List);
  const [newModelName, setNewModelName] = useState('');
  const [modifiedModels, setModifiedModels] = useState(Boolean(provider));
  const [pendingModels, setPendingModels] = useState<string[] | null>(null);
  const [testResult, setTestResult] = useState<MagpieTestProviderResult | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [invalidUrl, setInvalidUrl] = useState(false);
  const [generation, setGeneration] = useState(0);
  const latestProvider = useRef(provider);
  latestProvider.current = provider;
  const providerId = provider?.id;
  const lifetime = useRef({ active: false, revision: 0, testing: false, saving: false });

  // A new opening/owner has a distinct lifetime; same-ID refreshes must not erase edits.
  useLayoutEffect(() => {
    const current = { active: open, revision: 0, testing: false, saving: false };
    lifetime.current = current;
    if (open) {
      setDraft(draftFor(latestProvider.current));
      setPreset(CUSTOM_PROVIDER_PRESET);
      setModifiedModels(Boolean(latestProvider.current));
      setModelView(ProviderModelView.List);
      setNewModelName('');
      setPendingModels(null);
      setTestResult(null);
      setIsTesting(false);
      setIsSaving(false);
      setSaveFailed(false);
      setInvalidUrl(false);
      setGeneration(value => value + 1);
    }
    return () => {
      current.active = false;
    };
  }, [open, providerId]);

  const edit = (patch: Partial<Draft> | ((previous: Draft) => Partial<Draft>)) => {
    if (!lifetime.current.active || lifetime.current.saving) return;
    lifetime.current.revision++;
    setSaveFailed(false);
    setTestResult(null);
    setPendingModels(null);
    setDraft(previous => ({
      ...previous,
      ...(typeof patch === 'function' ? patch(previous) : patch),
    }));
  };
  const modelsChanged = (models: string[]) => {
    edit({ models, modelsText: models.join(', ') });
    setModifiedModels(true);
  };
  const applyPreset = (next: PresetKey) => {
    setPreset(next);
    if (next === CUSTOM_PROVIDER_PRESET) return;
    const config = PRESETS[next];
    const models =
      !modifiedModels || draft.models.length === 0
        ? parseProviderModels(config.defaultModels)
        : draft.models;
    edit({
      name: !draft.name || draft.name === PRESETS[preset].name ? config.name : draft.name,
      api: config.api,
      baseUrl: config.baseUrl,
      models,
      modelsText: models === draft.models ? draft.modelsText : models.join(', '),
    });
    if (models !== draft.models) setModifiedModels(false);
  };
  const payload = (): MagpieSaveProviderInput => ({
    ...(providerId ? { id: providerId } : {}),
    name: draft.name.trim() || i18nService.t('magpieProviderDefaultName'),
    api: draft.api,
    baseUrl: draft.baseUrl.trim(),
    ...(draft.apiKey.trim() ? { key: draft.apiKey.trim() } : {}),
    models: draft.models,
    fallback: parseProviderModels(draft.fallbackText),
  });
  const testConnection = async () => {
    const current = lifetime.current;
    if (!onTest || !draft.baseUrl.trim() || !current.active || current.testing || current.saving)
      return;
    const revision = current.revision;
    current.testing = true;
    setIsTesting(true);
    setTestResult(null);
    setPendingModels(null);
    try {
      const result = await onTest(payload());
      if (!current.active || lifetime.current !== current || current.revision !== revision) return;
      setTestResult(result);
      if (result.ok && result.discoveredModels?.length) {
        const models = [...new Set(result.discoveredModels)];
        if (
          models.length === draft.models.length &&
          models.every((model, index) => model === draft.models[index])
        )
          return;
        if (!modifiedModels || draft.models.length === 0) {
          setDraft(previous => ({ ...previous, models, modelsText: models.join(', ') }));
          setModifiedModels(false);
        } else setPendingModels(models);
      }
    } catch (error) {
      if (current.active && lifetime.current === current && current.revision === revision)
        setTestResult({
          ok: false,
          error: error instanceof Error ? error.message : i18nService.t('magpieTestFailed'),
        });
    } finally {
      current.testing = false;
      if (current.active && lifetime.current === current) setIsTesting(false);
    }
  };
  const resolveDiscovery = (
    resolution: (typeof ProviderDiscoveryResolution)[keyof typeof ProviderDiscoveryResolution],
  ) => {
    if (!pendingModels || lifetime.current.saving) return;
    if (resolution === ProviderDiscoveryResolution.Replace) {
      modelsChanged(pendingModels);
      edit({
        fallbackText: parseProviderModels(draft.fallbackText)
          .filter(model => pendingModels.includes(model))
          .join(', '),
      });
      setModifiedModels(false);
    } else if (resolution === ProviderDiscoveryResolution.Append)
      modelsChanged([...new Set([...draft.models, ...pendingModels])]);
    // Keeping the current list also invalidates any outstanding test snapshot.
    lifetime.current.revision++;
    setPendingModels(null);
  };
  const save = async () => {
    const current = lifetime.current;
    if (!current.active || current.saving || !draft.name.trim() || !draft.baseUrl.trim()) return;
    current.saving = true;
    current.revision++;
    setIsSaving(true);
    setSaveFailed(false);
    try {
      const saved = await onSave(payload());
      if (!current.active || lifetime.current !== current) return;
      if (saved) onOpenChange(false);
      else setSaveFailed(true);
    } catch {
      if (current.active && lifetime.current === current) setSaveFailed(true);
    } finally {
      current.saving = false;
      if (current.active && lifetime.current === current) setIsSaving(false);
    }
  };

  return {
    draft,
    preset,
    modelView,
    setModelView,
    newModelName,
    setNewModelName,
    generation,
    pendingModels,
    testResult,
    isTesting,
    isSaving,
    saveFailed,
    invalidUrl,
    setInvalidUrl,
    edit,
    applyPreset,
    testConnection,
    resolveDiscovery,
    save,
    isEditing: Boolean(providerId),
    isLocal: isLocalAddress(draft.baseUrl),
    hasKey: Boolean(draft.apiKey.trim() || provider?.hasKey),
    maskedKey: provider?.keyMasked,
    changeOpen: (next: boolean) => {
      if (!lifetime.current.saving) onOpenChange(next);
    },
    textChanged: (modelsText: string) => {
      edit({ modelsText, models: parseProviderModels(modelsText) });
      setModifiedModels(true);
    },
    addModel: () => {
      const name = newModelName.trim();
      if (!name || lifetime.current.saving) return;
      if (!draft.models.includes(name)) modelsChanged([...draft.models, name]);
      setNewModelName('');
    },
    removeModel: (name: string) => {
      modelsChanged(draft.models.filter(model => model !== name));
      edit({
        fallbackText: parseProviderModels(draft.fallbackText)
          .filter(model => model !== name)
          .join(', '),
      });
    },
    preferModel: (name: string) =>
      modelsChanged([name, ...draft.models.filter(model => model !== name)]),
    toggleFallback: (name: string) => {
      const models = parseProviderModels(draft.fallbackText);
      edit({
        fallbackText: (models.includes(name)
          ? models.filter(model => model !== name)
          : [...models, name]
        ).join(', '),
      });
    },
  };
}

export type ProviderEditor = ReturnType<typeof useProviderEditor>;
