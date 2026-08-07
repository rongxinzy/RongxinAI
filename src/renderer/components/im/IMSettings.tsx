/**
 * IM Settings Component
 * Configuration UI for DingTalk, Feishu and Telegram IM bots
 */

import { Alert, AlertTitle } from '@shared/components/ui/alert';
import { Badge } from '@shared/components/ui/badge';
import { Button } from '@shared/components/ui/button';
import { DialogTitle } from '@shared/components/ui/dialog';
import { Input } from '@shared/components/ui/input';
import { Skeleton } from '@shared/components/ui/skeleton';
import { Spinner } from '@shared/components/ui/spinner';
import { Switch } from '@shared/components/ui/switch';
import { cn } from '@shared/lib/utils';
import type { Platform } from '@shared/platform';
import { PlatformRegistry } from '@shared/platform';
import WecomAIBotSDK from '@wecom/wecom-aibot-sdk';
import {
  CheckCircle,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Signal,
  TriangleAlert,
  X,
  XCircle,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import { i18nService } from '../../services/i18n';
import { imService } from '../../services/im';
import { RootState } from '../../store';
import {
  clearError,
  setDingTalkInstanceConfig,
  setDiscordInstanceConfig,
  setFeishuInstanceConfig,
  setQQInstanceConfig,
  setTelegramInstanceConfig,
  setWecomInstanceConfig,
  setWeixinConfig,
} from '../../store/slices/imSlice';
import type {
  IMConnectivityCheck,
  IMConnectivityTestResult,
  IMGatewayConfig,
  WeixinOpenClawConfig,
} from '../../types/im';
import {
  MAX_DINGTALK_INSTANCES,
  MAX_DISCORD_INSTANCES,
  MAX_FEISHU_INSTANCES,
  MAX_QQ_INSTANCES,
  MAX_TELEGRAM_INSTANCES,
  MAX_WECOM_INSTANCES,
} from '../../types/im';
import { getVisibleIMPlatforms } from '../../utils/regionFilter';
import Modal from '../common/Modal';
import { useGatewayReady } from '../cowork/useGatewayReady';
import DingTalkInstanceSettings from './DingTalkInstanceSettings';
import DiscordInstanceSettings from './DiscordInstanceSettings';
import FeishuInstanceSettings from './FeishuInstanceSettings';
import { IMField, IMSelectField, IMStatusAlert } from './IMFormControls';
import QQInstanceSettings from './QQInstanceSettings';
import TelegramInstanceSettings from './TelegramInstanceSettings';
import WecomInstanceSettings from './WecomInstanceSettings';

// Reusable guide card component for platform setup instructions
const PlatformGuide: React.FC<{
  title?: string;
  steps: string[];
  guideUrl?: string;
  guideLabel?: string;
}> = ({ title, steps, guideUrl, guideLabel }) => (
  <div className="mb-3 p-3 rounded-lg border border-dashed border-border-subtle">
    {title && <p className="text-xs text-foreground leading-relaxed mb-1.5 font-medium">{title}</p>}
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
        {guideLabel || i18nService.t('imViewGuide')}
      </Button>
    )}
  </div>
);

const IMSettings: React.FC = () => {
  const dispatch = useDispatch();
  const { config, status, isLoading } = useSelector((state: RootState) => state.im);
  const gatewayReady = useGatewayReady();
  const [activePlatform, setActivePlatform] = useState<Platform>('weixin');
  const [activeQQInstanceId, setActiveQQInstanceId] = useState<string | null>(null);
  const [qqExpanded, setQqExpanded] = useState(false);
  const [activeFeishuInstanceId, setActiveFeishuInstanceId] = useState<string | null>(null);
  const [feishuExpanded, setFeishuExpanded] = useState(false);
  const [activeDingTalkInstanceId, setActiveDingTalkInstanceId] = useState<string | null>(null);
  const [dingtalkExpanded, setDingtalkExpanded] = useState(false);
  const [activeWecomInstanceId, setActiveWecomInstanceId] = useState<string | null>(null);
  const [wecomExpanded, setWecomExpanded] = useState(false);
  const [activeTelegramInstanceId, setActiveTelegramInstanceId] = useState<string | null>(null);
  const [telegramExpanded, setTelegramExpanded] = useState(false);
  const [activeDiscordInstanceId, setActiveDiscordInstanceId] = useState<string | null>(null);
  const [discordExpanded, setDiscordExpanded] = useState(false);
  const [testingPlatform, setTestingPlatform] = useState<Platform | null>(null);
  const [connectivityResults, setConnectivityResults] = useState<
    Partial<Record<Platform, IMConnectivityTestResult>>
  >({});
  const [connectivityFailures, setConnectivityFailures] = useState<Partial<Record<Platform, true>>>(
    {},
  );
  const [connectivityModalPlatform, setConnectivityModalPlatform] = useState<Platform | null>(null);
  const [language, setLanguage] = useState<'zh' | 'en'>(i18nService.getLanguage());
  const [configLoaded, setConfigLoaded] = useState(false);
  // Re-entrancy guard for gateway toggle to prevent rapid ON→OFF→ON
  const [togglingPlatform, setTogglingPlatform] = useState<Platform | null>(null);
  // WeCom quick setup state
  const [wecomQuickSetupStatus, setWecomQuickSetupStatus] = useState<
    'idle' | 'pending' | 'success' | 'error'
  >('idle');
  const [wecomQuickSetupError, setWecomQuickSetupError] = useState<string>('');
  // Weixin QR login state
  const [weixinQrStatus, setWeixinQrStatus] = useState<
    'idle' | 'loading' | 'showing' | 'waiting' | 'success' | 'expired' | 'error'
  >('idle');
  const [weixinQrUrl, setWeixinQrUrl] = useState<string>('');
  const [weixinQrError, setWeixinQrError] = useState<string>('');
  const [weixinAllowFromInput, setWeixinAllowFromInput] = useState<string>('');
  const weixinTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);

  // Subscribe to language changes
  useEffect(() => {
    const unsubscribe = i18nService.subscribe(() => {
      setLanguage(i18nService.getLanguage());
    });
    return unsubscribe;
  }, []);

  // Track component mounted state for async operations
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Auto-run connectivity tests for all enabled platforms on mount
  useEffect(() => {
    if (!configLoaded) return;

    const imPlatforms: Platform[] = [
      'weixin',
      'dingtalk',
      'qq',
      'feishu',
      'wecom',
      'telegram',
      'discord',
    ];
    const enabledPlatforms = imPlatforms.filter(platform => isPlatformEnabled(platform));
    if (enabledPlatforms.length === 0) return;

    let cancelled = false;
    const runTests = async () => {
      for (const platform of enabledPlatforms) {
        if (cancelled) return;
        try {
          const result = await runConnectivityTest(platform, config);
          if (!cancelled && result) {
            setConnectivityResults(prev => ({ ...prev, [platform]: result }));
          }
        } catch {
          // Ignore individual probe failures during auto-test.
        }
      }
    };
    runTests();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configLoaded]);

  // Cleanup feishu QR timers on unmount
  useEffect(() => {
    return () => {
      if (feishuQrPollTimerRef.current) clearInterval(feishuQrPollTimerRef.current);
      if (feishuQrCountdownTimerRef.current) clearInterval(feishuQrCountdownTimerRef.current);
    };
  }, []);

  // Reset feishu QR state when switching away from feishu
  useEffect(() => {
    if (activePlatform !== 'feishu') {
      if (feishuQrPollTimerRef.current) {
        clearInterval(feishuQrPollTimerRef.current);
        feishuQrPollTimerRef.current = null;
      }
      if (feishuQrCountdownTimerRef.current) {
        clearInterval(feishuQrCountdownTimerRef.current);
        feishuQrCountdownTimerRef.current = null;
      }
      setFeishuQrStatus('idle');
      setFeishuQrUrl('');
      setFeishuQrError('');
    }
  }, [activePlatform]);

  // @ts-ignore: will be used when QR flow is wired to FeishuInstanceSettings
  const _handleFeishuStartQr = async () => {
    if (feishuQrPollTimerRef.current) clearInterval(feishuQrPollTimerRef.current);
    if (feishuQrCountdownTimerRef.current) clearInterval(feishuQrCountdownTimerRef.current);
    setFeishuQrStatus('loading');
    setFeishuQrError('');
    try {
      const result = await window.electron.feishu.install.qrcode(false);
      if (!isMountedRef.current) return;
      setFeishuQrUrl(result.url);
      feishuQrDeviceCodeRef.current = result.deviceCode;
      const expireIn = result.expireIn ?? 300;
      setFeishuQrTimeLeft(expireIn);
      setFeishuQrStatus('showing');

      // Countdown
      feishuQrCountdownTimerRef.current = setInterval(() => {
        setFeishuQrTimeLeft(prev => {
          if (prev <= 1) {
            clearInterval(feishuQrCountdownTimerRef.current!);
            feishuQrCountdownTimerRef.current = null;
            if (feishuQrPollTimerRef.current) {
              clearInterval(feishuQrPollTimerRef.current);
              feishuQrPollTimerRef.current = null;
            }
            setFeishuQrStatus('error');
            setFeishuQrError(i18nService.t('feishuBotCreateWizardQrcodeExpired'));
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      // Poll
      const intervalMs = Math.max(result.interval ?? 5, 3) * 1000;
      feishuQrPollTimerRef.current = setInterval(async () => {
        try {
          const pollResult = await window.electron.feishu.install.poll(
            feishuQrDeviceCodeRef.current,
          );
          if (!isMountedRef.current) return;
          if (pollResult.done && pollResult.appId && pollResult.appSecret) {
            clearInterval(feishuQrPollTimerRef.current!);
            feishuQrPollTimerRef.current = null;
            clearInterval(feishuQrCountdownTimerRef.current!);
            feishuQrCountdownTimerRef.current = null;
            // QR flow creates a new instance with the scanned credentials
            const inst = await imService.addFeishuInstance('Feishu Bot');
            if (inst) {
              await imService.updateFeishuInstanceConfig(inst.instanceId, {
                appId: pollResult.appId,
                appSecret: pollResult.appSecret,
                enabled: true,
              });
              setActiveFeishuInstanceId(inst.instanceId);
              setFeishuExpanded(true);
            }
            if (!isMountedRef.current) return; // re-check after async updateConfig
            setFeishuQrStatus('success');
          } else if (
            pollResult.error &&
            pollResult.error !== 'authorization_pending' &&
            pollResult.error !== 'slow_down'
          ) {
            clearInterval(feishuQrPollTimerRef.current!);
            feishuQrPollTimerRef.current = null;
            clearInterval(feishuQrCountdownTimerRef.current!);
            feishuQrCountdownTimerRef.current = null;
            setFeishuQrStatus('error');
            setFeishuQrError(pollResult.error);
          }
        } catch {
          /* keep retrying */
        }
      }, intervalMs);
    } catch (err: any) {
      if (!isMountedRef.current) return;
      setFeishuQrStatus('error');
      setFeishuQrError(err?.message || i18nService.t('imQrGenerationFailed'));
    }
  };

  // Reset wecom quick setup state when switching away from wecom
  useEffect(() => {
    if (activePlatform !== 'wecom') {
      setWecomQuickSetupStatus('idle');
      setWecomQuickSetupError('');
    }
  }, [activePlatform]);

  // Reset weixin QR login state when switching away from weixin
  useEffect(() => {
    if (activePlatform !== 'weixin') {
      if (weixinTimerRef.current) {
        clearTimeout(weixinTimerRef.current);
        weixinTimerRef.current = null;
      }
      setWeixinQrStatus('idle');
      setWeixinQrUrl('');
      setWeixinQrError('');
    }
  }, [activePlatform]);

  // Initialize IM service and subscribe status updates
  useEffect(() => {
    let cancelled = false;
    void imService.init().then(() => {
      if (!cancelled) {
        setConfigLoaded(true);
      }
    });
    return () => {
      cancelled = true;
      setConfigLoaded(false);
      imService.destroy();
    };
  }, []);
  // Handle DingTalk multi-instance config
  const dingtalkMultiConfig = config.dingtalk;

  // Handle Feishu multi-instance config
  const feishuMultiConfig = config.feishu;

  // Inline QR code state for feishu bot creation (mirroring WeCom quick-setup pattern)
  // These are used by handleFeishuStartQr which creates instances via QR flow
  // @ts-ignore: will be used when QR flow is wired to FeishuInstanceSettings
  const [_feishuQrStatus, setFeishuQrStatus] = useState<
    'idle' | 'loading' | 'showing' | 'success' | 'error'
  >('idle');
  // @ts-ignore
  const [_feishuQrUrl, setFeishuQrUrl] = useState<string>('');
  // @ts-ignore
  const [_feishuQrTimeLeft, setFeishuQrTimeLeft] = useState<number>(0);
  // @ts-ignore
  const [_feishuQrError, setFeishuQrError] = useState<string>('');
  // These don't need to be state — they don't affect rendering directly
  const feishuQrDeviceCodeRef = useRef<string>('');
  const feishuQrPollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const feishuQrCountdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Pairing state for OpenClaw platforms
  const [pairingCodeInput, setPairingCodeInput] = useState<Record<string, string>>({});
  const [pairingStatus, setPairingStatus] = useState<
    Record<string, { type: 'success' | 'error'; message: string } | null>
  >({});

  const handleApprovePairing = async (platform: string, code: string) => {
    setPairingStatus(prev => ({ ...prev, [platform]: null }));
    const result = await imService.approvePairingCode(platform, code);
    if (result.success) {
      setPairingStatus(prev => ({
        ...prev,
        [platform]: {
          type: 'success',
          message: i18nService.t('imPairingCodeApproved').replace('{code}', code),
        },
      }));
    } else {
      setPairingStatus(prev => ({
        ...prev,
        [platform]: {
          type: 'error',
          message: result.error || i18nService.t('imPairingCodeInvalid'),
        },
      }));
    }
  };
  // Telegram multi-instance config alias
  const tgMultiConfig = config.telegram;

  const qqMultiConfig = config.qq;

  const discordMultiConfig = config.discord;

  // Handle Weixin OpenClaw config
  const weixinOpenClawConfig = config.weixin;

  const handleWeixinQrLogin = async () => {
    setWeixinQrStatus('loading');
    setWeixinQrError('');
    try {
      const startResult = await window.electron.im.weixinQrLoginStart();
      if (!isMountedRef.current) return;

      if (!startResult.success || !startResult.qrDataUrl) {
        setWeixinQrStatus('error');
        setWeixinQrError(startResult.message || i18nService.t('imWeixinQrFailed'));
        return;
      }

      setWeixinQrUrl(startResult.qrDataUrl);
      setWeixinQrStatus('showing');

      // QR expires in 1 minute.  Keep the QR visible but show a reconnect
      // overlay — don't tear down the display or show a red error.
      if (weixinTimerRef.current) clearTimeout(weixinTimerRef.current);
      weixinTimerRef.current = setTimeout(() => {
        if (!isMountedRef.current) return;
        setWeixinQrStatus('expired');
      }, 60_000);

      // Start polling for scan result
      setWeixinQrStatus('waiting');
      const waitResult = await window.electron.im.weixinQrLoginWait(startResult.sessionKey);
      if (weixinTimerRef.current) {
        clearTimeout(weixinTimerRef.current);
        weixinTimerRef.current = null;
      }
      if (!isMountedRef.current) return;

      if (waitResult.success && waitResult.connected) {
        setWeixinQrStatus('success');
        // Enable weixin and save config with accountId
        const accountId = waitResult.accountId || '';
        const fullConfig = { ...weixinOpenClawConfig, enabled: true, accountId };
        dispatch(setWeixinConfig({ enabled: true, accountId }));
        dispatch(clearError());
        await imService.updateConfig({ weixin: fullConfig });
        await imService.loadStatus();
      } else {
        // Not connected — keep QR visible with reconnect overlay.
        setWeixinQrStatus('expired');
      }
    } catch {
      if (weixinTimerRef.current) {
        clearTimeout(weixinTimerRef.current);
        weixinTimerRef.current = null;
      }
      if (!isMountedRef.current) return;
      setWeixinQrStatus('expired');
    }
  };

  const getCheckTitle = (code: IMConnectivityCheck['code']): string => {
    return i18nService.t(`imConnectivityCheckTitle_${code}`);
  };

  const formatTestTime = (timestamp: number): string => {
    try {
      return new Date(timestamp).toLocaleString();
    } catch {
      return String(timestamp);
    }
  };

  const runConnectivityTest = async (
    platform: Platform,
    configOverride?: Partial<IMGatewayConfig>,
  ): Promise<IMConnectivityTestResult | null> => {
    setConnectivityResults(prev => {
      const { [platform]: _, ...remaining } = prev;
      return remaining;
    });
    setConnectivityFailures(prev => {
      const { [platform]: _, ...remaining } = prev;
      return remaining;
    });

    try {
    const result = await imService.testGateway(platform, configOverride);
    if (result) {
      setConnectivityResults(prev => ({ ...prev, [platform]: result }));
      } else {
        setConnectivityFailures(prev => ({ ...prev, [platform]: true }));
    }
    return result;
    } catch {
      setConnectivityFailures(prev => ({ ...prev, [platform]: true }));
      return null;
    }
  };

  // Toggle gateway on/off and persist enabled state
  const toggleGateway = async (platform: Platform) => {
    // Re-entrancy guard: if a toggle is already in progress for this platform, bail out.
    // This prevents rapid ON→OFF→ON clicks from causing concurrent native SDK init/uninit.
    if (togglingPlatform === platform) return;
    setTogglingPlatform(platform);

    try {
      // All OpenClaw platforms: im:config:set handler already calls
      // syncOpenClawConfig({ restartGatewayIfRunning: true }), so no startGateway/stopGateway needed.
      // Only updateConfig + loadStatus is required.
      // Pessimistic UI update: wait for IPC to complete before updating Redux state.
      // This prevents UI/backend state divergence when rapidly toggling, since the
      // backend debounces syncOpenClawConfig calls with a 600ms window.
      if (platform === 'telegram') {
        // Telegram multi-instance: toggle is handled per-instance in TelegramInstanceSettings
        return;
      }

      if (platform === 'dingtalk') {
        // DingTalk multi-instance: toggle is handled per-instance in DingTalkInstanceSettings
        return;
      }

      if (platform === 'feishu') {
        // Feishu multi-instance: toggle is handled per-instance in FeishuInstanceSettings
        return;
      }

      if (platform === 'discord') {
        // Discord multi-instance: toggle is handled per-instance in DiscordInstanceSettings
        return;
      }

      if (platform === 'qq' || platform === 'wecom') {
        // Multi-instance platforms toggle per instance in their detail panels
        return;
      }

      if (platform === 'weixin') {
        const newEnabled = !weixinOpenClawConfig.enabled;
        const success = await imService.updateConfig({
          weixin: { ...weixinOpenClawConfig, enabled: newEnabled },
        });
        if (success) {
          dispatch(setWeixinConfig({ enabled: newEnabled }));
          if (newEnabled) dispatch(clearError());
          await imService.loadStatus();
        }
        return;
      }
    } finally {
      setTogglingPlatform(null);
    }
  };

  const dingtalkConnected = status.dingtalk?.instances?.some(i => i.connected) ?? false;
  const feishuConnected = status.feishu?.instances?.some(i => i.connected) ?? false;
  const telegramConnected = status.telegram?.instances?.some(i => i.connected) ?? false;
  const discordConnected = status.discord?.instances?.some(i => i.connected) ?? false;
  const qqConnected = status.qq?.instances?.some(i => i.connected) ?? false;
  const wecomConnected = status.wecom?.instances?.some(i => i.connected) ?? false;
  const weixinConnected = status.weixin?.connected ?? false;
  // Compute visible platforms based on language
  const platforms = useMemo<Platform[]>(() => {
    return getVisibleIMPlatforms(language) as Platform[];
  }, [language]);

  // Ensure activePlatform is always in visible platforms when language changes
  useEffect(() => {
    if (platforms.length > 0 && !platforms.includes(activePlatform)) {
      // If current activePlatform is not visible, switch to first visible platform
      setActivePlatform(platforms[0]);
    }
  }, [platforms, activePlatform]);

  // Check if platform can be started
  const canStart = (platform: Platform): boolean => {
    if (platform === 'dingtalk') {
      return config.dingtalk.instances.some(i => !!(i.clientId && i.clientSecret));
    }
    if (platform === 'telegram') {
      return config.telegram.instances.some(i => !!i.botToken);
    }
    if (platform === 'discord') {
      return config.discord.instances.some(i => !!i.botToken);
    }
    if (platform === 'qq') {
      return config.qq.instances.some(i => !!(i.appId && i.appSecret));
    }
    if (platform === 'wecom') {
      return config.wecom.instances.some(i => !!(i.botId && i.secret));
    }
    if (platform === 'weixin') {
      return true; // No credentials needed, connects via QR code in CLI
    }
    return config.feishu.instances?.some(i => !!(i.appId && i.appSecret));
  };

  // Get platform enabled state (persisted toggle state)
  const isPlatformEnabled = (platform: Platform): boolean => {
    if (platform === 'dingtalk') {
      return config.dingtalk.instances?.some(i => i.enabled);
    }
    if (platform === 'qq') {
      return config.qq.instances.some(i => i.enabled);
    }
    if (platform === 'feishu') {
      return config.feishu.instances?.some(i => i.enabled);
    }
    if (platform === 'wecom') {
      return config.wecom.instances?.some(i => i.enabled);
    }
    if (platform === 'telegram') {
      return config.telegram.instances?.some(i => i.enabled);
    }
    if (platform === 'discord') {
      return config.discord.instances?.some(i => i.enabled);
    }
    return (config[platform] as { enabled: boolean }).enabled;
  };

  // Get platform connection status (runtime state)
  const getPlatformConnected = (platform: Platform): boolean => {
    if (platform === 'dingtalk') return dingtalkConnected;
    if (platform === 'telegram') return telegramConnected;
    if (platform === 'discord') return discordConnected;
    if (platform === 'qq') return qqConnected;
    if (platform === 'wecom') return wecomConnected;
    if (platform === 'weixin') return weixinConnected;
    return feishuConnected;
  };

  // Get platform transient starting status
  const getPlatformStarting = (platform: Platform): boolean => {
    if (platform === 'discord') return status.discord.instances?.[0]?.starting ?? false;
    return false;
  };

  const handleConnectivityTest = async (platform: Platform) => {
    // Re-entrancy guard: if a test is already running, do nothing.
    if (testingPlatform) return;

    setConnectivityModalPlatform(platform);
    setTestingPlatform(platform);

    try {
    // For Telegram, persist telegram config and test (multi-instance)
    if (platform === 'telegram') {
      await imService.persistConfig({ telegram: tgMultiConfig });
      const result = await runConnectivityTest(platform, {
        telegram: tgMultiConfig,
      } as Partial<IMGatewayConfig>);
      // Auto-enable: if the active instance is OFF and auth_check passed, turn on automatically
      if (activeTelegramInstanceId && result) {
        const inst = tgMultiConfig.instances.find(i => i.instanceId === activeTelegramInstanceId);
        if (inst && !inst.enabled) {
          const authCheck = result.checks.find(c => c.code === 'auth_check');
          if (authCheck && authCheck.level === 'pass') {
            dispatch(
              setTelegramInstanceConfig({
                instanceId: activeTelegramInstanceId,
                config: { enabled: true },
              }),
            );
            await imService.updateTelegramInstanceConfig(activeTelegramInstanceId, {
              enabled: true,
            });
          }
        }
      }
      return;
    }

    // For DingTalk, persist dingtalk config and test (OpenClaw mode)
    if (platform === 'dingtalk') {
      await imService.persistConfig({ dingtalk: dingtalkMultiConfig });
      const result = await runConnectivityTest(platform, {
        dingtalk: dingtalkMultiConfig,
      } as Partial<IMGatewayConfig>);
      // Auto-enable: if the active instance is OFF and auth_check passed, turn on automatically
      if (activeDingTalkInstanceId && result) {
        const inst = dingtalkMultiConfig.instances.find(
          i => i.instanceId === activeDingTalkInstanceId,
        );
        if (inst && !inst.enabled) {
          const authCheck = result.checks.find(c => c.code === 'auth_check');
          if (authCheck && authCheck.level === 'pass') {
            dispatch(
              setDingTalkInstanceConfig({
                instanceId: activeDingTalkInstanceId,
                config: { enabled: true },
              }),
            );
            await imService.updateDingTalkInstanceConfig(activeDingTalkInstanceId, {
              enabled: true,
            });
          }
        }
      }
      return;
    }

    // For QQ, persist qq config and test (OpenClaw mode)
    if (platform === 'qq') {
      await imService.persistConfig({ qq: qqMultiConfig });
      const result = await runConnectivityTest(platform, {
        qq: qqMultiConfig,
      } as Partial<IMGatewayConfig>);
      // Auto-enable: if the active instance is OFF and auth_check passed, turn on automatically
      if (activeQQInstanceId && result) {
        const inst = qqMultiConfig.instances.find(i => i.instanceId === activeQQInstanceId);
        if (inst && !inst.enabled) {
          const authCheck = result.checks.find(c => c.code === 'auth_check');
          if (authCheck && authCheck.level === 'pass') {
            dispatch(
              setQQInstanceConfig({ instanceId: activeQQInstanceId, config: { enabled: true } }),
            );
            await imService.updateQQInstanceConfig(activeQQInstanceId, { enabled: true });
          }
        }
      }
      return;
    }

    // For WeCom, persist wecom config and test (OpenClaw mode)
    if (platform === 'wecom') {
      const wecomMultiConfig = config.wecom;
      await imService.persistConfig({ wecom: wecomMultiConfig });
      const result = await runConnectivityTest(platform, {
        wecom: wecomMultiConfig,
      } as Partial<IMGatewayConfig>);
      // Auto-enable: if the active instance is OFF and auth_check passed, turn on automatically
      if (activeWecomInstanceId && result) {
        const inst = wecomMultiConfig.instances.find(i => i.instanceId === activeWecomInstanceId);
        if (inst && !inst.enabled) {
          const authCheck = result.checks.find(c => c.code === 'auth_check');
          if (authCheck && authCheck.level === 'pass') {
            dispatch(
              setWecomInstanceConfig({
                instanceId: activeWecomInstanceId,
                config: { enabled: true },
              }),
            );
            await imService.updateWecomInstanceConfig(activeWecomInstanceId, { enabled: true });
          }
        }
      }
      return;
    }

    // For Weixin, persist weixin config and test (OpenClaw mode)
    if (platform === 'weixin') {
      await imService.persistConfig({ weixin: weixinOpenClawConfig });
      const result = await runConnectivityTest(platform, {
        weixin: weixinOpenClawConfig,
      } as Partial<IMGatewayConfig>);
      if (!weixinOpenClawConfig.enabled && result) {
        const authCheck = result.checks.find(c => c.code === 'auth_check');
        if (authCheck && authCheck.level === 'pass') {
          toggleGateway(platform);
        }
      }
      return;
    }

    // For Feishu, persist feishu config and test (OpenClaw mode)
    if (platform === 'feishu') {
      await imService.persistConfig({ feishu: feishuMultiConfig });
      const result = await runConnectivityTest(platform, {
        feishu: feishuMultiConfig,
      } as Partial<IMGatewayConfig>);
      // Auto-enable: if the active instance is OFF and auth_check passed, turn on automatically
      if (activeFeishuInstanceId && result) {
          const inst = feishuMultiConfig.instances.find(
            i => i.instanceId === activeFeishuInstanceId,
          );
        if (inst && !inst.enabled) {
          const authCheck = result.checks.find(c => c.code === 'auth_check');
          if (authCheck && authCheck.level === 'pass') {
            dispatch(
              setFeishuInstanceConfig({
                instanceId: activeFeishuInstanceId,
                config: { enabled: true },
              }),
            );
            await imService.updateFeishuInstanceConfig(activeFeishuInstanceId, { enabled: true });
          }
        }
      }
      return;
    }
    // For Discord, persist discord config and test (OpenClaw mode)
    if (platform === 'discord') {
      await imService.persistConfig({ discord: discordMultiConfig });
      const result = await runConnectivityTest(platform, {
        discord: discordMultiConfig,
      } as Partial<IMGatewayConfig>);
      if (activeDiscordInstanceId && result) {
        const inst = discordMultiConfig.instances.find(
          i => i.instanceId === activeDiscordInstanceId,
        );
        if (inst && !inst.enabled) {
          const authCheck = result.checks.find(c => c.code === 'auth_check');
          if (authCheck && authCheck.level === 'pass') {
            dispatch(
              setDiscordInstanceConfig({
                instanceId: activeDiscordInstanceId,
                config: { enabled: true },
              }),
            );
              await imService.updateDiscordInstanceConfig(activeDiscordInstanceId, {
                enabled: true,
              });
          }
        }
      }
      return;
    }

    // 1. Persist latest config to backend (without changing enabled state)
    await imService.persistConfig({
      [platform]: config[platform],
    } as Partial<IMGatewayConfig>);

    const isEnabled = isPlatformEnabled(platform);

    // Run connectivity test (always passes configOverride so the backend uses
    // the latest unsaved credential values from the form).
    const result = await runConnectivityTest(platform, {
      [platform]: config[platform],
    } as Partial<IMGatewayConfig>);

    // Auto-enable: if the platform was OFF but auth_check passed, start it automatically.
    if (!isEnabled && result) {
      const authCheck = result.checks.find(c => c.code === 'auth_check');
      if (authCheck && authCheck.level === 'pass') {
        toggleGateway(platform);
      }
    }
    } catch {
      setConnectivityResults(prev => {
        const { [platform]: _, ...remaining } = prev;
        return remaining;
      });
      setConnectivityFailures(prev => ({ ...prev, [platform]: true }));
    } finally {
      setTestingPlatform(null);
    }
  };

  // Handle platform toggle
  const handlePlatformToggle = (platform: Platform) => {
    // Block toggle if a toggle is already in progress for any platform
    if (togglingPlatform) return;
    const isEnabled = isPlatformEnabled(platform);
    // Can toggle ON if credentials are present, can always toggle OFF
    const canToggle = isEnabled || canStart(platform);
    if (canToggle && !isLoading && gatewayReady) {
      setActivePlatform(platform);
      toggleGateway(platform);
    }
  };

  // Toggle gateway on/off - map platform to Redux action
  const renderConnectivityTestButton = (platform: Platform) => (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => handleConnectivityTest(platform)}
      disabled={!gatewayReady || isLoading || testingPlatform === platform}
    >
      {testingPlatform === platform ? (
        <Spinner data-icon="inline-start" />
      ) : (
      <Signal data-icon="inline-start" />
      )}
      {testingPlatform === platform
        ? i18nService.t('imConnectivityTesting')
        : connectivityResults[platform]
          ? i18nService.t('imConnectivityRetest')
          : i18nService.t('imConnectivityTest')}
    </Button>
  );

  useEffect(() => {
    if (!connectivityModalPlatform) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setConnectivityModalPlatform(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [connectivityModalPlatform]);

  const renderPairingSection = (platform: string) => (
    <IMField id={`${platform}-pairing-code`} label={i18nService.t('imPairingApproval')}>
      <div className="flex gap-2">
        <Input
          id={`${platform}-pairing-code`}
          type="text"
          value={pairingCodeInput[platform] || ''}
          onChange={e => {
            setPairingCodeInput(prev => ({ ...prev, [platform]: e.target.value.toUpperCase() }));
            if (pairingStatus[platform]) setPairingStatus(prev => ({ ...prev, [platform]: null }));
          }}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              const code = (pairingCodeInput[platform] || '').trim();
              if (code) {
                void handleApprovePairing(platform, code).then(() => {
                  setPairingCodeInput(prev => ({ ...prev, [platform]: '' }));
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
            const code = (pairingCodeInput[platform] || '').trim();
            if (code) {
              void handleApprovePairing(platform, code).then(() => {
                setPairingCodeInput(prev => ({ ...prev, [platform]: '' }));
              });
            }
          }}
        >
          {i18nService.t('imPairingApprove')}
        </Button>
      </div>
      {pairingStatus[platform] && (
        <IMStatusAlert error={pairingStatus[platform]!.type === 'error'}>
          {pairingStatus[platform]!.message}
        </IMStatusAlert>
      )}
    </IMField>
  );

  if (!configLoaded) {
    return (
      <div
        className="flex h-full min-h-0 gap-4"
        aria-label={i18nService.t('imLoadingBots')}
        aria-busy="true"
      >
        <div className="flex w-48 shrink-0 flex-col gap-2 border-r border-border pr-3">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
        <div className="flex flex-1 flex-col gap-4 px-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-32" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full gap-4">
      {/* Platform List - Left Side */}
      <div className="w-48 shrink-0 border-r border-border pr-3 flex flex-col gap-2 overflow-y-auto">
        {platforms.map(platform => {
          const logo = PlatformRegistry.logo(platform);
          const isEnabled = isPlatformEnabled(platform);
          const canToggle = isEnabled || canStart(platform);

          if (platform === 'dingtalk') {
            return (
              <div key="dingtalk">
                {/* DingTalk Platform Header - clickable to expand/collapse */}
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setActivePlatform('dingtalk');
                    setActiveDingTalkInstanceId(null);
                    setDingtalkExpanded(!dingtalkExpanded);
                  }}
                  className={cn(
                    'h-auto w-full justify-start rounded-lg border p-2 transition-colors',
                    activePlatform === 'dingtalk'
                      ? 'border-primary bg-primary-muted shadow-subtle'
                      : 'border-transparent bg-surface hover:bg-surface-raised',
                  )}
                >
                  <div className="flex flex-1 items-center">
                    <div className="mr-2 flex size-7 items-center justify-center">
                      <img
                        src={PlatformRegistry.logo('dingtalk')}
                        alt="DingTalk"
                        className="size-6 object-contain rounded-md"
                      />
                    </div>
                    <span className="truncate text-sm font-medium">
                      {i18nService.t('dingtalk')}
                    </span>
                  </div>
                  {dingtalkExpanded ? (
                    <ChevronDown data-icon="inline-end" />
                  ) : (
                    <ChevronRight data-icon="inline-end" />
                  )}
                </Button>
                {/* DingTalk Instance Sub-items */}
                {dingtalkExpanded && (
                  <div className="ml-5 mt-1 flex flex-col gap-1">
                    {config.dingtalk.instances.map(inst => {
                      const instStatus = status.dingtalk?.instances?.find(
                        s => s.instanceId === inst.instanceId,
                      );
                      const isSelected =
                        activePlatform === 'dingtalk' &&
                        activeDingTalkInstanceId === inst.instanceId;
                      const dotColor = !inst.enabled
                        ? 'bg-muted-foreground'
                        : instStatus?.connected
                          ? 'bg-success'
                          : 'bg-warning';
                      return (
                        <Button
                          type="button"
                          variant="ghost"
                          key={inst.instanceId}
                          onClick={() => {
                            setActivePlatform('dingtalk');
                            setActiveDingTalkInstanceId(inst.instanceId);
                          }}
                          className={cn(
                            'h-auto w-full justify-start rounded-lg p-1.5 pl-2 text-sm transition-colors',
                            isSelected ? 'bg-primary/10' : 'hover:bg-surface-raised',
                          )}
                        >
                          <span className={cn('mr-2 size-2 shrink-0 rounded-full', dotColor)} />
                          <span className="flex-1 truncate">{inst.instanceName}</span>
                        </Button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          }

          if (platform === 'feishu') {
            return (
              <div key="feishu">
                {/* Feishu Platform Header - clickable to expand/collapse */}
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setActivePlatform('feishu');
                    setActiveFeishuInstanceId(null);
                    setFeishuExpanded(!feishuExpanded);
                  }}
                  className={cn(
                    'h-auto w-full justify-start rounded-lg border p-2 transition-colors',
                    activePlatform === 'feishu'
                      ? 'border-primary bg-primary-muted shadow-subtle'
                      : 'border-transparent bg-surface hover:bg-surface-raised',
                  )}
                >
                  <div className="flex flex-1 items-center">
                    <div className="mr-2 flex size-7 items-center justify-center">
                      <img
                        src={PlatformRegistry.logo('feishu')}
                        alt="Feishu"
                        className="size-6 object-contain rounded-md"
                      />
                    </div>
                    <span className="truncate text-sm font-medium">{i18nService.t('feishu')}</span>
                  </div>
                  {feishuExpanded ? (
                    <ChevronDown data-icon="inline-end" />
                  ) : (
                    <ChevronRight data-icon="inline-end" />
                  )}
                </Button>
                {/* Feishu Instance Sub-items */}
                {feishuExpanded && (
                  <div className="ml-5 mt-1 flex flex-col gap-1">
                    {config.feishu.instances.map(inst => {
                      const instStatus = status.feishu?.instances?.find(
                        s => s.instanceId === inst.instanceId,
                      );
                      const isSelected =
                        activePlatform === 'feishu' && activeFeishuInstanceId === inst.instanceId;
                      const dotColor = !inst.enabled
                        ? 'bg-muted-foreground'
                        : instStatus?.connected
                          ? 'bg-success'
                          : 'bg-warning';
                      return (
                        <Button
                          type="button"
                          variant="ghost"
                          key={inst.instanceId}
                          onClick={() => {
                            setActivePlatform('feishu');
                            setActiveFeishuInstanceId(inst.instanceId);
                          }}
                          className={cn(
                            'h-auto w-full justify-start rounded-lg p-1.5 pl-2 text-sm transition-colors',
                            isSelected ? 'bg-primary/10' : 'hover:bg-surface-raised',
                          )}
                        >
                          <span className={cn('mr-2 size-2 shrink-0 rounded-full', dotColor)} />
                          <span className="flex-1 truncate">{inst.instanceName}</span>
                        </Button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          }

          if (platform === 'qq') {
            return (
              <div key="qq">
                {/* QQ Platform Header - clickable to expand/collapse */}
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setActivePlatform('qq');
                    setActiveQQInstanceId(null);
                    setQqExpanded(!qqExpanded);
                  }}
                  className={cn(
                    'h-auto w-full justify-start rounded-lg border p-2 transition-colors',
                    activePlatform === 'qq'
                      ? 'border-primary bg-primary-muted shadow-subtle'
                      : 'border-transparent bg-surface hover:bg-surface-raised',
                  )}
                >
                  <div className="flex flex-1 items-center">
                    <div className="mr-2 flex size-7 items-center justify-center">
                      <img
                        src={PlatformRegistry.logo('qq')}
                        alt="QQ"
                        className="size-6 object-contain rounded-md"
                      />
                    </div>
                    <span className="truncate text-sm font-medium">{i18nService.t('qq')}</span>
                  </div>
                  {qqExpanded ? (
                    <ChevronDown data-icon="inline-end" />
                  ) : (
                    <ChevronRight data-icon="inline-end" />
                  )}
                </Button>
                {/* QQ Instance Sub-items */}
                {qqExpanded && (
                  <div className="ml-5 mt-1 flex flex-col gap-1">
                    {config.qq.instances.map(inst => {
                      const instStatus = status.qq?.instances?.find(
                        s => s.instanceId === inst.instanceId,
                      );
                      const isSelected =
                        activePlatform === 'qq' && activeQQInstanceId === inst.instanceId;
                      const dotColor = !inst.enabled
                        ? 'bg-muted-foreground'
                        : instStatus?.connected
                          ? 'bg-success'
                          : 'bg-warning';
                      return (
                        <Button
                          type="button"
                          variant="ghost"
                          key={inst.instanceId}
                          onClick={() => {
                            setActivePlatform('qq');
                            setActiveQQInstanceId(inst.instanceId);
                          }}
                          className={cn(
                            'h-auto w-full justify-start rounded-lg p-1.5 pl-2 text-sm transition-colors',
                            isSelected ? 'bg-primary/10' : 'hover:bg-surface-raised',
                          )}
                        >
                          <span className={cn('mr-2 size-2 shrink-0 rounded-full', dotColor)} />
                          <span className="flex-1 truncate">{inst.instanceName}</span>
                        </Button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          }

          if (platform === 'wecom') {
            return (
              <div key="wecom">
                {/* WeCom Platform Header - clickable to expand/collapse */}
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setActivePlatform('wecom');
                    setActiveWecomInstanceId(null);
                    setWecomExpanded(!wecomExpanded);
                  }}
                  className={cn(
                    'h-auto w-full justify-start rounded-lg border p-2 transition-colors',
                    activePlatform === 'wecom'
                      ? 'border-primary bg-primary-muted shadow-subtle'
                      : 'border-transparent bg-surface hover:bg-surface-raised',
                  )}
                >
                  <div className="flex flex-1 items-center">
                    <div className="mr-2 flex size-7 items-center justify-center">
                      <img
                        src={PlatformRegistry.logo('wecom')}
                        alt="WeCom"
                        className="size-6 object-contain rounded-md"
                      />
                    </div>
                    <span className="truncate text-sm font-medium">{i18nService.t('wecom')}</span>
                  </div>
                  {wecomExpanded ? (
                    <ChevronDown data-icon="inline-end" />
                  ) : (
                    <ChevronRight data-icon="inline-end" />
                  )}
                </Button>
                {/* WeCom Instance Sub-items */}
                {wecomExpanded && (
                  <div className="ml-5 mt-1 flex flex-col gap-1">
                    {config.wecom.instances.map(inst => {
                      const instStatus = status.wecom?.instances?.find(
                        s => s.instanceId === inst.instanceId,
                      );
                      const isSelected =
                        activePlatform === 'wecom' && activeWecomInstanceId === inst.instanceId;
                      const dotColor = !inst.enabled
                        ? 'bg-muted-foreground'
                        : instStatus?.connected
                          ? 'bg-success'
                          : 'bg-warning';
                      return (
                        <Button
                          type="button"
                          variant="ghost"
                          key={inst.instanceId}
                          onClick={() => {
                            setActivePlatform('wecom');
                            setActiveWecomInstanceId(inst.instanceId);
                          }}
                          className={cn(
                            'h-auto w-full justify-start rounded-lg p-1.5 pl-2 text-sm transition-colors',
                            isSelected ? 'bg-primary/10' : 'hover:bg-surface-raised',
                          )}
                        >
                          <span className={cn('mr-2 size-2 shrink-0 rounded-full', dotColor)} />
                          <span className="flex-1 truncate">{inst.instanceName}</span>
                        </Button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          }

          if (platform === 'telegram') {
            return (
              <div key="telegram">
                {/* Telegram Platform Header - clickable to expand/collapse */}
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setActivePlatform('telegram');
                    setActiveTelegramInstanceId(null);
                    setTelegramExpanded(!telegramExpanded);
                  }}
                  className={cn(
                    'h-auto w-full justify-start rounded-lg border p-2 transition-colors',
                    activePlatform === 'telegram'
                      ? 'border-primary bg-primary-muted shadow-subtle'
                      : 'border-transparent bg-surface hover:bg-surface-raised',
                  )}
                >
                  <div className="flex flex-1 items-center">
                    <div className="mr-2 flex size-7 items-center justify-center">
                      <img
                        src={PlatformRegistry.logo('telegram')}
                        alt="Telegram"
                        className="size-6 object-contain rounded-md"
                      />
                    </div>
                    <span className="truncate text-sm font-medium">
                      {i18nService.t('telegram')}
                    </span>
                  </div>
                  {telegramExpanded ? (
                    <ChevronDown data-icon="inline-end" />
                  ) : (
                    <ChevronRight data-icon="inline-end" />
                  )}
                </Button>
                {/* Telegram Instance Sub-items */}
                {telegramExpanded && (
                  <div className="ml-5 mt-1 flex flex-col gap-1">
                    {config.telegram.instances.map(inst => {
                      const instStatus = status.telegram?.instances?.find(
                        s => s.instanceId === inst.instanceId,
                      );
                      const isSelected =
                        activePlatform === 'telegram' &&
                        activeTelegramInstanceId === inst.instanceId;
                      const dotColor = !inst.enabled
                        ? 'bg-muted-foreground'
                        : instStatus?.connected
                          ? 'bg-success'
                          : 'bg-warning';
                      return (
                        <Button
                          type="button"
                          variant="ghost"
                          key={inst.instanceId}
                          onClick={() => {
                            setActivePlatform('telegram');
                            setActiveTelegramInstanceId(inst.instanceId);
                          }}
                          className={cn(
                            'h-auto w-full justify-start rounded-lg p-1.5 pl-2 text-sm transition-colors',
                            isSelected ? 'bg-primary/10' : 'hover:bg-surface-raised',
                          )}
                        >
                          <span className={cn('mr-2 size-2 shrink-0 rounded-full', dotColor)} />
                          <span className="flex-1 truncate">{inst.instanceName}</span>
                        </Button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          }

          if (platform === 'discord') {
            return (
              <div key="discord">
                {/* Discord Platform Header - clickable to expand/collapse */}
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setActivePlatform('discord');
                    setActiveDiscordInstanceId(null);
                    setDiscordExpanded(!discordExpanded);
                  }}
                  className={cn(
                    'h-auto w-full justify-start rounded-lg border p-2 transition-colors',
                    activePlatform === 'discord'
                      ? 'border-primary bg-primary-muted shadow-subtle'
                      : 'border-transparent bg-surface hover:bg-surface-raised',
                  )}
                >
                  <div className="flex flex-1 items-center">
                    <div className="mr-2 flex size-7 items-center justify-center">
                      <img
                        src={PlatformRegistry.logo('discord')}
                        alt="Discord"
                        className="size-6 object-contain rounded-md"
                      />
                    </div>
                    <span className="truncate text-sm font-medium">{i18nService.t('discord')}</span>
                  </div>
                  {discordExpanded ? (
                    <ChevronDown data-icon="inline-end" />
                  ) : (
                    <ChevronRight data-icon="inline-end" />
                  )}
                </Button>
                {/* Discord Instance Sub-items */}
                {discordExpanded && (
                  <div className="ml-5 mt-1 flex flex-col gap-1">
                    {config.discord.instances.map(inst => {
                      const instStatus = status.discord?.instances?.find(
                        s => s.instanceId === inst.instanceId,
                      );
                      const isSelected =
                        activePlatform === 'discord' && activeDiscordInstanceId === inst.instanceId;
                      const dotColor = !inst.enabled
                        ? 'bg-muted-foreground'
                        : instStatus?.connected
                          ? 'bg-success'
                          : 'bg-warning';
                      return (
                        <Button
                          type="button"
                          variant="ghost"
                          key={inst.instanceId}
                          onClick={() => {
                            setActivePlatform('discord');
                            setActiveDiscordInstanceId(inst.instanceId);
                          }}
                          className={cn(
                            'h-auto w-full justify-start rounded-lg p-1.5 pl-2 text-sm transition-colors',
                            isSelected ? 'bg-primary/10' : 'hover:bg-surface-raised',
                          )}
                        >
                          <span className={cn('mr-2 size-2 shrink-0 rounded-full', dotColor)} />
                          <span className="flex-1 truncate">{inst.instanceName}</span>
                        </Button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          }

          return (
            <div
              key={platform}
              className={cn(
                'flex items-center rounded-lg border transition-colors',
                activePlatform === platform
                  ? 'border-primary bg-primary-muted shadow-subtle'
                  : 'border-transparent bg-surface hover:bg-surface-raised',
              )}
            >
              <Button
                type="button"
                variant="ghost"
                onClick={() => setActivePlatform(platform)}
                aria-current={activePlatform === platform ? 'page' : undefined}
                className="h-auto min-w-0 flex-1 justify-start p-2"
              >
                <span className="mr-2 flex size-7 items-center justify-center">
                  <img
                    src={logo}
                    alt={i18nService.t(platform)}
                    className="size-6 rounded-md object-contain"
                  />
                </span>
                <span className="truncate text-sm font-medium">{i18nService.t(platform)}</span>
              </Button>
              <Switch
                className="mr-2"
                checked={isEnabled}
                disabled={!gatewayReady || !canToggle || togglingPlatform === platform}
                aria-label={`${i18nService.t(platform)} ${i18nService.t('enabled')}`}
                onCheckedChange={() => handlePlatformToggle(platform)}
              />
            </div>
          );
        })}
      </div>

      {/* Platform Settings - Right Side */}
      <div className="flex-1 min-w-0 pl-4 pr-2 flex flex-col gap-4 overflow-y-auto scrollbar-gutter-stable">
        {/* Header with status (only for single-instance platforms without per-instance headers) */}
        {activePlatform === 'weixin' && (
          <div className="flex items-center gap-3 pb-3 border-b border-border-subtle">
            <div className="flex items-center gap-2">
              <div className="flex size-7 items-center justify-center rounded-md bg-surface border border-border-subtle p-1">
                <img
                  src={PlatformRegistry.logo(activePlatform)}
                  alt={i18nService.t(activePlatform)}
                  className="size-4 object-contain rounded"
                />
              </div>
              <h3 className="text-sm font-medium text-foreground">
                {`${i18nService.t(activePlatform)}${i18nService.t('settings')}`}
              </h3>
            </div>
            <Badge
              variant={
                getPlatformConnected(activePlatform)
                  ? 'default'
                  : getPlatformStarting(activePlatform)
                    ? 'outline'
                    : 'secondary'
              }
            >
              {getPlatformConnected(activePlatform)
                ? i18nService.t('connected')
                : getPlatformStarting(activePlatform)
                  ? i18nService.t('starting')
                  : i18nService.t('disconnected')}
            </Badge>
          </div>
        )}

        {/* DingTalk Settings (multi-instance) */}
        {activePlatform === 'dingtalk' && !activeDingTalkInstanceId && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <img
              src={PlatformRegistry.logo('dingtalk')}
              alt="DingTalk"
              className="size-12 object-contain rounded-md mb-4 opacity-50"
            />
            <p className="text-sm text-muted-foreground mb-4">
              {config.dingtalk.instances.length === 0
                ? i18nService.t('imNoInstances').replace('{platform}', i18nService.t('dingtalk'))
                : i18nService
                    .t('imSelectInstance')
                    .replace('{platform}', i18nService.t('dingtalk'))}
            </p>
            {config.dingtalk.instances.length < MAX_DINGTALK_INSTANCES && (
              <Button
                type="button"
                variant="outline"
                onClick={async e => {
                  e.stopPropagation();
                  const inst = await imService.addDingTalkInstance(
                    `DingTalk Bot ${config.dingtalk.instances.length + 1}`,
                  );
                  if (inst) {
                    setActiveDingTalkInstanceId(inst.instanceId);
                    setDingtalkExpanded(true);
                  }
                }}
              >
                + {i18nService.t('imDingTalkAddInstance')}
              </Button>
            )}
          </div>
        )}
        {activePlatform === 'dingtalk' &&
          activeDingTalkInstanceId &&
          (() => {
            const selectedInstance = config.dingtalk.instances.find(
              i => i.instanceId === activeDingTalkInstanceId,
            );
            if (!selectedInstance) return null;
            const selectedStatus = status.dingtalk?.instances?.find(
              s => s.instanceId === activeDingTalkInstanceId,
            );
            return (
              <DingTalkInstanceSettings
                instance={selectedInstance}
                instanceStatus={selectedStatus}
                onConfigChange={update => {
                  dispatch(
                    setDingTalkInstanceConfig({
                      instanceId: activeDingTalkInstanceId,
                      config: update,
                    }),
                  );
                }}
                onSave={async override => {
                  const configToSave = override
                    ? { ...selectedInstance, ...override }
                    : selectedInstance;
                  if (selectedInstance.enabled) {
                    await imService.updateDingTalkInstanceConfig(
                      activeDingTalkInstanceId,
                      configToSave,
                    );
                  } else {
                    await imService.persistDingTalkInstanceConfig(
                      activeDingTalkInstanceId,
                      configToSave,
                    );
                  }
                }}
                onRename={async newName => {
                  dispatch(
                    setDingTalkInstanceConfig({
                      instanceId: activeDingTalkInstanceId,
                      config: { instanceName: newName } as any,
                    }),
                  );
                  await imService.persistDingTalkInstanceConfig(activeDingTalkInstanceId, {
                    instanceName: newName,
                  } as any);
                }}
                onDelete={async () => {
                  await imService.deleteDingTalkInstance(activeDingTalkInstanceId);
                  const remaining = config.dingtalk.instances.filter(
                    i => i.instanceId !== activeDingTalkInstanceId,
                  );
                  setActiveDingTalkInstanceId(
                    remaining.length > 0 ? remaining[0].instanceId : null,
                  );
                }}
                onToggleEnabled={async () => {
                  const newEnabled = !selectedInstance.enabled;
                  if (newEnabled && !(selectedInstance.clientId && selectedInstance.clientSecret))
                    return;
                  const success = await imService.updateDingTalkInstanceConfig(
                    activeDingTalkInstanceId,
                    { enabled: newEnabled },
                  );
                  if (success) {
                    dispatch(
                      setDingTalkInstanceConfig({
                        instanceId: activeDingTalkInstanceId,
                        config: { enabled: newEnabled },
                      }),
                    );
                    if (newEnabled) dispatch(clearError());
                  }
                }}
                onTestConnectivity={() => {
                  void handleConnectivityTest('dingtalk');
                }}
                testingPlatform={testingPlatform}
                connectivityResults={connectivityResults}
              />
            );
          })()}

        {/* Feishu Settings (multi-instance) */}
        {activePlatform === 'feishu' && !activeFeishuInstanceId && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <img
              src={PlatformRegistry.logo('feishu')}
              alt="Feishu"
              className="size-12 object-contain rounded-md mb-4 opacity-50"
            />
            <p className="text-sm text-muted-foreground mb-4">
              {config.feishu.instances.length === 0
                ? i18nService.t('imNoInstances').replace('{platform}', i18nService.t('feishu'))
                : i18nService.t('imSelectInstance').replace('{platform}', i18nService.t('feishu'))}
            </p>
            {config.feishu.instances.length < MAX_FEISHU_INSTANCES && (
              <Button
                type="button"
                variant="outline"
                onClick={async e => {
                  e.stopPropagation();
                  const inst = await imService.addFeishuInstance(
                    `Feishu Bot ${config.feishu.instances.length + 1}`,
                  );
                  if (inst) {
                    setActiveFeishuInstanceId(inst.instanceId);
                    setFeishuExpanded(true);
                  }
                }}
              >
                + {i18nService.t('imFeishuAddInstance')}
              </Button>
            )}
          </div>
        )}
        {activePlatform === 'feishu' &&
          activeFeishuInstanceId &&
          (() => {
            const selectedInstance = config.feishu.instances.find(
              i => i.instanceId === activeFeishuInstanceId,
            );
            if (!selectedInstance) return null;
            const selectedStatus = status.feishu?.instances?.find(
              s => s.instanceId === activeFeishuInstanceId,
            );
            return (
              <FeishuInstanceSettings
                instance={selectedInstance}
                instanceStatus={selectedStatus}
                onConfigChange={update => {
                  dispatch(
                    setFeishuInstanceConfig({ instanceId: activeFeishuInstanceId, config: update }),
                  );
                }}
                onSave={async override => {
                  const configToSave = override
                    ? { ...selectedInstance, ...override }
                    : selectedInstance;
                  if (selectedInstance.enabled) {
                    await imService.updateFeishuInstanceConfig(
                      activeFeishuInstanceId,
                      configToSave,
                    );
                  } else {
                    await imService.persistFeishuInstanceConfig(
                      activeFeishuInstanceId,
                      configToSave,
                    );
                  }
                }}
                onRename={async newName => {
                  dispatch(
                    setFeishuInstanceConfig({
                      instanceId: activeFeishuInstanceId,
                      config: { instanceName: newName } as any,
                    }),
                  );
                  await imService.persistFeishuInstanceConfig(activeFeishuInstanceId, {
                    instanceName: newName,
                  } as any);
                }}
                onDelete={async () => {
                  await imService.deleteFeishuInstance(activeFeishuInstanceId);
                  const remaining = config.feishu.instances.filter(
                    i => i.instanceId !== activeFeishuInstanceId,
                  );
                  setActiveFeishuInstanceId(remaining.length > 0 ? remaining[0].instanceId : null);
                }}
                onToggleEnabled={async () => {
                  const newEnabled = !selectedInstance.enabled;
                  if (newEnabled && !(selectedInstance.appId && selectedInstance.appSecret)) return;
                  const success = await imService.updateFeishuInstanceConfig(
                    activeFeishuInstanceId,
                    { enabled: newEnabled },
                  );
                  if (success) {
                    dispatch(
                      setFeishuInstanceConfig({
                        instanceId: activeFeishuInstanceId,
                        config: { enabled: newEnabled },
                      }),
                    );
                    if (newEnabled) dispatch(clearError());
                  }
                }}
                onTestConnectivity={() => {
                  void handleConnectivityTest('feishu');
                }}
                testingPlatform={testingPlatform}
                connectivityResults={connectivityResults}
              />
            );
          })()}

        {/* QQ Settings (multi-instance) */}
        {activePlatform === 'qq' && !activeQQInstanceId && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <img
              src={PlatformRegistry.logo('qq')}
              alt="QQ"
              className="size-12 object-contain rounded-md mb-4 opacity-50"
            />
            <p className="text-sm text-muted-foreground mb-4">
              {config.qq.instances.length === 0
                ? i18nService.t('imNoInstances').replace('{platform}', i18nService.t('qq'))
                : i18nService.t('imSelectInstance').replace('{platform}', i18nService.t('qq'))}
            </p>
            {config.qq.instances.length < MAX_QQ_INSTANCES && (
              <Button
                type="button"
                variant="outline"
                onClick={async e => {
                  e.stopPropagation();
                  const inst = await imService.addQQInstance(
                    `QQ Bot ${config.qq.instances.length + 1}`,
                  );
                  if (inst) {
                    setActiveQQInstanceId(inst.instanceId);
                    setQqExpanded(true);
                  }
                }}
              >
                + {i18nService.t('imQQAddInstance')}
              </Button>
            )}
          </div>
        )}
        {activePlatform === 'qq' &&
          activeQQInstanceId &&
          (() => {
            const selectedInstance = config.qq.instances.find(
              i => i.instanceId === activeQQInstanceId,
            );
            if (!selectedInstance) return null;
            const selectedStatus = status.qq?.instances?.find(
              s => s.instanceId === activeQQInstanceId,
            );
            return (
              <QQInstanceSettings
                instance={selectedInstance}
                instanceStatus={selectedStatus}
                onConfigChange={update => {
                  dispatch(setQQInstanceConfig({ instanceId: activeQQInstanceId, config: update }));
                }}
                onSave={async override => {
                  const configToSave = override
                    ? { ...selectedInstance, ...override }
                    : selectedInstance;
                  if (selectedInstance.enabled) {
                    await imService.updateQQInstanceConfig(activeQQInstanceId, configToSave);
                  } else {
                    await imService.persistQQInstanceConfig(activeQQInstanceId, configToSave);
                  }
                }}
                onRename={async newName => {
                  dispatch(
                    setQQInstanceConfig({
                      instanceId: activeQQInstanceId,
                      config: { instanceName: newName } as any,
                    }),
                  );
                  await imService.persistQQInstanceConfig(activeQQInstanceId, {
                    instanceName: newName,
                  } as any);
                }}
                onDelete={async () => {
                  await imService.deleteQQInstance(activeQQInstanceId);
                  const remaining = config.qq.instances.filter(
                    i => i.instanceId !== activeQQInstanceId,
                  );
                  setActiveQQInstanceId(remaining.length > 0 ? remaining[0].instanceId : null);
                }}
                onToggleEnabled={async () => {
                  const newEnabled = !selectedInstance.enabled;
                  if (newEnabled && !(selectedInstance.appId && selectedInstance.appSecret)) return;
                  const success = await imService.updateQQInstanceConfig(activeQQInstanceId, {
                    enabled: newEnabled,
                  });
                  if (success) {
                    dispatch(
                      setQQInstanceConfig({
                        instanceId: activeQQInstanceId,
                        config: { enabled: newEnabled },
                      }),
                    );
                    if (newEnabled) dispatch(clearError());
                  }
                }}
                onTestConnectivity={() => {
                  void handleConnectivityTest('qq');
                }}
                testingPlatform={testingPlatform}
                connectivityResults={connectivityResults}
              />
            );
          })()}

        {/* Telegram Settings (multi-instance) */}
        {activePlatform === 'telegram' && !activeTelegramInstanceId && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <img
              src={PlatformRegistry.logo('telegram')}
              alt="Telegram"
              className="size-12 object-contain rounded-md mb-4 opacity-50"
            />
            <p className="text-sm text-muted-foreground mb-4">
              {config.telegram.instances.length === 0
                ? i18nService.t('imNoInstances').replace('{platform}', i18nService.t('telegram'))
                : i18nService
                    .t('imSelectInstance')
                    .replace('{platform}', i18nService.t('telegram'))}
            </p>
            {config.telegram.instances.length < MAX_TELEGRAM_INSTANCES && (
              <Button
                type="button"
                variant="outline"
                onClick={async e => {
                  e.stopPropagation();
                  const inst = await imService.addTelegramInstance(
                    `Telegram Bot ${config.telegram.instances.length + 1}`,
                  );
                  if (inst) {
                    setActiveTelegramInstanceId(inst.instanceId);
                    setTelegramExpanded(true);
                  }
                }}
              >
                + {i18nService.t('imTelegramAddInstance')}
              </Button>
            )}
          </div>
        )}
        {activePlatform === 'telegram' &&
          activeTelegramInstanceId &&
          (() => {
            const selectedInstance = config.telegram.instances.find(
              i => i.instanceId === activeTelegramInstanceId,
            );
            if (!selectedInstance) return null;
            const selectedStatus = status.telegram?.instances?.find(
              s => s.instanceId === activeTelegramInstanceId,
            );
            return (
              <TelegramInstanceSettings
                instance={selectedInstance}
                instanceStatus={selectedStatus}
                onConfigChange={update => {
                  dispatch(
                    setTelegramInstanceConfig({
                      instanceId: activeTelegramInstanceId,
                      config: update,
                    }),
                  );
                }}
                onSave={async override => {
                  const configToSave = override
                    ? { ...selectedInstance, ...override }
                    : selectedInstance;
                  if (selectedInstance.enabled) {
                    await imService.updateTelegramInstanceConfig(
                      activeTelegramInstanceId,
                      configToSave,
                    );
                  } else {
                    await imService.persistTelegramInstanceConfig(
                      activeTelegramInstanceId,
                      configToSave,
                    );
                  }
                }}
                onRename={async newName => {
                  dispatch(
                    setTelegramInstanceConfig({
                      instanceId: activeTelegramInstanceId,
                      config: { instanceName: newName } as any,
                    }),
                  );
                  await imService.persistTelegramInstanceConfig(activeTelegramInstanceId, {
                    instanceName: newName,
                  } as any);
                }}
                onDelete={async () => {
                  await imService.deleteTelegramInstance(activeTelegramInstanceId);
                  const remaining = config.telegram.instances.filter(
                    i => i.instanceId !== activeTelegramInstanceId,
                  );
                  setActiveTelegramInstanceId(
                    remaining.length > 0 ? remaining[0].instanceId : null,
                  );
                }}
                onToggleEnabled={async () => {
                  const newEnabled = !selectedInstance.enabled;
                  if (newEnabled && !selectedInstance.botToken) return;
                  const success = await imService.updateTelegramInstanceConfig(
                    activeTelegramInstanceId,
                    { enabled: newEnabled },
                  );
                  if (success) {
                    dispatch(
                      setTelegramInstanceConfig({
                        instanceId: activeTelegramInstanceId,
                        config: { enabled: newEnabled },
                      }),
                    );
                    if (newEnabled) dispatch(clearError());
                  }
                }}
                onTestConnectivity={() => {
                  void handleConnectivityTest('telegram');
                }}
                testingPlatform={testingPlatform}
                connectivityResults={connectivityResults}
              />
            );
          })()}

        {/* Discord Settings */}
        {activePlatform === 'discord' && !activeDiscordInstanceId && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <img
              src={PlatformRegistry.logo('discord')}
              alt="Discord"
              className="size-12 object-contain rounded-md mb-4 opacity-50"
            />
            <p className="text-sm text-muted-foreground mb-4">
              {config.discord.instances.length === 0
                ? i18nService.t('imNoInstances').replace('{platform}', i18nService.t('discord'))
                : i18nService.t('imSelectInstance').replace('{platform}', i18nService.t('discord'))}
            </p>
            {config.discord.instances.length < MAX_DISCORD_INSTANCES && (
              <Button
                type="button"
                variant="outline"
                onClick={async e => {
                  e.stopPropagation();
                  const inst = await imService.addDiscordInstance(
                    `Discord Bot ${config.discord.instances.length + 1}`,
                  );
                  if (inst) {
                    setActiveDiscordInstanceId(inst.instanceId);
                    setDiscordExpanded(true);
                  }
                }}
              >
                + {i18nService.t('imAddInstance').replace('{platform}', i18nService.t('discord'))}
              </Button>
            )}
          </div>
        )}
        {activePlatform === 'discord' &&
          activeDiscordInstanceId &&
          (() => {
            const selectedInstance = config.discord.instances.find(
              i => i.instanceId === activeDiscordInstanceId,
            );
            if (!selectedInstance) return null;
            const selectedStatus = status.discord?.instances?.find(
              s => s.instanceId === activeDiscordInstanceId,
            );
            return (
              <DiscordInstanceSettings
                instance={selectedInstance}
                instanceStatus={selectedStatus}
                onConfigChange={update => {
                  dispatch(
                    setDiscordInstanceConfig({
                      instanceId: activeDiscordInstanceId,
                      config: update,
                    }),
                  );
                }}
                onSave={async override => {
                  const configToSave = override
                    ? { ...selectedInstance, ...override }
                    : selectedInstance;
                  if (selectedInstance.enabled) {
                    await imService.updateDiscordInstanceConfig(
                      activeDiscordInstanceId,
                      configToSave,
                    );
                  } else {
                    await imService.persistDiscordInstanceConfig(
                      activeDiscordInstanceId,
                      configToSave,
                    );
                  }
                }}
                onRename={async newName => {
                  dispatch(
                    setDiscordInstanceConfig({
                      instanceId: activeDiscordInstanceId,
                      config: { instanceName: newName } as any,
                    }),
                  );
                  await imService.persistDiscordInstanceConfig(activeDiscordInstanceId, {
                    instanceName: newName,
                  } as any);
                }}
                onDelete={async () => {
                  await imService.deleteDiscordInstance(activeDiscordInstanceId);
                  const remaining = config.discord.instances.filter(
                    i => i.instanceId !== activeDiscordInstanceId,
                  );
                  setActiveDiscordInstanceId(remaining.length > 0 ? remaining[0].instanceId : null);
                }}
                onToggleEnabled={async () => {
                  const newEnabled = !selectedInstance.enabled;
                  if (newEnabled && !selectedInstance.botToken) return;
                  const success = await imService.updateDiscordInstanceConfig(
                    activeDiscordInstanceId,
                    { enabled: newEnabled },
                  );
                  if (success) {
                    dispatch(
                      setDiscordInstanceConfig({
                        instanceId: activeDiscordInstanceId,
                        config: { enabled: newEnabled },
                      }),
                    );
                    if (newEnabled) dispatch(clearError());
                  }
                }}
                onTestConnectivity={() => {
                  void handleConnectivityTest('discord');
                }}
                testingPlatform={testingPlatform}
                connectivityResults={connectivityResults}
              />
            );
          })()}

        {/* Weixin (微信) Settings */}
        {activePlatform === 'weixin' && (
          <div className="flex flex-col gap-3">
            {/* Scan QR code section */}
            <div className="rounded-lg border border-dashed border-border-subtle p-4 text-center flex flex-col gap-3">
              {weixinQrStatus === 'idle' && (
                <div className="flex w-fit max-w-full flex-col gap-3 self-center">
                  <Button
                    type="button"
                    className="w-full"
                    onClick={() => void handleWeixinQrLogin()}
                  >
                    {i18nService.t('imWeixinScanBtn')}
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    {i18nService.t('imWeixinScanHint')}
                  </p>
                </div>
              )}
              {weixinQrStatus === 'error' && (
                <>
                  <Button type="button" onClick={() => void handleWeixinQrLogin()}>
                    {i18nService.t('imWeixinScanBtn')}
                  </Button>
                  {weixinQrError && <IMStatusAlert error>{weixinQrError}</IMStatusAlert>}
                </>
              )}
              {weixinQrStatus === 'loading' && (
                <div className="flex items-center justify-center gap-2 py-4">
                  <RefreshCw className="size-5 animate-spin text-primary" />
                  <span className="text-sm text-muted-foreground">
                    {i18nService.t('imWeixinQrLoading')}
                  </span>
                </div>
              )}
              {(weixinQrStatus === 'showing' ||
                weixinQrStatus === 'waiting' ||
                weixinQrStatus === 'expired') &&
                weixinQrUrl && (
                  <div className="flex flex-col items-center gap-3">
                    <p className="text-sm font-medium text-foreground">
                      {weixinQrStatus === 'expired'
                        ? i18nService.t('imWeixinQrExpired')
                        : i18nService.t('imWeixinQrScanPrompt')}
                    </p>
                    <div className="relative w-fit">
                      <div
                        className={cn(
                          'rounded-lg border border-border-subtle bg-white p-3',
                          weixinQrStatus === 'expired' && 'opacity-30',
                        )}
                      >
                        <QRCodeSVG value={weixinQrUrl} size={192} />
                      </div>
                      {weixinQrStatus === 'expired' && (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <Button type="button" onClick={() => void handleWeixinQrLogin()}>
                            <RefreshCw data-icon="inline-start" />
                            {i18nService.t('imWeixinQrRefresh')}
                          </Button>
                        </div>
                      )}
                    </div>
                    {weixinQrStatus === 'waiting' && (
                      <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
                        <RefreshCw className="size-3.5 animate-spin" />
                        {i18nService.t('imWeixinQrWaiting')}
                      </div>
                    )}
                  </div>
                )}
              {weixinQrStatus === 'success' && (
                <IMStatusAlert>{i18nService.t('imWeixinQrSuccess')}</IMStatusAlert>
              )}
            </div>

            {/* Platform Guide */}
            <PlatformGuide
              steps={[
                i18nService.t('imWeixinGuideStep1'),
                i18nService.t('imWeixinGuideStep2'),
                i18nService.t('imWeixinGuideStep3'),
              ]}
              guideUrl={PlatformRegistry.guideUrl('weixin')}
            />

            {/* Connectivity test */}
            <div className="pt-1">{renderConnectivityTestButton('weixin')}</div>

            {/* Account ID display */}
            {weixinOpenClawConfig.accountId && (
              <IMStatusAlert>
                {i18nService.t('imAccountId')}: {weixinOpenClawConfig.accountId}
              </IMStatusAlert>
            )}

            {/* Error display */}
            {status.weixin?.lastError && (
              <IMStatusAlert error>{status.weixin.lastError}</IMStatusAlert>
            )}

            {/* Advanced Settings (collapsible) */}
            <details className="group">
              <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-primary transition-colors">
                {i18nService.t('imAdvancedSettings')}
              </summary>
              <div className="mt-2 flex flex-col gap-3 pl-2 border-l-2 border-border-subtle">
                {/* DM Policy */}
                <IMSelectField
                  id="weixin-dm-policy"
                  label={i18nService.t('imDmPolicy')}
                  value={weixinOpenClawConfig.dmPolicy}
                  options={[
                    { value: 'open', label: i18nService.t('imDmPolicyOpen') },
                    { value: 'pairing', label: i18nService.t('imDmPolicyPairing') },
                    { value: 'allowlist', label: i18nService.t('imDmPolicyAllowlist') },
                    { value: 'disabled', label: i18nService.t('imDmPolicyDisabled') },
                  ]}
                  onValueChange={value => {
                    const update = { dmPolicy: value as WeixinOpenClawConfig['dmPolicy'] };
                    void imService.updateConfig({
                      weixin: { ...weixinOpenClawConfig, ...update },
                    });
                  }}
                />

                {/* Allow From */}
                <IMField id="weixin-allow-user" label={i18nService.t('imAllowFromUserIds')}>
                  <div className="flex gap-2">
                    <Input
                      id="weixin-allow-user"
                      type="text"
                      value={weixinAllowFromInput}
                      onChange={e => setWeixinAllowFromInput(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          const id = weixinAllowFromInput.trim();
                          if (id && !weixinOpenClawConfig.allowFrom.includes(id)) {
                            const newIds = [...weixinOpenClawConfig.allowFrom, id];
                            setWeixinAllowFromInput('');
                            void imService.updateConfig({
                              weixin: { ...weixinOpenClawConfig, allowFrom: newIds },
                            });
                          }
                        }
                      }}
                      className="flex-1"
                      placeholder="wxid_xxx@im.wechat"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const id = weixinAllowFromInput.trim();
                        if (id && !weixinOpenClawConfig.allowFrom.includes(id)) {
                          const newIds = [...weixinOpenClawConfig.allowFrom, id];
                          setWeixinAllowFromInput('');
                          void imService.updateConfig({
                            weixin: { ...weixinOpenClawConfig, allowFrom: newIds },
                          });
                        }
                      }}
                    >
                      {i18nService.t('add')}
                    </Button>
                  </div>
                  {weixinOpenClawConfig.allowFrom.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {weixinOpenClawConfig.allowFrom.map(id => (
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
                              const newIds = weixinOpenClawConfig.allowFrom.filter(
                                uid => uid !== id,
                              );
                              void imService.updateConfig({
                                weixin: { ...weixinOpenClawConfig, allowFrom: newIds },
                              });
                            }}
                          >
                            <X data-icon="inline-start" />
                          </Button>
                        </span>
                      ))}
                    </div>
                  )}
                </IMField>
              </div>
            </details>
          </div>
        )}

        {/* WeCom (企业微信) Multi-Instance Settings */}
        {activePlatform === 'wecom' &&
          (() => {
            const wecomMultiConfig = config.wecom;
            const activeWecomInstance = activeWecomInstanceId
              ? wecomMultiConfig.instances.find(i => i.instanceId === activeWecomInstanceId)
              : null;
            const activeWecomStatus = activeWecomInstanceId
              ? status.wecom?.instances?.find(s => s.instanceId === activeWecomInstanceId)
              : undefined;

            if (activeWecomInstance) {
              return (
                <WecomInstanceSettings
                  instance={activeWecomInstance}
                  instanceStatus={activeWecomStatus}
                  onConfigChange={update => {
                    dispatch(
                      setWecomInstanceConfig({
                        instanceId: activeWecomInstanceId!,
                        config: update,
                      }),
                    );
                  }}
                  onSave={async override => {
                    if (!configLoaded) return;
                    const configToSave = override
                      ? { ...activeWecomInstance, ...override }
                      : activeWecomInstance;
                    await imService.persistWecomInstanceConfig(
                      activeWecomInstanceId!,
                      configToSave,
                    );
                  }}
                  onRename={async newName => {
                    dispatch(
                      setWecomInstanceConfig({
                        instanceId: activeWecomInstanceId!,
                        config: { instanceName: newName } as any,
                      }),
                    );
                    await imService.persistWecomInstanceConfig(activeWecomInstanceId!, {
                      instanceName: newName,
                    } as any);
                  }}
                  onDelete={async () => {
                    await imService.deleteWecomInstance(activeWecomInstanceId!);
                    setActiveWecomInstanceId(null);
                  }}
                  onToggleEnabled={async () => {
                    const newEnabled = !activeWecomInstance.enabled;
                    dispatch(
                      setWecomInstanceConfig({
                        instanceId: activeWecomInstanceId!,
                        config: { enabled: newEnabled },
                      }),
                    );
                    await imService.updateWecomInstanceConfig(activeWecomInstanceId!, {
                      enabled: newEnabled,
                    });
                  }}
                  onTestConnectivity={() => void handleConnectivityTest('wecom')}
                  onQuickSetup={async () => {
                    setWecomQuickSetupStatus('pending');
                    setWecomQuickSetupError('');
                    try {
                      const bot = await WecomAIBotSDK.openBotInfoAuthWindow({
                        source: 'zhiyuan-ai',
                      });
                      if (!isMountedRef.current) return;
                      dispatch(
                        setWecomInstanceConfig({
                          instanceId: activeWecomInstanceId!,
                          config: { botId: bot.botid, secret: bot.secret, enabled: true },
                        }),
                      );
                      dispatch(clearError());
                      await imService.updateWecomInstanceConfig(activeWecomInstanceId!, {
                        botId: bot.botid,
                        secret: bot.secret,
                        enabled: true,
                      });
                      if (!isMountedRef.current) return;
                      await imService.loadStatus();
                      if (!isMountedRef.current) return;
                      setWecomQuickSetupStatus('success');
                    } catch (error: unknown) {
                      if (!isMountedRef.current) return;
                      setWecomQuickSetupStatus('error');
                      const err = error as { message?: string; code?: string };
                      setWecomQuickSetupError(
                        err.message || err.code || i18nService.t('unknownError'),
                      );
                    }
                  }}
                  quickSetupStatus={wecomQuickSetupStatus}
                  quickSetupError={wecomQuickSetupError}
                  testingPlatform={testingPlatform}
                  connectivityResults={
                    connectivityResults as Record<string, IMConnectivityTestResult>
                  }
                  renderPairingSection={renderPairingSection}
                />
              );
            }

            // No instance selected - show placeholder
            return (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <img
                  src={PlatformRegistry.logo('wecom')}
                  alt="WeCom"
                  className="size-12 object-contain rounded-md mb-4 opacity-50"
                />
                <p className="text-sm text-muted-foreground mb-4">
                  {wecomMultiConfig.instances.length === 0
                    ? i18nService.t('imNoInstances').replace('{platform}', i18nService.t('wecom'))
                    : i18nService
                        .t('imSelectInstance')
                        .replace('{platform}', i18nService.t('wecom'))}
                </p>
                {wecomMultiConfig.instances.length < MAX_WECOM_INSTANCES && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={async e => {
                      e.stopPropagation();
                      const name = `WeCom Bot ${wecomMultiConfig.instances.length + 1}`;
                      const inst = await imService.addWecomInstance(name);
                      if (inst) {
                        setActiveWecomInstanceId(inst.instanceId);
                        setWecomExpanded(true);
                      }
                    }}
                  >
                    + {i18nService.t('imWecomAddInstance')}
                  </Button>
                )}
              </div>
            );
          })()}

        {connectivityModalPlatform && (
          <Modal
            onClose={() => setConnectivityModalPlatform(null)}
            className="flex max-h-[min(24rem,calc(100vh-2rem))] w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-xl"
          >
            <div className="flex shrink-0 items-center justify-between px-6 py-4">
              <DialogTitle>
                {`${i18nService.t(connectivityModalPlatform)} ${i18nService.t('imConnectivitySectionTitle')}`}
              </DialogTitle>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={i18nService.t('close')}
                onClick={() => setConnectivityModalPlatform(null)}
              >
                <X data-icon="inline-start" />
              </Button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
              {connectivityResults[connectivityModalPlatform] ? (
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between gap-2">
                    <Badge
                      variant={
                        connectivityResults[connectivityModalPlatform]!.verdict === 'fail'
                          ? 'destructive'
                          : connectivityResults[connectivityModalPlatform]!.verdict === 'warn'
                            ? 'outline'
                            : 'default'
                      }
                    >
                      {connectivityResults[connectivityModalPlatform]!.verdict === 'pass' ? (
                        <CheckCircle data-icon="inline-start" />
                      ) : connectivityResults[connectivityModalPlatform]!.verdict === 'warn' ? (
                        <TriangleAlert data-icon="inline-start" />
                      ) : (
                        <XCircle data-icon="inline-start" />
                      )}
                      {i18nService.t(
                        `imConnectivityVerdict_${connectivityResults[connectivityModalPlatform]!.verdict}`,
                      )}
                    </Badge>
                    <div className="text-xs text-muted-foreground">
                      {`${i18nService.t('imConnectivityLastChecked')}: ${formatTestTime(connectivityResults[connectivityModalPlatform]!.testedAt)}`}
                    </div>
                  </div>

                  <div className="flex flex-col gap-2">
                    {connectivityResults[connectivityModalPlatform]!.checks.map((check, index) => (
                      <Alert
                        key={`${check.code}-${index}`}
                        variant={check.level === 'fail' ? 'destructive' : 'default'}
                      >
                        {check.level === 'fail' ? (
                          <XCircle />
                        ) : check.level === 'warn' ? (
                          <TriangleAlert />
                        ) : (
                          <CheckCircle />
                        )}
                        <AlertTitle>{getCheckTitle(check.code)}</AlertTitle>
                      </Alert>
                    ))}
                  </div>
                </div>
              ) : connectivityFailures[connectivityModalPlatform] ? (
                <div className="flex flex-col gap-3">
                  <Badge variant="destructive" className="w-fit">
                    <XCircle data-icon="inline-start" />
                    {i18nService.t('imConnectivityVerdict_fail')}
                  </Badge>
                  <Alert variant="destructive">
                    <XCircle />
                    <AlertTitle>{i18nService.t('imConnectivityTestFailed')}</AlertTitle>
                  </Alert>
                </div>
              ) : testingPlatform === connectivityModalPlatform ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Spinner />
                  <span>{i18nService.t('imConnectivityTesting')}</span>
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">
                  {i18nService.t('imConnectivityNoResult')}
                </div>
              )}
            </div>
          </Modal>
        )}
      </div>
    </div>
  );
};

export default IMSettings;
