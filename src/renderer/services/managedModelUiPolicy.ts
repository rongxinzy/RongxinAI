export function shouldShowLocalInferenceNavigation(
  isChatMode: boolean,
  managedModelsOnly: boolean,
): boolean {
  return !isChatMode && !managedModelsOnly;
}
