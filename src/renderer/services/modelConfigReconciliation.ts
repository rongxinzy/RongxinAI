import type { AppConfig } from '../config';
import { buildConfiguredAvailableModels } from './availableModels';

export function reconcileDefaultModelConfig(
  currentConfig: AppConfig,
  providers: NonNullable<AppConfig['providers']>,
): AppConfig['model'] {
  const availableModels = buildConfiguredAvailableModels({
    ...currentConfig,
    providers,
  });
  const currentModel = availableModels.find(
    model =>
      model.id === currentConfig.model.defaultModel &&
      (!currentConfig.model.defaultModelProvider ||
        model.providerKey === currentConfig.model.defaultModelProvider),
  );
  const nextModel = currentModel ?? availableModels[0];

  if (!nextModel) {
    return currentConfig.model;
  }

  return {
    ...currentConfig.model,
    defaultModel: nextModel.id,
    defaultModelProvider: nextModel.providerKey,
  };
}
