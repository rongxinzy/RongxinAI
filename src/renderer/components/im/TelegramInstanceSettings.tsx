/**
 * Telegram Instance Settings Component
 * Configuration form for a single Telegram bot instance in multi-instance mode
 */

import { Button } from '@shared/components/ui/button';
import { Input } from '@shared/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shared/components/ui/select';
import { Switch } from '@shared/components/ui/switch';
import { PlatformRegistry } from '@shared/platform';
import { Eye, EyeOff, Signal, Trash2, X, XCircle } from 'lucide-react';
import React, { useState } from 'react';

import { i18nService } from '../../services/i18n';
import type {
  IMConnectivityTestResult,
  TelegramInstanceConfig,
  TelegramInstanceStatus,
  TelegramOpenClawConfig,
} from '../../types/im';

interface TelegramInstanceSettingsProps {
  instance: TelegramInstanceConfig;
  instanceStatus: TelegramInstanceStatus | undefined;
  onConfigChange: (update: Partial<TelegramOpenClawConfig>) => void;
  onSave: (override?: Partial<TelegramOpenClawConfig>) => Promise<void>;
  onRename: (newName: string) => void;
  onDelete: () => void;
  onToggleEnabled: () => void;
  onTestConnectivity: () => void;
  testingPlatform: string | null;
  connectivityResults: Record<string, IMConnectivityTestResult>;
  language: 'zh' | 'en';
}

const TelegramInstanceSettings: React.FC<TelegramInstanceSettingsProps> = ({
  instance,
  instanceStatus,
  onConfigChange,
  onSave,
  onRename,
  onDelete,
  onToggleEnabled,
  onTestConnectivity,
  testingPlatform,
  connectivityResults,
  language,
}) => {
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  const [allowedUserIdInput, setAllowedUserIdInput] = useState('');
  const [groupAllowFromInput, setGroupAllowFromInput] = useState('');
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(instance.instanceName);

  // Sync nameValue when instance changes
  /* eslint-disable react-hooks/exhaustive-deps */
  React.useEffect(() => {
    setNameValue(instance.instanceName);
    setEditingName(false);
  }, [instance.instanceId]);
  /* eslint-enable react-hooks/exhaustive-deps */

  const handleNameBlur = () => {
    setEditingName(false);
    const trimmed = nameValue.trim();
    if (trimmed && trimmed !== instance.instanceName) {
      onRename(trimmed);
    } else {
      setNameValue(instance.instanceName);
    }
  };

  return (
    <div className="space-y-3">
      {/* Instance Header: Name, Status, Enable Toggle, Delete */}
      <div className="flex items-center gap-3 pb-3 border-b border-border-subtle">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-surface border border-border-subtle p-1">
            <img
              src={PlatformRegistry.logo('telegram')}
              alt="Telegram"
              className="w-4 h-4 object-contain rounded"
            />
          </div>
          {editingName ? (
            <Input
              type="text"
              value={nameValue}
              onChange={e => setNameValue(e.target.value)}
              onBlur={handleNameBlur}
              onKeyDown={e => {
                if (e.key === 'Enter') handleNameBlur();
                if (e.key === 'Escape') {
                  setNameValue(instance.instanceName);
                  setEditingName(false);
                }
              }}
              autoFocus
              className="text-sm font-medium px-0 py-0 border-0 border-b border-primary rounded-none bg-transparent"
            />
          ) : (
            <span
              className="text-sm font-medium text-foreground cursor-pointer hover:text-primary transition-colors truncate border-b border-dashed border-gray-400 dark:border-secondary/50 hover:border-primary pb-px"
              onClick={() => setEditingName(true)}
              title={i18nService.t('imTelegramClickToRename')}
            >
              {instance.instanceName}
            </span>
          )}
        </div>

        {/* Status badge */}
        <div
          className={`px-2 py-0.5 rounded-full text-xs font-medium shrink-0 ${
            instanceStatus?.connected
              ? 'bg-green-500/15 text-green-600 dark:text-green-400'
              : 'bg-gray-500/15 text-gray-500 dark:text-gray-400'
          }`}
        >
          {instanceStatus?.connected ? i18nService.t('connected') : i18nService.t('disconnected')}
        </div>

        {/* Enable toggle */}
        <Switch
          checked={instance.enabled}
          onCheckedChange={onToggleEnabled}
          disabled={!instance.enabled && !instance.botToken}
          title={
            instance.enabled
              ? i18nService.t('imTelegramDisableInstance')
              : !instance.botToken
                ? i18nService.t('imInstanceFillCredentials')
                : i18nService.t('imTelegramEnableInstance')
          }
        />

        {/* Delete button */}
        <Button
          type="button"
          variant="destructive"
          size="sm"
          onClick={onDelete}
          title={i18nService.t('imTelegramDeleteInstance')}
        >
          <Trash2 className="h-4 w-4" />
          {language === 'zh' ? '删除' : 'Delete'}
        </Button>
      </div>

      {/* Guide */}
      <div className="mb-3 p-3 rounded-lg border border-dashed border-border-subtle">
        <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
          <li>{i18nService.t('imTelegramGuideStep1')}</li>
          <li>{i18nService.t('imTelegramGuideStep2')}</li>
          <li>{i18nService.t('imTelegramGuideStep3')}</li>
        </ol>
        {PlatformRegistry.guideUrl('telegram') && (
          <Button
            type="button"
            variant="link"
            size="sm"
            onClick={() => {
              window.electron.shell
                .openExternal(PlatformRegistry.guideUrl('telegram')!)
                .catch((err: unknown) => {
                  console.error('[IM] Failed to open guide URL:', err);
                });
            }}
            className="mt-2 h-auto p-0 text-xs font-medium underline underline-offset-2"
          >
            {i18nService.t('imViewGuide')}
          </Button>
        )}
      </div>

      {/* Bot Token */}
      <div className="space-y-1.5">
        <label className="block text-xs font-medium text-muted-foreground">Bot Token</label>
        <div className="relative">
          <Input
            type={showSecrets['botToken'] ? 'text' : 'password'}
            value={instance.botToken}
            onChange={e => onConfigChange({ botToken: e.target.value })}
            onBlur={() => void onSave()}
            className="pr-16"
            placeholder="••••••••••••"
          />
          <div className="absolute right-2 inset-y-0 flex items-center gap-1">
            {instance.botToken && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => {
                  onConfigChange({ botToken: '' });
                  void onSave({ botToken: '' });
                }}
                title={i18nService.t('clear') || 'Clear'}
              >
                <XCircle className="h-4 w-4" />
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => setShowSecrets(prev => ({ ...prev, botToken: !prev['botToken'] }))}
              title={
                showSecrets['botToken']
                  ? i18nService.t('hide') || 'Hide'
                  : i18nService.t('show') || 'Show'
              }
            >
              {showSecrets['botToken'] ? (
                <Eye className="h-4 w-4" />
              ) : (
                <EyeOff className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">{i18nService.t('imTelegramTokenHint')}</p>
      </div>

      {/* Advanced Settings (collapsible) */}
      <details className="group">
        <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-primary transition-colors">
          {i18nService.t('imAdvancedSettings')}
        </summary>
        <div className="mt-2 space-y-3 pl-2 border-l-2 border-border-subtle">
          {/* DM Policy */}
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-muted-foreground">DM Policy</label>
            <Select
              value={instance.dmPolicy}
              onValueChange={value => {
                const update = { dmPolicy: value as TelegramOpenClawConfig['dmPolicy'] };
                onConfigChange(update);
                void onSave(update);
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="open">{i18nService.t('imDmPolicyOpen')}</SelectItem>
                <SelectItem value="pairing">{i18nService.t('imDmPolicyPairing')}</SelectItem>
                <SelectItem value="allowlist">{i18nService.t('imDmPolicyAllowlist')}</SelectItem>
                <SelectItem value="disabled">{i18nService.t('imDmPolicyDisabled')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Allow From */}
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-muted-foreground">
              Allow From (User IDs)
            </label>
            <div className="flex gap-2">
              <Input
                type="text"
                value={allowedUserIdInput}
                onChange={e => setAllowedUserIdInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    const id = allowedUserIdInput.trim();
                    if (id && !instance.allowFrom.includes(id)) {
                      const newIds = [...instance.allowFrom, id];
                      onConfigChange({ allowFrom: newIds });
                      setAllowedUserIdInput('');
                      void onSave({ allowFrom: newIds });
                    }
                  }
                }}
                className="flex-1"
                placeholder={i18nService.t('imTelegramUserIdPlaceholder')}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  const id = allowedUserIdInput.trim();
                  if (id && !instance.allowFrom.includes(id)) {
                    const newIds = [...instance.allowFrom, id];
                    onConfigChange({ allowFrom: newIds });
                    setAllowedUserIdInput('');
                    void onSave({ allowFrom: newIds });
                  }
                }}
              >
                {i18nService.t('add') || '添加'}
              </Button>
            </div>
            {instance.allowFrom.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {instance.allowFrom.map(id => (
                  <span
                    key={id}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs bg-surface border-border-subtle border text-foreground"
                  >
                    {id}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5 text-muted-foreground hover:text-red-500 dark:hover:text-red-400"
                      onClick={() => {
                        const newIds = instance.allowFrom.filter(uid => uid !== id);
                        onConfigChange({ allowFrom: newIds });
                        void onSave({ allowFrom: newIds });
                      }}
                    >
                      <X className="w-3 h-3" />
                    </Button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Group Policy */}
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-muted-foreground">Group Policy</label>
            <Select
              value={instance.groupPolicy}
              onValueChange={value => {
                const update = { groupPolicy: value as TelegramOpenClawConfig['groupPolicy'] };
                onConfigChange(update);
                void onSave(update);
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="allowlist">Allowlist</SelectItem>
                <SelectItem value="disabled">Disabled</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Group Allow From */}
          {instance.groupPolicy === 'allowlist' && (
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-muted-foreground">
                Group Allow From (Group IDs)
              </label>
              <div className="flex gap-2">
                <Input
                  type="text"
                  value={groupAllowFromInput}
                  onChange={e => setGroupAllowFromInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      const id = groupAllowFromInput.trim();
                      if (id && !instance.groupAllowFrom.includes(id)) {
                        const newIds = [...instance.groupAllowFrom, id];
                        onConfigChange({ groupAllowFrom: newIds });
                        setGroupAllowFromInput('');
                        void onSave({ groupAllowFrom: newIds });
                      }
                    }
                  }}
                  className="flex-1"
                  placeholder={
                    language === 'zh' ? '输入 Telegram Group ID' : 'Enter Telegram Group ID'
                  }
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const id = groupAllowFromInput.trim();
                    if (id && !instance.groupAllowFrom.includes(id)) {
                      const newIds = [...instance.groupAllowFrom, id];
                      onConfigChange({ groupAllowFrom: newIds });
                      setGroupAllowFromInput('');
                      void onSave({ groupAllowFrom: newIds });
                    }
                  }}
                >
                  {i18nService.t('add') || '添加'}
                </Button>
              </div>
              {instance.groupAllowFrom.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {instance.groupAllowFrom.map(id => (
                    <span
                      key={id}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs bg-surface border-border-subtle border text-foreground"
                    >
                      {id}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 text-muted-foreground hover:text-red-500 dark:hover:text-red-400"
                        onClick={() => {
                          const newIds = instance.groupAllowFrom.filter(gid => gid !== id);
                          onConfigChange({ groupAllowFrom: newIds });
                          void onSave({ groupAllowFrom: newIds });
                        }}
                      >
                        <X className="w-3 h-3" />
                      </Button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Streaming */}
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-muted-foreground">Streaming</label>
            <Select
              value={instance.streaming}
              onValueChange={value => {
                const update = { streaming: value as TelegramOpenClawConfig['streaming'] };
                onConfigChange(update);
                void onSave(update);
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="off">Off</SelectItem>
                <SelectItem value="partial">Partial</SelectItem>
                <SelectItem value="block">Block</SelectItem>
                <SelectItem value="progress">Progress</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Proxy */}
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-muted-foreground">Proxy</label>
            <Input
              type="text"
              value={instance.proxy}
              onChange={e => onConfigChange({ proxy: e.target.value })}
              onBlur={() => void onSave()}
              placeholder="socks5://host:port"
            />
          </div>

          {/* Reply-to Mode */}
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-muted-foreground">Reply-to Mode</label>
            <Select
              value={instance.replyToMode}
              onValueChange={value => {
                const update = { replyToMode: value as TelegramOpenClawConfig['replyToMode'] };
                onConfigChange(update);
                void onSave(update);
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="off">Off</SelectItem>
                <SelectItem value="first">First</SelectItem>
                <SelectItem value="all">All</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* History Limit */}
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-muted-foreground">History Limit</label>
            <Input
              type="number"
              value={instance.historyLimit}
              onChange={e => onConfigChange({ historyLimit: parseInt(e.target.value) || 50 })}
              onBlur={() => void onSave()}
              min={1}
              max={200}
            />
          </div>

          {/* Media Max MB */}
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-muted-foreground">Media Max MB</label>
            <Input
              type="number"
              value={instance.mediaMaxMb}
              onChange={e => onConfigChange({ mediaMaxMb: parseInt(e.target.value) || 100 })}
              onBlur={() => void onSave()}
              min={1}
              max={500}
            />
          </div>

          {/* Link Preview */}
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-muted-foreground">Link Preview</label>
            <Switch
              checked={instance.linkPreview}
              onCheckedChange={checked => {
                const update = { linkPreview: Boolean(checked) };
                onConfigChange(update);
                void onSave(update);
              }}
            />
          </div>

          {/* Webhook URL */}
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-muted-foreground">Webhook URL</label>
            <Input
              type="text"
              value={instance.webhookUrl}
              onChange={e => onConfigChange({ webhookUrl: e.target.value })}
              onBlur={() => void onSave()}
              placeholder="https://..."
            />
          </div>

          {/* Webhook Secret (shown only when webhookUrl is non-empty) */}
          {instance.webhookUrl && (
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-muted-foreground">
                Webhook Secret
              </label>
              <div className="relative">
                <Input
                  type={showSecrets['webhookSecret'] ? 'text' : 'password'}
                  value={instance.webhookSecret}
                  onChange={e => onConfigChange({ webhookSecret: e.target.value })}
                  onBlur={() => void onSave()}
                  className="pr-16"
                  placeholder="••••••••••••"
                />
                <div className="absolute right-2 inset-y-0 flex items-center gap-1">
                  {instance.webhookSecret && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => {
                        onConfigChange({ webhookSecret: '' });
                        void onSave({ webhookSecret: '' });
                      }}
                      title={i18nService.t('clear') || 'Clear'}
                    >
                      <XCircle className="h-4 w-4" />
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() =>
                      setShowSecrets(prev => ({ ...prev, webhookSecret: !prev['webhookSecret'] }))
                    }
                    title={
                      showSecrets['webhookSecret']
                        ? i18nService.t('hide') || 'Hide'
                        : i18nService.t('show') || 'Show'
                    }
                  >
                    {showSecrets['webhookSecret'] ? (
                      <Eye className="h-4 w-4" />
                    ) : (
                      <EyeOff className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Debug */}
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-muted-foreground">Debug</label>
            <Switch
              checked={instance.debug}
              onCheckedChange={checked => {
                const update = { debug: Boolean(checked) };
                onConfigChange(update);
                void onSave(update);
              }}
            />
          </div>
        </div>
      </details>

      {/* Connectivity test button */}
      <div className="pt-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onTestConnectivity}
          disabled={testingPlatform === 'telegram'}
        >
          <Signal className="h-3.5 w-3.5 mr-1.5" />
          {testingPlatform === 'telegram'
            ? i18nService.t('imConnectivityTesting')
            : connectivityResults['telegram' as keyof typeof connectivityResults]
              ? i18nService.t('imConnectivityRetest')
              : i18nService.t('imConnectivityTest')}
        </Button>
      </div>

      {/* Error display */}
      {instanceStatus?.lastError && (
        <div className="text-xs text-red-500 bg-red-500/10 px-3 py-2 rounded-lg">
          {instanceStatus.lastError}
        </div>
      )}
    </div>
  );
};

export default TelegramInstanceSettings;
