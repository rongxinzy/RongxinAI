import type { MagpieModel, MagpieModelCatalog } from '../../shared/magpie/types';
import { ModelCapabilityStatus } from '../../shared/providers';
import { store } from '../store';
import { setModelCatalog, type Model } from '../store/slices/modelSlice';

export const LLAMACPP_RUNNING_MODELS_CHANGED_EVENT = 'llamacpp:running-models-changed';
let catalogRequest = 0;
let selectionRequest = 0;
export function toCatalogModel(model: MagpieModel): Model {
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
  const catalog = await window.electron.magpie.catalog();
  if (request === catalogRequest) applyMagpieCatalog(catalog);
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
