/**
 * Feishu Instance Settings Component
 * Configuration form for a single Feishu bot instance in multi-instance mode
 */

import { Button } from '@shared/components/ui/button';
import { Input } from '@shared/components/ui/input';
import { Switch } from '@shared/components/ui/switch';
import { PlatformRegistry } from '@shared/platform';
import { Signal, Trash2, X } from 'lucide-react';
import React, { useState } from 'react';

import { i18nService } from '../../services/i18n';
import type {
  FeishuInstanceConfig,
  FeishuInstanceStatus,
  FeishuChannelConfig,
  IMConnectivityTestResult,
} from '../../types/im';
import {
  IMConnectionBadge,
  IMField,
  IMInputField,
  IMSelectField,
  IMStatusAlert,
  IMSwitchField,
} from './IMFormControls';

interface FeishuInstanceSettingsProps {
  instance: FeishuInstanceConfig;
  instanceStatus: FeishuInstanceStatus | undefined;
  onConfigChange: (update: Partial<FeishuChannelConfig>) => void;
  onSave: (override?: Partial<FeishuChannelConfig>) => Promise<void>;
  onRename: (newName: string) => void;
  onDelete: () => void;
  onToggleEnabled: () => void;
  onTestConnectivity: () => void;
  testingPlatform: string | null;
  connectivityResults: Record<string, IMConnectivityTestResult>;
}

// Reusable guide card component for platform setup instructions
const PlatformGuide: React.FC<{
  steps: string[];
  guideUrl?: string;
}> = ({ steps, guideUrl }) => (
  <div className="mb-3 p-3 rounded-lg border border-dashed border-border-subtle">
    {guideUrl && (
      <Button
        type="button"
        variant="link"
        size="sm"
        onClick={() => {
          window.electron.shell.openExternal(guideUrl).catch((err: unknown) => {
            console.error('[IM] Failed to open guide URL:', err);
          });
        }}
        className="theme-page-feishu-instance-settings-button-1 mb-2"
      >
        {i18nService.t('imFeishuConfigLink')}
      </Button>
    )}
    <ol className="text-xs text-muted-foreground flex flex-col gap-1 list-decimal list-inside">
      {steps.map((step, i) => (
        <li key={i}>{step}</li>
      ))}
    </ol>
  </div>
);

const FeishuInstanceSettings: React.FC<FeishuInstanceSettingsProps> = ({
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
  const [groupAllowIdInput, setGroupAllowIdInput] = useState('');
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
              src={PlatformRegistry.logo('feishu')}
              alt="Feishu"
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
          disabled={!instance.enabled && !(instance.appId && instance.appSecret)}
          title={
            instance.enabled
              ? i18nService.t('imDisableInstance')
              : !(instance.appId && instance.appSecret)
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

      {/* Guide */}
      <PlatformGuide
        steps={[
          i18nService.t('imFeishuGuideStep1'),
          i18nService.t('imFeishuGuideStep2'),
          i18nService.t('imFeishuGuideStep3'),
        ]}
        guideUrl={PlatformRegistry.guideUrl('feishu')}
      />

      {/* App ID */}
      <IMInputField
        id={`feishu-${instance.instanceId}-app-id`}
        label={i18nService.t('imAppId')}
        required
        type="text"
        value={instance.appId}
        onChange={e => onConfigChange({ appId: e.target.value })}
        onBlur={() => void onSave()}
        placeholder="cli_xxxxx"
        clearLabel={i18nService.t('clear')}
        onClear={() => {
          onConfigChange({ appId: '' });
          void onSave({ appId: '' });
        }}
      />

      {/* App Secret */}
      <IMInputField
        id={`feishu-${instance.instanceId}-app-secret`}
        label={i18nService.t('imAppSecret')}
        required
        type={showSecrets['appSecret'] ? 'text' : 'password'}
        value={instance.appSecret}
        onChange={e => onConfigChange({ appSecret: e.target.value })}
        onBlur={() => void onSave()}
        placeholder="••••••••••••"
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

      {/* Domain */}
      <IMSelectField
        id={`feishu-${instance.instanceId}-domain`}
        label={i18nService.t('imFeishuDomain')}
        value={instance.domain}
        options={[
          { value: 'feishu', label: i18nService.t('imFeishuDomainFeishu') },
          { value: 'lark', label: i18nService.t('imFeishuDomainLark') },
        ]}
        onValueChange={value => {
          const update = { domain: value };
          onConfigChange(update);
          void onSave(update);
        }}
      />

      {/* Advanced Settings (collapsible) */}
      <details className="group">
        <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-primary transition-colors">
          {i18nService.t('imAdvancedSettings')}
        </summary>
        <div className="mt-2 flex flex-col gap-3 pl-2 border-l-2 border-border-subtle">
          {/* DM Policy */}
          <IMSelectField
            id={`feishu-${instance.instanceId}-dm-policy`}
            label={i18nService.t('imDmPolicy')}
            value={instance.dmPolicy}
            options={[
              { value: 'pairing', label: i18nService.t('imDmPolicyPairing') },
              { value: 'allowlist', label: i18nService.t('imDmPolicyAllowlist') },
              { value: 'open', label: i18nService.t('imDmPolicyOpen') },
              { value: 'disabled', label: i18nService.t('imDmPolicyDisabled') },
            ]}
            onValueChange={value => {
              const update = { dmPolicy: value as FeishuChannelConfig['dmPolicy'] };
              onConfigChange(update);
              void onSave(update);
            }}
          />

          {/* Pairing Requests (shown when dmPolicy is 'pairing') */}

          {/* Allow From (User IDs) */}
          <IMField
            id={`feishu-${instance.instanceId}-allow-user`}
            label={i18nService.t('imAllowFromUserIds')}
          >
            <div className="flex gap-2">
              <Input
                id={`feishu-${instance.instanceId}-allow-user`}
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
                placeholder={i18nService.t('imFeishuUserIdPlaceholder')}
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
            id={`feishu-${instance.instanceId}-group-policy`}
            label={i18nService.t('imGroupPolicy')}
            value={instance.groupPolicy}
            options={[
              { value: 'allowlist', label: i18nService.t('imGroupPolicyAllowlist') },
              { value: 'open', label: i18nService.t('imGroupPolicyOpen') },
              { value: 'disabled', label: i18nService.t('imGroupPolicyDisabled') },
            ]}
            onValueChange={value => {
              const update = { groupPolicy: value as FeishuChannelConfig['groupPolicy'] };
              onConfigChange(update);
              void onSave(update);
            }}
          />

          {/* Group Allow From */}
          <IMField
            id={`feishu-${instance.instanceId}-allow-chat`}
            label={i18nService.t('imGroupAllowFromChatIds')}
          >
            <div className="flex gap-2">
              <Input
                id={`feishu-${instance.instanceId}-allow-chat`}
                type="text"
                value={groupAllowIdInput}
                onChange={e => setGroupAllowIdInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    const id = groupAllowIdInput.trim();
                    if (id && !instance.groupAllowFrom.includes(id)) {
                      const newIds = [...instance.groupAllowFrom, id];
                      onConfigChange({ groupAllowFrom: newIds });
                      setGroupAllowIdInput('');
                      void onSave({ groupAllowFrom: newIds });
                    }
                  }
                }}
                className="flex-1"
                placeholder={i18nService.t('imFeishuChatIdPlaceholder')}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  const id = groupAllowIdInput.trim();
                  if (id && !instance.groupAllowFrom.includes(id)) {
                    const newIds = [...instance.groupAllowFrom, id];
                    onConfigChange({ groupAllowFrom: newIds });
                    setGroupAllowIdInput('');
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

          {/* Streaming Output Toggle */}
          <IMSwitchField
            id={`feishu-${instance.instanceId}-streaming`}
            label={i18nService.t('imFeishuStreaming')}
            description={i18nService.t('imFeishuStreamingDesc')}
            checked={instance.streaming}
            onCheckedChange={checked => {
              const update = { streaming: Boolean(checked) };
              onConfigChange(update);
              void onSave(update);
            }}
          />

          {/* Footer Options (visible when streaming is enabled) */}
          {instance.streaming && (
            <div className="flex flex-col gap-2 pl-3 border-l-2 border-primary/20">
              <IMSwitchField
                id={`feishu-${instance.instanceId}-footer-status`}
                label={i18nService.t('imFeishuFooterStatus')}
                size="sm"
                checked={instance.footer?.status ?? false}
                onCheckedChange={checked => {
                  const newFooter = { ...instance.footer, status: Boolean(checked) };
                  const update = { footer: newFooter };
                  onConfigChange(update);
                  void onSave(update);
                }}
              />
              <IMSwitchField
                id={`feishu-${instance.instanceId}-footer-elapsed`}
                label={i18nService.t('imFeishuFooterElapsed')}
                size="sm"
                checked={instance.footer?.elapsed ?? false}
                onCheckedChange={checked => {
                  const newFooter = { ...instance.footer, elapsed: Boolean(checked) };
                  const update = { footer: newFooter };
                  onConfigChange(update);
                  void onSave(update);
                }}
              />
            </div>
          )}

          {/* Reply Mode */}
          <IMSelectField
            id={`feishu-${instance.instanceId}-reply-mode`}
            label={i18nService.t('imReplyMode')}
            value={instance.replyMode}
            options={[
              { value: 'auto', label: i18nService.t('imReplyModeAuto') },
              { value: 'static', label: i18nService.t('imReplyModeStatic') },
              { value: 'streaming', label: i18nService.t('imReplyModeStreaming') },
            ]}
            onValueChange={value => {
              const update = { replyMode: value as FeishuChannelConfig['replyMode'] };
              onConfigChange(update);
              void onSave(update);
            }}
          />

          {/* Block Streaming */}
          {instance.replyMode !== 'streaming' && (
            <IMSwitchField
              id={`feishu-${instance.instanceId}-block-streaming`}
              label={i18nService.t('imFeishuBlockStreaming')}
              description={i18nService.t('imFeishuBlockStreamingDesc')}
              checked={instance.blockStreaming}
              onCheckedChange={checked => {
                const update = { blockStreaming: Boolean(checked) };
                onConfigChange(update);
                void onSave(update);
              }}
            />
          )}

          {/* History Limit */}
          <IMInputField
            id={`feishu-${instance.instanceId}-history-limit`}
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
            id={`feishu-${instance.instanceId}-media-max-mb`}
            label={i18nService.t('imMediaMaxMb')}
            type="number"
            value={instance.mediaMaxMb}
            onChange={e => onConfigChange({ mediaMaxMb: parseInt(e.target.value) || 30 })}
            onBlur={() => void onSave()}
            min={1}
            max={50}
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
          disabled={testingPlatform === 'feishu'}
        >
          <Signal data-icon="inline-start" />
          {testingPlatform === 'feishu'
            ? i18nService.t('imConnectivityTesting')
            : connectivityResults['feishu' as keyof typeof connectivityResults]
              ? i18nService.t('imConnectivityRetest')
              : i18nService.t('imConnectivityTest')}
        </Button>
      </div>

      {/* Error display */}
      {instanceStatus?.error && <IMStatusAlert error>{instanceStatus.error}</IMStatusAlert>}
    </div>
  );
};

export default FeishuInstanceSettings;
