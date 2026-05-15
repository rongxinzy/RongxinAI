import { OpenClawProviderId, ProviderName, ProviderRegistry } from '@shared/providers';

import type { AppConfig } from '../config';
import { getProviderDisplayName } from '../config';

export type RuntimeSelectableModel = {
  id: string;
  name: string;
  provider?: string;
  providerKey?: string;
  openClawProviderId?: string;
  supportsImage?: boolean;
};

export function buildRuntimeSelectableModels(
  config: Pick<AppConfig, 'providers'>,
  runningOllamaModelNames: ReadonlySet<string>,
): RuntimeSelectableModel[] {
  const models: RuntimeSelectableModel[] = [];
  if (!config.providers) return models;

  Object.entries(config.providers).forEach(([providerName, providerConfig]) => {
    if (!providerConfig.enabled || !providerConfig.models) return;

    const openClawProviderId = getOpenClawProviderIdForConfig(providerName, providerConfig);
    providerConfig.models.forEach((model) => {
      if (providerName === ProviderName.Ollama && !runningOllamaModelNames.has(model.id)) {
        return;
      }
      models.push({
        id: model.id,
        name: model.name,
        provider: getProviderDisplayName(providerName, providerConfig),
        providerKey: providerName,
        openClawProviderId,
        supportsImage: model.supportsImage ?? false,
      });
    });
  });

  return models;
}

export async function getRunningOllamaModelNames(): Promise<Set<string>> {
  const names = new Set<string>();
  try {
    const status = await window.electron.ollama.status();
    if (status.status !== 'running') return names;
    const runningModels = await window.electron.ollama.listRunningModels();
    runningModels.forEach((model) => {
      if (model.name) names.add(model.name);
      if (model.model) names.add(model.model);
    });
  } catch {
    // Treat Ollama as unavailable so we never expose stale local models.
  }
  return names;
}

export async function isOllamaModelRunning(modelName: string): Promise<boolean> {
  if (!modelName.trim()) return false;
  const runningModelNames = await getRunningOllamaModelNames();
  return runningModelNames.has(modelName.trim());
}

export function getOllamaModelNameFromRef(modelRef: string): string | null {
  const normalized = modelRef.trim();
  const prefix = `${OpenClawProviderId.Ollama}/`;
  if (!normalized.startsWith(prefix)) return null;
  const modelName = normalized.slice(prefix.length).trim();
  return modelName || null;
}

function getOpenClawProviderIdForConfig(
  providerName: string,
  providerConfig: { authType?: string },
): string {
  if (providerName === ProviderName.OpenAI && providerConfig.authType === 'oauth') {
    return OpenClawProviderId.OpenAICodex;
  }
  return ProviderRegistry.getOpenClawProviderId(providerName);
}
