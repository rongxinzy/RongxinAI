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
