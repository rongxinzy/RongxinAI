/**
 * QQ settings panel (multi-instance) for the IM settings view.
 * Extracted from IMSettings.tsx (issue #1069); callback behavior is unchanged.
 */
import { Button } from '@shared/components/ui/button';
import React from 'react';
import { useDispatch } from 'react-redux';

import { imPlatformLogo } from '../../../../assets/imLogos';
import { i18nService } from '../../../../services/i18n';
import { imService } from '../../../../services/im';
import { clearError, setQQInstanceConfig } from '../../../../store/slices/imSlice';
import type { QQInstanceConfig, QQInstanceStatus } from '../../../../types/im';
import { MAX_QQ_INSTANCES } from '../../../../types/im';
import { ChannelWorkspaceField } from '../../ChannelWorkspaceField';
import QQInstanceSettings from '../../QQInstanceSettings';
import type { MultiInstancePanelProps } from './panelProps';

export interface QQPanelProps extends MultiInstancePanelProps {
  instances: QQInstanceConfig[];
  instanceStatuses: QQInstanceStatus[] | undefined;
}

export const QQPanel: React.FC<QQPanelProps> = ({
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
          src={imPlatformLogo('qq')}
          alt="QQ"
          className="size-12 object-contain rounded-md mb-4 opacity-50"
        />
        <p className="text-sm text-muted-foreground mb-4">
          {instances.length === 0
            ? i18nService.t('imNoInstances').replace('{platform}', i18nService.t('qq'))
            : i18nService.t('imSelectInstance').replace('{platform}', i18nService.t('qq'))}
        </p>
        {instances.length < MAX_QQ_INSTANCES && (
          <Button
            type="button"
            variant="outline"
            onClick={async e => {
              e.stopPropagation();
              const inst = await imService.addQQInstance(`QQ Bot ${instances.length + 1}`);
              if (inst) {
                onInstanceAdded(inst.instanceId);
              }
            }}
          >
            + {i18nService.t('imQQAddInstance')}
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
            setQQInstanceConfig({
              instanceId: activeInstanceId,
              config: { workspaceId },
            }),
          );
          void imService.updateQQInstanceConfig(activeInstanceId, { workspaceId });
        }}
      />
      <QQInstanceSettings
        instance={selectedInstance}
        instanceStatus={selectedStatus}
        onConfigChange={update => {
          dispatch(setQQInstanceConfig({ instanceId: activeInstanceId, config: update }));
        }}
        onSave={async override => {
          const configToSave = override ? { ...selectedInstance, ...override } : selectedInstance;
          if (selectedInstance.enabled) {
            await imService.updateQQInstanceConfig(activeInstanceId, configToSave);
          } else {
            await imService.persistQQInstanceConfig(activeInstanceId, configToSave);
          }
        }}
        onRename={async newName => {
          dispatch(
            setQQInstanceConfig({
              instanceId: activeInstanceId,
              config: { instanceName: newName } as any,
            }),
          );
          await imService.persistQQInstanceConfig(activeInstanceId, {
            instanceName: newName,
          } as any);
        }}
        onDelete={async () => {
          await imService.deleteQQInstance(activeInstanceId);
          const remaining = instances.filter(i => i.instanceId !== activeInstanceId);
          onSelectInstance(remaining.length > 0 ? remaining[0].instanceId : null);
        }}
        onToggleEnabled={async () => {
          const newEnabled = !selectedInstance.enabled;
          if (newEnabled && !(selectedInstance.appId && selectedInstance.appSecret)) return;
          const success = await imService.updateQQInstanceConfig(activeInstanceId, {
            enabled: newEnabled,
          });
          if (success) {
            dispatch(
              setQQInstanceConfig({
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
