/**
 * WeCom (企业微信) settings panel (multi-instance) for the IM settings view.
 * Extracted from IMSettings.tsx (issue #1069); callback behavior is unchanged.
 * The WeCom quick-setup flow (SDK auth window) stays in IMSettings because it
 * shares component-level mount tracking and quick-setup status state.
 */
import { Button } from '@shared/components/ui/button';
import React from 'react';
import { useDispatch } from 'react-redux';

import { imPlatformLogo } from '../../../../assets/imLogos';
import { i18nService } from '../../../../services/i18n';
import { imService } from '../../../../services/im';
import { setWecomInstanceConfig } from '../../../../store/slices/imSlice';
import type {
  IMConnectivityTestResult,
  WecomInstanceConfig,
  WecomInstanceStatus,
} from '../../../../types/im';
import { MAX_WECOM_INSTANCES } from '../../../../types/im';
import { ChannelWorkspaceField } from '../../ChannelWorkspaceField';
import WecomInstanceSettings from '../../WecomInstanceSettings';
import type { MultiInstancePanelProps } from './panelProps';

export interface WecomPanelProps extends MultiInstancePanelProps {
  instances: WecomInstanceConfig[];
  instanceStatuses: WecomInstanceStatus[] | undefined;
  configLoaded: boolean;
  quickSetupStatus: 'idle' | 'pending' | 'success' | 'error';
  quickSetupError: string;
  onQuickSetup: (instanceId: string) => Promise<void>;
}

export const WecomPanel: React.FC<WecomPanelProps> = ({
  instances,
  instanceStatuses,
  workspaces,
  activeInstanceId,
  onSelectInstance,
  onInstanceAdded,
  configLoaded,
  onQuickSetup,
  quickSetupStatus,
  quickSetupError,
  onTestConnectivity,
  testingPlatform,
  connectivityResults,
}) => {
  const dispatch = useDispatch();

  const activeInstance = activeInstanceId
    ? instances.find(i => i.instanceId === activeInstanceId)
    : null;
  const activeStatus = activeInstanceId
    ? instanceStatuses?.find(s => s.instanceId === activeInstanceId)
    : undefined;

  if (activeInstance && activeInstanceId) {
    return (
      <div className="flex flex-col gap-4">
        <ChannelWorkspaceField
          accountId={activeInstance.instanceId}
          workspaceId={activeInstance.workspaceId}
          workspaces={workspaces}
          onChange={workspaceId => {
            dispatch(
              setWecomInstanceConfig({
                instanceId: activeInstanceId,
                config: { workspaceId },
              }),
            );
            void imService.updateWecomInstanceConfig(activeInstanceId, {
              workspaceId,
            });
          }}
        />
        <WecomInstanceSettings
          instance={activeInstance}
          instanceStatus={activeStatus}
          onConfigChange={update => {
            dispatch(
              setWecomInstanceConfig({
                instanceId: activeInstanceId,
                config: update,
              }),
            );
          }}
          onSave={async override => {
            if (!configLoaded) return;
            const configToSave = override ? { ...activeInstance, ...override } : activeInstance;
            await imService.persistWecomInstanceConfig(activeInstanceId, configToSave);
          }}
          onRename={async newName => {
            dispatch(
              setWecomInstanceConfig({
                instanceId: activeInstanceId,
                config: { instanceName: newName } as any,
              }),
            );
            await imService.persistWecomInstanceConfig(activeInstanceId, {
              instanceName: newName,
            } as any);
          }}
          onDelete={async () => {
            await imService.deleteWecomInstance(activeInstanceId);
            onSelectInstance(null);
          }}
          onToggleEnabled={async () => {
            const newEnabled = !activeInstance.enabled;
            dispatch(
              setWecomInstanceConfig({
                instanceId: activeInstanceId,
                config: { enabled: newEnabled },
              }),
            );
            await imService.updateWecomInstanceConfig(activeInstanceId, {
              enabled: newEnabled,
            });
          }}
          onTestConnectivity={() => void onTestConnectivity()}
          onQuickSetup={() => onQuickSetup(activeInstanceId)}
          quickSetupStatus={quickSetupStatus}
          quickSetupError={quickSetupError}
          testingPlatform={testingPlatform}
          connectivityResults={connectivityResults as Record<string, IMConnectivityTestResult>}
        />
      </div>
    );
  }

  // No instance selected - show placeholder
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <img
        src={imPlatformLogo('wecom')}
        alt="WeCom"
        className="size-12 object-contain rounded-md mb-4 opacity-50"
      />
      <p className="text-sm text-muted-foreground mb-4">
        {instances.length === 0
          ? i18nService.t('imNoInstances').replace('{platform}', i18nService.t('wecom'))
          : i18nService.t('imSelectInstance').replace('{platform}', i18nService.t('wecom'))}
      </p>
      {instances.length < MAX_WECOM_INSTANCES && (
        <Button
          type="button"
          variant="outline"
          onClick={async e => {
            e.stopPropagation();
            const name = `WeCom Bot ${instances.length + 1}`;
            const inst = await imService.addWecomInstance(name);
            if (inst) {
              onInstanceAdded(inst.instanceId);
            }
          }}
        >
          + {i18nService.t('imWecomAddInstance')}
        </Button>
      )}
    </div>
  );
};
