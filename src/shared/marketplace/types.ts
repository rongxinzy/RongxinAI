import type { MarketplaceDeviceProfile } from './constants';

export type MarketplaceSource = 'modelscope-gguf';

export type MarketplaceTaskFilter = 'all' | 'chat' | 'reasoning' | 'embedding' | 'code' | 'vision';

export type MarketplaceSizeFilter = 'all' | 'small' | 'desktop' | 'workstation' | 'large';

export const MarketplaceCapability = {
  Chat: 'chat',
  Reasoning: 'reasoning',
  Embedding: 'embedding',
  Code: 'code',
  Vision: 'vision',
} as const;

export type MarketplaceCapability =
  (typeof MarketplaceCapability)[keyof typeof MarketplaceCapability];

export type MarketplaceModel = {
  source: MarketplaceSource;
  id: string;
  repoId: string;
  name: string;
  description: string;
  tags: string[];
  sizes: string[];
  recommendedTag: string;
  capability: MarketplaceCapability;
  capabilities?: MarketplaceCapability[];
  filePath?: string;
  downloads?: number;
  detailUrl?: string;
  parameterCount?: number;
  publishedAt?: string;
  installed: boolean;
  installedPath?: string;
  isFeatured?: boolean;
  featuredRank?: number;
  score?: MarketplaceScore;
  fit?: MarketplaceFit;
  files?: MarketplaceModelFile[];
  license?: string;
  licenseStatus?: 'permissive' | 'restricted' | 'unknown';
  lastModifiedAt?: string;
  qualityScore?: number;
  trustScore?: number;
  communityScore?: number;
  runtimeCompatibility?: number;
  evidence?: MarketplaceEvidence[];
  publisherVerified?: boolean;
  mmprojFilePath?: string;
  runtime?: MarketplaceRuntimeEvidence;
  metadataStatus?: 'verified' | 'pending' | 'unavailable';
};

export type MarketplaceRuntimeEvidence = {
  format: 'gguf';
  status: 'documented' | 'candidate' | 'verified' | 'unsupported';
  architecture?: string;
  ggufFilesVerified: boolean;
  sha256Verified: boolean;
  chatTemplate?: 'documented' | 'unknown';
  toolCalling?: 'documented' | 'unknown';
  mmproj?: 'available' | 'not-required' | 'unknown';
  source: 'modelscope-file-api' | 'local-runtime';
  observedAt: string;
  revision?: string;
  reasons: string[];
};

export type MarketplaceEvidence = {
  source: string;
  kind: 'modelscope' | 'benchmark' | 'runtime' | 'community' | 'license';
  label: string;
  value?: string | number;
  observedAt?: string;
  confidence?: 'A' | 'B' | 'C' | 'D';
};

export type MarketplaceModelFile = {
  path: string;
  sizeBytes?: number;
  sha256?: string;
  quantization?: string;
  isRecommended?: boolean;
  downloadUrl?: string;
  revision?: string;
  kind?: 'model' | 'mmproj';
};

export type MarketplaceScore = {
  stars: number;
  value: number;
  confidence: 'A' | 'B' | 'C' | 'D';
  taskQuality: number;
  deviceFit: number;
  runtimeCompatibility: number;
  trust: number;
  community: number;
  reasons: string[];
  scoreVersion: string;
};

export type MarketplaceFit = {
  status: 'excellent' | 'good' | 'limited' | 'unsupported' | 'unknown';
  estimatedVramMiB?: number;
  estimatedSystemMemoryMiB?: number;
  recommendedContext?: number;
  reason?: string;
};

export type MarketplaceSearchParams = {
  source?: MarketplaceSource | 'all';
  query?: string;
  tags?: string[];
  task?: MarketplaceTaskFilter;
  size?: MarketplaceSizeFilter;
  limit?: number;
  pageNumber?: number;
  cursor?: string;
  device?: MarketplaceDeviceProfile;
  featuredOnly?: boolean;
  fit?: 'all' | 'recommended' | 'excellent' | 'compatible' | 'unsupported';
  quantization?: string;
  minStars?: number;
  language?: string;
};

export type MarketplaceSearchRequest = {
  requestId: string;
  params: MarketplaceSearchParams;
};

export type MarketplaceSearchResult = {
  models: MarketplaceModel[];
  totalCount?: number;
  nextCursor?: string;
  hasMore?: boolean;
  warning?: string;
  source?: 'd1' | 'cloud-catalog' | 'modelscope' | 'curated';
  catalogUpdatedAt?: string;
  scoreVersion?: string;
};
