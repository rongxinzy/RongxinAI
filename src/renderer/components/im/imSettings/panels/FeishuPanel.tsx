/**
 * Feishu settings panel (multi-instance) for the IM settings view.
 * Extracted from IMSettings.tsx (issue #1069); callback behavior is unchanged.
 */
import { Button } from '@shared/components/ui/button';
import React from 'react';
import { useDispatch } from 'react-redux';

import { imPlatformLogo } from '../../../../assets/imLogos';
import { i18nService } from '../../../../services/i18n';
import { imService } from '../../../../services/im';
import { clearError, setFeishuInstanceConfig } from '../../../../store/slices/imSlice';
import type { FeishuInstanceConfig, FeishuInstanceStatus } from '../../../../types/im';
import { MAX_FEISHU_INSTANCES } from '../../../../types/im';
import { ChannelWorkspaceField } from '../../ChannelWorkspaceField';
import FeishuInstanceSettings from '../../FeishuInstanceSettings';
import type { MultiInstancePanelProps } from './panelProps';

export interface FeishuPanelProps extends MultiInstancePanelProps {
  instances: FeishuInstanceConfig[];
  instanceStatuses: FeishuInstanceStatus[] | undefined;
}

export const FeishuPanel: React.FC<FeishuPanelProps> = ({
  instances,
  instanceStatuses,
  workspaces,
  activeInstanceId,
  onSelectInstance,
  onInstanceAdded,
  onTestConnectivity,
  testingPlatform,
  connectivityResults,
}) => {
  const dispatch = useDispatch();

  if (!activeInstanceId) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <img
          src={imPlatformLogo('feishu')}
          alt="Feishu"
          className="size-12 object-contain rounded-md mb-4 opacity-50"
        />
        <p className="text-sm text-muted-foreground mb-4">
          {instances.length === 0
            ? i18nService.t('imNoInstances').replace('{platform}', i18nService.t('feishu'))
            : i18nService.t('imSelectInstance').replace('{platform}', i18nService.t('feishu'))}
        </p>
        {instances.length < MAX_FEISHU_INSTANCES && (
          <Button
            type="button"
            variant="outline"
            onClick={async e => {
              e.stopPropagation();
              const inst = await imService.addFeishuInstance(`Feishu Bot ${instances.length + 1}`);
              if (inst) {
                onInstanceAdded(inst.instanceId);
              }
            }}
          >
            + {i18nService.t('imFeishuAddInstance')}
          </Button>
        )}
      </div>
    );
  }

  const selectedInstance = instances.find(i => i.instanceId === activeInstanceId);
  if (!selectedInstance) return null;
  const selectedStatus = instanceStatuses?.find(s => s.instanceId === activeInstanceId);
  return (
    <div className="flex flex-col gap-4">
      <ChannelWorkspaceField
        accountId={selectedInstance.instanceId}
        workspaceId={selectedInstance.workspaceId}
        workspaces={workspaces}
        onChange={workspaceId => {
          dispatch(
            setFeishuInstanceConfig({
              instanceId: activeInstanceId,
              config: { workspaceId },
            }),
          );
          void imService.updateFeishuInstanceConfig(activeInstanceId, {
            workspaceId,
          });
        }}
      />
      <FeishuInstanceSettings
        instance={selectedInstance}
        instanceStatus={selectedStatus}
        onConfigChange={update => {
          dispatch(
            setFeishuInstanceConfig({
              instanceId: activeInstanceId,
              config: update,
            }),
          );
        }}
        onSave={async override => {
          const configToSave = override ? { ...selectedInstance, ...override } : selectedInstance;
          if (selectedInstance.enabled) {
            await imService.updateFeishuInstanceConfig(activeInstanceId, configToSave);
          } else {
            await imService.persistFeishuInstanceConfig(activeInstanceId, configToSave);
          }
        }}
        onRename={async newName => {
          dispatch(
            setFeishuInstanceConfig({
              instanceId: activeInstanceId,
              config: { instanceName: newName } as any,
            }),
          );
          await imService.persistFeishuInstanceConfig(activeInstanceId, {
            instanceName: newName,
          } as any);
        }}
        onDelete={async () => {
          await imService.deleteFeishuInstance(activeInstanceId);
          const remaining = instances.filter(i => i.instanceId !== activeInstanceId);
          onSelectInstance(remaining.length > 0 ? remaining[0].instanceId : null);
        }}
        onToggleEnabled={async () => {
          const newEnabled = !selectedInstance.enabled;
          if (newEnabled && !(selectedInstance.appId && selectedInstance.appSecret)) return;
          const success = await imService.updateFeishuInstanceConfig(activeInstanceId, {
            enabled: newEnabled,
          });
          if (success) {
            dispatch(
              setFeishuInstanceConfig({
                instanceId: activeInstanceId,
                config: { enabled: newEnabled },
              }),
            );
            if (newEnabled) dispatch(clearError());
          }
        }}
        onTestConnectivity={() => {
          void onTestConnectivity();
        }}
        testingPlatform={testingPlatform}
        connectivityResults={connectivityResults}
      />
    </div>
  );
};
