/**
 * Discord Instance Settings Component
 * Configuration form for a single Discord bot instance in multi-instance mode
 */

import { Button } from '@shared/components/ui/button';
import { Input } from '@shared/components/ui/input';
import { Switch } from '@shared/components/ui/switch';
import { PlatformRegistry } from '@shared/platform';
import { Signal, Trash2, X } from 'lucide-react';
import React, { useState } from 'react';

import { i18nService } from '../../services/i18n';
import type {
  DiscordInstanceConfig,
  DiscordInstanceStatus,
  DiscordChannelConfig,
  DiscordChannelGuildConfig,
  IMConnectivityTestResult,
} from '../../types/im';
import {
  IMConnectionBadge,
  IMField,
  IMInputField,
  IMSelectField,
  IMStatusAlert,
  IMSwitchField,
  IMTextareaField,
} from './IMFormControls';

interface DiscordInstanceSettingsProps {
  instance: DiscordInstanceConfig;
  instanceStatus: DiscordInstanceStatus | undefined;
  onConfigChange: (update: Partial<DiscordChannelConfig>) => void;
  onSave: (override?: Partial<DiscordChannelConfig>) => Promise<void>;
  onRename: (newName: string) => void;
  onDelete: () => void;
  onToggleEnabled: () => void;
  onTestConnectivity: () => void;
  testingPlatform: string | null;
  connectivityResults: Record<string, IMConnectivityTestResult>;
}

const DiscordInstanceSettings: React.FC<DiscordInstanceSettingsProps> = ({
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
  const [guildIdInput, setGuildIdInput] = useState('');
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

  const handleGuildConfigChange = (guildId: string, update: Partial<DiscordChannelGuildConfig>) => {
    const currentGuild = instance.guilds[guildId] ?? {};
    const newGuilds = { ...instance.guilds, [guildId]: { ...currentGuild, ...update } };
    onConfigChange({ guilds: newGuilds });
    void onSave({ guilds: newGuilds });
  };

  const handleRemoveGuild = (guildId: string) => {
    const newGuilds = { ...instance.guilds };
    delete newGuilds[guildId];
    onConfigChange({ guilds: newGuilds });
    void onSave({ guilds: newGuilds });
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Instance Header: Name, Status, Enable Toggle, Delete */}
      <div className="flex items-center gap-3 pb-3 border-b border-border-subtle">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="flex size-7 items-center justify-center rounded-md bg-surface border border-border-subtle p-1">
            <img
              src={PlatformRegistry.logo('discord')}
              alt="Discord"
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
              title={i18nService.t('imDiscordClickToRename')}
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
              ? i18nService.t('imDiscordDisableInstance')
              : !instance.botToken
                ? i18nService.t('imInstanceFillCredentials')
                : i18nService.t('imDiscordEnableInstance')
          }
        />

        {/* Delete button */}
        <Button
          type="button"
          variant="destructive"
          size="sm"
          onClick={onDelete}
          title={i18nService.t('imDiscordDeleteInstance')}
        >
          <Trash2 data-icon="inline-start" />
          {i18nService.t('delete')}
        </Button>
      </div>

      {/* Guide */}
      <div className="mb-3 p-3 rounded-lg border border-dashed border-border-subtle">
        <ol className="text-xs text-muted-foreground flex flex-col gap-1 list-decimal list-inside">
          <li>{i18nService.t('imDiscordGuideStep1')}</li>
          <li>{i18nService.t('imDiscordGuideStep2')}</li>
          <li>{i18nService.t('imDiscordGuideStep3')}</li>
          <li>{i18nService.t('imDiscordGuideStep4')}</li>
          <li>{i18nService.t('imDiscordGuideStep5')}</li>
          <li>{i18nService.t('imDiscordGuideStep6')}</li>
        </ol>
        {PlatformRegistry.guideUrl('discord') && (
          <Button
            type="button"
            variant="link"
            size="sm"
            onClick={() => {
              window.electron.shell
                .openExternal(PlatformRegistry.guideUrl('discord')!)
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
        id={`discord-${instance.instanceId}-bot-token`}
        label="Bot Token"
        type={showSecrets['botToken'] ? 'text' : 'password'}
        value={instance.botToken}
        onChange={e => onConfigChange({ botToken: e.target.value })}
        onBlur={() => void onSave()}
        placeholder="MTIzNDU2Nzg5MDEyMzQ1Njc4OQ..."
        description={i18nService.t('imDiscordTokenHint')}
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
            id={`discord-${instance.instanceId}-dm-policy`}
            label={i18nService.t('imDmPolicy')}
            value={instance.dmPolicy}
            options={[
              { value: 'pairing', label: i18nService.t('imDmPolicyPairing') },
              { value: 'allowlist', label: i18nService.t('imDmPolicyAllowlist') },
              { value: 'open', label: i18nService.t('imDmPolicyOpen') },
              { value: 'disabled', label: i18nService.t('imDmPolicyDisabled') },
            ]}
            onValueChange={value => {
              const update = { dmPolicy: value as DiscordChannelConfig['dmPolicy'] };
              onConfigChange(update);
              void onSave(update);
            }}
          />

          {/* Allow From (User IDs) */}
          <IMField
            id={`discord-${instance.instanceId}-allow-user`}
            label={i18nService.t('imAllowFromUserIds')}
          >
            <div className="flex gap-2">
              <Input
                id={`discord-${instance.instanceId}-allow-user`}
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
                placeholder={i18nService.t('imDiscordUserIdPlaceholder')}
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
            id={`discord-${instance.instanceId}-group-policy`}
            label={i18nService.t('imGroupPolicy')}
            value={instance.groupPolicy}
            options={[
              { value: 'allowlist', label: i18nService.t('imGroupPolicyAllowlist') },
              { value: 'open', label: i18nService.t('imGroupPolicyOpen') },
              { value: 'disabled', label: i18nService.t('imGroupPolicyDisabled') },
            ]}
            onValueChange={value => {
              const update = { groupPolicy: value as DiscordChannelConfig['groupPolicy'] };
              onConfigChange(update);
              void onSave(update);
            }}
          />

          {/* Group Allow From (Server IDs) */}
          {instance.groupPolicy === 'allowlist' && (
            <IMField
              id={`discord-${instance.instanceId}-allow-server`}
              label={i18nService.t('imGroupAllowFromServerIds')}
            >
              <div className="flex gap-2">
                <Input
                  id={`discord-${instance.instanceId}-allow-server`}
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
                  placeholder={i18nService.t('imDiscordServerIdPlaceholder')}
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

          {/* Per-Guild Settings */}
          <IMField
            id={`discord-${instance.instanceId}-guild-id`}
            label={i18nService.t('imDiscordGuildSettings')}
          >
            <div className="flex gap-2">
              <Input
                id={`discord-${instance.instanceId}-guild-id`}
                type="text"
                value={guildIdInput}
                onChange={e => setGuildIdInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    const id = guildIdInput.trim();
                    if (id && !instance.guilds[id]) {
                      const newGuilds = { ...instance.guilds, [id]: { requireMention: true } };
                      onConfigChange({ guilds: newGuilds });
                      setGuildIdInput('');
                      void onSave({ guilds: newGuilds });
                    }
                  }
                }}
                className="flex-1"
                placeholder={i18nService.t('imDiscordGuildIdPlaceholder')}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  const id = guildIdInput.trim();
                  if (id && !instance.guilds[id]) {
                    const newGuilds = { ...instance.guilds, [id]: { requireMention: true } };
                    onConfigChange({ guilds: newGuilds });
                    setGuildIdInput('');
                    void onSave({ guilds: newGuilds });
                  }
                }}
              >
                {i18nService.t('add')}
              </Button>
            </div>
            {Object.keys(instance.guilds).length > 0 && (
              <div className="mt-2 flex flex-col gap-2">
                {Object.entries(instance.guilds).map(([guildId, guildCfg]) => (
                  <div
                    key={guildId}
                    className="p-2 rounded-lg bg-surface border border-border-subtle flex flex-col gap-2"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-mono text-foreground">{guildId}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label={i18nService.t('delete')}
                        onClick={() => handleRemoveGuild(guildId)}
                      >
                        <X data-icon="inline-start" />
                      </Button>
                    </div>
                    {/* requireMention toggle */}
                    <IMSwitchField
                      id={`discord-${instance.instanceId}-${guildId}-require-mention`}
                      label={i18nService.t('imRequireMention')}
                      checked={Boolean(guildCfg.requireMention)}
                      onCheckedChange={checked =>
                        handleGuildConfigChange(guildId, { requireMention: Boolean(checked) })
                      }
                    />
                    {/* Guild-level systemPrompt */}
                    <IMTextareaField
                      id={`discord-${instance.instanceId}-${guildId}-system-prompt`}
                      label={i18nService.t('systemPrompt')}
                      value={guildCfg.systemPrompt ?? ''}
                      onChange={e => {
                        const currentGuild = instance.guilds[guildId] ?? {};
                        const newGuilds = {
                          ...instance.guilds,
                          [guildId]: { ...currentGuild, systemPrompt: e.target.value },
                        };
                        onConfigChange({ guilds: newGuilds });
                      }}
                      onBlur={() => void onSave()}
                      className="min-h-[60px] resize-y text-xs"
                      placeholder={i18nService.t('imDiscordGuildSystemPromptPlaceholder')}
                    />
                  </div>
                ))}
              </div>
            )}
          </IMField>

          {/* Streaming */}
          <IMSelectField
            id={`discord-${instance.instanceId}-streaming`}
            label={i18nService.t('imStreaming')}
            value={instance.streaming}
            options={[
              { value: 'off', label: i18nService.t('imStreamingOff') },
              { value: 'partial', label: i18nService.t('imStreamingPartial') },
              { value: 'block', label: i18nService.t('imStreamingBlock') },
              { value: 'progress', label: i18nService.t('imStreamingProgress') },
            ]}
            onValueChange={value => {
              const update = { streaming: value as DiscordChannelConfig['streaming'] };
              onConfigChange(update);
              void onSave(update);
            }}
          />

          {/* Proxy */}
          <IMInputField
            id={`discord-${instance.instanceId}-proxy`}
            label={i18nService.t('imProxy')}
            type="text"
            value={instance.proxy}
            onChange={e => onConfigChange({ proxy: e.target.value })}
            onBlur={() => void onSave()}
            placeholder="http://proxy:port"
          />

          {/* History Limit */}
          <IMInputField
            id={`discord-${instance.instanceId}-history-limit`}
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
            id={`discord-${instance.instanceId}-media-max-mb`}
            label={i18nService.t('imMediaMaxMb')}
            type="number"
            value={instance.mediaMaxMb}
            onChange={e => onConfigChange({ mediaMaxMb: parseInt(e.target.value) || 25 })}
            onBlur={() => void onSave()}
            min={1}
            max={100}
          />

          {/* Debug */}
          <IMSwitchField
            id={`discord-${instance.instanceId}-debug`}
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
          disabled={testingPlatform === 'discord'}
        >
          <Signal data-icon="inline-start" />
          {testingPlatform === 'discord'
            ? i18nService.t('imConnectivityTesting')
            : connectivityResults['discord' as keyof typeof connectivityResults]
              ? i18nService.t('imConnectivityRetest')
              : i18nService.t('imConnectivityTest')}
        </Button>
      </div>

      {/* Bot username display */}
      {instanceStatus?.botUsername && (
        <IMStatusAlert>
          {i18nService.t('imBot')}: {instanceStatus.botUsername}
        </IMStatusAlert>
      )}

      {/* Error display */}
      {instanceStatus?.lastError && <IMStatusAlert error>{instanceStatus.lastError}</IMStatusAlert>}
    </div>
  );
};

export default DiscordInstanceSettings;
