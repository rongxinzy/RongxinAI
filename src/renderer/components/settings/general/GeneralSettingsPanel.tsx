import { FieldGroup } from '@shared/components/ui/field';
import { useEffect, useState } from 'react';

import { i18nService, type LanguageType } from '../../../services/i18n';
import { SettingsToggleRow } from '../../common/SettingsToggleRow';
import { CodemodeToggleRow } from './CodemodeToggleRow';
import { GeneralLanguageField } from './GeneralLanguageField';
import { McpNativeBridgeToggleRow } from './McpNativeBridgeToggleRow';

interface GeneralSettingsPanelProps {
  language: LanguageType;
  onLanguageChange: (nextLanguage: LanguageType) => void;
  useSystemProxy: boolean;
  onUseSystemProxyChange: (next: boolean) => void;
  sqliteAutoBackupEnabled: boolean;
  onSqliteAutoBackupEnabledChange: (next: boolean) => void;
  setError: (message: string | null) => void;
}

export default function GeneralSettingsPanel({
  language,
  onLanguageChange,
  useSystemProxy,
  onUseSystemProxyChange,
  sqliteAutoBackupEnabled,
  onSqliteAutoBackupEnabledChange,
  setError,
}: GeneralSettingsPanelProps) {
  const [autoLaunch, setAutoLaunchState] = useState(false);
  const [isUpdatingAutoLaunch, setIsUpdatingAutoLaunch] = useState(false);
  const [preventSleep, setPreventSleepState] = useState(false);
  const [isUpdatingPreventSleep, setIsUpdatingPreventSleep] = useState(false);

  useEffect(() => {
    let active = true;
    // Load auto-launch setting
    window.electron.autoLaunch
      .get()
      .then(({ enabled }) => {
        if (active) {
          setAutoLaunchState(enabled);
        }
      })
      .catch(err => {
        console.error('Failed to load auto-launch setting:', err);
      });

    // Load prevent-sleep setting
    window.electron.preventSleep
      .get()
      .then(({ enabled }) => {
        if (active) {
          setPreventSleepState(enabled);
        }
      })
      .catch(err => {
        console.error('Failed to load prevent-sleep setting:', err);
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <FieldGroup className="gap-4">
      <GeneralLanguageField value={language} onValueChange={onLanguageChange} />

      <SettingsToggleRow
        label={i18nService.t('autoLaunch')}
        description={i18nService.t('autoLaunchDescription')}
        checked={autoLaunch}
        onCheckedChange={async next => {
          if (isUpdatingAutoLaunch) return;
          setIsUpdatingAutoLaunch(true);
          try {
            const result = await window.electron.autoLaunch.set(next);
            if (result.success) {
              setAutoLaunchState(next);
            } else {
              setError(result.error || i18nService.t('autoLaunchUpdateFailed'));
            }
          } catch (err) {
            console.error('Failed to set auto-launch:', err);
            setError(i18nService.t('autoLaunchUpdateFailed'));
          } finally {
            setIsUpdatingAutoLaunch(false);
          }
        }}
        disabled={isUpdatingAutoLaunch}
      />

      <CodemodeToggleRow />

      <McpNativeBridgeToggleRow />

      <SettingsToggleRow
        label={i18nService.t('preventSleep')}
        description={i18nService.t('preventSleepDescription')}
        checked={preventSleep}
        onCheckedChange={async next => {
          if (isUpdatingPreventSleep) return;
          setIsUpdatingPreventSleep(true);
          try {
            const result = await window.electron.preventSleep.set(next);
            if (result.success) {
              setPreventSleepState(next);
            } else {
              setError(result.error || i18nService.t('preventSleepUpdateFailed'));
            }
          } catch (err) {
            console.error('Failed to set prevent-sleep:', err);
            setError(i18nService.t('preventSleepUpdateFailed'));
          } finally {
            setIsUpdatingPreventSleep(false);
          }
        }}
        disabled={isUpdatingPreventSleep}
      />

      <SettingsToggleRow
        label={i18nService.t('useSystemProxy')}
        description={i18nService.t('useSystemProxyDescription')}
        checked={useSystemProxy}
        onCheckedChange={next => onUseSystemProxyChange(next)}
      />

      <SettingsToggleRow
        label={i18nService.t('sqliteAutoBackupEnabled')}
        description={i18nService.t('sqliteAutoBackupEnabledDescription')}
        checked={sqliteAutoBackupEnabled}
        onCheckedChange={next => onSqliteAutoBackupEnabledChange(next)}
      />
    </FieldGroup>
  );
}
