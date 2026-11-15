import { Badge } from '@shared/components/ui/badge';
import { Button } from '@shared/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@shared/components/ui/sheet';
import type { Platform } from '@shared/platform';
import WecomAIBotSDK from '@wecom/wecom-aibot-sdk';
import { Mail } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { EmailSkill } from '../email/constants';
import { imPlatformLogo } from '../../../assets/imLogos';
import { i18nService } from '../../../services/i18n';
import { imService } from '../../../services/im';
import { skillService } from '../../../services/skill';
import type { RootState } from '../../../store';
import { clearError, setWecomInstanceConfig } from '../../../store/slices/imSlice';
import { ConnectivityResultModal } from '../../im/imSettings/ConnectivityResultModal';
import { DingTalkPanel } from '../../im/imSettings/panels/DingTalkPanel';
import { FeishuPanel } from '../../im/imSettings/panels/FeishuPanel';
import { QQPanel } from '../../im/imSettings/panels/QQPanel';
import { WecomPanel } from '../../im/imSettings/panels/WecomPanel';
import { WeixinPanel } from '../../im/imSettings/panels/WeixinPanel';
import {
  canStartIMPlatform,
  getIMPlatformConnected,
  isIMPlatformEnabled,
  type MultiInstancePlatform,
} from '../../im/imSettings/platformStatus';
import { useIMConnectivity } from '../../im/imSettings/useIMConnectivity';
import { EmailSettingsPage } from '../email/EmailSettingsPage';

type ChannelKey = 'weixin' | 'wecom' | 'dingtalk' | 'feishu' | 'qq' | 'email';

const CHANNEL_ORDER: readonly ChannelKey[] = [
  'weixin',
  'wecom',
  'dingtalk',
  'feishu',
  'qq',
  'email',
];

export function ChannelsPage() {
  const dispatch = useDispatch();
  const { config, status, isLoading } = useSelector((state: RootState) => state.im);
  const workspaces = useSelector((state: RootState) => state.workspace.workspaces);

  const [configLoaded, setConfigLoaded] = useState(false);
  const [activeChannel, setActiveChannel] = useState<ChannelKey | null>(null);
  const [emailConfigured, setEmailConfigured] = useState(false);
  const [weixinAllowFromInput, setWeixinAllowFromInput] = useState('');
  const [wecomQuickSetupStatus, setWecomQuickSetupStatus] = useState<
    'idle' | 'pending' | 'success' | 'error'
  >('idle');
  const [wecomQuickSetupError, setWecomQuickSetupError] = useState('');
  const [activeInstanceIds, setActiveInstanceIds] = useState<
    Record<MultiInstancePlatform, string | null>
  >({
    dingtalk: null,
    feishu: null,
    qq: null,
    wecom: null,
  });

  useEffect(() => {
    let cancelled = false;
    void imService.init().then(() => {
      if (!cancelled) setConfigLoaded(true);
    });
    void skillService.getSkillConfig?.(EmailSkill.Id).then(cfg => {
      if (!cancelled && cfg && Object.values(cfg).some(v => Boolean(v))) {
        setEmailConfigured(true);
      }
    });
    return () => {
      cancelled = true;
      setConfigLoaded(false);
      imService.destroy();
    };
  }, []);

  const toggleWeixin = async (platform: Platform) => {
    if (platform !== 'weixin') return;
    await imService.updateConfig({ weixin: { enabled: !config.weixin.enabled } });
    await imService.loadStatus();
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
    isPlatformEnabled: platform => isIMPlatformEnabled(config, platform),
    toggleGateway: toggleWeixin,
  });

  const handleWecomQuickSetup = async (instanceId: string) => {
    setWecomQuickSetupStatus('pending');
    setWecomQuickSetupError('');
    try {
      const bot = await WecomAIBotSDK.openBotInfoAuthWindow({ source: 'zhiyuan-ai' });
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
      await imService.loadStatus();
      setWecomQuickSetupStatus('success');
    } catch (error) {
      setWecomQuickSetupStatus('error');
      setWecomQuickSetupError(
        error instanceof Error ? error.message : i18nService.t('unknownError'),
      );
    }
  };

  const getChannelStatusBadge = (channel: ChannelKey) => {
    if (channel === 'email') {
      return (
        <Badge variant={emailConfigured ? 'secondary' : 'outline'}>
          {emailConfigured
            ? i18nService.t('channelStatusConfigured')
            : i18nService.t('channelStatusUnconfigured')}
        </Badge>
      );
    }
    const connected = getIMPlatformConnected(status, channel);
    if (connected) {
      return <Badge variant="default">{i18nService.t('channelStatusConnected')}</Badge>;
    }
    const configured = isIMPlatformEnabled(config, channel) || canStartIMPlatform(config, channel);
    return (
      <Badge variant={configured ? 'secondary' : 'outline'}>
        {configured
          ? i18nService.t('channelStatusConfigured')
          : i18nService.t('channelStatusUnconfigured')}
      </Badge>
    );
  };

  const getChannelTitle = (channel: ChannelKey) =>
    channel === 'email' ? i18nService.t('emailSettings') : i18nService.t(channel);

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">{i18nService.t('channelsPageDescription')}</p>

      <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
        {CHANNEL_ORDER.map(channel => {
          const configured =
            channel === 'email'
              ? emailConfigured
              : isIMPlatformEnabled(config, channel) || canStartIMPlatform(config, channel);
          return (
            <div key={channel} className="flex items-center justify-between gap-4 px-4 py-3.5">
              <div className="flex min-w-0 items-center gap-3">
                <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-background p-1.5">
                  {channel === 'email' ? (
                    <Mail className="size-4 text-muted-foreground" />
                  ) : (
                    <img
                      src={imPlatformLogo(channel)}
                      alt={getChannelTitle(channel)}
                      className="size-4 rounded object-contain"
                    />
                  )}
                </span>
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="text-sm font-medium text-foreground">
                    {getChannelTitle(channel)}
                  </span>
                  {getChannelStatusBadge(channel)}
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={() => setActiveChannel(channel)}
              >
                {configured ? i18nService.t('edit') : i18nService.t('configure')}
              </Button>
            </div>
          );
        })}
      </div>

      <Sheet
        open={Boolean(activeChannel)}
        onOpenChange={open => {
          if (!open) setActiveChannel(null);
        }}
      >
        <SheetContent side="right" className="w-full sm:max-w-[480px]">
          <SheetHeader>
            <SheetTitle>{activeChannel ? getChannelTitle(activeChannel) : ''}</SheetTitle>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-4 pb-6">
            {activeChannel === 'weixin' && (
              <WeixinPanel
                weixinConfig={config.weixin}
                workspaces={workspaces}
                allowFromInput={weixinAllowFromInput}
                onAllowFromInputChange={setWeixinAllowFromInput}
                connectivityTesting={testingPlatform === 'weixin'}
                hasConnectivityResult={Boolean(connectivityResults.weixin)}
                connectivityDisabled={isLoading || testingPlatform === 'weixin'}
                onTestConnectivity={() => handleConnectivityTest('weixin')}
                lastError={status.weixin?.lastError ?? null}
              />
            )}
            {activeChannel === 'wecom' && (
              <WecomPanel
                instances={config.wecom.instances}
                instanceStatuses={status.wecom?.instances}
                workspaces={workspaces}
                activeInstanceId={activeInstanceIds.wecom}
                onSelectInstance={id => setActiveInstanceIds(prev => ({ ...prev, wecom: id }))}
                onInstanceAdded={id => setActiveInstanceIds(prev => ({ ...prev, wecom: id }))}
                configLoaded={configLoaded}
                onQuickSetup={handleWecomQuickSetup}
                quickSetupStatus={wecomQuickSetupStatus}
                quickSetupError={wecomQuickSetupError}
                onTestConnectivity={() => handleConnectivityTest('wecom')}
                testingPlatform={testingPlatform}
                connectivityResults={connectivityResults}
              />
            )}
            {activeChannel === 'dingtalk' && (
              <DingTalkPanel
                instances={config.dingtalk.instances}
                instanceStatuses={status.dingtalk?.instances}
                workspaces={workspaces}
                activeInstanceId={activeInstanceIds.dingtalk}
                onSelectInstance={id => setActiveInstanceIds(prev => ({ ...prev, dingtalk: id }))}
                onInstanceAdded={id => setActiveInstanceIds(prev => ({ ...prev, dingtalk: id }))}
                onTestConnectivity={() => handleConnectivityTest('dingtalk')}
                testingPlatform={testingPlatform}
                connectivityResults={connectivityResults}
              />
            )}
            {activeChannel === 'feishu' && (
              <FeishuPanel
                instances={config.feishu.instances}
                instanceStatuses={status.feishu?.instances}
                workspaces={workspaces}
                activeInstanceId={activeInstanceIds.feishu}
                onSelectInstance={id => setActiveInstanceIds(prev => ({ ...prev, feishu: id }))}
                onInstanceAdded={id => setActiveInstanceIds(prev => ({ ...prev, feishu: id }))}
                onTestConnectivity={() => handleConnectivityTest('feishu')}
                testingPlatform={testingPlatform}
                connectivityResults={connectivityResults}
              />
            )}
            {activeChannel === 'qq' && (
              <QQPanel
                instances={config.qq.instances}
                instanceStatuses={status.qq?.instances}
                workspaces={workspaces}
                activeInstanceId={activeInstanceIds.qq}
                onSelectInstance={id => setActiveInstanceIds(prev => ({ ...prev, qq: id }))}
                onInstanceAdded={id => setActiveInstanceIds(prev => ({ ...prev, qq: id }))}
                onTestConnectivity={() => handleConnectivityTest('qq')}
                testingPlatform={testingPlatform}
                connectivityResults={connectivityResults}
              />
            )}
            {activeChannel === 'email' && <EmailSettingsPage />}
          </div>
        </SheetContent>
      </Sheet>

      {connectivityModalPlatform && (
        <ConnectivityResultModal
          platform={connectivityModalPlatform}
          result={connectivityResults[connectivityModalPlatform]}
          failed={Boolean(connectivityFailures[connectivityModalPlatform])}
          testing={testingPlatform === connectivityModalPlatform}
          onClose={() => setConnectivityModalPlatform(null)}
        />
      )}
    </div>
  );
}
