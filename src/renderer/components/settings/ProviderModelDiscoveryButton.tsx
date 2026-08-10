import { Button } from '@shared/components/ui/button';
import { Spinner } from '@shared/components/ui/spinner';
import {
  ApiFormat,
  type DiscoveredProviderModel,
  type ProviderConfig,
  ProviderModelDiscoveryErrorCode,
  resolveCodingPlanBaseUrl,
} from '@shared/providers';
import { RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { i18nService } from '../../services/i18n';
import { isCurrentProviderModelDiscoveryRequest } from '../../services/providerModelDiscovery';

interface ProviderModelDiscoveryButtonProps {
  providerId: string;
  provider: ProviderConfig;
  baseUrl: string;
  apiFormat: ApiFormat;
  requiresApiKey: boolean;
  onModelsMerge: (models: readonly DiscoveredProviderModel[]) => void;
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

export function ProviderModelDiscoveryButton({
  providerId,
  provider,
  baseUrl,
  apiFormat,
  requiresApiKey,
  onModelsMerge,
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

  useEffect(() => {
    latestRequestId.current += 1;
    setIsLoading(false);
    return () => {
      latestRequestId.current += 1;
    };
  }, [signature]);

  const handleFetchModels = async () => {
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
      if (result.models.length === 0) {
        toast.message(i18nService.t('fetchModelsEmpty'));
        return;
      }

      onModelsMerge(result.models);
      toast.success(
        i18nService.t('fetchModelsSuccess').replace('{count}', String(result.models.length)),
      );
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
  };

  return (
    <Button
      type="button"
      variant="link"
      size="xs"
      onClick={() => void handleFetchModels()}
      disabled={isLoading}
      className="h-auto px-0 py-0 [&_svg]:size-3.5"
    >
      {isLoading ? <Spinner data-icon="inline-start" /> : <RefreshCw data-icon="inline-start" />}
      {i18nService.t(isLoading ? 'fetchingModels' : 'fetchModels')}
    </Button>
  );
}
