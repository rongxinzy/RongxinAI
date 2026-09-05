import { Button } from '@shared/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@shared/components/ui/tooltip';
import {
  ApiFormat,
  type DiscoveredProviderModel,
  type ProviderConfig,
  ProviderModelDiscoveryErrorCode,
  resolveCodingPlanBaseUrl,
} from '@shared/providers';
import { RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { i18nService } from '../../services/i18n';
import { isCurrentProviderModelDiscoveryRequest } from '../../services/providerModelDiscovery';

interface ProviderModelDiscoveryButtonProps {
  providerId: string;
  provider: ProviderConfig;
  baseUrl: string;
  apiFormat: ApiFormat;
  requiresApiKey: boolean;
  autoDetectRequest?: { providerId: string; requestId: number } | null;
  showButton?: boolean;
  iconOnly?: boolean;
  prominent?: boolean;
  onModelsDiscovered: (
    providerId: string,
    models: readonly DiscoveredProviderModel[],
  ) => Promise<boolean> | boolean;
}

const errorTranslationKeys = {
  [ProviderModelDiscoveryErrorCode.InvalidConfig]: 'fetchModelsNeedEndpoint',
  [ProviderModelDiscoveryErrorCode.Authentication]: 'fetchModelsAuthFailed',
  [ProviderModelDiscoveryErrorCode.EndpointNotFound]: 'fetchModelsEndpointNotFound',
  [ProviderModelDiscoveryErrorCode.Timeout]: 'fetchModelsTimeout',
  [ProviderModelDiscoveryErrorCode.UnsupportedFormat]: 'fetchModelsUnsupported',
  [ProviderModelDiscoveryErrorCode.ResponseTooLarge]: 'fetchModelsResponseTooLarge',
  [ProviderModelDiscoveryErrorCode.Network]: 'fetchModelsFailed',
  [ProviderModelDiscoveryErrorCode.Http]: 'fetchModelsFailed',
} as const;

const MODEL_DISCOVERY_MIN_LOADING_DURATION_MS = 1_000;

export function ProviderModelDiscoveryButton({
  providerId,
  provider,
  baseUrl,
  apiFormat,
  requiresApiKey,
  autoDetectRequest,
  showButton = true,
  iconOnly = false,
  prominent = false,
  onModelsDiscovered,
}: ProviderModelDiscoveryButtonProps) {
  const [isLoading, setIsLoading] = useState(false);
  const latestRequestId = useRef(0);
  const isOAuth = provider.authType === 'oauth';
  const endpoint = useMemo(() => {
    const oauthBaseUrl = isOAuth ? provider.oauthBaseUrl?.trim() : '';
    if (apiFormat === ApiFormat.Gemini) {
      return { baseUrl: oauthBaseUrl || baseUrl, apiFormat };
    }
    const resolved = resolveCodingPlanBaseUrl(
      providerId,
      provider.codingPlanEnabled === true,
      apiFormat,
      oauthBaseUrl || baseUrl,
    );
    return { baseUrl: resolved.baseUrl, apiFormat: resolved.effectiveFormat };
  }, [apiFormat, baseUrl, isOAuth, provider.codingPlanEnabled, provider.oauthBaseUrl, providerId]);
  const apiKey = isOAuth ? provider.oauthAccessToken?.trim() || '' : provider.apiKey.trim();
  const signature = `${providerId}\u0000${endpoint.baseUrl}\u0000${endpoint.apiFormat}\u0000${apiKey}`;
  const currentSignature = useRef(signature);
  currentSignature.current = signature;
  const consumedAutoDetectRequestId = useRef(0);

  useEffect(() => {
    latestRequestId.current += 1;
    setIsLoading(false);
    return () => {
      latestRequestId.current += 1;
    };
  }, [signature]);

  const handleFetchModels = useCallback(async () => {
    if (!endpoint.baseUrl.trim()) {
      toast.error(i18nService.t('fetchModelsNeedEndpoint'));
      return;
    }
    if (requiresApiKey && !apiKey) {
      toast.error(i18nService.t('fetchModelsNeedApiKey'));
      return;
    }

    const requestId = ++latestRequestId.current;
    const requestSignature = signature;
    const loadingStartedAt = performance.now();
    setIsLoading(true);
    try {
      const result = await window.electron.api.fetchModels({
        baseUrl: endpoint.baseUrl,
        apiKey,
        apiFormat: endpoint.apiFormat,
      });
      if (
        !isCurrentProviderModelDiscoveryRequest(
          requestId,
          latestRequestId.current,
          requestSignature,
          currentSignature.current,
        )
      ) {
        return;
      }
      if (!result.success) {
        toast.error(i18nService.t(errorTranslationKeys[result.code]));
        return;
      }
      const didTestModels = await onModelsDiscovered(providerId, result.models);
      if (result.models.length === 0 && !didTestModels) {
        toast.message(i18nService.t('fetchModelsEmpty'));
      }
    } catch {
      if (
        isCurrentProviderModelDiscoveryRequest(
          requestId,
          latestRequestId.current,
          requestSignature,
          currentSignature.current,
        )
      ) {
        toast.error(i18nService.t('fetchModelsFailed'));
      }
    } finally {
      const remainingLoadingDuration = Math.max(
        0,
        MODEL_DISCOVERY_MIN_LOADING_DURATION_MS - (performance.now() - loadingStartedAt),
      );
      if (remainingLoadingDuration > 0) {
        await new Promise<void>(resolve => {
          window.setTimeout(resolve, remainingLoadingDuration);
        });
      }
      if (
        isCurrentProviderModelDiscoveryRequest(
          requestId,
          latestRequestId.current,
          requestSignature,
          currentSignature.current,
        )
      ) {
        setIsLoading(false);
      }
    }
  }, [
    apiKey,
    endpoint.apiFormat,
    endpoint.baseUrl,
    onModelsDiscovered,
    providerId,
    requiresApiKey,
    signature,
  ]);

  useEffect(() => {
    if (
      !autoDetectRequest ||
      autoDetectRequest.providerId !== providerId ||
      autoDetectRequest.requestId <= consumedAutoDetectRequestId.current
    ) {
      return;
    }
    consumedAutoDetectRequestId.current = autoDetectRequest.requestId;
    void handleFetchModels();
  }, [autoDetectRequest, handleFetchModels, providerId]);

  if (!showButton) return null;

  if (iconOnly) {
    const label = i18nService.t(isLoading ? 'fetchingModels' : 'refresh');
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => void handleFetchModels()}
              disabled={isLoading}
              aria-label={label}
            >
              <RefreshCw
                className={isLoading ? 'animate-spin motion-reduce:animate-none' : undefined}
              />
            </Button>
          }
        />
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Button
      type="button"
      variant={prominent ? 'outline' : 'link'}
      size={prominent ? 'sm' : 'xs'}
      onClick={() => void handleFetchModels()}
      disabled={isLoading}
      className={
        prominent
          ? 'theme-page-provider-model-discovery-button-button-variant-1 [&_svg]:size-3.5'
          : 'theme-page-provider-model-discovery-button-button-variant-2 [&_svg]:size-3.5'
      }
    >
      <RefreshCw
        data-icon="inline-start"
        className={isLoading ? 'animate-spin motion-reduce:animate-none' : undefined}
      />
      {i18nService.t(isLoading ? 'fetchingModels' : 'fetchModels')}
    </Button>
  );
}
