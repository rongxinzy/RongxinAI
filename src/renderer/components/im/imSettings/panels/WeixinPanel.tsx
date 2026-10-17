/**
 * Weixin (微信) settings panel for the IM settings view.
 * Extracted from IMSettings.tsx (issue #1069); callback behavior is unchanged.
 * The allow-from input draft lives in IMSettings so it survives platform
 * switches, exactly as before the split.
 */
import { Button } from '@shared/components/ui/button';
import { Input } from '@shared/components/ui/input';
import { PlatformRegistry } from '@shared/platform';
import type { Workspace } from '@shared/workspace';
import { X } from 'lucide-react';
import React from 'react';
import { useDispatch } from 'react-redux';

import { i18nService } from '../../../../services/i18n';
import { imService } from '../../../../services/im';
import { clearError, setWeixinConfig } from '../../../../store/slices/imSlice';
import type { WeixinChannelConfig } from '../../../../types/im';
import { ChannelWorkspaceField } from '../../ChannelWorkspaceField';
import { IMField, IMSelectField, IMStatusAlert } from '../../IMFormControls';
import { WeixinLoginPanel } from '../../WeixinLoginPanel';
import { ConnectivityTestButton } from '../ConnectivityTestButton';
import { PlatformGuide } from '../PlatformGuide';

export interface WeixinPanelProps {
  weixinConfig: WeixinChannelConfig;
  workspaces: Workspace[];
  allowFromInput: string;
  onAllowFromInputChange: (value: string) => void;
  connectivityTesting: boolean;
  hasConnectivityResult: boolean;
  connectivityDisabled: boolean;
  onTestConnectivity: () => void;
  /** Current weixin runtime status error, if any. */
  lastError: string | null;
}

export const WeixinPanel: React.FC<WeixinPanelProps> = ({
  weixinConfig,
  workspaces,
  allowFromInput,
  onAllowFromInputChange,
  connectivityTesting,
  hasConnectivityResult,
  connectivityDisabled,
  onTestConnectivity,
  lastError,
}) => {
  const dispatch = useDispatch();

  const addAllowFromId = () => {
    const id = allowFromInput.trim();
    if (id && !weixinConfig.allowFrom.includes(id)) {
      const newIds = [...weixinConfig.allowFrom, id];
      onAllowFromInputChange('');
      void imService.updateConfig({
        weixin: { allowFrom: newIds },
      });
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <ChannelWorkspaceField
        accountId={weixinConfig.accountId || 'weixin'}
        workspaceId={weixinConfig.workspaceId}
        workspaces={workspaces}
        onChange={workspaceId => {
          dispatch(setWeixinConfig({ workspaceId }));
          void imService.updateConfig({ weixin: { workspaceId } });
        }}
      />
      {/* Platform Guide */}
      <PlatformGuide
        steps={[
          i18nService.t('imWeixinGuideStep1'),
          i18nService.t('imWeixinGuideStep2'),
          i18nService.t('imWeixinGuideStep3'),
        ]}
        guideUrl={PlatformRegistry.guideUrl('weixin')}
      />

      <WeixinLoginPanel
        onConfirmed={async () => {
          await imService.loadConfig();
          await imService.loadStatus();
          dispatch(clearError());
        }}
      />

      {/* Connectivity test */}
      <div className="pt-1">
        <ConnectivityTestButton
          testing={connectivityTesting}
          hasResult={hasConnectivityResult}
          disabled={connectivityDisabled}
          onClick={onTestConnectivity}
        />
      </div>

      {/* Account ID display */}
      {weixinConfig.accountId && (
        <IMStatusAlert>
          {i18nService.t('imAccountId')}: {weixinConfig.accountId}
        </IMStatusAlert>
      )}

      {/* Error display */}
      {lastError && <IMStatusAlert error>{lastError}</IMStatusAlert>}

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
            value={weixinConfig.dmPolicy}
            options={[
              { value: 'open', label: i18nService.t('imDmPolicyOpen') },
              { value: 'pairing', label: i18nService.t('imDmPolicyPairing') },
              { value: 'allowlist', label: i18nService.t('imDmPolicyAllowlist') },
              { value: 'disabled', label: i18nService.t('imDmPolicyDisabled') },
            ]}
            onValueChange={value => {
              const update = { dmPolicy: value as WeixinChannelConfig['dmPolicy'] };
              void imService.updateConfig({
                weixin: update,
              });
            }}
          />

          {/* Allow From */}
          <IMField id="weixin-allow-user" label={i18nService.t('imAllowFromUserIds')}>
            <div className="flex gap-2">
              <Input
                id="weixin-allow-user"
                type="text"
                value={allowFromInput}
                onChange={e => onAllowFromInputChange(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addAllowFromId();
                  }
                }}
                className="flex-1"
                placeholder="wxid_xxx@im.wechat"
              />
              <Button type="button" variant="outline" size="sm" onClick={addAllowFromId}>
                {i18nService.t('add')}
              </Button>
            </div>
            {weixinConfig.allowFrom.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {weixinConfig.allowFrom.map(id => (
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
                        const newIds = weixinConfig.allowFrom.filter(uid => uid !== id);
                        void imService.updateConfig({
                          weixin: { allowFrom: newIds },
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
  );
};
