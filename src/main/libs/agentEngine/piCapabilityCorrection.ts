/**
 * Runtime model-capability correction.
 *
 * When a provider deterministically rejects a modality the session sent
 * (CoworkErrorKind.ModelCapabilityUnsupported — e.g. llama.cpp answering
 * "image input is not supported" because no mmproj vision projector is
 * loaded), the stored capability verdict is wrong and every retry would fail
 * the same way. This module downgrades the stored `imageInput` capability to
 * Unsupported so the next session registers the model as text-only
 * (buildPiCustomModel reads `supportsImage` / `capabilities.imageInput`).
 *
 * The main process has no config-changed broadcast for 'app_config', so the
 * settings page reflects the correction on its next load rather than live;
 * no new IPC channel is added here for that.
 */

import {
  isLocalProviderName,
  ModelCapabilityStatus,
  ProviderRegistry,
  type ProviderConfig,
} from '../../../shared/providers';
import type { SqliteStore } from '../../sqliteStore';

type ProviderModelEntry = NonNullable<ProviderConfig['models']>[number];

interface CapabilityCorrectionAppConfig {
  providers?: Record<string, ProviderConfig>;
}

// Store accessor injected from main.ts, mirroring claudeSettings.setStoreGetter.
let storeGetter: (() => SqliteStore | null) | null = null;

export function setPiCapabilityCorrectionStoreGetter(getter: () => SqliteStore | null): void {
  storeGetter = getter;
}

/**
 * Downgrade the stored image-input capability of a provider model.
 *
 * Returns `changed: true` when the config was rewritten: an existing model
 * entry is downgraded in place, a missing entry is created with the minimal
 * shape the model form understands. Returns `changed: false` when the
 * provider is unknown, the model id is blank, or the entry already records
 * image input as unsupported.
 */
export function disableModelImageInputCapability(
  providerName: string,
  modelId: string,
): { changed: boolean } {
  const normalizedModelId = modelId.trim();
  if (!providerName.trim() || !normalizedModelId) {
    return { changed: false };
  }
  const store = storeGetter?.();
  if (!store) {
    console.warn('[PiCapabilityCorrection] store is not initialized, skipping capability update');
    return { changed: false };
  }

  try {
    const appConfig = store.get<CapabilityCorrectionAppConfig>('app_config');
    const provider = appConfig?.providers?.[providerName];
    if (!appConfig || !provider) {
      return { changed: false };
    }

    const models = provider.models ?? [];
    // Case-insensitive id match plus registry alias resolution, same as
    // resolveModelEndpoint: a session may run under an alias of the stored id.
    const catalogModel = ProviderRegistry.getModel(providerName, normalizedModelId);
    const existing = models.find(model => {
      if (model.id.trim().toLowerCase() === normalizedModelId.toLowerCase()) return true;
      return (
        catalogModel !== undefined &&
        ProviderRegistry.getModel(providerName, model.id)?.id === catalogModel.id
      );
    });
    if (
      existing &&
      existing.capabilities?.imageInput === ModelCapabilityStatus.Unsupported &&
      existing.supportsImage === false
    ) {
      return { changed: false };
    }

    // Creating a minimal entry is only meaningful for providers whose model
    // list is user-managed; for builtin providers (zhiyuan etc.) a missing
    // entry would be a phantom row the settings page cannot reconcile.
    if (!existing && !isLocalProviderName(providerName) && !providerName.startsWith('custom_')) {
      console.warn(
        `[PiCapabilityCorrection] no stored model entry for ${normalizedModelId} on builtin provider ${providerName}, skipping capability update`,
      );
      return { changed: false };
    }

    const correctedEntry: ProviderModelEntry = existing
      ? {
          ...existing,
          supportsImage: false,
          capabilities: {
            ...existing.capabilities,
            imageInput: ModelCapabilityStatus.Unsupported,
          },
        }
      : {
          id: normalizedModelId,
          name: normalizedModelId,
          supportsImage: false,
          capabilities: { imageInput: ModelCapabilityStatus.Unsupported },
        };
    const nextModels = existing
      ? models.map(model => (model === existing ? correctedEntry : model))
      : [...models, correctedEntry];

    store.set('app_config', {
      ...appConfig,
      providers: {
        ...appConfig.providers,
        [providerName]: { ...provider, models: nextModels },
      },
    });
    console.log(
      `[PiCapabilityCorrection] disabled image input for model ${normalizedModelId} on provider ${providerName} after the server rejected it`,
    );
    return { changed: true };
  } catch (error) {
    console.warn(
      `[PiCapabilityCorrection] failed to disable image input for model ${normalizedModelId} on provider ${providerName}:`,
      error,
    );
    return { changed: false };
  }
}
