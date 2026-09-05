/**
 * WeCom Instance Settings Component
 * Configuration form for a single WeCom bot instance in multi-instance mode
 */

import { Button } from '@shared/components/ui/button';
import { Input } from '@shared/components/ui/input';
import { Separator } from '@shared/components/ui/separator';
import { Switch } from '@shared/components/ui/switch';
import { PlatformRegistry } from '@shared/platform';
import { Signal, Trash2, X } from 'lucide-react';
import React, { useState } from 'react';

import { i18nService } from '../../services/i18n';
import type {
  IMConnectivityTestResult,
  WecomInstanceConfig,
  WecomInstanceStatus,
  WecomChannelConfig,
} from '../../types/im';
import {
  IMConnectionBadge,
  IMField,
  IMInputField,
  IMSelectField,
  IMStatusAlert,
  IMSwitchField,
} from './IMFormControls';

interface WecomInstanceSettingsProps {
  instance: WecomInstanceConfig;
  instanceStatus: WecomInstanceStatus | undefined;
  onConfigChange: (update: Partial<WecomChannelConfig>) => void;
  onSave: (override?: Partial<WecomChannelConfig>) => Promise<void>;
  onRename: (newName: string) => void;
  onDelete: () => void;
  onToggleEnabled: () => void;
  onTestConnectivity: () => void;
  onQuickSetup: () => void;
  quickSetupStatus: 'idle' | 'pending' | 'success' | 'error';
  quickSetupError: string;
  testingPlatform: string | null;
  connectivityResults: Record<string, IMConnectivityTestResult>;
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
    <div className="flex flex-col gap-3">
      {/* Instance Header: Name, Status, Enable Toggle, Delete */}
      <div className="flex items-center gap-3 pb-3 border-b border-border-subtle">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="flex size-7 items-center justify-center rounded-md bg-surface border border-border-subtle p-1">
            <img
              src={PlatformRegistry.logo('wecom')}
              alt="WeCom"
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
              title={i18nService.t('imClickToRename')}
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
          disabled={!instance.enabled && !(instance.botId && instance.secret)}
          title={
            instance.enabled
              ? i18nService.t('imDisableInstance')
              : !(instance.botId && instance.secret)
                ? i18nService.t('imInstanceFillCredentials')
                : i18nService.t('imEnableInstance')
          }
        />

        {/* Delete button */}
        <Button
          type="button"
          variant="destructive"
          size="sm"
          onClick={onDelete}
          title={i18nService.t('imDeleteInstance')}
        >
          <Trash2 data-icon="inline-start" />
          {i18nService.t('delete')}
        </Button>
      </div>

      {/* Quick Setup via QR Code */}
      <div className="rounded-lg border border-dashed border-border-subtle p-4 text-center flex flex-col gap-2">
        <Button type="button" disabled={quickSetupStatus === 'pending'} onClick={onQuickSetup}>
          {quickSetupStatus === 'pending'
            ? i18nService.t('imWecomQuickSetupPending')
            : i18nService.t('imWecomScanBtn')}
        </Button>
        <p className="text-xs text-muted-foreground">{i18nService.t('imWecomScanHint')}</p>
        {quickSetupStatus === 'success' && (
          <IMStatusAlert>{i18nService.t('imWecomQuickSetupSuccess')}</IMStatusAlert>
        )}
        {quickSetupStatus === 'error' && (
          <IMStatusAlert error>
            {i18nService.t('imWecomQuickSetupError')}: {quickSetupError}
          </IMStatusAlert>
        )}
      </div>

      {/* Divider with "or manually enter" */}
      <div className="flex items-center gap-3">
        <Separator className="flex-1" />
        <span className="whitespace-nowrap text-xs text-muted-foreground">
          {i18nService.t('imWecomOrManual')}
        </span>
        <Separator className="flex-1" />
      </div>

      {/* Guide */}
      <div className="mb-3 p-3 rounded-lg border border-dashed border-border-subtle">
        <ol className="text-xs text-muted-foreground flex flex-col gap-1 list-decimal list-inside">
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
              window.electron.shell
                .openExternal(PlatformRegistry.guideUrl('wecom')!)
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

      {/* Bot ID */}
      <IMInputField
        id={`wecom-${instance.instanceId}-bot-id`}
        label="Bot ID"
        type="text"
        value={instance.botId}
        onChange={e => onConfigChange({ botId: e.target.value })}
        onBlur={() => void onSave()}
        placeholder={i18nService.t('imWecomBotIdPlaceholder')}
        clearLabel={i18nService.t('clear')}
        onClear={() => {
          onConfigChange({ botId: '' });
          void onSave({ botId: '' });
        }}
      />

      {/* Secret */}
      <IMInputField
        id={`wecom-${instance.instanceId}-secret`}
        label="Secret"
        type={showSecrets['secret'] ? 'text' : 'password'}
        value={instance.secret}
        onChange={e => onConfigChange({ secret: e.target.value })}
        onBlur={() => void onSave()}
        placeholder="••••••••••••"
        description={i18nService.t('imWecomCredentialHint')}
        clearLabel={i18nService.t('clear')}
        onClear={() => {
          onConfigChange({ secret: '' });
          void onSave({ secret: '' });
        }}
        revealLabel={i18nService.t('imShowSecret')}
        concealLabel={i18nService.t('imHideSecret')}
        revealed={showSecrets['secret']}
        onRevealChange={revealed => setShowSecrets(prev => ({ ...prev, secret: revealed }))}
      />

      {/* Advanced Settings (collapsible) */}
      <details className="group">
        <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-primary transition-colors">
          {i18nService.t('imAdvancedSettings')}
        </summary>
        <div className="mt-2 flex flex-col gap-3 pl-2 border-l-2 border-border-subtle">
          {/* DM Policy */}
          <IMSelectField
            id={`wecom-${instance.instanceId}-dm-policy`}
            label={i18nService.t('imDmPolicy')}
            value={instance.dmPolicy}
            options={[
              { value: 'open', label: i18nService.t('imDmPolicyOpen') },
              { value: 'pairing', label: i18nService.t('imDmPolicyPairing') },
              { value: 'allowlist', label: i18nService.t('imDmPolicyAllowlist') },
              { value: 'disabled', label: i18nService.t('imDmPolicyDisabled') },
            ]}
            onValueChange={value => {
              const update = { dmPolicy: value as WecomChannelConfig['dmPolicy'] };
              onConfigChange(update);
              void onSave(update);
            }}
          />

          {/* Pairing Requests (shown when dmPolicy is 'pairing') */}

          {/* Allow From */}
          <IMField
            id={`wecom-${instance.instanceId}-allow-user`}
            label={i18nService.t('imAllowFromUserIds')}
          >
            <div className="flex gap-2">
              <Input
                id={`wecom-${instance.instanceId}-allow-user`}
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
            id={`wecom-${instance.instanceId}-group-policy`}
            label={i18nService.t('imGroupPolicy')}
            value={instance.groupPolicy}
            options={[
              { value: 'open', label: i18nService.t('imGroupPolicyOpen') },
              { value: 'allowlist', label: i18nService.t('imGroupPolicyAllowlist') },
              { value: 'disabled', label: i18nService.t('imGroupPolicyDisabled') },
            ]}
            onValueChange={value => {
              const update = { groupPolicy: value as WecomChannelConfig['groupPolicy'] };
              onConfigChange(update);
              void onSave(update);
            }}
          />

          {/* Group Allow From */}
          {instance.groupPolicy === 'allowlist' && (
            <IMField
              id={`wecom-${instance.instanceId}-allow-group`}
              label={i18nService.t('imGroupAllowFromGroupIds')}
            >
              <div className="flex gap-2">
                <Input
                  id={`wecom-${instance.instanceId}-allow-group`}
                  type="text"
                  value={groupAllowInput}
                  onChange={e => setGroupAllowInput(e.target.value)}
                  onKeyDown={e => {
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
                  placeholder={i18nService.t('imGroupIdPlaceholder')}
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

          {/* Send Thinking Message */}
          <IMSwitchField
            id={`wecom-${instance.instanceId}-send-thinking`}
            label={i18nService.t('imSendThinkingMessage')}
            checked={instance.sendThinkingMessage}
            onCheckedChange={checked => {
              const update = { sendThinkingMessage: checked };
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
          disabled={testingPlatform === 'wecom'}
        >
          <Signal data-icon="inline-start" />
          {testingPlatform === 'wecom'
            ? i18nService.t('imConnectivityTesting')
            : connectivityResults['wecom' as keyof typeof connectivityResults]
              ? i18nService.t('imConnectivityRetest')
              : i18nService.t('imConnectivityTest')}
        </Button>
      </div>

      {/* Error display */}
      {instanceStatus?.lastError && <IMStatusAlert error>{instanceStatus.lastError}</IMStatusAlert>}
    </div>
  );
};

export default WecomInstanceSettings;
