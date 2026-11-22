import { ProviderName } from './constants';

export function isLocalProviderName(providerName?: string | null): boolean {
  return providerName?.trim().toLowerCase() === ProviderName.LlamaCpp;
}

function getProviderNameFromModelRef(modelRef?: string | null): string | null {
  const normalized = modelRef?.trim();
  if (!normalized) return null;
  const slashIndex = normalized.indexOf('/');
  if (slashIndex <= 0) return null;
  return normalized.slice(0, slashIndex);
}

export function isLocalModelRef(modelRef?: string | null): boolean {
  return isLocalProviderName(getProviderNameFromModelRef(modelRef));
}
