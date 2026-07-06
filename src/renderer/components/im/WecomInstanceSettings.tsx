/**
 * WeCom Instance Settings Component
 * Configuration form for a single WeCom bot instance in multi-instance mode
 */

import { Button } from '@shared/components/ui/button';
import { Input } from '@shared/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/components/ui/select';
import { Switch } from '@shared/components/ui/switch';
import { PlatformRegistry } from '@shared/platform';
import { CheckCircle, Eye, EyeOff, Signal, Trash2, X,XCircle } from 'lucide-react';
import React, { useState } from 'react';

import { i18nService } from '../../services/i18n';
import type { IMConnectivityTestResult, WecomInstanceConfig, WecomInstanceStatus, WecomOpenClawConfig } from '../../types/im';

interface WecomInstanceSettingsProps {
  instance: WecomInstanceConfig;
  instanceStatus: WecomInstanceStatus | undefined;
  onConfigChange: (update: Partial<WecomOpenClawConfig>) => void;
  onSave: (override?: Partial<WecomOpenClawConfig>) => Promise<void>;
  onRename: (newName: string) => void;
  onDelete: () => void;
  onToggleEnabled: () => void;
  onTestConnectivity: () => void;
  onQuickSetup: () => void;
  quickSetupStatus: 'idle' | 'pending' | 'success' | 'error';
  quickSetupError: string;
  testingPlatform: string | null;
  connectivityResults: Record<string, IMConnectivityTestResult>;
  language: 'zh' | 'en';
  renderPairingSection: (platform: string) => React.ReactNode;
}

const WecomInstanceSettings: React.FC<WecomInstanceSettingsProps> = ({
  instance,
  instanceStatus,
  onConfigChange,
  onSave,
  onRename,
  onDelete,
  onToggleEnabled,
  onTestConnectivity,
  onQuickSetup,
  quickSetupStatus,
  quickSetupError,
  testingPlatform,
  connectivityResults,
  language,
  renderPairingSection,
}) => {
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  const [allowedUserIdInput, setAllowedUserIdInput] = useState('');
  const [groupAllowInput, setGroupAllowInput] = useState('');
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
              src={PlatformRegistry.logo('wecom')}
              alt="WeCom"
              className="w-4 h-4 object-contain rounded"
            />
          </div>
          {editingName ? (
            <Input
              type="text"
              value={nameValue}
              onChange={(e) => setNameValue(e.target.value)}
              onBlur={handleNameBlur}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleNameBlur();
                if (e.key === 'Escape') { setNameValue(instance.instanceName); setEditingName(false); }
              }}
              autoFocus
              className="text-sm font-medium px-0 py-0 border-0 border-b border-primary rounded-none bg-transparent focus-visible:ring-0"
            />
          ) : (
            <span
              className="text-sm font-medium text-foreground cursor-pointer hover:text-primary transition-colors truncate border-b border-dashed border-gray-400 dark:border-secondary/50 hover:border-primary pb-px"
              onClick={() => setEditingName(true)}
              title={language === 'zh' ? '点击重命名' : 'Click to rename'}
            >
              {instance.instanceName}
            </span>
          )}
        </div>

        {/* Status badge */}
        <div className={`px-2 py-0.5 rounded-full text-xs font-medium flex-shrink-0 ${
          instanceStatus?.connected
            ? 'bg-green-500/15 text-green-600 dark:text-green-400'
            : 'bg-gray-500/15 text-gray-500 dark:text-gray-400'
        }`}>
          {instanceStatus?.connected
            ? i18nService.t('connected')
            : i18nService.t('disconnected')}
        </div>

        {/* Enable toggle */}
        <Switch
          checked={instance.enabled}
          onCheckedChange={onToggleEnabled}
          disabled={!instance.enabled && !(instance.botId && instance.secret)}
          title={instance.enabled ? (language === 'zh' ? '禁用' : 'Disable') : (!(instance.botId && instance.secret) ? i18nService.t('imInstanceFillCredentials') : (language === 'zh' ? '启用' : 'Enable'))}
        />

        {/* Delete button */}
        <Button
          type="button"
          variant="destructive"
          size="sm"
          onClick={onDelete}
          title={language === 'zh' ? '删除实例' : 'Delete instance'}
        >
          <Trash2 className="h-4 w-4" />
          {language === 'zh' ? '删除' : 'Delete'}
        </Button>
      </div>

      {/* Quick Setup via QR Code */}
      <div className="rounded-lg border border-dashed border-border-subtle p-4 text-center space-y-2">
        <Button
          type="button"
          disabled={quickSetupStatus === 'pending'}
          onClick={onQuickSetup}
        >
          {quickSetupStatus === 'pending'
            ? i18nService.t('imWecomQuickSetupPending')
            : i18nService.t('imWecomScanBtn')}
        </Button>
        <p className="text-xs text-secondary">
          {i18nService.t('imWecomScanHint')}
        </p>
        {quickSetupStatus === 'success' && (
          <div className="flex items-center justify-center gap-1.5 text-xs text-green-600 dark:text-green-400 bg-green-500/10 px-3 py-2 rounded-lg">
            <CheckCircle className="h-4 w-4 flex-shrink-0" />
            {i18nService.t('imWecomQuickSetupSuccess')}
          </div>
        )}
        {quickSetupStatus === 'error' && (
          <div className="flex items-center justify-center gap-1.5 text-xs text-red-500 bg-red-500/10 px-3 py-2 rounded-lg">
            <XCircle className="h-4 w-4 flex-shrink-0" />
            {i18nService.t('imWecomQuickSetupError')}: {quickSetupError}
          </div>
        )}
      </div>

      {/* Divider with "or manually enter" */}
      <div className="relative flex items-center">
        <div className="flex-1 border-t border-border-subtle" />
        <span className="px-3 text-xs text-secondary whitespace-nowrap">
          {i18nService.t('imWecomOrManual')}
        </span>
        <div className="flex-1 border-t border-border-subtle" />
      </div>

      {/* Guide */}
      <div className="mb-3 p-3 rounded-lg border border-dashed border-border-subtle">
        <ol className="text-xs text-secondary space-y-1 list-decimal list-inside">
          <li>{i18nService.t('imWecomGuideStep1')}</li>
          <li>{i18nService.t('imWecomGuideStep2')}</li>
          <li>{i18nService.t('imWecomGuideStep3')}</li>
        </ol>
        {PlatformRegistry.guideUrl('wecom') && (
          <Button
            type="button"
            variant="link"
            size="sm"
            onClick={() => {
              window.electron.shell.openExternal(PlatformRegistry.guideUrl('wecom')!).catch((err: unknown) => {
                console.error('[IM] Failed to open guide URL:', err);
              });
            }}
            className="mt-2 h-auto p-0 text-xs font-medium underline underline-offset-2"
          >
            {i18nService.t('imViewGuide')}
          </Button>
        )}
      </div>

      {/* Bot ID */}
      <div className="space-y-1.5">
        <label className="block text-xs font-medium text-secondary">
          Bot ID
        </label>
        <div className="relative">
          <Input
            type="text"
            value={instance.botId}
            onChange={(e) => onConfigChange({ botId: e.target.value })}
            onBlur={() => void onSave()}
            className="pr-8"
            placeholder={i18nService.t('imWecomBotIdPlaceholder')}
          />
          {instance.botId && (
            <div className="absolute right-2 inset-y-0 flex items-center">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => { onConfigChange({ botId: '' }); void onSave({ botId: '' }); }}
                title={i18nService.t('clear') || 'Clear'}
              >
                <XCircle className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Secret */}
      <div className="space-y-1.5">
        <label className="block text-xs font-medium text-secondary">
          Secret
        </label>
        <div className="relative">
          <Input
            type={showSecrets['secret'] ? 'text' : 'password'}
            value={instance.secret}
            onChange={(e) => onConfigChange({ secret: e.target.value })}
            onBlur={() => void onSave()}
            className="pr-16"
            placeholder="••••••••••••"
          />
          <div className="absolute right-2 inset-y-0 flex items-center gap-1">
            {instance.secret && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => { onConfigChange({ secret: '' }); void onSave({ secret: '' }); }}
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
              onClick={() => setShowSecrets(prev => ({ ...prev, 'secret': !prev['secret'] }))}
              title={showSecrets['secret'] ? (i18nService.t('hide') || 'Hide') : (i18nService.t('show') || 'Show')}
            >
              {showSecrets['secret'] ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
            </Button>
          </div>
        </div>
        <p className="text-xs text-secondary">
          {i18nService.t('imWecomCredentialHint')}
        </p>
      </div>

      {/* Advanced Settings (collapsible) */}
      <details className="group">
        <summary className="cursor-pointer text-xs font-medium text-secondary hover:text-primary transition-colors">
          {i18nService.t('imAdvancedSettings')}
        </summary>
        <div className="mt-2 space-y-3 pl-2 border-l-2 border-border-subtle">
          {/* DM Policy */}
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-secondary">
              DM Policy
            </label>
            <Select
              value={instance.dmPolicy}
              onValueChange={(value) => {
                const update = { dmPolicy: value as WecomOpenClawConfig['dmPolicy'] };
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

          {/* Pairing Requests (shown when dmPolicy is 'pairing') */}
          {instance.dmPolicy === 'pairing' && renderPairingSection('wecom')}

          {/* Allow From */}
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-secondary">
              Allow From (User IDs)
            </label>
            <div className="flex gap-2">
              <Input
                type="text"
                value={allowedUserIdInput}
                onChange={(e) => setAllowedUserIdInput(e.target.value)}
                onKeyDown={(e) => {
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
                placeholder={i18nService.t('imWecomUserIdPlaceholder')}
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
                {instance.allowFrom.map((id) => (
                  <span
                    key={id}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs bg-surface border-border-subtle border text-foreground"
                  >
                    {id}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5 text-secondary hover:text-red-500 dark:hover:text-red-400"
                      onClick={() => {
                        const newIds = instance.allowFrom.filter((uid) => uid !== id);
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
            <label className="block text-xs font-medium text-secondary">
              Group Policy
            </label>
            <Select
              value={instance.groupPolicy}
              onValueChange={(value) => {
                const update = { groupPolicy: value as WecomOpenClawConfig['groupPolicy'] };
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
              <label className="block text-xs font-medium text-secondary">
                Group Allow From (Group IDs)
              </label>
              <div className="flex gap-2">
                <Input
                  type="text"
                  value={groupAllowInput}
                  onChange={(e) => setGroupAllowInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      const id = groupAllowInput.trim();
                      if (id && !instance.groupAllowFrom.includes(id)) {
                        const newIds = [...instance.groupAllowFrom, id];
                        onConfigChange({ groupAllowFrom: newIds });
                        setGroupAllowInput('');
                        void onSave({ groupAllowFrom: newIds });
                      }
                    }
                  }}
                  className="flex-1"
                  placeholder={language === 'zh' ? '输入群ID' : 'Enter Group ID'}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const id = groupAllowInput.trim();
                    if (id && !instance.groupAllowFrom.includes(id)) {
                      const newIds = [...instance.groupAllowFrom, id];
                      onConfigChange({ groupAllowFrom: newIds });
                      setGroupAllowInput('');
                      void onSave({ groupAllowFrom: newIds });
                    }
                  }}
                >
                  {i18nService.t('add') || '添加'}
                </Button>
              </div>
              {instance.groupAllowFrom.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {instance.groupAllowFrom.map((id) => (
                    <span
                      key={id}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs bg-surface border-border-subtle border text-foreground"
                    >
                      {id}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 text-secondary hover:text-red-500 dark:hover:text-red-400"
                        onClick={() => {
                          const newIds = instance.groupAllowFrom.filter((gid) => gid !== id);
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

          {/* Send Thinking Message */}
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-secondary">
              {i18nService.t('imSendThinkingMessage')}
            </label>
            <Switch
              checked={instance.sendThinkingMessage}
              onCheckedChange={(checked: boolean) => {
                const update = { sendThinkingMessage: checked };
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
          disabled={testingPlatform === 'wecom'}
        >
          <Signal className="h-3.5 w-3.5 mr-1.5" />
          {testingPlatform === 'wecom'
            ? i18nService.t('imConnectivityTesting')
            : connectivityResults['wecom' as keyof typeof connectivityResults]
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

export default WecomInstanceSettings;
