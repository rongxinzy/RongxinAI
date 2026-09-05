import type { AppConfig } from '../config';

export function hasSettingsValueChanged(current: unknown, next: unknown): boolean {
  return JSON.stringify(current) !== JSON.stringify(next);
}

export function buildAppSettingsSavePatch(input: {
  current: AppConfig;
  theme: AppConfig['theme'];
  themeStyle?: string;
  language: AppConfig['language'];
  useSystemProxy: boolean;
  sqliteAutoBackupEnabled: boolean;
  shortcuts: NonNullable<AppConfig['shortcuts']>;
  providers: AppConfig['providers'];
  api: AppConfig['api'];
  model: AppConfig['model'];
}): Partial<AppConfig> {
  const patch: Partial<AppConfig> = {};

  if (input.themeStyle !== undefined && (input.current.themeStyle ?? 'codex') !== input.themeStyle)
    patch.themeStyle = input.themeStyle;
  if (input.current.theme !== input.theme) patch.theme = input.theme;
  if (input.current.language !== input.language) patch.language = input.language;
  if (input.current.useSystemProxy !== input.useSystemProxy) {
    patch.useSystemProxy = input.useSystemProxy;
  }
  if ((input.current.sqliteAutoBackupEnabled ?? false) !== input.sqliteAutoBackupEnabled) {
    patch.sqliteAutoBackupEnabled = input.sqliteAutoBackupEnabled;
  }
  if (hasSettingsValueChanged(input.current.shortcuts, input.shortcuts)) {
    patch.shortcuts = input.shortcuts;
  }

  if (hasSettingsValueChanged(input.current.providers, input.providers)) {
    patch.providers = input.providers;
    patch.api = input.api;
    patch.model = input.model;
  }

  return patch;
}

export function getSettingsSaveErrorMessage(
  error: unknown,
  appConfigSaved: boolean,
  translate: (key: string) => string,
): string {
  const detail = error instanceof Error ? error.message : translate('failedToSaveSettings');
  if (!appConfigSaved) {
    return detail;
  }
  return translate('settingsPartiallySaved').replace('{0}', detail);
}
