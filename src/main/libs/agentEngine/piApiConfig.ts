import type {
  ModelCapabilities,
  ProviderConfig,
  ProviderModelPiRuntimeConfig,
  ResolvedModelEndpoint,
} from '../../../shared/providers';
import type { CoworkApiConfig } from '../coworkConfigStore';

/**
 * Structural view of a resolved model endpoint still used by the loopback
 * compatibility proxy. Session traffic itself resolves through the unified
 * model gateway, not this shape.
 */
export type ApiConfigResolution = {
  config: CoworkApiConfig | null;
  error?: string;
  endpoint?: ResolvedModelEndpoint;
  providerMetadata?: {
    providerName: string;
    authType?: ProviderConfig['authType'];
    usesAnonymousAccess?: boolean;
    codingPlanEnabled: boolean;
    supportsImage?: boolean;
    modelName?: string;
    contextWindow?: number;
    contextTokens?: number;
    maxTokens?: number;
    capabilities?: Partial<ModelCapabilities>;
    piRuntime?: ProviderModelPiRuntimeConfig;
  };
};
