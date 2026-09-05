/**
 * Telegram Instance Settings Component
 * Configuration form for a single Telegram bot instance in multi-instance mode
 */

import { Button } from '@shared/components/ui/button';
import { Input } from '@shared/components/ui/input';
import { Switch } from '@shared/components/ui/switch';
import { PlatformRegistry } from '@shared/platform';
import { Signal, Trash2, X } from 'lucide-react';
import React, { useState } from 'react';

import { i18nService } from '../../services/i18n';
import type {
  IMConnectivityTestResult,
  TelegramInstanceConfig,
  TelegramInstanceStatus,
  TelegramChannelConfig,
} from '../../types/im';
import {
  IMConnectionBadge,
  IMField,
  IMInputField,
  IMSelectField,
  IMStatusAlert,
  IMSwitchField,
} from './IMFormControls';

interface TelegramInstanceSettingsProps {
  instance: TelegramInstanceConfig;
  instanceStatus: TelegramInstanceStatus | undefined;
  onConfigChange: (update: Partial<TelegramChannelConfig>) => void;
  onSave: (override?: Partial<TelegramChannelConfig>) => Promise<void>;
  onRename: (newName: string) => void;
  onDelete: () => void;
  onToggleEnabled: () => void;
  onTestConnectivity: () => void;
  testingPlatform: string | null;
  connectivityResults: Record<string, IMConnectivityTestResult>;
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
    <div className="flex flex-col gap-3">
      {/* Instance Header: Name, Status, Enable Toggle, Delete */}
      <div className="flex items-center gap-3 pb-3 border-b border-border-subtle">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="flex size-7 items-center justify-center rounded-md bg-surface border border-border-subtle p-1">
            <img
              src={PlatformRegistry.logo('telegram')}
              alt="Telegram"
              className="size-4 object-contain rounded"
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
              className="theme-control-inline-edit"
            />
          ) : (
            <Button
              type="button"
              variant="ghost"
              className="theme-control-sizing-4 theme-control-content-height min-w-0 justify-start truncate"
              onClick={() => setEditingName(true)}
              title={i18nService.t('imTelegramClickToRename')}
            >
              {instance.instanceName}
            </Button>
          )}
        </div>

        {/* Status badge */}
        <IMConnectionBadge
          connected={Boolean(instanceStatus?.connected)}
          connectedLabel={i18nService.t('connected')}
          disconnectedLabel={i18nService.t('disconnected')}
        />

        {/* Enable toggle */}
        <Switch
          aria-label={i18nService.t('enabled')}
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
          <Trash2 data-icon="inline-start" />
          {i18nService.t('delete')}
        </Button>
      </div>

      {/* Guide */}
      <div className="mb-3 p-3 rounded-lg border border-dashed border-border-subtle">
        <ol className="text-xs text-muted-foreground flex flex-col gap-1 list-decimal list-inside">
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
            className="theme-action-inline-underlined mt-2"
          >
            {i18nService.t('imViewGuide')}
          </Button>
        )}
      </div>

      {/* Bot Token */}
      <IMInputField
        id={`telegram-${instance.instanceId}-bot-token`}
        label="Bot Token"
        type={showSecrets['botToken'] ? 'text' : 'password'}
        value={instance.botToken}
        onChange={e => onConfigChange({ botToken: e.target.value })}
        onBlur={() => void onSave()}
        placeholder="••••••••••••"
        description={i18nService.t('imTelegramTokenHint')}
        clearLabel={i18nService.t('clear')}
        onClear={() => {
          onConfigChange({ botToken: '' });
          void onSave({ botToken: '' });
        }}
        revealLabel={i18nService.t('imShowSecret')}
        concealLabel={i18nService.t('imHideSecret')}
        revealed={showSecrets['botToken']}
        onRevealChange={revealed => setShowSecrets(prev => ({ ...prev, botToken: revealed }))}
      />

      {/* Advanced Settings (collapsible) */}
      <details className="group">
        <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-primary transition-colors">
          {i18nService.t('imAdvancedSettings')}
        </summary>
        <div className="mt-2 flex flex-col gap-3 pl-2 border-l-2 border-border-subtle">
          {/* DM Policy */}
          <IMSelectField
            id={`telegram-${instance.instanceId}-dm-policy`}
            label={i18nService.t('imDmPolicy')}
            value={instance.dmPolicy}
            options={[
              { value: 'open', label: i18nService.t('imDmPolicyOpen') },
              { value: 'pairing', label: i18nService.t('imDmPolicyPairing') },
              { value: 'allowlist', label: i18nService.t('imDmPolicyAllowlist') },
              { value: 'disabled', label: i18nService.t('imDmPolicyDisabled') },
            ]}
            onValueChange={value => {
              const update = { dmPolicy: value as TelegramChannelConfig['dmPolicy'] };
              onConfigChange(update);
              void onSave(update);
            }}
          />

          {/* Allow From */}
          <IMField
            id={`telegram-${instance.instanceId}-allow-user`}
            label={i18nService.t('imAllowFromUserIds')}
          >
            <div className="flex gap-2">
              <Input
                id={`telegram-${instance.instanceId}-allow-user`}
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
                {i18nService.t('add')}
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
                      size="icon-xs"
                      aria-label={i18nService.t('delete')}
                      onClick={() => {
                        const newIds = instance.allowFrom.filter(uid => uid !== id);
                        onConfigChange({ allowFrom: newIds });
                        void onSave({ allowFrom: newIds });
                      }}
                    >
                      <X data-icon="inline-start" />
                    </Button>
                  </span>
                ))}
              </div>
            )}
          </IMField>

          {/* Group Policy */}
          <IMSelectField
            id={`telegram-${instance.instanceId}-group-policy`}
            label={i18nService.t('imGroupPolicy')}
            value={instance.groupPolicy}
            options={[
              { value: 'open', label: i18nService.t('imGroupPolicyOpen') },
              { value: 'allowlist', label: i18nService.t('imGroupPolicyAllowlist') },
              { value: 'disabled', label: i18nService.t('imGroupPolicyDisabled') },
            ]}
            onValueChange={value => {
              const update = { groupPolicy: value as TelegramChannelConfig['groupPolicy'] };
              onConfigChange(update);
              void onSave(update);
            }}
          />

          {/* Group Allow From */}
          {instance.groupPolicy === 'allowlist' && (
            <IMField
              id={`telegram-${instance.instanceId}-allow-group`}
              label={i18nService.t('imGroupAllowFromGroupIds')}
            >
              <div className="flex gap-2">
                <Input
                  id={`telegram-${instance.instanceId}-allow-group`}
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
                  placeholder={i18nService.t('imTelegramGroupIdPlaceholder')}
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
                  {i18nService.t('add')}
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
                        size="icon-xs"
                        aria-label={i18nService.t('delete')}
                        onClick={() => {
                          const newIds = instance.groupAllowFrom.filter(gid => gid !== id);
                          onConfigChange({ groupAllowFrom: newIds });
                          void onSave({ groupAllowFrom: newIds });
                        }}
                      >
                        <X data-icon="inline-start" />
                      </Button>
                    </span>
                  ))}
                </div>
              )}
            </IMField>
          )}

          {/* Streaming */}
          <IMSelectField
            id={`telegram-${instance.instanceId}-streaming`}
            label={i18nService.t('imStreaming')}
            value={instance.streaming}
            options={[
              { value: 'off', label: i18nService.t('imStreamingOff') },
              { value: 'partial', label: i18nService.t('imStreamingPartial') },
              { value: 'block', label: i18nService.t('imStreamingBlock') },
              { value: 'progress', label: i18nService.t('imStreamingProgress') },
            ]}
            onValueChange={value => {
              const update = { streaming: value as TelegramChannelConfig['streaming'] };
              onConfigChange(update);
              void onSave(update);
            }}
          />

          {/* Proxy */}
          <IMInputField
            id={`telegram-${instance.instanceId}-proxy`}
            label={i18nService.t('imProxy')}
            type="text"
            value={instance.proxy}
            onChange={e => onConfigChange({ proxy: e.target.value })}
            onBlur={() => void onSave()}
            placeholder="socks5://host:port"
          />

          {/* Reply-to Mode */}
          <IMSelectField
            id={`telegram-${instance.instanceId}-reply-to-mode`}
            label={i18nService.t('imReplyToMode')}
            value={instance.replyToMode}
            options={[
              { value: 'off', label: i18nService.t('imReplyToModeOff') },
              { value: 'first', label: i18nService.t('imReplyToModeFirst') },
              { value: 'all', label: i18nService.t('imReplyToModeAll') },
            ]}
            onValueChange={value => {
              const update = { replyToMode: value as TelegramChannelConfig['replyToMode'] };
              onConfigChange(update);
              void onSave(update);
            }}
          />

          {/* History Limit */}
          <IMInputField
            id={`telegram-${instance.instanceId}-history-limit`}
            label={i18nService.t('imHistoryLimit')}
            type="number"
            value={instance.historyLimit}
            onChange={e => onConfigChange({ historyLimit: parseInt(e.target.value) || 50 })}
            onBlur={() => void onSave()}
            min={1}
            max={200}
          />

          {/* Media Max MB */}
          <IMInputField
            id={`telegram-${instance.instanceId}-media-max-mb`}
            label={i18nService.t('imMediaMaxMb')}
            type="number"
            value={instance.mediaMaxMb}
            onChange={e => onConfigChange({ mediaMaxMb: parseInt(e.target.value) || 100 })}
            onBlur={() => void onSave()}
            min={1}
            max={500}
          />

          {/* Link Preview */}
          <IMSwitchField
            id={`telegram-${instance.instanceId}-link-preview`}
            label={i18nService.t('imLinkPreview')}
            checked={instance.linkPreview}
            onCheckedChange={checked => {
              const update = { linkPreview: Boolean(checked) };
              onConfigChange(update);
              void onSave(update);
            }}
          />

          {/* Webhook URL */}
          <IMInputField
            id={`telegram-${instance.instanceId}-webhook-url`}
            label={i18nService.t('imWebhookUrl')}
            type="text"
            value={instance.webhookUrl}
            onChange={e => onConfigChange({ webhookUrl: e.target.value })}
            onBlur={() => void onSave()}
            placeholder="https://..."
          />

          {/* Webhook Secret (shown only when webhookUrl is non-empty) */}
          {instance.webhookUrl && (
            <IMInputField
              id={`telegram-${instance.instanceId}-webhook-secret`}
              label={i18nService.t('imWebhookSecret')}
              type={showSecrets['webhookSecret'] ? 'text' : 'password'}
              value={instance.webhookSecret}
              onChange={e => onConfigChange({ webhookSecret: e.target.value })}
              onBlur={() => void onSave()}
              placeholder="••••••••••••"
              clearLabel={i18nService.t('clear')}
              onClear={() => {
                onConfigChange({ webhookSecret: '' });
                void onSave({ webhookSecret: '' });
              }}
              revealLabel={i18nService.t('imShowSecret')}
              concealLabel={i18nService.t('imHideSecret')}
              revealed={showSecrets['webhookSecret']}
              onRevealChange={revealed =>
                setShowSecrets(prev => ({ ...prev, webhookSecret: revealed }))
              }
            />
          )}

          {/* Debug */}
          <IMSwitchField
            id={`telegram-${instance.instanceId}-debug`}
            label={i18nService.t('imDebugMode')}
            checked={instance.debug}
            onCheckedChange={checked => {
              const update = { debug: Boolean(checked) };
              onConfigChange(update);
              void onSave(update);
            }}
          />
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
          <Signal data-icon="inline-start" />
          {testingPlatform === 'telegram'
            ? i18nService.t('imConnectivityTesting')
            : connectivityResults['telegram' as keyof typeof connectivityResults]
              ? i18nService.t('imConnectivityRetest')
              : i18nService.t('imConnectivityTest')}
        </Button>
      </div>

      {/* Error display */}
      {instanceStatus?.lastError && <IMStatusAlert error>{instanceStatus.lastError}</IMStatusAlert>}
    </div>
  );
};

export default TelegramInstanceSettings;
