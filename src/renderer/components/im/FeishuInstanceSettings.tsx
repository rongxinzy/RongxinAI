/**
 * Feishu Instance Settings Component
 * Configuration form for a single Feishu bot instance in multi-instance mode
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
  FeishuInstanceConfig,
  FeishuInstanceStatus,
  FeishuOpenClawConfig,
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
  onConfigChange: (update: Partial<FeishuOpenClawConfig>) => void;
  onSave: (override?: Partial<FeishuOpenClawConfig>) => Promise<void>;
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
        className="mt-2 h-auto p-0 text-xs font-medium underline underline-offset-2"
      >
        {i18nService.t('imViewGuide')}
      </Button>
    )}
  </div>
);

// Pairing section component
const PairingSection: React.FC<{
  platform: string;
}> = ({ platform }) => {
  const [pairingCodeInput, setPairingCodeInput] = useState('');
  const [pairingStatus, setPairingStatus] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  const handleApprovePairing = async (code: string) => {
    setPairingStatus(null);
    try {
      const result = await window.electron.im.approvePairingCode(platform, code);
      if (result.success) {
        setPairingStatus({
          type: 'success',
          message: i18nService.t('imPairingCodeApproved').replace('{code}', code),
        });
      } else {
        setPairingStatus({
          type: 'error',
          message: result.error || i18nService.t('imPairingCodeInvalid'),
        });
      }
    } catch {
      setPairingStatus({ type: 'error', message: i18nService.t('imPairingCodeInvalid') });
    }
  };

  return (
    <IMField id={`${platform}-pairing-code`} label={i18nService.t('imPairingApproval')}>
      <div className="flex gap-2">
        <Input
          id={`${platform}-pairing-code`}
          type="text"
          value={pairingCodeInput}
          onChange={e => {
            setPairingCodeInput(e.target.value.toUpperCase());
            if (pairingStatus) setPairingStatus(null);
          }}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              const code = pairingCodeInput.trim();
              if (code) {
                void handleApprovePairing(code).then(() => {
                  setPairingCodeInput('');
                });
              }
            }
          }}
          className="flex-1 font-mono uppercase tracking-widest"
          placeholder={i18nService.t('imPairingCodePlaceholder')}
          maxLength={8}
        />
        <Button
          type="button"
          variant="default"
          size="sm"
          onClick={() => {
            const code = pairingCodeInput.trim();
            if (code) {
              void handleApprovePairing(code).then(() => {
                setPairingCodeInput('');
              });
            }
          }}
        >
          {i18nService.t('imPairingApprove')}
        </Button>
      </div>
      {pairingStatus && (
        <IMStatusAlert error={pairingStatus.type === 'error'}>
          {pairingStatus.message}
        </IMStatusAlert>
      )}
    </IMField>
  );
};

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
      const result = await window.electron.feishu.install.qrcode(false);
      if (!isMountedRef.current) return;
      setQrUrl(result.url);
      qrDeviceCodeRef.current = result.deviceCode;
      const expireIn = (result as any).expireIn ?? 300;
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

      const intervalMs = Math.max((result as any).interval ?? 5, 3) * 1000;
      qrPollTimerRef.current = setInterval(async () => {
        try {
          const pollResult = await window.electron.feishu.install.poll(qrDeviceCodeRef.current);
          if (!isMountedRef.current) return;
          if (pollResult.done && pollResult.appId && pollResult.appSecret) {
            clearInterval(qrPollTimerRef.current!);
            qrPollTimerRef.current = null;
            clearInterval(qrCountdownTimerRef.current!);
            qrCountdownTimerRef.current = null;
            onConfigChange({
              appId: pollResult.appId,
              appSecret: pollResult.appSecret,
              enabled: true,
            });
            await onSave({
              appId: pollResult.appId,
              appSecret: pollResult.appSecret,
              enabled: true,
            });
            setQrStatus('success');
          } else if (
            pollResult.error &&
            pollResult.error !== 'authorization_pending' &&
            pollResult.error !== 'slow_down'
          ) {
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
    } catch (err: any) {
      if (!isMountedRef.current) return;
      setQrStatus('error');
      setQrError(err?.message || i18nService.t('imQrGenerationFailed'));
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
              className="text-sm font-medium px-0 py-0 border-0 border-b border-primary rounded-none bg-transparent"
            />
          ) : (
            <Button
              type="button"
              variant="ghost"
              className="h-auto min-w-0 justify-start truncate p-0"
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

      {/* Scan QR code section */}
      <div className="rounded-lg border border-dashed border-border-subtle p-4 text-center flex flex-col gap-3">
        {qrStatus === 'idle' && (
          <>
            <Button type="button" onClick={() => void handleStartQr()} disabled={false}>
              {i18nService.t('feishuBotCreateWizardScanBtn')}
            </Button>
            <p className="text-xs text-muted-foreground">
              {i18nService.t('feishuBotCreateWizardScanHint')}
            </p>
          </>
        )}
        {qrStatus === 'error' && (
          <>
            <Button type="button" onClick={() => void handleStartQr()} disabled={false}>
              {i18nService.t('feishuBotCreateWizardScanBtn')}
            </Button>
            {qrError && <IMStatusAlert error>{qrError}</IMStatusAlert>}
          </>
        )}
        {qrStatus === 'loading' && (
          <div className="flex flex-col items-center gap-2 py-2">
            <RefreshCw className="size-7 text-primary animate-spin" />
            <span className="text-xs text-muted-foreground">
              {i18nService.t('feishuBotCreateWizardGenerating')}
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
                    {i18nService.t('feishuBotCreateWizardQrcodeRefresh')}
                  </Button>
                </div>
              )}
            </div>
            <p className="text-xs text-muted-foreground max-w-[240px]">
              {qrStatus === 'expired'
                ? i18nService.t('feishuBotCreateWizardQrcodeExpired')
                : i18nService.t('feishuBotCreateWizardQrcodeDesc')}
            </p>
            {qrStatus === 'showing' && (
              <p className="text-xs text-muted-foreground">{qrTimeLeft}s</p>
            )}
          </div>
        )}
        {qrStatus === 'success' && (
          <IMStatusAlert>{i18nService.t('feishuBotCreateWizardSuccessTitle')}</IMStatusAlert>
        )}
      </div>

      {/* Divider */}
      <div className="flex items-center gap-3">
        <Separator className="flex-1" />
        <span className="whitespace-nowrap text-xs text-muted-foreground">
          {i18nService.t('feishuBotCreateWizardOrManual')}
        </span>
        <Separator className="flex-1" />
      </div>

      {/* Guide */}
      <PlatformGuide
        steps={[i18nService.t('imFeishuGuideStep1'), i18nService.t('imFeishuGuideStep2')]}
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
              const update = { dmPolicy: value as FeishuOpenClawConfig['dmPolicy'] };
              onConfigChange(update);
              void onSave(update);
            }}
          />

          {/* Pairing Requests (shown when dmPolicy is 'pairing') */}
          {instance.dmPolicy === 'pairing' && <PairingSection platform="feishu" />}

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
              const update = { groupPolicy: value as FeishuOpenClawConfig['groupPolicy'] };
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
              const update = { replyMode: value as FeishuOpenClawConfig['replyMode'] };
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
