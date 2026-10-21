import { Badge } from '@shared/components/ui/badge';
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
import { Label } from '@shared/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shared/components/ui/select';
import {
  AlertCircle,
  ArrowRightLeft,
  CheckCircle2,
  LoaderCircle,
  Plus,
  Sparkles,
  X,
} from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';

import type {
  MagpieProviderApi,
  MagpieProviderSummary,
  MagpieSaveProviderInput,
  MagpieTestProviderResult,
} from '../../../../shared/magpie/types';
import { i18nService } from '../../../services/i18n';
import { PRESET_KEYS, PRESETS, type PresetKey } from './providerPresets';

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

  useEffect(() => {
    if (open) {
      editVersionRef.current = 0;
      testRequestIdRef.current = 0;
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
    return {
      ...(provider?.id ? { id: provider.id } : {}),
      name: name.trim() || i18nService.t('magpieProviderDefaultName'),
      api,
      baseUrl: baseUrl.trim(),
      ...(apiKey.trim() ? { key: apiKey.trim() } : {}),
      models,
      fallback,
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
    if (!name.trim() || !baseUrl.trim()) return;
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
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? i18nService.t('magpieEditProvider') : i18nService.t('magpieAddProvider')}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSave} className="flex flex-col gap-4 py-2">
          {/* 1. 连接基础信息配置 */}
          <div className="flex flex-col gap-3">
            {!isEditing && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="provider-preset" className="text-sm">
                  {i18nService.t('magpieProviderPreset')}
                </Label>
                <Select
                  items={Object.fromEntries(
                    PRESET_KEYS.map(key => [key, i18nService.t(PRESETS[key].labelKey)]),
                  )}
                  value={preset}
                  onValueChange={val => handleApplyPreset(val as PresetKey)}
                >
                  <SelectTrigger id="provider-preset" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRESET_KEYS.map(key => (
                      <SelectItem key={key} value={key}>
                        {i18nService.t(PRESETS[key].labelKey)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="provider-name" className="text-sm">
                  {i18nService.t('magpieProviderName')}
                </Label>
                <Input
                  id="provider-name"
                  value={name}
                  onChange={e => {
                    editVersionRef.current += 1;
                    setName(e.target.value);
                  }}
                  placeholder={i18nService.t('magpieProviderNamePlaceholder')}
                  required
                  disabled={isSaving}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="provider-api" className="text-sm">
                  {i18nService.t('magpieProviderApi')}
                </Label>
                <Select
                  value={api}
                  onValueChange={val => {
                    editVersionRef.current += 1;
                    setApi(val as MagpieProviderApi);
                  }}
                >
                  <SelectTrigger id="provider-api" className="w-full">
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

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="provider-url" className="text-sm">
                {i18nService.t('magpieProviderBaseUrl')}
              </Label>
              <Input
                id="provider-url"
                type="url"
                value={baseUrl}
                onChange={e => {
                  editVersionRef.current += 1;
                  setBaseUrl(e.target.value);
                }}
                placeholder="https://api.openai.com/v1"
                required
                disabled={isSaving}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="provider-key" className="text-sm">
                {i18nService.t('magpieProviderKey')}
              </Label>
              <Input
                id="provider-key"
                type="password"
                value={apiKey}
                onChange={e => {
                  editVersionRef.current += 1;
                  setApiKey(e.target.value);
                }}
                placeholder={
                  isEditing
                    ? i18nService.t('magpieProviderKeyKeepExisting')
                    : i18nService.t('magpieProviderKeyPlaceholder')
                }
                disabled={isSaving}
              />
              <div className="flex flex-wrap items-center justify-between gap-1 text-xs text-muted-foreground">
                {isEditing && provider?.hasKey && provider.keyMasked ? (
                  <span>
                    {i18nService
                      .t('magpieProviderKeyMasked')
                      .replace('{masked}', provider.keyMasked)}
                  </span>
                ) : !isLocalProvider && !apiKey.trim() ? (
                  <span>{i18nService.t('magpieTestNeedKeyHint')}</span>
                ) : (
                  <span />
                )}
              </div>
            </div>
          </div>

          {/* 2. 探测连通并拉取模型按钮与状态反馈 */}
          <div className="flex flex-col gap-2 rounded-lg border border-border/80 bg-muted/20 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleTest}
                  disabled={isSaving || isTesting || !baseUrl.trim()}
                  className="gap-1.5"
                >
                  {isTesting ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : (
                    <Sparkles className="size-4 text-primary" />
                  )}
                  <span>
                    {isTesting
                      ? i18nService.t('magpieTesting')
                      : i18nService.t('magpieTestAndDiscover')}
                  </span>
                </Button>
                {!isLocalProvider && !hasKeyAvailable && (
                  <span className="text-xs text-muted-foreground">
                    {i18nService.t('magpieTestNeedKeyHint')}
                  </span>
                )}
              </div>
            </div>

            {testResult && (
              <div
                className={`flex items-start gap-2 rounded-md p-2.5 text-xs ${
                  testResult.ok
                    ? 'border border-border bg-background text-foreground'
                    : 'border border-destructive/40 bg-destructive/10 text-destructive'
                }`}
              >
                {testResult.ok ? (
                  <>
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-foreground" />
                    <div className="flex flex-col gap-0.5">
                      <div className="flex flex-wrap items-center gap-1.5 font-medium">
                        <span>{i18nService.t('magpieTestSuccess')}</span>
                        {testResult.latencyMs !== undefined && (
                          <span className="text-muted-foreground">({testResult.latencyMs}ms)</span>
                        )}
                        {testResult.modelCount !== undefined && (
                          <span>
                            ·{' '}
                            {i18nService
                              .t('magpieTestModelsFound')
                              .replace('{count}', String(testResult.modelCount))}
                          </span>
                        )}
                      </div>
                      {testResult.discoveredModels && testResult.discoveredModels.length > 0 && (
                        <p className="text-muted-foreground">
                          {i18nService
                            .t('magpieTestAutoFilled')
                            .replace('{count}', String(testResult.discoveredModels.length))}
                        </p>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <AlertCircle className="mt-0.5 size-4 shrink-0" />
                    <div className="flex flex-col gap-0.5">
                      <span className="font-medium">{i18nService.t('magpieTestFailed')}</span>
                      <p>
                        {testResult.requiresKey
                          ? i18nService.t('magpieTestRequiresKey')
                          : testResult.error}
                      </p>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* 3. 智能冲突解决操作条（仅当有模型被发现且用户已存在自定义配置时触发） */}
          {pendingDiscoveredModels && pendingDiscoveredModels.length > 0 && (
            <div className="flex flex-col gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3 text-xs">
              <span className="font-medium text-foreground">
                {i18nService
                  .t('magpieModelConflictTitle')
                  .replace('{count}', String(pendingDiscoveredModels.length))}
              </span>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => handleResolveConflict('replace')}
                >
                  {i18nService.t('magpieModelConflictReplace')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => handleResolveConflict('append')}
                >
                  {i18nService.t('magpieModelConflictAppend')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={() => handleResolveConflict('keep')}
                >
                  {i18nService.t('magpieModelConflictKeep')}
                </Button>
              </div>
            </div>
          )}

          {/* 4. 可用模型管理（支持标签胶囊 Chips 与纯文本双向切换） */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">{i18nService.t('magpieProviderModels')}</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 gap-1 px-2 text-xs text-muted-foreground"
                onClick={() => setViewMode(prev => (prev === 'chips' ? 'text' : 'chips'))}
              >
                <ArrowRightLeft className="size-3" />
                <span>
                  {viewMode === 'chips'
                    ? i18nService.t('magpieModelModeText')
                    : i18nService.t('magpieModelModeChips')}
                </span>
              </Button>
            </div>

            {viewMode === 'text' ? (
              <div className="flex flex-col gap-1.5">
                <Input
                  id="provider-models"
                  value={rawText}
                  onChange={e => syncModelsFromText(e.target.value)}
                  placeholder={i18nService.t('magpieProviderModelsHint')}
                  disabled={isSaving}
                />
                <p className="text-xs text-muted-foreground">
                  {i18nService.t('magpieProviderModelsHint')}
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {/* 标签胶囊列表 */}
                <div className="flex min-h-[48px] flex-wrap items-center gap-1.5 rounded-lg border border-border bg-background p-2">
                  {models.length === 0 ? (
                    <span className="text-xs text-muted-foreground">
                      {i18nService.t('magpieProviderModelsHint')}
                    </span>
                  ) : (
                    models.map((modelId, index) => {
                      const isPrimary = index === 0;
                      const isFallback = fallbackModels.includes(modelId);

                      return (
                        <div
                          key={modelId}
                          className={`group flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors ${
                            isPrimary
                              ? 'border-primary/40 bg-primary/10 text-foreground font-medium'
                              : 'border-border bg-muted/30 text-foreground'
                          }`}
                        >
                          <span
                            className="cursor-pointer"
                            title={isPrimary ? i18nService.t('magpieModelSetAsPrimary') : undefined}
                          >
                            {modelId}
                          </span>

                          {isPrimary && (
                            <Badge variant="secondary" className="h-4 px-1 text-[10px] font-normal">
                              ★
                            </Badge>
                          )}

                          {isFallback && (
                            <Badge
                              variant="outline"
                              className="h-4 px-1 text-[10px] font-normal text-muted-foreground"
                            >
                              FB
                            </Badge>
                          )}

                          <div className="ml-1 flex items-center gap-0.5 opacity-60 group-hover:opacity-100">
                            {!isPrimary && (
                              <button
                                type="button"
                                onClick={() => handleSetPrimary(modelId)}
                                title={i18nService.t('magpieModelSetAsPrimary')}
                                className="cursor-pointer rounded p-0.5 hover:bg-muted"
                              >
                                ★
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handleToggleFallback(modelId)}
                              title={i18nService.t('magpieModelSetAsFallback')}
                              className={`cursor-pointer rounded p-0.5 hover:bg-muted ${
                                isFallback ? 'text-primary' : ''
                              }`}
                            >
                              ↻
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRemoveModel(modelId)}
                              title={i18nService.t('magpieModelRemove')}
                              className="cursor-pointer rounded p-0.5 hover:bg-destructive/20 hover:text-destructive"
                            >
                              <X className="size-3" />
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* 快速单项添加模型 */}
                <div className="flex items-center gap-2">
                  <Input
                    value={newModelName}
                    onChange={e => setNewModelName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddModel(newModelName);
                      }
                    }}
                    placeholder={i18nService.t('magpieModelAddPlaceholder')}
                    className="h-8 text-xs"
                    disabled={isSaving}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 shrink-0 gap-1 text-xs"
                    onClick={() => handleAddModel(newModelName)}
                    disabled={isSaving || !newModelName.trim()}
                  >
                    <Plus className="size-3" />
                    <span>{i18nService.t('magpieModelAdd')}</span>
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* 5. 容灾回退模型列表 (P2: 保留独立文本状态，避免逗号和空格被提前吃掉) */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="provider-fallback" className="text-sm">
              {i18nService.t('magpieProviderFallback')}
            </Label>
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
            <p className="text-xs text-muted-foreground">
              {i18nService.t('magpieProviderFallbackHint')}
            </p>
          </div>

          <DialogFooter surface={DialogFooterSurface.Seamless} className="mt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={isSaving}
            >
              {i18nService.t('cancel')}
            </Button>
            <Button type="submit" disabled={isSaving || !name.trim() || !baseUrl.trim()}>
              {isSaving && <LoaderCircle className="size-4 animate-spin" />}
              {i18nService.t('save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
