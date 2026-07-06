/**
 * Feishu Instance Settings Component
 * Configuration form for a single Feishu bot instance in multi-instance mode
 */

import { Button } from '@shared/components/ui/button';
import { Input } from '@shared/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/components/ui/select';
import { Switch } from '@shared/components/ui/switch';
import { PlatformRegistry } from '@shared/platform';
import { CheckCircle, Eye, EyeOff, RefreshCw, Signal, Trash2, X,XCircle } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import React, { useEffect, useRef, useState } from 'react';

import { i18nService } from '../../services/i18n';
import type { FeishuInstanceConfig, FeishuInstanceStatus, FeishuOpenClawConfig, IMConnectivityTestResult } from '../../types/im';

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
  language: 'zh' | 'en';
}

// Reusable guide card component for platform setup instructions
const PlatformGuide: React.FC<{
  steps: string[];
  guideUrl?: string;
}> = ({ steps, guideUrl }) => (
  <div className="mb-3 p-3 rounded-lg border border-dashed border-border-subtle">
    <ol className="text-xs text-secondary space-y-1 list-decimal list-inside">
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
  const [pairingStatus, setPairingStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const handleApprovePairing = async (code: string) => {
    setPairingStatus(null);
    try {
      const result = await window.electron.im.approvePairingCode(platform, code);
      if (result.success) {
        setPairingStatus({ type: 'success', message: i18nService.t('imPairingCodeApproved').replace('{code}', code) });
      } else {
        setPairingStatus({ type: 'error', message: result.error || i18nService.t('imPairingCodeInvalid') });
      }
    } catch {
      setPairingStatus({ type: 'error', message: i18nService.t('imPairingCodeInvalid') });
    }
  };

  return (
    <div className="space-y-2">
      <label className="block text-xs font-medium text-secondary">
        {i18nService.t('imPairingApproval')}
      </label>
      <div className="flex gap-2">
        <Input
          type="text"
          value={pairingCodeInput}
          onChange={(e) => {
            setPairingCodeInput(e.target.value.toUpperCase());
            if (pairingStatus) setPairingStatus(null);
          }}
          onKeyDown={(e) => {
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
          className="bg-green-600 text-white hover:bg-green-700 dark:bg-green-600 dark:hover:bg-green-700"
        >
          {i18nService.t('imPairingApprove')}
        </Button>
      </div>
      {pairingStatus && (
        <p className={`text-xs ${pairingStatus.type === 'success' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
          {pairingStatus.type === 'success' ? '\u2713' : '\u2717'} {pairingStatus.message}
        </p>
      )}
    </div>
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
  language,
}) => {
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  const [allowedUserIdInput, setAllowedUserIdInput] = useState('');
  const [groupAllowIdInput, setGroupAllowIdInput] = useState('');
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(instance.instanceName);

  // QR code scanning state
  const [qrStatus, setQrStatus] = useState<'idle' | 'loading' | 'showing' | 'success' | 'expired' | 'error'>('idle');
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
        setQrTimeLeft((prev) => {
          if (prev <= 1) {
            clearInterval(qrCountdownTimerRef.current!);
            qrCountdownTimerRef.current = null;
            if (qrPollTimerRef.current) { clearInterval(qrPollTimerRef.current); qrPollTimerRef.current = null; }
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
            clearInterval(qrPollTimerRef.current!); qrPollTimerRef.current = null;
            clearInterval(qrCountdownTimerRef.current!); qrCountdownTimerRef.current = null;
            onConfigChange({ appId: pollResult.appId, appSecret: pollResult.appSecret, enabled: true });
            await onSave({ appId: pollResult.appId, appSecret: pollResult.appSecret, enabled: true });
            setQrStatus('success');
          } else if (pollResult.error && pollResult.error !== 'authorization_pending' && pollResult.error !== 'slow_down') {
            clearInterval(qrPollTimerRef.current!); qrPollTimerRef.current = null;
            clearInterval(qrCountdownTimerRef.current!); qrCountdownTimerRef.current = null;
            setQrStatus('expired');
          }
        } catch { /* keep retrying */ }
      }, intervalMs);
    } catch (err: any) {
      if (!isMountedRef.current) return;
      setQrStatus('error');
      setQrError(err?.message || '获取二维码失败');
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
    <div className="space-y-3">
      {/* Instance Header: Name, Status, Enable Toggle, Delete */}
      <div className="flex items-center gap-3 pb-3 border-b border-border-subtle">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-surface border border-border-subtle p-1">
            <img
              src={PlatformRegistry.logo('feishu')}
              alt="Feishu"
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
          disabled={!instance.enabled && !(instance.appId && instance.appSecret)}
          title={instance.enabled
            ? (language === 'zh' ? '禁用此实例' : 'Disable this instance')
            : (!(instance.appId && instance.appSecret)
              ? i18nService.t('imInstanceFillCredentials')
              : (language === 'zh' ? '启用此实例' : 'Enable this instance'))}
        />

        {/* Delete button */}
        <Button
          type="button"
          variant="destructive"
          size="sm"
          onClick={onDelete}
          title={language === 'zh' ? '删除此实例' : 'Delete this instance'}
        >
          <Trash2 className="h-4 w-4" />
          {language === 'zh' ? '删除' : 'Delete'}
        </Button>
      </div>

      {/* Scan QR code section */}
      <div className="rounded-lg border border-dashed border-border-subtle p-4 text-center space-y-3">
        {qrStatus === 'idle' && (
          <>
            <Button
              type="button"
              onClick={() => void handleStartQr()}
              disabled={false}
            >
              {i18nService.t('feishuBotCreateWizardScanBtn')}
            </Button>
            <p className="text-xs text-secondary">
              {i18nService.t('feishuBotCreateWizardScanHint')}
            </p>
          </>
        )}
        {qrStatus === 'error' && (
          <>
            <Button
              type="button"
              onClick={() => void handleStartQr()}
              disabled={false}
            >
              {i18nService.t('feishuBotCreateWizardScanBtn')}
            </Button>
            {qrError && (
              <div className="flex items-center justify-center gap-1.5 text-xs text-red-500 bg-red-500/10 px-3 py-2 rounded-lg">
                <XCircle className="h-4 w-4 flex-shrink-0" />
                {qrError}
              </div>
            )}
          </>
        )}
        {qrStatus === 'loading' && (
          <div className="flex flex-col items-center gap-2 py-2">
            <RefreshCw className="h-7 w-7 text-primary animate-spin" />
            <span className="text-xs text-secondary">{i18nService.t('feishuBotCreateWizardGenerating') || '正在生成二维码…'}</span>
          </div>
        )}
        {(qrStatus === 'showing' || qrStatus === 'expired') && qrUrl && (
          <div className="flex flex-col items-center gap-2">
            <div className="relative inline-block">
              <div className={`p-2 bg-white rounded-lg ${qrStatus === 'expired' ? 'opacity-30' : ''}`}>
                <QRCodeSVG value={qrUrl} size={160} />
              </div>
              {qrStatus === 'expired' && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <Button
                    type="button"
                    onClick={() => void handleStartQr()}
                    className="shadow-lg"
                  >
                    <RefreshCw className="h-4 w-4 mr-1.5" />
                    {i18nService.t('feishuBotCreateWizardQrcodeRefresh')}
                  </Button>
                </div>
              )}
            </div>
            <p className="text-xs text-secondary max-w-[240px]">
              {qrStatus === 'expired'
                ? i18nService.t('feishuBotCreateWizardQrcodeExpired')
                : i18nService.t('feishuBotCreateWizardQrcodeDesc')}
            </p>
            {qrStatus === 'showing' && (
              <p className="text-xs text-secondary">{qrTimeLeft}s</p>
            )}
          </div>
        )}
        {qrStatus === 'success' && (
          <div className="flex items-center justify-center gap-1.5 text-xs text-green-600 dark:text-green-400 bg-green-500/10 px-3 py-2 rounded-lg">
            <CheckCircle className="h-4 w-4 flex-shrink-0" />
            {i18nService.t('feishuBotCreateWizardSuccessTitle')}
          </div>
        )}
      </div>

      {/* Divider */}
      <div className="relative flex items-center">
        <div className="flex-1 border-t border-border-subtle" />
        <span className="px-3 text-xs text-secondary whitespace-nowrap">
          {i18nService.t('feishuBotCreateWizardOrManual') || i18nService.t('or') || '或'}
        </span>
        <div className="flex-1 border-t border-border-subtle" />
      </div>

      {/* Guide */}
      <PlatformGuide
        steps={[
          i18nService.t('imFeishuGuideStep1'),
          i18nService.t('imFeishuGuideStep2'),
        ]}
        guideUrl={PlatformRegistry.guideUrl('feishu')}
      />

      {/* App ID */}
      <div className="space-y-1.5">
        <label className="block text-xs font-medium text-secondary">
          App ID<span className="text-red-500 dark:text-red-400 ml-0.5">*</span>
        </label>
        <div className="relative">
          <Input
            type="text"
            value={instance.appId}
            onChange={(e) => onConfigChange({ appId: e.target.value })}
            onBlur={() => void onSave()}
            className="pr-8"
            placeholder="cli_xxxxx"
          />
          {instance.appId && (
            <div className="absolute right-2 inset-y-0 flex items-center">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => { onConfigChange({ appId: '' }); void onSave({ appId: '' }); }}
                title={i18nService.t('clear') || 'Clear'}
              >
                <XCircle className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* App Secret */}
      <div className="space-y-1.5">
        <label className="block text-xs font-medium text-secondary">
          App Secret<span className="text-red-500 dark:text-red-400 ml-0.5">*</span>
        </label>
        <div className="relative">
          <Input
            type={showSecrets['appSecret'] ? 'text' : 'password'}
            value={instance.appSecret}
            onChange={(e) => onConfigChange({ appSecret: e.target.value })}
            onBlur={() => void onSave()}
            className="pr-16"
            placeholder="••••••••••••"
          />
          <div className="absolute right-2 inset-y-0 flex items-center gap-1">
            {instance.appSecret && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => { onConfigChange({ appSecret: '' }); void onSave({ appSecret: '' }); }}
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
              onClick={() => setShowSecrets(prev => ({ ...prev, 'appSecret': !prev['appSecret'] }))}
              title={showSecrets['appSecret'] ? (i18nService.t('hide') || 'Hide') : (i18nService.t('show') || 'Show')}
            >
              {showSecrets['appSecret'] ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </div>

      {/* Domain */}
      <div className="space-y-1.5">
        <label className="block text-xs font-medium text-secondary">
          Domain
        </label>
        <Select
          value={instance.domain}
          onValueChange={(value) => {
            const update = { domain: value as string };
            onConfigChange(update);
            void onSave(update);
          }}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="feishu">{i18nService.t('imFeishuDomainFeishu')}</SelectItem>
            <SelectItem value="lark">{i18nService.t('imFeishuDomainLark')}</SelectItem>
          </SelectContent>
        </Select>
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
                const update = { dmPolicy: value as FeishuOpenClawConfig['dmPolicy'] };
                onConfigChange(update);
                void onSave(update);
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pairing">{i18nService.t('imDmPolicyPairing')}</SelectItem>
                <SelectItem value="allowlist">{i18nService.t('imDmPolicyAllowlist')}</SelectItem>
                <SelectItem value="open">{i18nService.t('imDmPolicyOpen')}</SelectItem>
                <SelectItem value="disabled">{i18nService.t('imDmPolicyDisabled')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Pairing Requests (shown when dmPolicy is 'pairing') */}
          {instance.dmPolicy === 'pairing' && (
            <PairingSection platform="feishu" />
          )}

          {/* Allow From (User IDs) */}
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
                const update = { groupPolicy: value as FeishuOpenClawConfig['groupPolicy'] };
                onConfigChange(update);
                void onSave(update);
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="allowlist">Allowlist</SelectItem>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="disabled">Disabled</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Group Allow From */}
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-secondary">
              Group Allow From (Chat IDs)
            </label>
            <div className="flex gap-2">
              <Input
                type="text"
                value={groupAllowIdInput}
                onChange={(e) => setGroupAllowIdInput(e.target.value)}
                onKeyDown={(e) => {
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

          {/* Streaming Output Toggle */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <div>
                <label className="block text-xs font-medium text-secondary">
                  {i18nService.t('imFeishuStreaming')}
                </label>
                <p className="text-[11px] text-tertiary mt-0.5">
                  {i18nService.t('imFeishuStreamingDesc')}
                </p>
              </div>
              <Switch
                checked={instance.streaming}
                onCheckedChange={(checked) => {
                  const update = { streaming: Boolean(checked) };
                  onConfigChange(update);
                  void onSave(update);
                }}
              />
            </div>
          </div>

          {/* Footer Options (visible when streaming is enabled) */}
          {instance.streaming && (
            <div className="space-y-2 pl-3 border-l-2 border-primary/20">
              <div className="flex items-center justify-between">
                <label className="text-xs text-secondary">
                  {i18nService.t('imFeishuFooterStatus')}
                </label>
                <Switch
                  size="sm"
                  checked={instance.footer?.status ?? false}
                  onCheckedChange={(checked) => {
                    const newFooter = { ...instance.footer, status: Boolean(checked) };
                    const update = { footer: newFooter };
                    onConfigChange(update);
                    void onSave(update);
                  }}
                />
              </div>
              <div className="flex items-center justify-between">
                <label className="text-xs text-secondary">
                  {i18nService.t('imFeishuFooterElapsed')}
                </label>
                <Switch
                  size="sm"
                  checked={instance.footer?.elapsed ?? false}
                  onCheckedChange={(checked) => {
                    const newFooter = { ...instance.footer, elapsed: Boolean(checked) };
                    const update = { footer: newFooter };
                    onConfigChange(update);
                    void onSave(update);
                  }}
                />
              </div>
            </div>
          )}

          {/* Reply Mode */}
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-secondary">
              Reply Mode
            </label>
            <Select
              value={instance.replyMode}
              onValueChange={(value) => {
                const update = { replyMode: value as FeishuOpenClawConfig['replyMode'] };
                onConfigChange(update);
                void onSave(update);
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">{i18nService.t('imReplyModeAuto')}</SelectItem>
                <SelectItem value="static">{i18nService.t('imReplyModeStatic')}</SelectItem>
                <SelectItem value="streaming">{i18nService.t('imReplyModeStreaming')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Block Streaming */}
          {instance.replyMode !== 'streaming' && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <div>
                  <label className="block text-xs font-medium text-secondary">
                    {i18nService.t('imFeishuBlockStreaming')}
                  </label>
                  <p className="text-[11px] text-tertiary mt-0.5">
                    {i18nService.t('imFeishuBlockStreamingDesc')}
                  </p>
                </div>
                <Switch
                  checked={instance.blockStreaming}
                  onCheckedChange={(checked) => {
                    const update = { blockStreaming: Boolean(checked) };
                    onConfigChange(update);
                    void onSave(update);
                  }}
                />
              </div>
            </div>
          )}

          {/* History Limit */}
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-secondary">
              History Limit
            </label>
            <Input
              type="number"
              value={instance.historyLimit}
              onChange={(e) => onConfigChange({ historyLimit: parseInt(e.target.value) || 50 })}
              onBlur={() => void onSave()}
              min={1}
              max={200}
            />
          </div>

          {/* Media Max MB */}
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-secondary">
              Media Max (MB)
            </label>
            <Input
              type="number"
              value={instance.mediaMaxMb}
              onChange={(e) => onConfigChange({ mediaMaxMb: parseInt(e.target.value) || 30 })}
              onBlur={() => void onSave()}
              min={1}
              max={50}
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
          disabled={testingPlatform === 'feishu'}
        >
          <Signal className="h-3.5 w-3.5 mr-1.5" />
          {testingPlatform === 'feishu'
            ? i18nService.t('imConnectivityTesting')
            : connectivityResults['feishu' as keyof typeof connectivityResults]
              ? i18nService.t('imConnectivityRetest')
              : i18nService.t('imConnectivityTest')}
        </Button>
      </div>

      {/* Error display */}
      {instanceStatus?.error && (
        <div className="text-xs text-red-500 bg-red-500/10 px-3 py-2 rounded-lg">
          {instanceStatus.error}
        </div>
      )}
    </div>
  );
};

export default FeishuInstanceSettings;
