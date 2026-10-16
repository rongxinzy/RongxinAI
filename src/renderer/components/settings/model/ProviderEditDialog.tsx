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
import { AlertCircle, CheckCircle2, LoaderCircle } from 'lucide-react';
import React, { useEffect, useState } from 'react';

import type {
  MagpieProviderApi,
  MagpieProviderSummary,
  MagpieSaveProviderInput,
  MagpieTestProviderResult,
} from '../../../../shared/magpie/types';
import { i18nService } from '../../../services/i18n';

interface ProviderEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider?: MagpieProviderSummary | null;
  onSave: (input: MagpieSaveProviderInput) => Promise<boolean>;
  onTest?: (input: MagpieSaveProviderInput) => Promise<MagpieTestProviderResult>;
}

type PresetKey = 'custom' | 'openai' | 'anthropic' | 'deepseek' | 'gemini' | 'ollama';

interface PresetConfig {
  name: string;
  api: MagpieProviderApi;
  baseUrl: string;
  defaultModels: string;
}

const PRESETS: Record<PresetKey, PresetConfig> = {
  custom: {
    name: '',
    api: 'openai-completions',
    baseUrl: '',
    defaultModels: '',
  },
  openai: {
    name: 'OpenAI',
    api: 'openai-completions',
    baseUrl: 'https://api.openai.com/v1',
    defaultModels: 'gpt-4o, gpt-4o-mini, o1, o3-mini',
  },
  anthropic: {
    name: 'Anthropic',
    api: 'anthropic-messages',
    baseUrl: 'https://api.anthropic.com',
    defaultModels: 'claude-3-7-sonnet, claude-3-5-haiku, claude-3-5-sonnet',
  },
  deepseek: {
    name: 'DeepSeek',
    api: 'openai-completions',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModels: 'deepseek-chat, deepseek-reasoner',
  },
  gemini: {
    name: 'Google Gemini',
    api: 'openai-completions',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModels: 'gemini-2.5-flash, gemini-2.5-pro',
  },
  ollama: {
    name: 'Ollama',
    api: 'openai-completions',
    baseUrl: 'http://127.0.0.1:11434/v1',
    defaultModels: 'qwen2.5-coder:7b, llama3.3:latest',
  },
};

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
  const [modelsText, setModelsText] = useState('');
  const [fallbackText, setFallbackText] = useState('');
  const [preset, setPreset] = useState<PresetKey>('custom');
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<MagpieTestProviderResult | null>(null);

  const isEditing = Boolean(provider?.id);

  useEffect(() => {
    if (open) {
      if (provider) {
        setName(provider.name || '');
        setApi(provider.api || 'openai-completions');
        setBaseUrl(provider.baseUrl || '');
        setApiKey('');
        setModelsText(provider.models ? provider.models.join(', ') : '');
        setFallbackText(provider.fallback ? provider.fallback.join(', ') : '');
        setPreset('custom');
      } else {
        setName('');
        setApi('openai-completions');
        setBaseUrl('');
        setApiKey('');
        setModelsText('');
        setFallbackText('');
        setPreset('custom');
      }
      setTestResult(null);
      setIsSaving(false);
      setIsTesting(false);
    }
  }, [open, provider]);

  const handleApplyPreset = (key: PresetKey) => {
    setPreset(key);
    if (key === 'custom') return;
    const config = PRESETS[key];
    if (config) {
      if (!name || name === PRESETS[preset]?.name) setName(config.name);
      setApi(config.api);
      setBaseUrl(config.baseUrl);
      if (!modelsText || modelsText === PRESETS[preset]?.defaultModels) {
        setModelsText(config.defaultModels);
      }
    }
  };

  const getPayload = (): MagpieSaveProviderInput => {
    const models = modelsText
      .split(',')
      .map(m => m.trim())
      .filter(Boolean);
    const fallback = fallbackText
      .split(',')
      .map(f => f.trim())
      .filter(Boolean);
    return {
      ...(provider?.id ? { id: provider.id } : {}),
      name: name.trim() || 'Custom Provider',
      api,
      baseUrl: baseUrl.trim(),
      ...(apiKey.trim() ? { key: apiKey.trim() } : {}),
      models,
      fallback,
    };
  };

  const handleTest = async () => {
    if (!onTest || !baseUrl.trim()) return;
    setIsTesting(true);
    setTestResult(null);
    try {
      const result = await onTest(getPayload());
      setTestResult(result);
    } catch (err: unknown) {
      setTestResult({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setIsTesting(false);
    }
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
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? i18nService.t('magpieEditProvider') : i18nService.t('magpieAddProvider')}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSave} className="flex flex-col gap-4 py-2">
          {!isEditing && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="provider-preset" className="text-sm">
                {i18nService.t('magpieProviderPreset')}
              </Label>
              <Select value={preset} onValueChange={val => handleApplyPreset(val as PresetKey)}>
                <SelectTrigger id="provider-preset" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="custom">{i18nService.t('magpiePresetCustom')}</SelectItem>
                  <SelectItem value="openai">OpenAI (Official)</SelectItem>
                  <SelectItem value="anthropic">
                    {i18nService.t('magpiePresetAnthropic')}
                  </SelectItem>
                  <SelectItem value="deepseek">{i18nService.t('magpiePresetDeepSeek')}</SelectItem>
                  <SelectItem value="gemini">{i18nService.t('magpiePresetGemini')}</SelectItem>
                  <SelectItem value="ollama">{i18nService.t('magpiePresetOllama')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="provider-name" className="text-sm">
              {i18nService.t('magpieProviderName')}
            </Label>
            <Input
              id="provider-name"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. OpenAI Production"
              required
              disabled={isSaving}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="provider-api" className="text-sm">
              {i18nService.t('magpieProviderApi')}
            </Label>
            <Select value={api} onValueChange={val => setApi(val as MagpieProviderApi)}>
              <SelectTrigger id="provider-api" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="openai-completions">
                  OpenAI Chat Completions (/v1/chat/completions)
                </SelectItem>
                <SelectItem value="anthropic-messages">
                  Anthropic Messages (/v1/messages)
                </SelectItem>
                <SelectItem value="openai-responses">OpenAI Responses (/v1/responses)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="provider-url" className="text-sm">
              {i18nService.t('magpieProviderBaseUrl')}
            </Label>
            <Input
              id="provider-url"
              type="url"
              value={baseUrl}
              onChange={e => setBaseUrl(e.target.value)}
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
              onChange={e => setApiKey(e.target.value)}
              placeholder={
                isEditing
                  ? i18nService.t('magpieProviderKeyKeepExisting')
                  : i18nService.t('magpieProviderKeyPlaceholder')
              }
              disabled={isSaving}
            />
            {isEditing && provider?.hasKey && (
              <p className="text-xs text-muted-foreground">
                {provider.keyMasked ? `Key: ${provider.keyMasked}` : ''}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="provider-models" className="text-sm">
              {i18nService.t('magpieProviderModels')}
            </Label>
            <Input
              id="provider-models"
              value={modelsText}
              onChange={e => setModelsText(e.target.value)}
              placeholder={i18nService.t('magpieProviderModelsHint')}
              disabled={isSaving}
            />
            <p className="text-xs text-muted-foreground">
              {i18nService.t('magpieProviderModelsHint')}
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="provider-fallback" className="text-sm">
              {i18nService.t('magpieProviderFallback')}
            </Label>
            <Input
              id="provider-fallback"
              value={fallbackText}
              onChange={e => setFallbackText(e.target.value)}
              placeholder="e.g. deepseek-chat, qwen2.5-coder:7b"
              disabled={isSaving}
            />
            <p className="text-xs text-muted-foreground">
              {i18nService.t('magpieProviderFallbackHint')}
            </p>
          </div>

          {testResult && (
            <div
              className={`flex items-center gap-2 rounded-lg border p-3 text-sm ${
                testResult.ok
                  ? 'border-border bg-muted/30 text-foreground'
                  : 'border-destructive/40 bg-destructive/10 text-destructive'
              }`}
            >
              {testResult.ok ? (
                <>
                  <CheckCircle2 className="size-4 shrink-0 text-foreground" />
                  <span>
                    {i18nService.t('magpieTestSuccess')}
                    {testResult.latencyMs !== undefined ? ` (${testResult.latencyMs}ms)` : ''}
                    {testResult.modelCount !== undefined
                      ? ` · ${testResult.modelCount} models found`
                      : ''}
                  </span>
                </>
              ) : (
                <>
                  <AlertCircle className="size-4 shrink-0" />
                  <span>
                    {i18nService.t('magpieTestFailed')}
                    {testResult.error ? `: ${testResult.error}` : ''}
                  </span>
                </>
              )}
            </div>
          )}

          <DialogFooter surface={DialogFooterSurface.Seamless} className="mt-2">
            {onTest && (
              <Button
                type="button"
                variant="outline"
                className="mr-auto"
                onClick={handleTest}
                disabled={isSaving || isTesting || !baseUrl.trim()}
              >
                {isTesting && <LoaderCircle className="size-4 animate-spin" />}
                {isTesting ? i18nService.t('magpieTesting') : i18nService.t('magpieTestConnection')}
              </Button>
            )}
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
