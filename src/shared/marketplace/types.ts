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

export type MarketplaceCapability = typeof MarketplaceCapability[keyof typeof MarketplaceCapability];

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
  filePath?: string;
  downloads?: number;
  detailUrl?: string;
  parameterCount?: number;
  installed: boolean;
  installedPath?: string;
  isFeatured?: boolean;
};

export type MarketplaceSearchParams = {
  source?: MarketplaceSource | 'all';
  query?: string;
  tags?: string[];
  task?: MarketplaceTaskFilter;
  size?: MarketplaceSizeFilter;
  limit?: number;
  pageNumber?: number;
  featuredOnly?: boolean;
};

export type MarketplaceSearchResult = {
  models: MarketplaceModel[];
  totalCount?: number;
  nextPageNumber?: number;
  warning?: string;
};
