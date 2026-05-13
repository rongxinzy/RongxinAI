export type MarketplaceSource = 'ollama-library';

export type MarketplaceTaskFilter = 'all' | 'chat' | 'reasoning' | 'embedding' | 'code' | 'vision';

export type MarketplaceSizeFilter = 'all' | 'small' | 'desktop' | 'workstation' | 'large';

export type MarketplaceModel = {
  source: MarketplaceSource;
  id: string;
  name: string;
  description: string;
  tags: string[];
  sizes: string[];
  recommendedTag: string;
  downloads?: number;
  installName?: string;
  detailUrl?: string;
  parameterCount?: number;
};

export type MarketplaceSearchParams = {
  source?: MarketplaceSource | 'all';
  query?: string;
  tags?: string[];
  task?: MarketplaceTaskFilter;
  size?: MarketplaceSizeFilter;
  limit?: number;
};

export type MarketplaceSearchResult = {
  models: MarketplaceModel[];
};

export type MarketplaceInstallPhase =
  | 'starting'
  | 'pulling'
  | 'cancelling'
  | 'cancelled'
  | 'done'
  | 'failed';

export type MarketplaceInstallProgress = {
  modelId: string;
  modelName: string;
  phase: MarketplaceInstallPhase;
  completed?: number;
  total?: number;
  error?: string;
};

export type MarketplaceInstallResult = {
  success: true;
  modelName: string;
};

export type MarketplaceCancelInstallResult = {
  success: true;
  cancelled: boolean;
};
