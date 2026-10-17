import { FieldGroup } from '@shared/components/ui/field';

import { i18nService, type LanguageType } from '../../../services/i18n';
import { SettingsToggleRow } from '../../common/SettingsToggleRow';
import { GeneralLanguageField } from './GeneralLanguageField';

interface GeneralSettingsPanelProps {
  language: LanguageType;
  onLanguageChange: (nextLanguage: LanguageType) => void;
  autoLaunch: boolean;
  onAutoLaunchChange: (next: boolean) => void;
  preventSleep: boolean;
  onPreventSleepChange: (next: boolean) => void;
  useSystemProxy: boolean;
  onUseSystemProxyChange: (next: boolean) => void;
  sqliteAutoBackupEnabled: boolean;
  onSqliteAutoBackupEnabledChange: (next: boolean) => void;
  codemodeEnabled: boolean;
  onCodemodeEnabledChange: (next: boolean) => void;
  mcpNativeBridge: boolean;
  onMcpNativeBridgeChange: (next: boolean) => void;
}

export default function GeneralSettingsPanel({
  language,
  onLanguageChange,
  autoLaunch,
  onAutoLaunchChange,
  preventSleep,
  onPreventSleepChange,
  useSystemProxy,
  onUseSystemProxyChange,
  sqliteAutoBackupEnabled,
  onSqliteAutoBackupEnabledChange,
  codemodeEnabled,
  onCodemodeEnabledChange,
  mcpNativeBridge,
  onMcpNativeBridgeChange,
}: GeneralSettingsPanelProps) {
  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-4">
        <h2 className="text-base font-semibold text-foreground">
          {i18nService.t('settingsGeneralSectionApplication')}
        </h2>
        <FieldGroup className="gap-4">
          <GeneralLanguageField value={language} onValueChange={onLanguageChange} />

          <SettingsToggleRow
            label={i18nService.t('autoLaunch')}
            description={i18nService.t('autoLaunchDescription')}
            checked={autoLaunch}
            onCheckedChange={onAutoLaunchChange}
          />

          <SettingsToggleRow
            label={i18nService.t('preventSleep')}
            description={i18nService.t('preventSleepDescription')}
            checked={preventSleep}
            onCheckedChange={onPreventSleepChange}
          />

          <SettingsToggleRow
            label={i18nService.t('useSystemProxy')}
            description={i18nService.t('useSystemProxyDescription')}
            checked={useSystemProxy}
            onCheckedChange={onUseSystemProxyChange}
          />

          <SettingsToggleRow
            label={i18nService.t('sqliteAutoBackupEnabled')}
            description={i18nService.t('sqliteAutoBackupEnabledDescription')}
            checked={sqliteAutoBackupEnabled}
            onCheckedChange={onSqliteAutoBackupEnabledChange}
          />
        </FieldGroup>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-base font-semibold text-foreground">
          {i18nService.t('settingsGeneralSectionAgentRuntime')}
        </h2>
        <FieldGroup className="gap-4">
          <SettingsToggleRow
            label={i18nService.t('codemodeEnabled')}
            description={i18nService.t('codemodeEnabledDescription')}
            checked={codemodeEnabled}
            onCheckedChange={onCodemodeEnabledChange}
          />

          <SettingsToggleRow
            label={i18nService.t('mcpNativeBridge')}
            description={i18nService.t('mcpNativeBridgeDescription')}
            checked={mcpNativeBridge}
            onCheckedChange={onMcpNativeBridgeChange}
          />
        </FieldGroup>
      </section>
    </div>
  );
}
