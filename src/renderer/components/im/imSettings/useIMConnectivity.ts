/**
 * Connectivity testing state and orchestration for the IM settings view.
 *
 * Extracted from IMSettings.tsx (issue #1069). The handler bodies must stay
 * behavior-identical to the originals: same persist/test/auto-enable sequence,
 * same re-entrancy guards, same failure bookkeeping.
 */
import type { Platform } from '@shared/platform';
import { useEffect, useState } from 'react';
import { useDispatch } from 'react-redux';

import { imService } from '../../../services/im';
import {
  setDingTalkInstanceConfig,
  setDiscordInstanceConfig,
  setFeishuInstanceConfig,
  setQQInstanceConfig,
  setTelegramInstanceConfig,
  setWecomInstanceConfig,
} from '../../../store/slices/imSlice';
import type { IMConnectivityTestResult, IMGatewayConfig } from '../../../types/im';
import type { MultiInstancePlatform } from './platformStatus';

const AUTH_CHECK_CODE = 'auth_check';

const hasPassedAuthCheck = (result: IMConnectivityTestResult): boolean => {
  const authCheck = result.checks.find(c => c.code === AUTH_CHECK_CODE);
  return !!authCheck && authCheck.level === 'pass';
};

/**
 * Auto-enable after a connectivity test: only when the instance exists, is
 * currently disabled and the auth_check passed. Mirrors the per-platform
 * `if (inst && !inst.enabled) { ... }` blocks from the original handler.
 */
const maybeAutoEnableInstance = async (
  result: IMConnectivityTestResult,
  instance: { enabled: boolean } | undefined,
  enable: () => Promise<void>,
): Promise<void> => {
  if (!instance || instance.enabled || !hasPassedAuthCheck(result)) return;
  await enable();
};

interface UseIMConnectivityOptions {
  config: IMGatewayConfig;
  configLoaded: boolean;
  activeInstanceIds: Record<MultiInstancePlatform, string | null>;
  isPlatformEnabled: (platform: Platform) => boolean;
  toggleGateway: (platform: Platform) => Promise<void>;
}

interface UseIMConnectivityResult {
  testingPlatform: Platform | null;
  connectivityResults: Partial<Record<Platform, IMConnectivityTestResult>>;
  connectivityFailures: Partial<Record<Platform, true>>;
  connectivityModalPlatform: Platform | null;
  setConnectivityModalPlatform: (platform: Platform | null) => void;
  runConnectivityTest: (
    platform: Platform,
    configOverride?: Partial<IMGatewayConfig>,
    accountId?: string,
  ) => Promise<IMConnectivityTestResult | null>;
  handleConnectivityTest: (platform: Platform) => Promise<void>;
}

export const useIMConnectivity = ({
  config,
  configLoaded,
  activeInstanceIds,
  isPlatformEnabled,
  toggleGateway,
}: UseIMConnectivityOptions): UseIMConnectivityResult => {
  const dispatch = useDispatch();
  const [testingPlatform, setTestingPlatform] = useState<Platform | null>(null);
  const [connectivityResults, setConnectivityResults] = useState<
    Partial<Record<Platform, IMConnectivityTestResult>>
  >({});
  const [connectivityFailures, setConnectivityFailures] = useState<Partial<Record<Platform, true>>>(
    {},
  );
  const [connectivityModalPlatform, setConnectivityModalPlatform] = useState<Platform | null>(null);

  const runConnectivityTest = async (
    platform: Platform,
    configOverride?: Partial<IMGatewayConfig>,
    accountId?: string,
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
      if (!(await imService.syncPendingConfig())) {
        setConnectivityFailures(prev => ({ ...prev, [platform]: true }));
        return null;
      }
      const result = await imService.testGateway(platform, configOverride, accountId);
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

  const handleConnectivityTest = async (platform: Platform) => {
    // Re-entrancy guard: if a test is already running, do nothing.
    if (testingPlatform) return;

    setConnectivityModalPlatform(platform);
    setTestingPlatform(platform);

    try {
      // For Telegram, persist telegram config and test (multi-instance)
      if (platform === 'telegram') {
        await imService.persistConfig({ telegram: config.telegram });
        const result = await runConnectivityTest(
          platform,
          {
            telegram: config.telegram,
          } as Partial<IMGatewayConfig>,
          activeInstanceIds.telegram ?? undefined,
        );
        // Auto-enable: if the active instance is OFF and auth_check passed, turn on automatically
        const activeId = activeInstanceIds.telegram;
        if (activeId && result) {
          const inst = config.telegram.instances.find(i => i.instanceId === activeId);
          await maybeAutoEnableInstance(result, inst, async () => {
            dispatch(
              setTelegramInstanceConfig({ instanceId: activeId, config: { enabled: true } }),
            );
            await imService.updateTelegramInstanceConfig(activeId, { enabled: true });
          });
        }
        return;
      }

      // Persist DingTalk config and test connectivity.
      if (platform === 'dingtalk') {
        await imService.persistConfig({ dingtalk: config.dingtalk });
        const result = await runConnectivityTest(
          platform,
          {
            dingtalk: config.dingtalk,
          } as Partial<IMGatewayConfig>,
          activeInstanceIds.dingtalk ?? undefined,
        );
        // Auto-enable: if the active instance is OFF and auth_check passed, turn on automatically
        const activeId = activeInstanceIds.dingtalk;
        if (activeId && result) {
          const inst = config.dingtalk.instances.find(i => i.instanceId === activeId);
          await maybeAutoEnableInstance(result, inst, async () => {
            dispatch(
              setDingTalkInstanceConfig({ instanceId: activeId, config: { enabled: true } }),
            );
            await imService.updateDingTalkInstanceConfig(activeId, { enabled: true });
          });
        }
        return;
      }

      // Persist QQ config and test connectivity.
      if (platform === 'qq') {
        await imService.persistConfig({ qq: config.qq });
        const result = await runConnectivityTest(
          platform,
          {
            qq: config.qq,
          } as Partial<IMGatewayConfig>,
          activeInstanceIds.qq ?? undefined,
        );
        // Auto-enable: if the active instance is OFF and auth_check passed, turn on automatically
        const activeId = activeInstanceIds.qq;
        if (activeId && result) {
          const inst = config.qq.instances.find(i => i.instanceId === activeId);
          await maybeAutoEnableInstance(result, inst, async () => {
            dispatch(setQQInstanceConfig({ instanceId: activeId, config: { enabled: true } }));
            await imService.updateQQInstanceConfig(activeId, { enabled: true });
          });
        }
        return;
      }

      // Persist WeCom config and test connectivity.
      if (platform === 'wecom') {
        const wecomMultiConfig = config.wecom;
        await imService.persistConfig({ wecom: wecomMultiConfig });
        const result = await runConnectivityTest(
          platform,
          {
            wecom: wecomMultiConfig,
          } as Partial<IMGatewayConfig>,
          activeInstanceIds.wecom ?? undefined,
        );
        // Auto-enable: if the active instance is OFF and auth_check passed, turn on automatically
        const activeId = activeInstanceIds.wecom;
        if (activeId && result) {
          const inst = wecomMultiConfig.instances.find(i => i.instanceId === activeId);
          await maybeAutoEnableInstance(result, inst, async () => {
            dispatch(setWecomInstanceConfig({ instanceId: activeId, config: { enabled: true } }));
            await imService.updateWecomInstanceConfig(activeId, { enabled: true });
          });
        }
        return;
      }

      // Persist Weixin config and test connectivity.
      if (platform === 'weixin') {
        const result = await runConnectivityTest(platform);
        if (!config.weixin.enabled && result) {
          if (hasPassedAuthCheck(result)) {
            toggleGateway(platform);
          }
        }
        return;
      }

      // Persist Feishu config and test connectivity.
      if (platform === 'feishu') {
        await imService.persistConfig({ feishu: config.feishu });
        const result = await runConnectivityTest(
          platform,
          {
            feishu: config.feishu,
          } as Partial<IMGatewayConfig>,
          activeInstanceIds.feishu ?? undefined,
        );
        // Auto-enable: if the active instance is OFF and auth_check passed, turn on automatically
        const activeId = activeInstanceIds.feishu;
        if (activeId && result) {
          const inst = config.feishu.instances.find(i => i.instanceId === activeId);
          await maybeAutoEnableInstance(result, inst, async () => {
            dispatch(setFeishuInstanceConfig({ instanceId: activeId, config: { enabled: true } }));
            await imService.updateFeishuInstanceConfig(activeId, { enabled: true });
          });
        }
        return;
      }
      // Persist Discord config and test connectivity.
      if (platform === 'discord') {
        await imService.persistConfig({ discord: config.discord });
        const result = await runConnectivityTest(
          platform,
          {
            discord: config.discord,
          } as Partial<IMGatewayConfig>,
          activeInstanceIds.discord ?? undefined,
        );
        const activeId = activeInstanceIds.discord;
        if (activeId && result) {
          const inst = config.discord.instances.find(i => i.instanceId === activeId);
          await maybeAutoEnableInstance(result, inst, async () => {
            dispatch(setDiscordInstanceConfig({ instanceId: activeId, config: { enabled: true } }));
            await imService.updateDiscordInstanceConfig(activeId, { enabled: true });
          });
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
        if (hasPassedAuthCheck(result)) {
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

  // Close the connectivity modal on Escape
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

  return {
    testingPlatform,
    connectivityResults,
    connectivityFailures,
    connectivityModalPlatform,
    setConnectivityModalPlatform,
    runConnectivityTest,
    handleConnectivityTest,
  };
};
