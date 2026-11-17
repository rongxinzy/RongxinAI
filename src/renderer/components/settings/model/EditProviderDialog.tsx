import { ProviderAvatar } from '@shared/components/model-picker/ProviderAvatar';
import { Badge } from '@shared/components/ui/badge';
import { Button } from '@shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shared/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@shared/components/ui/dropdown-menu';
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
  CheckCircle2,
  ChevronDown,
  Eye,
  EyeOff,
  Loader2,
  MoreHorizontal,
  Plus,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import type {
  MagpieProviderApi,
  MagpieProviderSummary,
  MagpieSaveProviderInput,
} from '../../../../shared/magpie/types';
import { i18nService } from '../../../services/i18n';
import {
  classifyProviderError,
  type ClassifiedProviderError,
  type ProviderErrorAction,
} from '../../../services/modelSettings/providerErrorClassifier';
import { formatContextTokens, parseContextTokens } from './modelContextValue';
import { ProviderErrorBanner } from './ProviderErrorBanner';

export interface EditProviderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider: MagpieProviderSummary;
  onSave: (input: MagpieSaveProviderInput) => Promise<void>;
  onOpenNetworkSettings?: () => void;
  onOpenUsageSettings?: () => void;
}

export function EditProviderDialog({
  open,
  onOpenChange,
  provider,
  onSave,
  onOpenNetworkSettings,
  onOpenUsageSettings,
}: EditProviderDialogProps) {
  const [name, setName] = useState(provider.name);
  const [api, setApi] = useState<MagpieProviderApi>(provider.api);
  const [baseUrl, setBaseUrl] = useState(provider.baseUrl);
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [models, setModels] = useState<string[]>(provider.models);
  const [fallback, setFallback] = useState<string[]>(provider.fallback ?? []);
  const [newModelInput, setNewModelInput] = useState('');
  const [defaultContextInput, setDefaultContextInput] = useState('');
  const [discoveredModelContexts, setDiscoveredModelContexts] = useState<Record<string, number>>(
    {},
  );
  const [testing, setTesting] = useState(false);
  const [testPassed, setTestPassed] = useState(false);
  const [testError, setTestError] = useState<ClassifiedProviderError | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(provider.name);
    setApi(provider.api);
    setBaseUrl(provider.baseUrl);
    setApiKey('');
    setShowKey(false);
    setModels([...provider.models]);
    setFallback([...(provider.fallback ?? [])]);
    setNewModelInput('');
    setDefaultContextInput(formatContextTokens(provider.contexts?.['*']));
    setDiscoveredModelContexts({});
    setTestPassed(false);
    setTestError(null);
  }, [open, provider]);

  const parsedContext = parseContextTokens(defaultContextInput);

  const runTest = async (overrideBaseUrl?: string) => {
    if (!window.electron?.magpie?.testProvider) return;
    setTesting(true);
    setTestError(null);
    setTestPassed(false);
    try {
      const result = await window.electron.magpie.testProvider({
        id: provider.id,
        name: name.trim() || provider.name,
        api,
        baseUrl: (overrideBaseUrl ?? baseUrl).trim(),
        key: apiKey.trim() || undefined,
        models,
        fallback,
      });
      if (result.ok) {
        setTestPassed(true);
        const discovered = result.discoveredModels ?? [];
        if (result.discoveredModelContexts) {
          setDiscoveredModelContexts(result.discoveredModelContexts);
        }
        if (discovered.length > 0) {
          setModels(prev => Array.from(new Set([...prev, ...discovered])));
        }
      } else {
        setTestError(
          classifyProviderError({
            testResult: result,
            providerName: name || provider.name,
            baseUrl: overrideBaseUrl ?? baseUrl,
          }),
        );
      }
    } catch (error) {
      setTestError(
        classifyProviderError({
          raw: error instanceof Error ? error.message : String(error),
          providerName: name || provider.name,
          baseUrl: overrideBaseUrl ?? baseUrl,
        }),
      );
    } finally {
      setTesting(false);
    }
  };

  const handleErrorAction = (action: ProviderErrorAction, suggestedUrl?: string) => {
    if (action === 'fix_v1' && suggestedUrl) {
      setBaseUrl(suggestedUrl);
      void runTest(suggestedUrl);
    } else if (action === 'open_network' && onOpenNetworkSettings) {
      onOpenChange(false);
      onOpenNetworkSettings();
    } else if (action === 'open_usage' && onOpenUsageSettings) {
      onOpenChange(false);
      onOpenUsageSettings();
    } else if (action === 'retry') {
      void runTest();
    }
  };

  const moveModel = (index: number, delta: -1 | 1) => {
    const nextIdx = index + delta;
    if (nextIdx < 0 || nextIdx >= models.length) return;
    setModels(prev => {
      const copy = [...prev];
      const [item] = copy.splice(index, 1);
      copy.splice(nextIdx, 0, item);
      return copy;
    });
  };

  const addModel = () => {
    const trimmed = newModelInput.trim();
    if (!trimmed) return;
    if (!models.includes(trimmed)) setModels(prev => [...prev, trimmed]);
    setNewModelInput('');
  };

  const handleSave = async () => {
    if (!parsedContext.ok) return;
    setSaving(true);
    try {
      const contexts = { ...(provider.contexts ?? {}) };
      for (const [modelId, detected] of Object.entries(discoveredModelContexts)) {
        if (models.includes(modelId) && contexts[modelId] === undefined) {
          contexts[modelId] = detected;
        }
      }
      if (parsedContext.value) {
        contexts['*'] = parsedContext.value;
      } else {
        delete contexts['*'];
      }
      await onSave({
        id: provider.id,
        name: name.trim() || provider.name,
        api,
        baseUrl: baseUrl.trim(),
        key: apiKey.trim() || undefined,
        models,
        fallback: fallback.filter(f => models.includes(f)),
        contexts: Object.keys(contexts).length > 0 ? contexts : undefined,
      });
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <div className="flex items-center gap-3 pr-6">
            <ProviderAvatar
              name={name || provider.name}
              providerKey={provider.id}
              baseUrl={baseUrl || provider.baseUrl}
              size="md"
            />
            <DialogTitle>{i18nService.t('magpieEditProvider')}</DialogTitle>
          </div>
        </DialogHeader>

        <div className="max-h-[70vh] space-y-5 overflow-y-auto pr-1">
          <div className="space-y-1.5">
            <Label htmlFor="edit-provider-name">{i18nService.t('magpieProviderName')}</Label>
            <Input id="edit-provider-name" value={name} onChange={e => setName(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-provider-key">{i18nService.t('magpieProviderKey')}</Label>
            <div className="flex gap-2">
              <Input
                id="edit-provider-key"
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder={
                  provider.hasKey
                    ? i18nService.t('magpieProviderKeyKeepExisting')
                    : i18nService.t('magpieProviderKeyPlaceholder')
                }
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label={showKey ? 'Hide key' : 'Show key'}
                onClick={() => setShowKey(v => !v)}
              >
                {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={testing}
                onClick={() => void runTest()}
              >
                {testing ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  i18nService.t('modelsProvidersTestAction')
                )}
              </Button>
            </div>
            {provider.keyMasked && (
              <p className="text-xs text-muted-foreground">
                {i18nService.t('magpieProviderKeyMasked').replace('{masked}', provider.keyMasked)}
              </p>
            )}
          </div>

          {testPassed && (
            <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
              <CheckCircle2 className="size-4 shrink-0 text-primary" />
              <span>{i18nService.t('magpieTestSuccess')}</span>
            </div>
          )}

          {testError && <ProviderErrorBanner classified={testError} onAction={handleErrorAction} />}

          <div className="space-y-2.5">
            <Label>{i18nService.t('magpieProviderModels')}</Label>
            <div className="flex gap-2">
              <Input
                value={newModelInput}
                onChange={e => setNewModelInput(e.target.value)}
                placeholder={i18nService.t('magpieModelAddPlaceholder')}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addModel();
                  }
                }}
              />
              <Button
                type="button"
                variant="outline"
                disabled={!newModelInput.trim()}
                onClick={addModel}
              >
                <Plus className="size-4" />
              </Button>
            </div>

            <div className="divide-y divide-border rounded-lg border border-border">
              {models.map((modelId, index) => {
                const isPrimary = index === 0;
                const isBackup = fallback.includes(modelId);
                return (
                  <div
                    key={modelId}
                    className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-mono text-xs">{modelId}</span>
                      {isPrimary && (
                        <Badge variant="secondary">{i18nService.t('providerEditPrimaryTag')}</Badge>
                      )}
                      {isBackup && (
                        <Badge variant="outline">{i18nService.t('providerEditBackupTag')}</Badge>
                      )}
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={i18nService.t('providerEditRowMenuLabel')}
                          />
                        }
                      >
                        <MoreHorizontal className="size-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          disabled={isPrimary}
                          onClick={() => {
                            setModels(prev => [modelId, ...prev.filter(id => id !== modelId)]);
                          }}
                        >
                          {i18nService.t('providerEditSetPrimary')}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => {
                            setFallback(prev =>
                              isBackup ? prev.filter(id => id !== modelId) : [...prev, modelId],
                            );
                          }}
                        >
                          {isBackup
                            ? i18nService.t('providerEditUnsetBackup')
                            : i18nService.t('providerEditSetBackup')}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={index === 0}
                          onClick={() => moveModel(index, -1)}
                        >
                          {i18nService.t('providerEditMoveUp')}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={index === models.length - 1}
                          onClick={() => moveModel(index, 1)}
                        >
                          {i18nService.t('providerEditMoveDown')}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => {
                            setModels(prev => prev.filter(id => id !== modelId));
                            setFallback(prev => prev.filter(id => id !== modelId));
                          }}
                        >
                          {i18nService.t('magpieModelRemove')}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                );
              })}
            </div>
          </div>

          <details className="group rounded-lg border border-border px-3 py-2 text-sm">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 font-medium text-muted-foreground select-none hover:text-foreground">
              <ChevronDown className="size-4 transition-transform group-open:rotate-180" />
              <span>{i18nService.t('providerEditMoreOptions')}</span>
            </summary>
            <div className="mt-3 space-y-3 border-t border-border pt-3">
              <div className="space-y-1.5">
                <Label htmlFor="edit-provider-url">{i18nService.t('magpieProviderBaseUrl')}</Label>
                <Input
                  id="edit-provider-url"
                  value={baseUrl}
                  onChange={e => setBaseUrl(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{i18nService.t('magpieProviderApi')}</Label>
                <Select value={api} onValueChange={v => setApi(v as MagpieProviderApi)}>
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
              <div className="space-y-1.5">
                <Label htmlFor="edit-provider-context">
                  {i18nService.t('magpieProviderContext')}
                </Label>
                <Input
                  id="edit-provider-context"
                  value={defaultContextInput}
                  onChange={e => setDefaultContextInput(e.target.value)}
                  placeholder={i18nService.t('magpieProviderContextPlaceholder')}
                />
                <p className="text-xs text-muted-foreground">
                  {parsedContext.ok
                    ? i18nService.t('magpieProviderContextHint')
                    : i18nService.t('magpieProviderContextInvalid')}
                </p>
              </div>
            </div>
          </details>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {i18nService.t('cancel')}
          </Button>
          <Button
            type="button"
            disabled={saving || !baseUrl.trim() || !parsedContext.ok}
            onClick={() => void handleSave()}
          >
            {i18nService.t('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
