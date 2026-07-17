/**
 * IM Settings Component
 * Configuration UI for DingTalk, Feishu and Telegram IM bots
 */

import { Button } from '@shared/components/ui/button';
import { Input } from '@shared/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shared/components/ui/select';
import type { Platform } from '@shared/platform';
import { PlatformRegistry } from '@shared/platform';
import WecomAIBotSDK from '@wecom/wecom-aibot-sdk';
import { CheckCircle, RefreshCw, Signal, TriangleAlert, X, XCircle } from 'lucide-react';
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
import DingTalkInstanceSettings from './DingTalkInstanceSettings';
import DiscordInstanceSettings from './DiscordInstanceSettings';
import FeishuInstanceSettings from './FeishuInstanceSettings';
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
    <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
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

const verdictColorClass: Record<IMConnectivityTestResult['verdict'], string> = {
  pass: 'bg-green-500/15 text-green-600 dark:text-green-400',
  warn: 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-300',
  fail: 'bg-red-500/15 text-red-600 dark:text-red-400',
};

const checkLevelColorClass: Record<IMConnectivityCheck['level'], string> = {
  pass: 'text-green-600 dark:text-green-400',
  info: 'text-sky-600 dark:text-sky-400',
  warn: 'text-yellow-700 dark:text-yellow-300',
  fail: 'text-red-600 dark:text-red-400',
};

const IMSettings: React.FC = () => {
  const dispatch = useDispatch();
  const { config, status, isLoading } = useSelector((state: RootState) => state.im);
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
  }, []);

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
      setFeishuQrError(err?.message || '获取二维码失败');
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

  const getCheckSuggestion = (check: IMConnectivityCheck): string | undefined => {
    if (check.suggestion) {
      return check.suggestion;
    }
    if (check.code === 'gateway_running' && check.level === 'pass') {
      return undefined;
    }
    const suggestion = i18nService.t(`imConnectivityCheckSuggestion_${check.code}`);
    if (suggestion.startsWith('imConnectivityCheckSuggestion_')) {
      return undefined;
    }
    return suggestion;
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
    setTestingPlatform(platform);
    const result = await imService.testGateway(platform, configOverride);
    if (result) {
      setConnectivityResults(prev => ({ ...prev, [platform]: result }));
    }
    setTestingPlatform(null);
    return result;
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
        const inst = feishuMultiConfig.instances.find(i => i.instanceId === activeFeishuInstanceId);
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
            await imService.updateDiscordInstanceConfig(activeDiscordInstanceId, { enabled: true });
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
  };

  // Handle platform toggle
  const handlePlatformToggle = (platform: Platform) => {
    // Block toggle if a toggle is already in progress for any platform
    if (togglingPlatform) return;
    const isEnabled = isPlatformEnabled(platform);
    // Can toggle ON if credentials are present, can always toggle OFF
    const canToggle = isEnabled || canStart(platform);
    if (canToggle && !isLoading) {
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
      disabled={isLoading || testingPlatform === platform}
    >
      <Signal className="h-3.5 w-3.5 mr-1.5" />
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
    <div className="space-y-2">
      <label className="block text-xs font-medium text-muted-foreground">
        {i18nService.t('imPairingApproval')}
      </label>
      <div className="flex gap-2">
        <Input
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
          className="bg-green-600 text-white hover:bg-green-700 dark:bg-green-600 dark:hover:bg-green-700"
        >
          {i18nService.t('imPairingApprove')}
        </Button>
      </div>
      {pairingStatus[platform] && (
        <p
          className={`text-xs ${pairingStatus[platform]!.type === 'success' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}
        >
          {pairingStatus[platform]!.type === 'success' ? '\u2713' : '\u2717'}{' '}
          {pairingStatus[platform]!.message}
        </p>
      )}
    </div>
  );

  return (
    <div className="flex h-full gap-4">
      {/* Platform List - Left Side */}
      <div className="w-48 shrink-0 border-r border-border pr-3 space-y-2 overflow-y-auto">
        {platforms.map(platform => {
          const logo = PlatformRegistry.logo(platform);
          const isEnabled = isPlatformEnabled(platform);
          const isConnected = getPlatformConnected(platform) || getPlatformStarting(platform);
          const canToggle = isEnabled || canStart(platform);

          if (platform === 'dingtalk') {
            return (
              <div key="dingtalk">
                {/* DingTalk Platform Header - clickable to expand/collapse */}
                <div
                  onClick={() => {
                    setActivePlatform('dingtalk');
                    setActiveDingTalkInstanceId(null);
                    setDingtalkExpanded(!dingtalkExpanded);
                  }}
                  className={`flex items-center p-2 rounded-xl cursor-pointer transition-colors ${
                    activePlatform === 'dingtalk'
                      ? 'bg-primary-muted border border-primary shadow-subtle'
                      : 'bg-surface hover:bg-surface-raised border border-transparent'
                  }`}
                >
                  <div className="flex flex-1 items-center">
                    <div className="mr-2 flex h-7 w-7 items-center justify-center">
                      <img
                        src={PlatformRegistry.logo('dingtalk')}
                        alt="DingTalk"
                        className="w-6 h-6 object-contain rounded-md"
                      />
                    </div>
                    <span
                      className={`text-sm font-medium truncate ${activePlatform === 'dingtalk' ? 'text-primary' : 'text-foreground'}`}
                    >
                      {i18nService.t('dingtalk')}
                    </span>
                  </div>
                  <span className="text-xs opacity-50">
                    {dingtalkExpanded ? '\u25BC' : '\u25B6'}
                  </span>
                </div>
                {/* DingTalk Instance Sub-items */}
                {dingtalkExpanded && (
                  <div className="ml-5 mt-1 space-y-1">
                    {config.dingtalk.instances.map(inst => {
                      const instStatus = status.dingtalk?.instances?.find(
                        s => s.instanceId === inst.instanceId,
                      );
                      const isSelected =
                        activePlatform === 'dingtalk' &&
                        activeDingTalkInstanceId === inst.instanceId;
                      const dotColor = !inst.enabled
                        ? 'bg-gray-400'
                        : instStatus?.connected
                          ? 'bg-green-500'
                          : 'bg-yellow-500';
                      return (
                        <div
                          key={inst.instanceId}
                          onClick={() => {
                            setActivePlatform('dingtalk');
                            setActiveDingTalkInstanceId(inst.instanceId);
                          }}
                          className={`flex items-center p-1.5 pl-2 rounded-lg cursor-pointer transition-colors text-sm ${
                            isSelected
                              ? 'bg-primary/10 dark:bg-primary/20'
                              : 'hover:bg-surface-raised'
                          }`}
                        >
                          <span className={`w-2 h-2 rounded-full ${dotColor} mr-2 shrink-0`} />
                          <span
                            className={`truncate flex-1 ${isSelected ? 'text-primary font-medium' : 'text-foreground'}`}
                          >
                            {inst.instanceName}
                          </span>
                        </div>
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
                <div
                  onClick={() => {
                    setActivePlatform('feishu');
                    setActiveFeishuInstanceId(null);
                    setFeishuExpanded(!feishuExpanded);
                  }}
                  className={`flex items-center p-2 rounded-xl cursor-pointer transition-colors ${
                    activePlatform === 'feishu'
                      ? 'bg-primary-muted border border-primary shadow-subtle'
                      : 'bg-surface hover:bg-surface-raised border border-transparent'
                  }`}
                >
                  <div className="flex flex-1 items-center">
                    <div className="mr-2 flex h-7 w-7 items-center justify-center">
                      <img
                        src={PlatformRegistry.logo('feishu')}
                        alt="Feishu"
                        className="w-6 h-6 object-contain rounded-md"
                      />
                    </div>
                    <span
                      className={`text-sm font-medium truncate ${activePlatform === 'feishu' ? 'text-primary' : 'text-foreground'}`}
                    >
                      {i18nService.t('feishu')}
                    </span>
                  </div>
                  <span className="text-xs opacity-50">{feishuExpanded ? '\u25BC' : '\u25B6'}</span>
                </div>
                {/* Feishu Instance Sub-items */}
                {feishuExpanded && (
                  <div className="ml-5 mt-1 space-y-1">
                    {config.feishu.instances.map(inst => {
                      const instStatus = status.feishu?.instances?.find(
                        s => s.instanceId === inst.instanceId,
                      );
                      const isSelected =
                        activePlatform === 'feishu' && activeFeishuInstanceId === inst.instanceId;
                      const dotColor = !inst.enabled
                        ? 'bg-gray-400'
                        : instStatus?.connected
                          ? 'bg-green-500'
                          : 'bg-yellow-500';
                      return (
                        <div
                          key={inst.instanceId}
                          onClick={() => {
                            setActivePlatform('feishu');
                            setActiveFeishuInstanceId(inst.instanceId);
                          }}
                          className={`flex items-center p-1.5 pl-2 rounded-lg cursor-pointer transition-colors text-sm ${
                            isSelected
                              ? 'bg-primary/10 dark:bg-primary/20'
                              : 'hover:bg-surface-raised'
                          }`}
                        >
                          <span className={`w-2 h-2 rounded-full ${dotColor} mr-2 shrink-0`} />
                          <span
                            className={`truncate flex-1 ${isSelected ? 'text-primary font-medium' : 'text-foreground'}`}
                          >
                            {inst.instanceName}
                          </span>
                        </div>
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
                <div
                  onClick={() => {
                    setActivePlatform('qq');
                    setActiveQQInstanceId(null);
                    setQqExpanded(!qqExpanded);
                  }}
                  className={`flex items-center p-2 rounded-xl cursor-pointer transition-colors ${
                    activePlatform === 'qq'
                      ? 'bg-primary-muted border border-primary shadow-subtle'
                      : 'bg-surface hover:bg-surface-raised border border-transparent'
                  }`}
                >
                  <div className="flex flex-1 items-center">
                    <div className="mr-2 flex h-7 w-7 items-center justify-center">
                      <img
                        src={PlatformRegistry.logo('qq')}
                        alt="QQ"
                        className="w-6 h-6 object-contain rounded-md"
                      />
                    </div>
                    <span
                      className={`text-sm font-medium truncate ${activePlatform === 'qq' ? 'text-primary' : 'text-foreground'}`}
                    >
                      {i18nService.t('qq')}
                    </span>
                  </div>
                  <span className="text-xs opacity-50">{qqExpanded ? '\u25BC' : '\u25B6'}</span>
                </div>
                {/* QQ Instance Sub-items */}
                {qqExpanded && (
                  <div className="ml-5 mt-1 space-y-1">
                    {config.qq.instances.map(inst => {
                      const instStatus = status.qq?.instances?.find(
                        s => s.instanceId === inst.instanceId,
                      );
                      const isSelected =
                        activePlatform === 'qq' && activeQQInstanceId === inst.instanceId;
                      const dotColor = !inst.enabled
                        ? 'bg-gray-400'
                        : instStatus?.connected
                          ? 'bg-green-500'
                          : 'bg-yellow-500';
                      return (
                        <div
                          key={inst.instanceId}
                          onClick={() => {
                            setActivePlatform('qq');
                            setActiveQQInstanceId(inst.instanceId);
                          }}
                          className={`flex items-center p-1.5 pl-2 rounded-lg cursor-pointer transition-colors text-sm ${
                            isSelected
                              ? 'bg-primary/10 dark:bg-primary/20'
                              : 'hover:bg-surface-raised'
                          }`}
                        >
                          <span className={`w-2 h-2 rounded-full ${dotColor} mr-2 shrink-0`} />
                          <span
                            className={`truncate flex-1 ${isSelected ? 'text-primary font-medium' : 'text-foreground'}`}
                          >
                            {inst.instanceName}
                          </span>
                        </div>
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
                <div
                  onClick={() => {
                    setActivePlatform('wecom');
                    setActiveWecomInstanceId(null);
                    setWecomExpanded(!wecomExpanded);
                  }}
                  className={`flex items-center p-2 rounded-xl cursor-pointer transition-colors ${
                    activePlatform === 'wecom'
                      ? 'bg-primary-muted border border-primary shadow-subtle'
                      : 'bg-surface hover:bg-surface-raised border border-transparent'
                  }`}
                >
                  <div className="flex flex-1 items-center">
                    <div className="mr-2 flex h-7 w-7 items-center justify-center">
                      <img
                        src={PlatformRegistry.logo('wecom')}
                        alt="WeCom"
                        className="w-6 h-6 object-contain rounded-md"
                      />
                    </div>
                    <span
                      className={`text-sm font-medium truncate ${activePlatform === 'wecom' ? 'text-primary' : 'text-foreground'}`}
                    >
                      {i18nService.t('wecom')}
                    </span>
                  </div>
                  <span className="text-xs opacity-50">{wecomExpanded ? '\u25BC' : '\u25B6'}</span>
                </div>
                {/* WeCom Instance Sub-items */}
                {wecomExpanded && (
                  <div className="ml-5 mt-1 space-y-1">
                    {config.wecom.instances.map(inst => {
                      const instStatus = status.wecom?.instances?.find(
                        s => s.instanceId === inst.instanceId,
                      );
                      const isSelected =
                        activePlatform === 'wecom' && activeWecomInstanceId === inst.instanceId;
                      const dotColor = !inst.enabled
                        ? 'bg-gray-400'
                        : instStatus?.connected
                          ? 'bg-green-500'
                          : 'bg-yellow-500';
                      return (
                        <div
                          key={inst.instanceId}
                          onClick={() => {
                            setActivePlatform('wecom');
                            setActiveWecomInstanceId(inst.instanceId);
                          }}
                          className={`flex items-center p-1.5 pl-2 rounded-lg cursor-pointer transition-colors text-sm ${
                            isSelected
                              ? 'bg-primary/10 dark:bg-primary/20'
                              : 'hover:bg-surface-raised'
                          }`}
                        >
                          <span className={`w-2 h-2 rounded-full ${dotColor} mr-2 shrink-0`} />
                          <span
                            className={`truncate flex-1 ${isSelected ? 'text-primary font-medium' : 'text-foreground'}`}
                          >
                            {inst.instanceName}
                          </span>
                        </div>
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
                <div
                  onClick={() => {
                    setActivePlatform('telegram');
                    setActiveTelegramInstanceId(null);
                    setTelegramExpanded(!telegramExpanded);
                  }}
                  className={`flex items-center p-2 rounded-xl cursor-pointer transition-colors ${
                    activePlatform === 'telegram'
                      ? 'bg-primary-muted border border-primary shadow-subtle'
                      : 'bg-surface hover:bg-surface-raised border border-transparent'
                  }`}
                >
                  <div className="flex flex-1 items-center">
                    <div className="mr-2 flex h-7 w-7 items-center justify-center">
                      <img
                        src={PlatformRegistry.logo('telegram')}
                        alt="Telegram"
                        className="w-6 h-6 object-contain rounded-md"
                      />
                    </div>
                    <span
                      className={`text-sm font-medium truncate ${activePlatform === 'telegram' ? 'text-primary' : 'text-foreground'}`}
                    >
                      {i18nService.t('telegram')}
                    </span>
                  </div>
                  <span className="text-xs opacity-50">{telegramExpanded ? '▼' : '▶'}</span>
                </div>
                {/* Telegram Instance Sub-items */}
                {telegramExpanded && (
                  <div className="ml-5 mt-1 space-y-1">
                    {config.telegram.instances.map(inst => {
                      const instStatus = status.telegram?.instances?.find(
                        s => s.instanceId === inst.instanceId,
                      );
                      const isSelected =
                        activePlatform === 'telegram' &&
                        activeTelegramInstanceId === inst.instanceId;
                      const dotColor = !inst.enabled
                        ? 'bg-gray-400'
                        : instStatus?.connected
                          ? 'bg-green-500'
                          : 'bg-yellow-500';
                      return (
                        <div
                          key={inst.instanceId}
                          onClick={() => {
                            setActivePlatform('telegram');
                            setActiveTelegramInstanceId(inst.instanceId);
                          }}
                          className={`flex items-center p-1.5 pl-2 rounded-lg cursor-pointer transition-colors text-sm ${
                            isSelected
                              ? 'bg-primary/10 dark:bg-primary/20'
                              : 'hover:bg-surface-raised'
                          }`}
                        >
                          <span className={`w-2 h-2 rounded-full ${dotColor} mr-2 shrink-0`} />
                          <span
                            className={`truncate flex-1 ${isSelected ? 'text-primary font-medium' : 'text-foreground'}`}
                          >
                            {inst.instanceName}
                          </span>
                        </div>
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
                <div
                  onClick={() => {
                    setActivePlatform('discord');
                    setActiveDiscordInstanceId(null);
                    setDiscordExpanded(!discordExpanded);
                  }}
                  className={`flex items-center p-2 rounded-xl cursor-pointer transition-colors ${
                    activePlatform === 'discord'
                      ? 'bg-primary-muted border border-primary shadow-subtle'
                      : 'bg-surface hover:bg-surface-raised border border-transparent'
                  }`}
                >
                  <div className="flex flex-1 items-center">
                    <div className="mr-2 flex h-7 w-7 items-center justify-center">
                      <img
                        src={PlatformRegistry.logo('discord')}
                        alt="Discord"
                        className="w-6 h-6 object-contain rounded-md"
                      />
                    </div>
                    <span
                      className={`text-sm font-medium truncate ${activePlatform === 'discord' ? 'text-primary' : 'text-foreground'}`}
                    >
                      {i18nService.t('discord')}
                    </span>
                  </div>
                  <span className="text-xs opacity-50">{discordExpanded ? '▼' : '▶'}</span>
                </div>
                {/* Discord Instance Sub-items */}
                {discordExpanded && (
                  <div className="ml-5 mt-1 space-y-1">
                    {config.discord.instances.map(inst => {
                      const instStatus = status.discord?.instances?.find(
                        s => s.instanceId === inst.instanceId,
                      );
                      const isSelected =
                        activePlatform === 'discord' && activeDiscordInstanceId === inst.instanceId;
                      const dotColor = !inst.enabled
                        ? 'bg-gray-400'
                        : instStatus?.connected
                          ? 'bg-green-500'
                          : 'bg-yellow-500';
                      return (
                        <div
                          key={inst.instanceId}
                          onClick={() => {
                            setActivePlatform('discord');
                            setActiveDiscordInstanceId(inst.instanceId);
                          }}
                          className={`flex items-center p-1.5 pl-2 rounded-lg cursor-pointer transition-colors text-sm ${
                            isSelected
                              ? 'bg-primary/10 dark:bg-primary/20'
                              : 'hover:bg-surface-raised'
                          }`}
                        >
                          <span className={`w-2 h-2 rounded-full ${dotColor} mr-2 shrink-0`} />
                          <span
                            className={`truncate flex-1 ${isSelected ? 'text-primary font-medium' : 'text-foreground'}`}
                          >
                            {inst.instanceName}
                          </span>
                        </div>
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
              onClick={() => setActivePlatform(platform)}
              className={`flex items-center p-2 rounded-xl cursor-pointer transition-colors ${
                activePlatform === platform
                  ? 'bg-primary-muted border border-primary shadow-subtle'
                  : 'bg-surface hover:bg-surface-raised border border-transparent'
              }`}
            >
              <div className="flex flex-1 items-center">
                <div className="mr-2 flex h-7 w-7 items-center justify-center">
                  <img
                    src={logo}
                    alt={i18nService.t(platform)}
                    className="w-6 h-6 object-contain rounded-md"
                  />
                </div>
                <span
                  className={`text-sm font-medium truncate ${
                    activePlatform === platform ? 'text-primary' : 'text-foreground'
                  }`}
                >
                  {i18nService.t(platform)}
                </span>
              </div>
              <div className="flex items-center ml-2">
                <div
                  className={`w-7 h-4 rounded-full flex items-center transition-colors ${
                    isEnabled
                      ? isConnected
                        ? 'bg-green-500'
                        : 'bg-yellow-500'
                      : 'bg-gray-400 dark:bg-gray-600'
                  } ${!canToggle || togglingPlatform === platform ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                  onClick={e => {
                    e.stopPropagation();
                    handlePlatformToggle(platform);
                  }}
                >
                  <div
                    className={`w-3 h-3 rounded-full bg-white shadow-md transform transition-transform ${
                      isEnabled ? 'translate-x-3.5' : 'translate-x-0.5'
                    }`}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Platform Settings - Right Side */}
      <div className="flex-1 min-w-0 pl-4 pr-2 space-y-4 overflow-y-auto scrollbar-gutter-stable">
        {/* Header with status (only for single-instance platforms without per-instance headers) */}
        {activePlatform === 'weixin' && (
          <div className="flex items-center gap-3 pb-3 border-b border-border-subtle">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-surface border border-border-subtle p-1">
                <img
                  src={PlatformRegistry.logo(activePlatform)}
                  alt={i18nService.t(activePlatform)}
                  className="w-4 h-4 object-contain rounded"
                />
              </div>
              <h3 className="text-sm font-medium text-foreground">
                {`${i18nService.t(activePlatform)}${i18nService.t('settings')}`}
              </h3>
            </div>
            <div
              className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                getPlatformConnected(activePlatform) || getPlatformStarting(activePlatform)
                  ? 'bg-green-500/15 text-green-600 dark:text-green-400'
                  : 'bg-gray-500/15 text-gray-500 dark:text-gray-400'
              }`}
            >
              {getPlatformConnected(activePlatform)
                ? i18nService.t('connected')
                : getPlatformStarting(activePlatform)
                  ? i18nService.t('starting') || '启动中'
                  : i18nService.t('disconnected')}
            </div>
          </div>
        )}

        {/* DingTalk Settings (multi-instance) */}
        {activePlatform === 'dingtalk' && !activeDingTalkInstanceId && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <img
              src={PlatformRegistry.logo('dingtalk')}
              alt="DingTalk"
              className="w-12 h-12 object-contain rounded-md mb-4 opacity-50"
            />
            <p className="text-sm text-muted-foreground mb-4">
              {config.dingtalk.instances.length === 0
                ? language === 'zh'
                  ? '尚未添加钉钉实例，点击下方按钮添加'
                  : 'No DingTalk instances yet. Click below to add one.'
                : language === 'zh'
                  ? '请在左侧选择一个钉钉实例'
                  : 'Select a DingTalk instance from the sidebar.'}
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
                language={language}
              />
            );
          })()}

        {/* Feishu Settings (multi-instance) */}
        {activePlatform === 'feishu' && !activeFeishuInstanceId && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <img
              src={PlatformRegistry.logo('feishu')}
              alt="Feishu"
              className="w-12 h-12 object-contain rounded-md mb-4 opacity-50"
            />
            <p className="text-sm text-muted-foreground mb-4">
              {config.feishu.instances.length === 0
                ? language === 'zh'
                  ? '尚未添加飞书实例，点击下方按钮添加'
                  : 'No Feishu instances yet. Click below to add one.'
                : language === 'zh'
                  ? '请在左侧选择一个飞书实例'
                  : 'Select a Feishu instance from the sidebar.'}
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
                language={language}
              />
            );
          })()}

        {/* QQ Settings (multi-instance) */}
        {activePlatform === 'qq' && !activeQQInstanceId && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <img
              src={PlatformRegistry.logo('qq')}
              alt="QQ"
              className="w-12 h-12 object-contain rounded-md mb-4 opacity-50"
            />
            <p className="text-sm text-muted-foreground mb-4">
              {config.qq.instances.length === 0
                ? language === 'zh'
                  ? '尚未添加 QQ 实例，点击下方按钮添加'
                  : 'No QQ instances yet. Click below to add one.'
                : language === 'zh'
                  ? '请在左侧选择一个 QQ 实例'
                  : 'Select a QQ instance from the sidebar.'}
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
                language={language}
              />
            );
          })()}

        {/* Telegram Settings (multi-instance) */}
        {activePlatform === 'telegram' && !activeTelegramInstanceId && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <img
              src={PlatformRegistry.logo('telegram')}
              alt="Telegram"
              className="w-12 h-12 object-contain rounded-md mb-4 opacity-50"
            />
            <p className="text-sm text-muted-foreground mb-4">
              {config.telegram.instances.length === 0
                ? language === 'zh'
                  ? '尚未添加 Telegram 实例，点击下方按钮添加'
                  : 'No Telegram instances yet. Click below to add one.'
                : language === 'zh'
                  ? '请在左侧选择一个 Telegram 实例'
                  : 'Select a Telegram instance from the sidebar.'}
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
                language={language}
              />
            );
          })()}

        {/* Discord Settings */}
        {activePlatform === 'discord' && !activeDiscordInstanceId && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <img
              src={PlatformRegistry.logo('discord')}
              alt="Discord"
              className="w-12 h-12 object-contain rounded-md mb-4 opacity-50"
            />
            <p className="text-sm text-muted-foreground mb-4">
              {config.discord.instances.length === 0
                ? language === 'zh'
                  ? '尚未添加 Discord 实例，点击下方按钮添加'
                  : 'No Discord instances yet. Click below to add one.'
                : language === 'zh'
                  ? '请在左侧选择一个 Discord 实例'
                  : 'Select a Discord instance from the sidebar.'}
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
                + {language === 'zh' ? '添加 Discord 实例' : 'Add Discord Instance'}
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
                language={language}
              />
            );
          })()}

        {/* Weixin (微信) Settings */}
        {activePlatform === 'weixin' && (
          <div className="space-y-3">
            {/* Scan QR code section */}
            <div className="rounded-lg border border-dashed border-border-subtle p-4 text-center space-y-3">
              {weixinQrStatus === 'idle' && (
                <>
                  <Button type="button" onClick={() => void handleWeixinQrLogin()}>
                    {i18nService.t('imWeixinScanBtn')}
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    {i18nService.t('imWeixinScanHint')}
                  </p>
                </>
              )}
              {weixinQrStatus === 'error' && (
                <>
                  <Button type="button" onClick={() => void handleWeixinQrLogin()}>
                    {i18nService.t('imWeixinScanBtn')}
                  </Button>
                  {weixinQrError && (
                    <div className="flex items-center justify-center gap-1.5 text-xs text-red-500 bg-red-500/10 px-3 py-2 rounded-lg">
                      <XCircle className="h-4 w-4 shrink-0" />
                      {weixinQrError}
                    </div>
                  )}
                </>
              )}
              {weixinQrStatus === 'loading' && (
                <div className="flex items-center justify-center gap-2 py-4">
                  <RefreshCw className="h-5 w-5 animate-spin text-primary" />
                  <span className="text-sm text-muted-foreground">
                    {i18nService.t('imWeixinQrLoading')}
                  </span>
                </div>
              )}
              {(weixinQrStatus === 'showing' ||
                weixinQrStatus === 'waiting' ||
                weixinQrStatus === 'expired') &&
                weixinQrUrl && (
                  <div className="space-y-3">
                    <p className="text-sm font-medium text-foreground">
                      {weixinQrStatus === 'expired'
                        ? i18nService.t('imWeixinQrExpired')
                        : i18nService.t('imWeixinQrScanPrompt')}
                    </p>
                    <div className="relative inline-block">
                      <div
                        className={`p-3 bg-white rounded-lg border border-border-subtle ${weixinQrStatus === 'expired' ? 'opacity-30' : ''}`}
                      >
                        <QRCodeSVG value={weixinQrUrl} size={192} />
                      </div>
                      {weixinQrStatus === 'expired' && (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <Button
                            type="button"
                            onClick={() => void handleWeixinQrLogin()}
                            className="shadow-lg"
                          >
                            <RefreshCw className="h-4 w-4 mr-1.5" />
                            {i18nService.t('imWeixinQrRefresh')}
                          </Button>
                        </div>
                      )}
                    </div>
                    {weixinQrStatus === 'waiting' && (
                      <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        {i18nService.t('imWeixinQrWaiting') || 'Waiting for scan...'}
                      </div>
                    )}
                  </div>
                )}
              {weixinQrStatus === 'success' && (
                <div className="flex items-center justify-center gap-1.5 text-xs text-green-600 dark:text-green-400 bg-green-500/10 px-3 py-2 rounded-lg">
                  <CheckCircle className="h-4 w-4 shrink-0" />
                  {i18nService.t('imWeixinQrSuccess')}
                </div>
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
              <div className="text-xs text-green-600 dark:text-green-400 bg-green-500/10 px-3 py-2 rounded-lg">
                Account ID: {weixinOpenClawConfig.accountId}
              </div>
            )}

            {/* Error display */}
            {status.weixin?.lastError && (
              <div className="text-xs text-red-500 bg-red-500/10 px-3 py-2 rounded-lg">
                {status.weixin.lastError}
              </div>
            )}

            {/* Advanced Settings (collapsible) */}
            <details className="group">
              <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-primary transition-colors">
                {i18nService.t('imAdvancedSettings')}
              </summary>
              <div className="mt-2 space-y-3 pl-2 border-l-2 border-border-subtle">
                {/* DM Policy */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-muted-foreground">
                    DM Policy
                  </label>
                  <Select
                    value={weixinOpenClawConfig.dmPolicy}
                    onValueChange={value => {
                      const update = { dmPolicy: value as WeixinOpenClawConfig['dmPolicy'] };
                      void imService.updateConfig({
                        weixin: { ...weixinOpenClawConfig, ...update },
                      });
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="open">{i18nService.t('imDmPolicyOpen')}</SelectItem>
                      <SelectItem value="pairing">{i18nService.t('imDmPolicyPairing')}</SelectItem>
                      <SelectItem value="allowlist">
                        {i18nService.t('imDmPolicyAllowlist')}
                      </SelectItem>
                      <SelectItem value="disabled">
                        {i18nService.t('imDmPolicyDisabled')}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Allow From */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-muted-foreground">
                    Allow From (User IDs)
                  </label>
                  <div className="flex gap-2">
                    <Input
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
                      {i18nService.t('add') || '添加'}
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
                            size="icon"
                            className="h-5 w-5 text-muted-foreground hover:text-red-500 dark:hover:text-red-400"
                            onClick={() => {
                              const newIds = weixinOpenClawConfig.allowFrom.filter(
                                uid => uid !== id,
                              );
                              void imService.updateConfig({
                                weixin: { ...weixinOpenClawConfig, allowFrom: newIds },
                              });
                            }}
                          >
                            <X className="w-3 h-3" />
                          </Button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
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
                      setWecomQuickSetupError(err.message || err.code || 'Unknown error');
                    }
                  }}
                  quickSetupStatus={wecomQuickSetupStatus}
                  quickSetupError={wecomQuickSetupError}
                  testingPlatform={testingPlatform}
                  connectivityResults={
                    connectivityResults as Record<string, IMConnectivityTestResult>
                  }
                  language={language}
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
                  className="w-12 h-12 object-contain rounded-md mb-4 opacity-50"
                />
                <p className="text-sm text-muted-foreground mb-4">
                  {wecomMultiConfig.instances.length === 0
                    ? language === 'zh'
                      ? '尚未添加企业微信实例，点击下方按钮添加'
                      : 'No WeCom instances yet. Click below to add one.'
                    : language === 'zh'
                      ? '请在左侧选择一个企业微信实例'
                      : 'Select a WeCom instance from the sidebar.'}
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
            overlayClassName="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
            className="w-full max-w-2xl bg-surface rounded-2xl shadow-modal border border-border overflow-hidden"
          >
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <div className="text-sm font-semibold text-foreground">
                {`${i18nService.t(connectivityModalPlatform)} ${i18nService.t('imConnectivitySectionTitle')}`}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={i18nService.t('close')}
                onClick={() => setConnectivityModalPlatform(null)}
                className="text-muted-foreground"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="p-4 max-h-[65vh] overflow-y-auto">
              {testingPlatform === connectivityModalPlatform ? (
                <div className="text-sm text-muted-foreground">
                  {i18nService.t('imConnectivityTesting')}
                </div>
              ) : connectivityResults[connectivityModalPlatform] ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${verdictColorClass[connectivityResults[connectivityModalPlatform]!.verdict]}`}
                    >
                      {connectivityResults[connectivityModalPlatform]!.verdict === 'pass' ? (
                        <CheckCircle className="h-3.5 w-3.5" />
                      ) : connectivityResults[connectivityModalPlatform]!.verdict === 'warn' ? (
                        <TriangleAlert className="h-3.5 w-3.5" />
                      ) : (
                        <XCircle className="h-3.5 w-3.5" />
                      )}
                      {i18nService.t(
                        `imConnectivityVerdict_${connectivityResults[connectivityModalPlatform]!.verdict}`,
                      )}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {`${i18nService.t('imConnectivityLastChecked')}: ${formatTestTime(connectivityResults[connectivityModalPlatform]!.testedAt)}`}
                    </div>
                  </div>

                  <div className="space-y-2">
                    {connectivityResults[connectivityModalPlatform]!.checks.map((check, index) => (
                      <div
                        key={`${check.code}-${index}`}
                        className="rounded-lg border border-border-subtle px-2.5 py-2 bg-surface"
                      >
                        <div className={`text-xs font-medium ${checkLevelColorClass[check.level]}`}>
                          {getCheckTitle(check.code)}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">{check.message}</div>
                        {getCheckSuggestion(check) && (
                          <div className="mt-1 text-[11px] text-muted-foreground">
                            {`${i18nService.t('imConnectivitySuggestion')}: ${getCheckSuggestion(check)}`}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">
                  {i18nService.t('imConnectivityNoResult')}
                </div>
              )}
            </div>

            <div className="px-4 py-3 border-t border-border flex items-center justify-end">
              {renderConnectivityTestButton(connectivityModalPlatform)}
            </div>
          </Modal>
        )}
      </div>
    </div>
  );
};

export default IMSettings;
