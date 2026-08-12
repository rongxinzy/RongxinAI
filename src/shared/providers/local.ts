import { ProviderName } from './constants';

export const LocalProviderName = {
  LlamaCpp: ProviderName.LlamaCpp,
  Ollama: ProviderName.Ollama,
} as const;

const LOCAL_PROVIDER_NAMES = new Set<string>(Object.values(LocalProviderName));

export function isLocalProviderName(providerName?: string | null): boolean {
  const normalized = providerName?.trim().toLowerCase();
  return !!normalized && LOCAL_PROVIDER_NAMES.has(normalized);
}

export function getProviderNameFromModelRef(modelRef?: string | null): string | null {
  const normalized = modelRef?.trim();
  if (!normalized) return null;
  const slashIndex = normalized.indexOf('/');
  if (slashIndex <= 0) return null;
  return normalized.slice(0, slashIndex);
}

export function isLocalModelRef(modelRef?: string | null): boolean {
  return isLocalProviderName(getProviderNameFromModelRef(modelRef));
}
