/**
 * Telegram settings panel (multi-instance) for the IM settings view.
 * Extracted from IMSettings.tsx (issue #1069); callback behavior is unchanged.
 */
import { Button } from '@shared/components/ui/button';
import React from 'react';
import { useDispatch } from 'react-redux';

import { imPlatformLogo } from '../../../../assets/imLogos';
import { i18nService } from '../../../../services/i18n';
import { imService } from '../../../../services/im';
import { clearError, setTelegramInstanceConfig } from '../../../../store/slices/imSlice';
import type { TelegramInstanceConfig, TelegramInstanceStatus } from '../../../../types/im';
import { MAX_TELEGRAM_INSTANCES } from '../../../../types/im';
import { ChannelWorkspaceField } from '../../ChannelWorkspaceField';
import TelegramInstanceSettings from '../../TelegramInstanceSettings';
import type { MultiInstancePanelProps } from './panelProps';

export interface TelegramPanelProps extends MultiInstancePanelProps {
  instances: TelegramInstanceConfig[];
  instanceStatuses: TelegramInstanceStatus[] | undefined;
}

export const TelegramPanel: React.FC<TelegramPanelProps> = ({
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
          src={imPlatformLogo('telegram')}
          alt="Telegram"
          className="size-12 object-contain rounded-md mb-4 opacity-50"
        />
        <p className="text-sm text-muted-foreground mb-4">
          {instances.length === 0
            ? i18nService.t('imNoInstances').replace('{platform}', i18nService.t('telegram'))
            : i18nService.t('imSelectInstance').replace('{platform}', i18nService.t('telegram'))}
        </p>
        {instances.length < MAX_TELEGRAM_INSTANCES && (
          <Button
            type="button"
            variant="outline"
            onClick={async e => {
              e.stopPropagation();
              const inst = await imService.addTelegramInstance(
                `Telegram Bot ${instances.length + 1}`,
              );
              if (inst) {
                onInstanceAdded(inst.instanceId);
              }
            }}
          >
            + {i18nService.t('imTelegramAddInstance')}
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
            setTelegramInstanceConfig({
              instanceId: activeInstanceId,
              config: { workspaceId },
            }),
          );
          void imService.updateTelegramInstanceConfig(activeInstanceId, {
            workspaceId,
          });
        }}
      />
      <TelegramInstanceSettings
        instance={selectedInstance}
        instanceStatus={selectedStatus}
        onConfigChange={update => {
          dispatch(
            setTelegramInstanceConfig({
              instanceId: activeInstanceId,
              config: update,
            }),
          );
        }}
        onSave={async override => {
          const configToSave = override ? { ...selectedInstance, ...override } : selectedInstance;
          if (selectedInstance.enabled) {
            await imService.updateTelegramInstanceConfig(activeInstanceId, configToSave);
          } else {
            await imService.persistTelegramInstanceConfig(activeInstanceId, configToSave);
          }
        }}
        onRename={async newName => {
          dispatch(
            setTelegramInstanceConfig({
              instanceId: activeInstanceId,
              config: { instanceName: newName } as any,
            }),
          );
          await imService.persistTelegramInstanceConfig(activeInstanceId, {
            instanceName: newName,
          } as any);
        }}
        onDelete={async () => {
          await imService.deleteTelegramInstance(activeInstanceId);
          const remaining = instances.filter(i => i.instanceId !== activeInstanceId);
          onSelectInstance(remaining.length > 0 ? remaining[0].instanceId : null);
        }}
        onToggleEnabled={async () => {
          const newEnabled = !selectedInstance.enabled;
          if (newEnabled && !selectedInstance.botToken) return;
          const success = await imService.updateTelegramInstanceConfig(activeInstanceId, {
            enabled: newEnabled,
          });
          if (success) {
            dispatch(
              setTelegramInstanceConfig({
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
