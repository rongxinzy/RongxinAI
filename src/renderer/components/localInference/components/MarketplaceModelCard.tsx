import { memo, useMemo, useState } from 'react';
import type { MarketplaceModel } from '../../../../shared/marketplace';
import { i18nService } from '../../../services/i18n';
import {
  getMarketplaceRecommendedQuantization,
  groupMarketplaceVariants,
  MARKETPLACE_GGUF_FORMAT,
  openExternalUrl,
} from '../utils/marketplace';
import { formatBytes } from '../utils/progress';
import { MarketplaceModelCardView } from './MarketplaceModelCardView';

// Owns the existing selection and install boundary; visual modules receive
// controlled values and callbacks and never start services themselves.
export const MarketplaceModelCard = memo(function MarketplaceModelCard({
  model,
  loading,
  isDownloadActive,
  onInstall,
  onOpenDownload,
}: {
  model: MarketplaceModel;
  loading: boolean;
  isDownloadActive: boolean;
  onInstall: (model: MarketplaceModel) => Promise<void>;
  onOpenDownload: () => void;
}) {
  const variants = useMemo(() => groupMarketplaceVariants(model.files), [model.files]);
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);
  const selectedVariant = variants.find(variant => variant.id === selectedVariantId) ?? variants[0];
  const details = [
    {
      label: i18nService.t('marketplaceModelSizeLabel'),
      value: selectedVariant?.totalSizeBytes
        ? formatBytes(selectedVariant.totalSizeBytes)
        : model.sizes[0]?.trim() || null,
    },
    {
      label: i18nService.t('marketplaceRecommendedQuantizationLabel'),
      value:
        selectedVariant?.quantization ||
        getMarketplaceRecommendedQuantization(model.recommendedTag),
    },
    { label: i18nService.t('marketplaceFormatLabel'), value: MARKETPLACE_GGUF_FORMAT },
  ];
  const installable = Boolean(
    model.metadataStatus === 'verified' &&
    selectedVariant &&
    selectedVariant.files.length > 0 &&
    selectedVariant.files.every(
      file => file.downloadUrl && file.sha256 && (file.sizeBytes ?? 0) > 0,
    ),
  );
  return (
    <MarketplaceModelCardView
      model={model}
      details={details}
      variants={variants}
      selectedVariant={selectedVariant}
      onSelectVariant={setSelectedVariantId}
      loading={loading}
      installable={installable}
      isDownloadActive={isDownloadActive}
      onOpenDownload={onOpenDownload}
      onOpenModel={() => {
        if (model.detailUrl) void openExternalUrl(model.detailUrl);
      }}
      onInstall={() =>
        void onInstall({ ...model, filePath: selectedVariant?.files[0]?.path ?? model.filePath })
      }
    />
  );
});
