/**
 * QQ Instance Settings Component
 * Configuration form for a single QQ bot instance in multi-instance mode
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
  QQInstanceConfig,
  QQInstanceStatus,
  QQChannelConfig,
} from '../../types/im';
import {
  IMConnectionBadge,
  IMField,
  IMInputField,
  IMSelectField,
  IMStatusAlert,
  IMSwitchField,
} from './IMFormControls';

interface QQInstanceSettingsProps {
  instance: QQInstanceConfig;
  instanceStatus: QQInstanceStatus | undefined;
  onConfigChange: (update: Partial<QQChannelConfig>) => void;
  onSave: (override?: Partial<QQChannelConfig>) => Promise<void>;
  onRename: (newName: string) => void;
  onDelete: () => void;
  onToggleEnabled: () => void;
  onTestConnectivity: () => void;
  testingPlatform: string | null;
  connectivityResults: Record<string, IMConnectivityTestResult>;
}

const QQInstanceSettings: React.FC<QQInstanceSettingsProps> = ({
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
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(instance.instanceName);

  // Sync nameValue when instance changes
  React.useEffect(() => {
    setNameValue(instance.instanceName);
    setEditingName(false);
  }, [instance.instanceId, instance.instanceName]);

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
              src={PlatformRegistry.logo('qq')}
              alt="QQ"
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
              title={i18nService.t('imQQClickToRename')}
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
          disabled={!instance.enabled && !(instance.appId && instance.appSecret)}
          title={
            instance.enabled
              ? i18nService.t('imQQDisableInstance')
              : !(instance.appId && instance.appSecret)
                ? i18nService.t('imInstanceFillCredentials')
                : i18nService.t('imQQEnableInstance')
          }
        />

        {/* Delete button */}
        <Button
          type="button"
          variant="destructive"
          size="sm"
          onClick={onDelete}
          title={i18nService.t('imQQDeleteInstance')}
        >
          <Trash2 data-icon="inline-start" />
          {i18nService.t('delete')}
        </Button>
      </div>

      {/* Guide */}
      <div className="mb-3 p-3 rounded-lg border border-dashed border-border-subtle">
        <ol className="text-xs text-muted-foreground flex flex-col gap-1 list-decimal list-inside">
          <li>{i18nService.t('imQQGuideStep1')}</li>
          <li>{i18nService.t('imQQGuideStep2')}</li>
          <li>{i18nService.t('imQQGuideStep3')}</li>
          <li>{i18nService.t('imQQGuideStep4')}</li>
        </ol>
        {PlatformRegistry.guideUrl('qq') && (
          <Button
            type="button"
            variant="link"
            size="sm"
            onClick={() => {
              window.electron.shell
                .openExternal(PlatformRegistry.guideUrl('qq')!)
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

      {/* AppID */}
      <IMInputField
        id={`qq-${instance.instanceId}-app-id`}
        label={i18nService.t('imAppId')}
        required
        type="text"
        value={instance.appId}
        onChange={e => onConfigChange({ appId: e.target.value })}
        onBlur={() => void onSave()}
        placeholder="102xxxxx"
        clearLabel={i18nService.t('clear')}
        onClear={() => {
          onConfigChange({ appId: '' });
          void onSave({ appId: '' });
        }}
      />

      {/* AppSecret */}
      <IMInputField
        id={`qq-${instance.instanceId}-app-secret`}
        label={i18nService.t('imAppSecret')}
        required
        type={showSecrets['appSecret'] ? 'text' : 'password'}
        value={instance.appSecret}
        onChange={e => onConfigChange({ appSecret: e.target.value })}
        onBlur={() => void onSave()}
        placeholder="••••••••••••"
        description={i18nService.t('imQQCredentialHint')}
        clearLabel={i18nService.t('clear')}
        onClear={() => {
          onConfigChange({ appSecret: '' });
          void onSave({ appSecret: '' });
        }}
        revealLabel={i18nService.t('imShowSecret')}
        concealLabel={i18nService.t('imHideSecret')}
        revealed={showSecrets['appSecret']}
        onRevealChange={revealed => setShowSecrets(prev => ({ ...prev, appSecret: revealed }))}
      />

      {/* Advanced Settings (collapsible) */}
      <details className="group">
        <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-primary transition-colors">
          {i18nService.t('imAdvancedSettings')}
        </summary>
        <div className="mt-2 flex flex-col gap-3 pl-2 border-l-2 border-border-subtle">
          {/* DM Policy */}
          <IMSelectField
            id={`qq-${instance.instanceId}-dm-policy`}
            label={i18nService.t('imDmPolicy')}
            value={instance.dmPolicy}
            options={[
              { value: 'open', label: i18nService.t('imDmPolicyOpen') },
              { value: 'pairing', label: i18nService.t('imDmPolicyPairing') },
              { value: 'allowlist', label: i18nService.t('imDmPolicyAllowlist') },
            ]}
            onValueChange={value => {
              const update = { dmPolicy: value as QQChannelConfig['dmPolicy'] };
              onConfigChange(update);
              void onSave(update);
            }}
          />

          {/* Allow From */}
          <IMField
            id={`qq-${instance.instanceId}-allow-user`}
            label={i18nService.t('imAllowFromUserIds')}
          >
            <div className="flex gap-2">
              <Input
                id={`qq-${instance.instanceId}-allow-user`}
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
                placeholder={i18nService.t('imQQUserIdPlaceholder')}
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
            id={`qq-${instance.instanceId}-group-policy`}
            label={i18nService.t('imGroupPolicy')}
            value={instance.groupPolicy}
            options={[
              { value: 'open', label: i18nService.t('imGroupPolicyOpen') },
              { value: 'allowlist', label: i18nService.t('imGroupPolicyAllowlist') },
              { value: 'disabled', label: i18nService.t('imGroupPolicyDisabled') },
            ]}
            onValueChange={value => {
              const update = { groupPolicy: value as QQChannelConfig['groupPolicy'] };
              onConfigChange(update);
              void onSave(update);
            }}
          />

          {/* Group Allow From */}
          {instance.groupPolicy === 'allowlist' && (
            <IMField label={i18nService.t('imGroupAllowFromGroupIds')}>
              <div className="flex flex-wrap gap-1.5">
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
            </IMField>
          )}

          {/* History Limit */}
          <IMInputField
            id={`qq-${instance.instanceId}-history-limit`}
            label={i18nService.t('imHistoryLimit')}
            type="number"
            value={instance.historyLimit}
            onChange={e => onConfigChange({ historyLimit: parseInt(e.target.value) || 50 })}
            onBlur={() => void onSave()}
            min={1}
            max={200}
          />

          {/* Markdown Support */}
          <IMSwitchField
            id={`qq-${instance.instanceId}-markdown-support`}
            label={i18nService.t('imMarkdownSupport')}
            checked={instance.markdownSupport}
            onCheckedChange={checked => {
              const update = { markdownSupport: Boolean(checked) };
              onConfigChange(update);
              void onSave(update);
            }}
          />

          {/* Image Server Base URL */}
          <IMInputField
            id={`qq-${instance.instanceId}-image-server-url`}
            label={i18nService.t('imImageServerBaseUrl')}
            type="text"
            value={instance.imageServerBaseUrl}
            onChange={e => onConfigChange({ imageServerBaseUrl: e.target.value })}
            onBlur={() => void onSave()}
            placeholder="http://your-ip:18765"
            description={i18nService.t('imQQImageServerHint')}
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
          disabled={testingPlatform === 'qq'}
        >
          <Signal data-icon="inline-start" />
          {testingPlatform === 'qq'
            ? i18nService.t('imConnectivityTesting')
            : connectivityResults['qq' as keyof typeof connectivityResults]
              ? i18nService.t('imConnectivityRetest')
              : i18nService.t('imConnectivityTest')}
        </Button>
      </div>

      {/* Error display */}
      {instanceStatus?.lastError && <IMStatusAlert error>{instanceStatus.lastError}</IMStatusAlert>}
    </div>
  );
};

export default QQInstanceSettings;
