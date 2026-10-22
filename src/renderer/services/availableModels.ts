import type { LlamaCppAgentEligibility } from '../../shared/llamacpp';
import { LOCAL_GPU_MAGPIE_PROVIDER_ID } from '../../shared/magpie/constants';
import type { MagpieModel, MagpieModelCatalog } from '../../shared/magpie/types';
import { getRunningModelAgentEligibility } from '../utils/llamacppAgentEligibility';
import { ModelCapabilityStatus } from '../../shared/providers';
import { store } from '../store';
import { setModelCatalog, type Model } from '../store/slices/modelSlice';

export const LLAMACPP_RUNNING_MODELS_CHANGED_EVENT = 'llamacpp:running-models-changed';
let catalogRequest = 0;
let selectionRequest = 0;
/** Agent eligibility of the running local models, keyed by the name the GPU provider registers. */
let localEligibility = new Map<string, LlamaCppAgentEligibility>();
async function readLocalEligibility(): Promise<Map<string, LlamaCppAgentEligibility>> {
  try {
    const running = await window.electron.llamacpp.listRunningModels();
    return new Map(
      running.flatMap(model => {
        const name = model.name?.trim() || model.model?.trim() || model.id?.trim();
        return name ? [[name, getRunningModelAgentEligibility(model)] as const] : [];
      }),
    );
  } catch {
    return new Map();
  }
}
function localModelEligibility(model: MagpieModel): LlamaCppAgentEligibility | undefined {
  if (model.owned_by !== LOCAL_GPU_MAGPIE_PROVIDER_ID) return undefined;
  const slash = model.id.indexOf('/');
  return localEligibility.get(model.id) ?? localEligibility.get(model.id.slice(slash + 1));
}
export function toCatalogModel(model: MagpieModel): Model {
  const llamaCppAgentEligibility = localModelEligibility(model);
  return {
    id: model.id,
    name: model.display_name || model.id,
    provider: model.owned_by,
    providerKey: model.owned_by,
    supportsImage: model.modalities?.input.includes('image') ?? false,
    supportsThinkingToggle: model.reasoning,
    contextWindow: model.context_window,
    capabilities: {
      imageInput: model.modalities?.input.includes('image')
        ? ModelCapabilityStatus.Supported
        : ModelCapabilityStatus.Unknown,
    },
    ...(llamaCppAgentEligibility ? { llamaCppAgentEligibility } : {}),
  };
}
export function applyMagpieCatalog(catalog: MagpieModelCatalog): void {
  store.dispatch(
    setModelCatalog({
      models: catalog.status.state === 'running' ? catalog.models.map(toCatalogModel) : [],
      defaultModelId: catalog.defaultModelId,
    }),
  );
}
export async function refreshMagpieModels(): Promise<MagpieModelCatalog> {
  const request = ++catalogRequest;
  const [catalog, eligibility] = await Promise.all([
    window.electron.magpie.catalog(),
    readLocalEligibility(),
  ]);
  if (request !== catalogRequest) return catalog;
  localEligibility = eligibility;
  applyMagpieCatalog(catalog);
  return catalog;
}
export async function selectMagpieDefaultModel(id: string): Promise<MagpieModelCatalog> {
  ++catalogRequest;
  const request = ++selectionRequest;
  const catalog = await window.electron.magpie.selectDefault(id);
  if (request === selectionRequest) {
    // A focus refresh may have started while the write was pending. Its older
    // snapshot must not replace the newly confirmed default when it finishes.
    ++catalogRequest;
    applyMagpieCatalog(catalog);
  }
  return catalog;
}
export function notifyLlamaCppRunningModelsChanged(): void {
  window.dispatchEvent(new CustomEvent(LLAMACPP_RUNNING_MODELS_CHANGED_EVENT));
}
