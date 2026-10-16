import { ProviderName } from '../../../shared/providers';
import { isSameModelIdentity, type Model } from '../../store/slices/modelSlice';

/** Available local models are projected from the running local service. */
export function getPreferredReadyLocalModel(models: Model[], selected: Model | null): Model | null {
  const ready = models.filter(
    model =>
      model.providerKey === ProviderName.LlamaCpp &&
      model.llamaCppAgentEligibility?.eligible === true,
  );
  return ready.find(model => selected && isSameModelIdentity(model, selected)) ?? ready[0] ?? null;
}
