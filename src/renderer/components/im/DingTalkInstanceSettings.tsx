/**
 * DingTalk Instance Settings Component
 * Configuration form for a single DingTalk bot instance in multi-instance mode
 */

import { Button } from '@shared/components/ui/button';
import { Input } from '@shared/components/ui/input';
import { Separator } from '@shared/components/ui/separator';
import { Switch } from '@shared/components/ui/switch';
import { PlatformRegistry } from '@shared/platform';
import { cn } from '@shared/lib/utils';
import { RefreshCw, Signal, Trash2, X } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import React, { useEffect, useRef, useState } from 'react';

import { i18nService } from '../../services/i18n';
import type {
  DingTalkInstanceConfig,
  DingTalkInstanceStatus,
  DingTalkChannelConfig,
  IMConnectivityTestResult,
} from '../../types/im';
import {
  IMCheckboxField,
  IMConnectionBadge,
  IMField,
  IMInputField,
  IMSelectField,
  IMStatusAlert,
} from './IMFormControls';

interface DingTalkInstanceSettingsProps {
  instance: DingTalkInstanceConfig;
  instanceStatus: DingTalkInstanceStatus | undefined;
  onConfigChange: (update: Partial<DingTalkChannelConfig>) => void;
  onSave: (override?: Partial<DingTalkChannelConfig>) => Promise<void>;
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
    <ol className="text-xs text-muted-foreground flex flex-col gap-1 list-decimal list-inside">
      {steps.map((step, i) => (
        <li key={i}>{step}</li>
      ))}
    </ol>
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
        className="theme-action-inline-underlined mt-2"
      >
        {i18nService.t('imViewGuide')}
      </Button>
    )}
  </div>
);

const DingTalkInstanceSettings: React.FC<DingTalkInstanceSettingsProps> = ({
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

  // QR code scanning state
  const [qrStatus, setQrStatus] = useState<
    'idle' | 'loading' | 'showing' | 'success' | 'expired' | 'error'
  >('idle');
  const [qrUrl, setQrUrl] = useState('');
  const [qrTimeLeft, setQrTimeLeft] = useState(0);
  const [qrError, setQrError] = useState('');
  const qrDeviceCodeRef = useRef('');
  const qrPollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const qrCountdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (qrPollTimerRef.current) clearInterval(qrPollTimerRef.current);
      if (qrCountdownTimerRef.current) clearInterval(qrCountdownTimerRef.current);
    };
  }, []);

  const handleStartQr = async () => {
    if (qrPollTimerRef.current) clearInterval(qrPollTimerRef.current);
    if (qrCountdownTimerRef.current) clearInterval(qrCountdownTimerRef.current);
    setQrStatus('loading');
    setQrError('');
    try {
      const result = await window.electron.dingtalk.install.qrcode();
      if (!isMountedRef.current) return;
      setQrUrl(result.url);
      qrDeviceCodeRef.current = result.deviceCode;
      const expireIn = result.expireIn ?? 600;
      setQrTimeLeft(expireIn);
      setQrStatus('showing');

      qrCountdownTimerRef.current = setInterval(() => {
        setQrTimeLeft(prev => {
          if (prev <= 1) {
            clearInterval(qrCountdownTimerRef.current!);
            qrCountdownTimerRef.current = null;
            if (qrPollTimerRef.current) {
              clearInterval(qrPollTimerRef.current);
              qrPollTimerRef.current = null;
            }
            // QR expired: keep it visible with a reconnect overlay.
            setQrStatus('expired');
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      const intervalMs = Math.max(result.interval ?? 5, 3) * 1000;
      qrPollTimerRef.current = setInterval(async () => {
        try {
          const pollResult = await window.electron.dingtalk.install.poll(qrDeviceCodeRef.current);
          if (!isMountedRef.current) return;
          if (pollResult.done && pollResult.clientId && pollResult.clientSecret) {
            clearInterval(qrPollTimerRef.current!);
            qrPollTimerRef.current = null;
            clearInterval(qrCountdownTimerRef.current!);
            qrCountdownTimerRef.current = null;
            onConfigChange({
              clientId: pollResult.clientId,
              clientSecret: pollResult.clientSecret,
              enabled: true,
            });
            await onSave({
              clientId: pollResult.clientId,
              clientSecret: pollResult.clientSecret,
              enabled: true,
            });
            setQrStatus('success');
          } else if (pollResult.error) {
            clearInterval(qrPollTimerRef.current!);
            qrPollTimerRef.current = null;
            clearInterval(qrCountdownTimerRef.current!);
            qrCountdownTimerRef.current = null;
            setQrStatus('expired');
          }
        } catch {
          /* keep retrying */
        }
      }, intervalMs);
    } catch (err: unknown) {
      if (!isMountedRef.current) return;
      setQrStatus('error');
      setQrError(
        (err instanceof Error ? err.message : undefined) || i18nService.t('imQrGenerationFailed'),
      );
    }
  };

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
              src={PlatformRegistry.logo('dingtalk')}
              alt="DingTalk"
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
          disabled={!instance.enabled && !(instance.clientId && instance.clientSecret)}
          title={
            instance.enabled
              ? i18nService.t('imDisableInstance')
              : !(instance.clientId && instance.clientSecret)
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

      {/* Scan QR code section */}
      <div className="rounded-lg border border-dashed border-border-subtle p-4 text-center flex flex-col gap-3">
        {qrStatus === 'idle' && (
          <>
            <Button type="button" onClick={() => void handleStartQr()} disabled={false}>
              {i18nService.t('dingtalkBotCreateWizardScanBtn')}
            </Button>
            <p className="text-xs text-muted-foreground">
              {i18nService.t('dingtalkBotCreateWizardScanHint')}
            </p>
          </>
        )}
        {qrStatus === 'error' && (
          <>
            <Button type="button" onClick={() => void handleStartQr()} disabled={false}>
              {i18nService.t('dingtalkBotCreateWizardScanBtn')}
            </Button>
            {qrError && <IMStatusAlert error>{qrError}</IMStatusAlert>}
          </>
        )}
        {qrStatus === 'loading' && (
          <div className="flex flex-col items-center gap-2 py-2">
            <RefreshCw className="size-7 text-primary animate-spin" />
            <span className="text-xs text-muted-foreground">
              {i18nService.t('dingtalkBotCreateWizardGenerating')}
            </span>
          </div>
        )}
        {(qrStatus === 'showing' || qrStatus === 'expired') && qrUrl && (
          <div className="flex flex-col items-center gap-2">
            <div className="relative inline-block">
              <div
                className={cn('rounded-lg bg-white p-2', qrStatus === 'expired' && 'opacity-30')}
              >
                <QRCodeSVG value={qrUrl} size={160} />
              </div>
              {qrStatus === 'expired' && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <Button type="button" onClick={() => void handleStartQr()}>
                    <RefreshCw data-icon="inline-start" />
                    {i18nService.t('dingtalkBotCreateWizardQrcodeRefresh')}
                  </Button>
                </div>
              )}
            </div>
            <p className="text-xs text-muted-foreground max-w-[240px]">
              {qrStatus === 'expired'
                ? i18nService.t('dingtalkBotCreateWizardQrcodeExpired')
                : i18nService.t('dingtalkBotCreateWizardQrcodeDesc')}
            </p>
            {qrStatus === 'showing' && (
              <p className="text-xs text-muted-foreground">{qrTimeLeft}s</p>
            )}
          </div>
        )}
        {qrStatus === 'success' && (
          <IMStatusAlert>{i18nService.t('dingtalkBotCreateWizardSuccessTitle')}</IMStatusAlert>
        )}
      </div>

      {/* Divider */}
      <div className="flex items-center gap-3">
        <Separator className="flex-1" />
        <span className="whitespace-nowrap text-xs text-muted-foreground">
          {i18nService.t('dingtalkBotCreateWizardOrManual')}
        </span>
        <Separator className="flex-1" />
      </div>

      {/* Guide */}
      <PlatformGuide
        steps={[
          i18nService.t('imDingtalkGuideStep1'),
          i18nService.t('imDingtalkGuideStep2'),
          i18nService.t('imDingtalkGuideStep3'),
          i18nService.t('imDingtalkGuideStep4'),
        ]}
        guideUrl={PlatformRegistry.guideUrl('dingtalk')}
      />

      {/* Client ID (AppKey) */}
      <IMInputField
        id={`dingtalk-${instance.instanceId}-client-id`}
        label={i18nService.t('imDingTalkClientId')}
        required
        type="text"
        value={instance.clientId}
        onChange={e => onConfigChange({ clientId: e.target.value })}
        onBlur={() => void onSave()}
        placeholder="dingxxxxxx"
        clearLabel={i18nService.t('clear')}
        onClear={() => {
          onConfigChange({ clientId: '' });
          void onSave({ clientId: '' });
        }}
      />

      {/* Client Secret (AppSecret) */}
      <IMInputField
        id={`dingtalk-${instance.instanceId}-client-secret`}
        label={i18nService.t('imDingTalkClientSecret')}
        required
        type={showSecrets['clientSecret'] ? 'text' : 'password'}
        value={instance.clientSecret}
        onChange={e => onConfigChange({ clientSecret: e.target.value })}
        onBlur={() => void onSave()}
        placeholder="••••••••••••"
        clearLabel={i18nService.t('clear')}
        onClear={() => {
          onConfigChange({ clientSecret: '' });
          void onSave({ clientSecret: '' });
        }}
        revealLabel={i18nService.t('imShowSecret')}
        concealLabel={i18nService.t('imHideSecret')}
        revealed={showSecrets['clientSecret']}
        onRevealChange={revealed => setShowSecrets(prev => ({ ...prev, clientSecret: revealed }))}
      />

      {/* Advanced Settings (collapsible) */}
      <details className="group">
        <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-primary transition-colors">
          {i18nService.t('imAdvancedSettings')}
        </summary>
        <div className="mt-2 flex flex-col gap-3 pl-2 border-l-2 border-border-subtle">
          {/* DM Policy */}
          <IMSelectField
            id={`dingtalk-${instance.instanceId}-dm-policy`}
            label={i18nService.t('imDmPolicy')}
            value={instance.dmPolicy}
            options={[
              { value: 'open', label: i18nService.t('imDmPolicyOpen') },
              { value: 'pairing', label: i18nService.t('imDmPolicyPairing') },
              { value: 'allowlist', label: i18nService.t('imDmPolicyAllowlist') },
            ]}
            onValueChange={value => {
              const update = { dmPolicy: value as DingTalkChannelConfig['dmPolicy'] };
              onConfigChange(update);
              void onSave(update);
            }}
          />

          {/* Pairing Requests (shown when dmPolicy is 'pairing') */}

          {/* Allow From (User IDs) */}
          <IMField
            id={`dingtalk-${instance.instanceId}-allow-user`}
            label={i18nService.t('imAllowFromUserIds')}
          >
            <div className="flex gap-2">
              <Input
                id={`dingtalk-${instance.instanceId}-allow-user`}
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
                placeholder={i18nService.t('imDingtalkUserIdPlaceholder')}
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
            id={`dingtalk-${instance.instanceId}-group-policy`}
            label={i18nService.t('imGroupPolicy')}
            value={instance.groupPolicy}
            options={[
              { value: 'open', label: i18nService.t('imGroupPolicyOpen') },
              { value: 'allowlist', label: i18nService.t('imGroupPolicyAllowlist') },
            ]}
            onValueChange={value => {
              const update = { groupPolicy: value as DingTalkChannelConfig['groupPolicy'] };
              onConfigChange(update);
              void onSave(update);
            }}
          />

          {/* Session Timeout (deprecated) */}
          <IMInputField
            id={`dingtalk-${instance.instanceId}-session-timeout`}
            label={i18nService.t('imSessionTimeout')}
            type="number"
            value={Math.round(instance.sessionTimeout / 60000)}
            onChange={e => {
              const minutes = parseInt(e.target.value, 10);
              if (!isNaN(minutes) && minutes > 0) {
                onConfigChange({ sessionTimeout: minutes * 60000 });
              }
            }}
            onBlur={() => void onSave()}
            min={1}
            placeholder="30"
          />

          {/* Separate Session by Conversation */}
          <IMCheckboxField
            id={`dingtalk-${instance.instanceId}-separate-session`}
            label={i18nService.t('imSeparateSessionByConversation')}
            description={i18nService.t('imSeparateSessionByConversationDesc')}
            checked={instance.separateSessionByConversation}
            onCheckedChange={checked => {
              const update = { separateSessionByConversation: Boolean(checked) };
              onConfigChange(update);
              void onSave(update);
            }}
          />

          {/* Group Session Scope (only visible when separateSessionByConversation is on) */}
          {instance.separateSessionByConversation && (
            <div className="pl-4">
              <IMSelectField
                id={`dingtalk-${instance.instanceId}-group-session-scope`}
                label={i18nService.t('imGroupSessionScope')}
                value={instance.groupSessionScope}
                options={[
                  { value: 'group', label: i18nService.t('imGroupSessionScopeGroup') },
                  {
                    value: 'group_sender',
                    label: i18nService.t('imGroupSessionScopeGroupSender'),
                  },
                ]}
                onValueChange={value => {
                  const update = { groupSessionScope: value as 'group' | 'group_sender' };
                  onConfigChange(update);
                  void onSave(update);
                }}
              />
            </div>
          )}

          {/* Shared Memory Across Conversations */}
          <IMCheckboxField
            id={`dingtalk-${instance.instanceId}-shared-memory`}
            label={i18nService.t('imSharedMemoryAcrossConversations')}
            description={i18nService.t('imSharedMemoryAcrossConversationsDesc')}
            checked={instance.sharedMemoryAcrossConversations}
            onCheckedChange={checked => {
              const update = { sharedMemoryAcrossConversations: Boolean(checked) };
              onConfigChange(update);
              void onSave(update);
            }}
          />

          {/* Gateway Base URL */}
          <IMInputField
            id={`dingtalk-${instance.instanceId}-gateway-url`}
            label={i18nService.t('imGatewayBaseUrl')}
            type="text"
            value={instance.gatewayBaseUrl}
            onChange={e => {
              onConfigChange({ gatewayBaseUrl: e.target.value });
            }}
            onBlur={() => void onSave()}
            placeholder={i18nService.t('imGatewayBaseUrlPlaceholder')}
          />

          {/* Debug */}
          <IMCheckboxField
            id={`dingtalk-${instance.instanceId}-debug`}
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
          disabled={testingPlatform === 'dingtalk'}
        >
          <Signal data-icon="inline-start" />
          {testingPlatform === 'dingtalk'
            ? i18nService.t('imConnectivityTesting')
            : connectivityResults['dingtalk' as keyof typeof connectivityResults]
              ? i18nService.t('imConnectivityRetest')
              : i18nService.t('imConnectivityTest')}
        </Button>
      </div>

      {/* Error display */}
      {instanceStatus?.lastError && <IMStatusAlert error>{instanceStatus.lastError}</IMStatusAlert>}
    </div>
  );
};

export default DingTalkInstanceSettings;
