/**
 * IM Settings Component
 * Configuration UI for DingTalk, Feishu and Telegram IM bots
 *
 * Split into cohesive modules under ./imSettings/ (issue #1069). This file is
 * the composition root: it owns cross-panel state (active platform, selected
 * instances, wecom quick setup, weixin allow-from draft) and wires the
 * navigation, platform panels and connectivity hook together.
 */

import { Badge } from '@shared/components/ui/badge';
import type { Platform } from '@shared/platform';
import WecomAIBotSDK from '@wecom/wecom-aibot-sdk';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import { imPlatformLogo } from '../../assets/imLogos';
import { i18nService } from '../../services/i18n';
import { imService } from '../../services/im';
import { RootState } from '../../store';
import { clearError, setWeixinConfig, setWecomInstanceConfig } from '../../store/slices/imSlice';
import { getVisibleIMPlatforms } from '../../utils/regionFilter';
import { ConnectivityResultModal } from './imSettings/ConnectivityResultModal';
import { IMSettingsSkeleton } from './imSettings/IMSettingsSkeleton';
import { IMPlatformNav } from './imSettings/PlatformNav';
import {
  canStartIMPlatform,
  getIMPlatformConnected,
  getIMPlatformStarting,
  getNavInstances,
  isIMPlatformEnabled,
  type MultiInstancePlatform,
} from './imSettings/platformStatus';
import { useIMConnectivity } from './imSettings/useIMConnectivity';
import { DingTalkPanel } from './imSettings/panels/DingTalkPanel';
import { DiscordPanel } from './imSettings/panels/DiscordPanel';
import { FeishuPanel } from './imSettings/panels/FeishuPanel';
import { QQPanel } from './imSettings/panels/QQPanel';
import { TelegramPanel } from './imSettings/panels/TelegramPanel';
import { WeixinPanel } from './imSettings/panels/WeixinPanel';
import { WecomPanel } from './imSettings/panels/WecomPanel';

const INITIAL_ACTIVE_INSTANCE_IDS: Record<MultiInstancePlatform, string | null> = {
  dingtalk: null,
  feishu: null,
  qq: null,
  wecom: null,
  telegram: null,
  discord: null,
};

const INITIAL_NAV_EXPANDED: Record<MultiInstancePlatform, boolean> = {
  dingtalk: false,
  feishu: false,
  qq: false,
  wecom: false,
  telegram: false,
  discord: false,
};

const IMSettings: React.FC = () => {
  const dispatch = useDispatch();
  const { config, status, isLoading } = useSelector((state: RootState) => state.im);
  const workspaces = useSelector((state: RootState) => state.workspace.workspaces);
  const [activePlatform, setActivePlatform] = useState<Platform>('weixin');
  const [activeInstanceIds, setActiveInstanceIds] = useState(INITIAL_ACTIVE_INSTANCE_IDS);
  const [navExpanded, setNavExpanded] = useState(INITIAL_NAV_EXPANDED);
  const [language, setLanguage] = useState<'zh' | 'en'>(i18nService.getLanguage());
  const [configLoaded, setConfigLoaded] = useState(false);
  // Re-entrancy guard for gateway toggle to prevent rapid ON→OFF→ON
  const [togglingPlatform, setTogglingPlatform] = useState<Platform | null>(null);
  // WeCom quick setup state
  const [wecomQuickSetupStatus, setWecomQuickSetupStatus] = useState<
    'idle' | 'pending' | 'success' | 'error'
  >('idle');
  const [wecomQuickSetupError, setWecomQuickSetupError] = useState<string>('');
  const [weixinAllowFromInput, setWeixinAllowFromInput] = useState<string>('');
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

  // Reset wecom quick setup state when switching away from wecom
  useEffect(() => {
    if (activePlatform !== 'wecom') {
      setWecomQuickSetupStatus('idle');
      setWecomQuickSetupError('');
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

  // Handle Weixin channel config.
  const weixinConfig = config.weixin;

  // Get platform enabled state (persisted toggle state)
  const isPlatformEnabled = (platform: Platform): boolean => isIMPlatformEnabled(config, platform);

  // Check if platform can be started
  const canStart = (platform: Platform): boolean => canStartIMPlatform(config, platform);

  // Toggle gateway on/off and persist enabled state
  const toggleGateway = async (platform: Platform) => {
    // Re-entrancy guard: if a toggle is already in progress for this platform, bail out.
    // This prevents rapid ON→OFF→ON clicks from causing concurrent native SDK init/uninit.
    if (togglingPlatform === platform) return;
    setTogglingPlatform(platform);

    try {
      // Persisting config reconciles the corresponding channel sidecar.
      // Only updateConfig + loadStatus is required.
      // Pessimistic UI update: wait for IPC to complete before updating Redux state.
      // This prevents UI/backend state divergence when rapidly toggling, since the
      // The backend debounces account reconciliation.
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
        const newEnabled = !weixinConfig.enabled;
        const success = await imService.updateConfig({
          weixin: { enabled: newEnabled },
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

  const {
    testingPlatform,
    connectivityResults,
    connectivityFailures,
    connectivityModalPlatform,
    setConnectivityModalPlatform,
    handleConnectivityTest,
  } = useIMConnectivity({
    config,
    configLoaded,
    activeInstanceIds,
    isPlatformEnabled,
    toggleGateway,
  });

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

  // Multi-instance navigation: header click selects the platform, clears the
  // selected instance and toggles the group expansion.
  const handleNavHeaderClick = (platform: MultiInstancePlatform) => {
    setActivePlatform(platform);
    setActiveInstanceIds(prev => ({ ...prev, [platform]: null }));
    setNavExpanded(prev => ({
      ...prev,
      [platform]: getNavInstances(config, platform).length > 0 && !prev[platform],
    }));
  };

  const handleNavInstanceSelect = (platform: MultiInstancePlatform, instanceId: string) => {
    setActivePlatform(platform);
    setActiveInstanceIds(prev => ({ ...prev, [platform]: instanceId }));
  };

  const selectInstance = (platform: MultiInstancePlatform, instanceId: string | null) => {
    setActiveInstanceIds(prev => ({ ...prev, [platform]: instanceId }));
  };

  const handleInstanceAdded = (platform: MultiInstancePlatform, instanceId: string) => {
    setActiveInstanceIds(prev => ({ ...prev, [platform]: instanceId }));
    setNavExpanded(prev => ({ ...prev, [platform]: true }));
  };

  // WeCom quick setup: opens the WeCom AI bot SDK auth window and applies the
  // returned credentials. Lives here (not in WecomPanel) because it shares the
  // component-level mount guard and its status survives platform switches.
  const handleWecomQuickSetup = async (instanceId: string): Promise<void> => {
    setWecomQuickSetupStatus('pending');
    setWecomQuickSetupError('');
    try {
      const bot = await WecomAIBotSDK.openBotInfoAuthWindow({
        source: 'zhiyuan-ai',
      });
      if (!isMountedRef.current) return;
      dispatch(
        setWecomInstanceConfig({
          instanceId,
          config: { botId: bot.botid, secret: bot.secret, enabled: true },
        }),
      );
      dispatch(clearError());
      await imService.updateWecomInstanceConfig(instanceId, {
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
      setWecomQuickSetupError(err.message || err.code || i18nService.t('unknownError'));
    }
  };

  if (!configLoaded) {
    return <IMSettingsSkeleton />;
  }

  return (
    <div className="flex h-full gap-4">
      {/* Platform List - Left Side */}
      <IMPlatformNav
        platforms={platforms}
        activePlatform={activePlatform}
        config={config}
        status={status}
        navExpanded={navExpanded}
        activeInstanceIds={activeInstanceIds}
        togglingPlatform={togglingPlatform}
        isEnabled={isPlatformEnabled}
        canStart={canStart}
        onSelectPlatform={setActivePlatform}
        onToggleMultiInstanceHeader={handleNavHeaderClick}
        onSelectInstance={handleNavInstanceSelect}
        onPlatformToggle={handlePlatformToggle}
      />

      {/* Platform Settings - Right Side */}
      <div className="flex-1 min-w-0 pl-4 pr-2 flex flex-col gap-4 overflow-y-auto scrollbar-gutter-stable">
        {/* Header with status (only for single-instance platforms without per-instance headers) */}
        {activePlatform === 'weixin' && (
          <div className="flex items-center gap-3 pb-3 border-b border-border-subtle">
            <div className="flex items-center gap-2">
              <div className="flex size-7 items-center justify-center rounded-md bg-surface border border-border-subtle p-1">
                <img
                  src={imPlatformLogo(activePlatform)}
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
                getIMPlatformConnected(status, activePlatform)
                  ? 'default'
                  : getIMPlatformStarting(status, activePlatform)
                    ? 'outline'
                    : 'secondary'
              }
            >
              {getIMPlatformConnected(status, activePlatform)
                ? i18nService.t('connected')
                : getIMPlatformStarting(status, activePlatform)
                  ? i18nService.t('starting')
                  : i18nService.t('disconnected')}
            </Badge>
          </div>
        )}

        {/* DingTalk Settings (multi-instance) */}
        {activePlatform === 'dingtalk' && (
          <DingTalkPanel
            instances={config.dingtalk.instances}
            instanceStatuses={status.dingtalk?.instances}
            workspaces={workspaces}
            activeInstanceId={activeInstanceIds.dingtalk}
            onSelectInstance={instanceId => selectInstance('dingtalk', instanceId)}
            onInstanceAdded={instanceId => handleInstanceAdded('dingtalk', instanceId)}
            onTestConnectivity={() => handleConnectivityTest('dingtalk')}
            testingPlatform={testingPlatform}
            connectivityResults={connectivityResults}
          />
        )}

        {/* Feishu Settings (multi-instance) */}
        {activePlatform === 'feishu' && (
          <FeishuPanel
            instances={config.feishu.instances}
            instanceStatuses={status.feishu?.instances}
            workspaces={workspaces}
            activeInstanceId={activeInstanceIds.feishu}
            onSelectInstance={instanceId => selectInstance('feishu', instanceId)}
            onInstanceAdded={instanceId => handleInstanceAdded('feishu', instanceId)}
            onTestConnectivity={() => handleConnectivityTest('feishu')}
            testingPlatform={testingPlatform}
            connectivityResults={connectivityResults}
          />
        )}

        {/* QQ Settings (multi-instance) */}
        {activePlatform === 'qq' && (
          <QQPanel
            instances={config.qq.instances}
            instanceStatuses={status.qq?.instances}
            workspaces={workspaces}
            activeInstanceId={activeInstanceIds.qq}
            onSelectInstance={instanceId => selectInstance('qq', instanceId)}
            onInstanceAdded={instanceId => handleInstanceAdded('qq', instanceId)}
            onTestConnectivity={() => handleConnectivityTest('qq')}
            testingPlatform={testingPlatform}
            connectivityResults={connectivityResults}
          />
        )}

        {/* Telegram Settings (multi-instance) */}
        {activePlatform === 'telegram' && (
          <TelegramPanel
            instances={config.telegram.instances}
            instanceStatuses={status.telegram?.instances}
            workspaces={workspaces}
            activeInstanceId={activeInstanceIds.telegram}
            onSelectInstance={instanceId => selectInstance('telegram', instanceId)}
            onInstanceAdded={instanceId => handleInstanceAdded('telegram', instanceId)}
            onTestConnectivity={() => handleConnectivityTest('telegram')}
            testingPlatform={testingPlatform}
            connectivityResults={connectivityResults}
          />
        )}

        {/* Discord Settings */}
        {activePlatform === 'discord' && (
          <DiscordPanel
            instances={config.discord.instances}
            instanceStatuses={status.discord?.instances}
            workspaces={workspaces}
            activeInstanceId={activeInstanceIds.discord}
            onSelectInstance={instanceId => selectInstance('discord', instanceId)}
            onInstanceAdded={instanceId => handleInstanceAdded('discord', instanceId)}
            onTestConnectivity={() => handleConnectivityTest('discord')}
            testingPlatform={testingPlatform}
            connectivityResults={connectivityResults}
          />
        )}

        {/* Weixin (微信) Settings */}
        {activePlatform === 'weixin' && (
          <WeixinPanel
            weixinConfig={weixinConfig}
            workspaces={workspaces}
            allowFromInput={weixinAllowFromInput}
            onAllowFromInputChange={setWeixinAllowFromInput}
            connectivityTesting={testingPlatform === 'weixin'}
            hasConnectivityResult={!!connectivityResults.weixin}
            connectivityDisabled={isLoading || testingPlatform === 'weixin'}
            onTestConnectivity={() => handleConnectivityTest('weixin')}
            lastError={status.weixin?.lastError ?? null}
          />
        )}

        {/* WeCom (企业微信) Multi-Instance Settings */}
        {activePlatform === 'wecom' && (
          <WecomPanel
            instances={config.wecom.instances}
            instanceStatuses={status.wecom?.instances}
            workspaces={workspaces}
            activeInstanceId={activeInstanceIds.wecom}
            onSelectInstance={instanceId => selectInstance('wecom', instanceId)}
            onInstanceAdded={instanceId => handleInstanceAdded('wecom', instanceId)}
            configLoaded={configLoaded}
            onQuickSetup={handleWecomQuickSetup}
            quickSetupStatus={wecomQuickSetupStatus}
            quickSetupError={wecomQuickSetupError}
            onTestConnectivity={() => handleConnectivityTest('wecom')}
            testingPlatform={testingPlatform}
            connectivityResults={connectivityResults}
          />
        )}

        {connectivityModalPlatform && (
          <ConnectivityResultModal
            platform={connectivityModalPlatform}
            result={connectivityResults[connectivityModalPlatform]}
            failed={!!connectivityFailures[connectivityModalPlatform]}
            testing={testingPlatform === connectivityModalPlatform}
            onClose={() => setConnectivityModalPlatform(null)}
          />
        )}
      </div>
    </div>
  );
};

export default IMSettings;
