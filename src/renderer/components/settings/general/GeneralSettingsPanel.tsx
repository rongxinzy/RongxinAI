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
  sqliteAutoBackupEnabled: boolean;
  sqliteAutoBackupDisabled: boolean;
  onSqliteAutoBackupEnabledChange: (next: boolean) => void;
}

export default function GeneralSettingsPanel({
  language,
  onLanguageChange,
  autoLaunch,
  onAutoLaunchChange,
  preventSleep,
  onPreventSleepChange,
  sqliteAutoBackupEnabled,
  sqliteAutoBackupDisabled,
  onSqliteAutoBackupEnabledChange,
}: GeneralSettingsPanelProps) {
  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-4">
        <h2 className="text-base font-semibold text-foreground">
          {i18nService.t('settingsSectionBasic')}
        </h2>
        <FieldGroup className="gap-4">
          <GeneralLanguageField value={language} onValueChange={onLanguageChange} />
        </FieldGroup>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-base font-semibold text-foreground">
          {i18nService.t('settingsSectionStartup')}
        </h2>
        <FieldGroup className="gap-4">
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
        </FieldGroup>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-base font-semibold text-foreground">
          {i18nService.t('settingsSectionData')}
        </h2>
        <FieldGroup className="gap-4">
          <SettingsToggleRow
            label={i18nService.t('sqliteAutoBackupEnabled')}
            description={i18nService.t('sqliteAutoBackupEnabledDescription')}
            checked={sqliteAutoBackupEnabled}
            disabled={sqliteAutoBackupDisabled}
            onCheckedChange={onSqliteAutoBackupEnabledChange}
          />
        </FieldGroup>
      </section>
    </div>
  );
}
