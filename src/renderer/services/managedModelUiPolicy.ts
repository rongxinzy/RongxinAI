export function filterManagedModelSettingsTabs<T extends { readonly key: string }>(
  tabs: readonly T[],
  managedModelsOnly: boolean,
): T[] {
  return managedModelsOnly ? tabs.filter(tab => tab.key !== 'model') : [...tabs];
}

export function resolveManagedModelSettingsTab<T extends string>(
  activeTab: T,
  managedModelsOnly: boolean,
  enterpriseTab: T | undefined,
): T {
  if (!managedModelsOnly || activeTab !== 'model') return activeTab;
  return enterpriseTab ?? ('general' as T);
}

export function shouldShowLocalInferenceNavigation(
  isChatMode: boolean,
  managedModelsOnly: boolean,
): boolean {
  return !isChatMode && !managedModelsOnly;
}
