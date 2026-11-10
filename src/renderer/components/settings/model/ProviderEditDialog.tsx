import { ProviderContextFields } from './ProviderContextFields';
import { ProviderModelListFields } from './ProviderModelListFields';
import { ProviderProbeSection } from './ProviderProbeSection';
import { ProviderConnectionFields } from './ProviderConnectionFields';
import { Button } from '@shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogFooterSurface,
  DialogHeader,
  DialogTitle,
} from '@shared/components/ui/dialog';
import { Input } from '@shared/components/ui/input';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@shared/components/ui/field';
import { LoaderCircle } from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';

import type {
  MagpieProviderApi,
  MagpieProviderSummary,
  MagpieSaveProviderInput,
  MagpieTestProviderResult,
} from '../../../../shared/magpie/types';
import { i18nService } from '../../../services/i18n';
import { formatContextTokens, parseContextTokens } from './modelContextValue';
import { PRESETS, type PresetKey } from './providerPresets';

interface ProviderEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider?: MagpieProviderSummary | null;
  onSave: (input: MagpieSaveProviderInput) => Promise<boolean>;
  onTest?: (input: MagpieSaveProviderInput) => Promise<MagpieTestProviderResult>;
}

export const ProviderEditDialog: React.FC<ProviderEditDialogProps> = ({
  open,
  onOpenChange,
  provider,
  onSave,
  onTest,
}) => {
  const [name, setName] = useState('');
  const [api, setApi] = useState<MagpieProviderApi>('openai-completions');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [models, setModels] = useState<string[]>([]);
  const [fallbackModels, setFallbackModels] = useState<string[]>([]);
  const [fallbackRawText, setFallbackRawText] = useState('');
  const [contextDefault, setContextDefault] = useState('');
  const [contextOverrides, setContextOverrides] = useState<Record<string, string>>({});
  const [contextsTouched, setContextsTouched] = useState(false);
  const [pendingContextModel, setPendingContextModel] = useState('');
  const [preset, setPreset] = useState<PresetKey>('custom');
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<MagpieTestProviderResult | null>(null);

  // 记录用户是否主动对模型列表做过自定义编辑（未编辑时探测到模型可直接全量自动覆盖）
  const [hasUserModifiedModels, setHasUserModifiedModels] = useState(false);
  // 当已有自定义修改，且探测拉回新模型时，暂存以供用户选择 [全部替换 / 增量追加 / 保持当前]
  const [pendingDiscoveredModels, setPendingDiscoveredModels] = useState<string[] | null>(null);

  // 请求版本与表单编辑版本校验，避免网络延时导致旧请求覆盖期间新编辑 (P1)
  const testRequestIdRef = useRef(0);
  const editVersionRef = useRef(0);

  // 视图模式：'chips' 标签胶囊 / 'text' 纯文本
  const [viewMode, setViewMode] = useState<'chips' | 'text'>('chips');
  const [rawText, setRawText] = useState('');
  const [newModelName, setNewModelName] = useState('');

  const isEditing = Boolean(provider?.id);

  // 是否属于本地免密服务商或已提供密钥
  const isLocalProvider = useMemo(() => {
    return (
      preset === 'ollama' ||
      baseUrl.includes('localhost') ||
      baseUrl.includes('127.0.0.1') ||
      baseUrl.includes('0.0.0.0')
    );
  }, [preset, baseUrl]);

  const hasKeyAvailable = useMemo(() => {
    return Boolean(apiKey.trim() || (isEditing && provider?.hasKey));
  }, [apiKey, isEditing, provider?.hasKey]);

  const contextDefaultParsed = useMemo(() => parseContextTokens(contextDefault), [contextDefault]);
  const contextRows = useMemo(
    () =>
      Object.keys(contextOverrides).map(id => ({
        id,
        parsed: parseContextTokens(contextOverrides[id] ?? ''),
      })),
    [contextOverrides],
  );
  const contextCandidates = useMemo(
    () => models.filter(modelId => !(modelId in contextOverrides)),
    [models, contextOverrides],
  );
  const hasInvalidContext = !contextDefaultParsed.ok || contextRows.some(row => !row.parsed.ok);
  const collectContexts = (): Record<string, number> | undefined => {
    // Untouched: omit the field, so a name or key edit never rewrites windows.
    if (!contextsTouched) return undefined;
    const contexts: Record<string, number> = {};
    if (contextDefaultParsed.ok && contextDefaultParsed.value !== undefined) {
      contexts['*'] = contextDefaultParsed.value;
    }
    for (const row of contextRows) {
      if (row.parsed.ok && row.parsed.value !== undefined) contexts[row.id] = row.parsed.value;
    }
    return contexts;
  };

  useEffect(() => {
    editVersionRef.current += 1;
    testRequestIdRef.current += 1;
    if (open) {
      if (provider) {
        setName(provider.name || '');
        setApi(provider.api || 'openai-completions');
        setBaseUrl(provider.baseUrl || '');
        setApiKey('');
        const initialModels = provider.models || [];
        setModels(initialModels);
        setRawText(initialModels.join(', '));
        const initialFallback = provider.fallback || [];
        setFallbackModels(initialFallback);
        setFallbackRawText(initialFallback.join(', '));
        const contexts = provider.contexts ?? {};
        setContextDefault(formatContextTokens(contexts['*']));
        const overrides: Record<string, string> = {};
        for (const [modelId, tokens] of Object.entries(contexts)) {
          if (modelId !== '*') overrides[modelId] = formatContextTokens(tokens);
        }
        setContextOverrides(overrides);
        setContextsTouched(false);
        setPendingContextModel('');
        setPreset('custom');
        setHasUserModifiedModels(true);
      } else {
        setName('');
        setApi('openai-completions');
        setBaseUrl('');
        setApiKey('');
        setModels([]);
        setRawText('');
        setFallbackModels([]);
        setFallbackRawText('');
        setContextDefault('');
        setContextOverrides({});
        setContextsTouched(false);
        setPendingContextModel('');
        setPreset('custom');
        setHasUserModifiedModels(false);
      }
      setTestResult(null);
      setPendingDiscoveredModels(null);
      setNewModelName('');
      setViewMode('chips');
      setIsSaving(false);
      setIsTesting(false);
    }
  }, [open, provider]);

  const handleApplyPreset = (key: PresetKey) => {
    editVersionRef.current += 1;
    setPreset(key);
    if (key === 'custom') return;
    const config = PRESETS[key];
    if (config) {
      if (!name || name === PRESETS[preset]?.name) setName(config.name);
      setApi(config.api);
      setBaseUrl(config.baseUrl);

      // 若用户未手动自定义过模型，载入预设官方推荐模型作为安全兜底
      if (!hasUserModifiedModels || models.length === 0) {
        const parsed = config.defaultModels
          .split(',')
          .map(m => m.trim())
          .filter(Boolean);
        setModels(parsed);
        setRawText(parsed.join(', '));
        setHasUserModifiedModels(false);
      }
    }
  };

  const syncModelsFromText = (text: string) => {
    editVersionRef.current += 1;
    setRawText(text);
    const parsed = text
      .split(',')
      .map(m => m.trim())
      .filter(Boolean);
    setModels(Array.from(new Set(parsed)));
    setHasUserModifiedModels(true);
  };

  const handleAddModel = (nameToAdd: string) => {
    const trimmed = nameToAdd.trim();
    if (!trimmed) return;
    editVersionRef.current += 1;
    if (!models.includes(trimmed)) {
      const updated = [...models, trimmed];
      setModels(updated);
      setRawText(updated.join(', '));
      setHasUserModifiedModels(true);
    }
    setNewModelName('');
  };

  const handleRemoveModel = (target: string) => {
    editVersionRef.current += 1;
    const updated = models.filter(m => m !== target);
    setModels(updated);
    setRawText(updated.join(', '));
    const nextFallback = fallbackModels.filter(f => f !== target);
    setFallbackModels(nextFallback);
    setFallbackRawText(nextFallback.join(', '));
    setHasUserModifiedModels(true);
  };

  const handleToggleFallback = (target: string) => {
    editVersionRef.current += 1;
    let nextFallback: string[];
    if (fallbackModels.includes(target)) {
      nextFallback = fallbackModels.filter(f => f !== target);
    } else {
      nextFallback = [...fallbackModels, target];
    }
    setFallbackModels(nextFallback);
    setFallbackRawText(nextFallback.join(', '));
  };

  const handleSetPrimary = (target: string) => {
    editVersionRef.current += 1;
    // 将指定模型提升到模型列表第一位
    const filtered = models.filter(m => m !== target);
    const updated = [target, ...filtered];
    setModels(updated);
    setRawText(updated.join(', '));
    setHasUserModifiedModels(true);
  };

  const getPayload = (): MagpieSaveProviderInput => {
    const fallback = fallbackRawText
      .split(',')
      .map(f => f.trim())
      .filter(Boolean);
    const contexts = collectContexts();
    return {
      ...(provider?.id ? { id: provider.id } : {}),
      name: name.trim() || i18nService.t('magpieProviderDefaultName'),
      api,
      baseUrl: baseUrl.trim(),
      ...(apiKey.trim() ? { key: apiKey.trim() } : {}),
      models,
      fallback,
      ...(contexts !== undefined ? { contexts } : {}),
    };
  };

  const handleTest = async () => {
    if (!onTest || !baseUrl.trim()) return;
    const requestId = ++testRequestIdRef.current;
    const capturedEditVersion = editVersionRef.current;

    setIsTesting(true);
    setTestResult(null);
    setPendingDiscoveredModels(null);
    try {
      const result = await onTest(getPayload());

      // P1 校验：若有新探测请求发起或请求期间表单被修改，直接丢弃过期结果
      if (
        requestId !== testRequestIdRef.current ||
        capturedEditVersion !== editVersionRef.current
      ) {
        return;
      }

      setTestResult(result);

      if (result.ok && result.discoveredModels && result.discoveredModels.length > 0) {
        const onlineList = result.discoveredModels;
        const isIdentical =
          onlineList.length === models.length &&
          onlineList.every((val, idx) => val === models[idx]);

        if (isIdentical) {
          // 与当前列表完全一致，无需额外操作
          return;
        }

        if (!hasUserModifiedModels || models.length === 0) {
          // 用户未做过自定义修改（或者是预设初始态或空）：直接智能全量自动填入！
          setModels(onlineList);
          setRawText(onlineList.join(', '));
          setHasUserModifiedModels(false);
        } else {
          // 用户已有自己的配置：弹出温和操作条供选择
          setPendingDiscoveredModels(onlineList);
        }
      }
    } catch (err: unknown) {
      if (
        requestId !== testRequestIdRef.current ||
        capturedEditVersion !== editVersionRef.current
      ) {
        return;
      }
      setTestResult({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      if (requestId === testRequestIdRef.current) {
        setIsTesting(false);
      }
    }
  };

  const handleResolveConflict = (action: 'replace' | 'append' | 'keep') => {
    if (!pendingDiscoveredModels) return;
    editVersionRef.current += 1;

    if (action === 'replace') {
      setModels(pendingDiscoveredModels);
      setRawText(pendingDiscoveredModels.join(', '));
      const nextFallback = fallbackModels.filter(f => pendingDiscoveredModels.includes(f));
      setFallbackModels(nextFallback);
      setFallbackRawText(nextFallback.join(', '));
      setHasUserModifiedModels(false);
    } else if (action === 'append') {
      const merged = Array.from(new Set([...models, ...pendingDiscoveredModels]));
      setModels(merged);
      setRawText(merged.join(', '));
      setHasUserModifiedModels(true);
    }
    // 'keep' 保持当前不变
    setPendingDiscoveredModels(null);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !baseUrl.trim() || hasInvalidContext) return;
    setIsSaving(true);
    try {
      const ok = await onSave(getPayload());
      if (ok) {
        onOpenChange(false);
      }
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl flex max-h-[90vh] flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle>
            {isEditing ? i18nService.t('magpieEditProvider') : i18nService.t('magpieAddProvider')}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSave} className="flex min-h-0 flex-1 flex-col">
          <FieldGroup className="min-h-0 flex-1 overflow-y-auto pr-1 gap-4 py-2">
            <ProviderConnectionFields
              isEditing={isEditing}
              provider={provider}
              preset={preset}
              name={name}
              api={api}
              baseUrl={baseUrl}
              apiKey={apiKey}
              isSaving={isSaving}
              isLocalProvider={isLocalProvider}
              editVersionRef={editVersionRef}
              setName={setName}
              setApi={setApi}
              setBaseUrl={setBaseUrl}
              setApiKey={setApiKey}
              handleApplyPreset={handleApplyPreset}
            />

            <ProviderProbeSection
              isSaving={isSaving}
              isTesting={isTesting}
              baseUrl={baseUrl}
              isLocalProvider={isLocalProvider}
              hasKeyAvailable={hasKeyAvailable}
              testResult={testResult}
              pendingDiscoveredModels={pendingDiscoveredModels}
              handleTest={handleTest}
              handleResolveConflict={handleResolveConflict}
            />

            <ProviderModelListFields
              models={models}
              fallbackModels={fallbackModels}
              viewMode={viewMode}
              rawText={rawText}
              newModelName={newModelName}
              isSaving={isSaving}
              setViewMode={setViewMode}
              setNewModelName={setNewModelName}
              syncModelsFromText={syncModelsFromText}
              handleSetPrimary={handleSetPrimary}
              handleToggleFallback={handleToggleFallback}
              handleRemoveModel={handleRemoveModel}
              handleAddModel={handleAddModel}
            />

            <ProviderContextFields
              contextDefault={contextDefault}
              contextDefaultParsed={contextDefaultParsed}
              contextRows={contextRows}
              contextCandidates={contextCandidates}
              contextOverrides={contextOverrides}
              pendingContextModel={pendingContextModel}
              isSaving={isSaving}
              setContextsTouched={setContextsTouched}
              setContextDefault={setContextDefault}
              setContextOverrides={setContextOverrides}
              setPendingContextModel={setPendingContextModel}
            />

            {/* 6. 容灾回退模型列表 (P2: 保留独立文本状态，避免逗号和空格被提前吃掉) */}
            <Field>
              <FieldLabel htmlFor="provider-fallback">
                {i18nService.t('magpieProviderFallback')}
              </FieldLabel>
              <Input
                id="provider-fallback"
                value={fallbackRawText}
                onChange={e => {
                  editVersionRef.current += 1;
                  const text = e.target.value;
                  setFallbackRawText(text);
                  const parsed = text
                    .split(',')
                    .map(f => f.trim())
                    .filter(Boolean);
                  setFallbackModels(parsed);
                }}
                placeholder={i18nService.t('magpieProviderFallbackPlaceholder')}
                disabled={isSaving}
              />
              <FieldDescription>{i18nService.t('magpieProviderFallbackHint')}</FieldDescription>
            </Field>
          </FieldGroup>

          <DialogFooter surface={DialogFooterSurface.Seamless} className="mt-4 shrink-0">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={isSaving}
            >
              {i18nService.t('cancel')}
            </Button>
            <Button
              type="submit"
              disabled={isSaving || !name.trim() || !baseUrl.trim() || hasInvalidContext}
            >
              {isSaving && <LoaderCircle className="theme-composition-button-icon animate-spin" />}
              {i18nService.t('save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
