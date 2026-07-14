import { ProviderName } from '../../../shared/providers';
import type { Model } from '../../store/slices/modelSlice';

export function supportsLocalThinkingToggle(model: Model | null | undefined): boolean {
  return Boolean(model && isLlamaCppModel(model) && model.supportsThinkingToggle === true);
}

function isLlamaCppModel(model: Model): boolean {
  const provider = model?.providerKey ?? model?.provider;
  return provider?.trim().toLowerCase() === ProviderName.LlamaCpp;
}
