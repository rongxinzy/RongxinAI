import type { MarketplaceModel } from '../../shared/marketplace';

export type CatalogVersion = { revision: number; updatedAt: string };

export type CatalogUpsert = [
  repoId: string,
  position: number,
  payload: string,
  searchText: string,
  tags: string,
  parameterCount: number | null,
  featuredRank: number | null,
];

export type CatalogUpdate = CatalogVersion & {
  baseRevision: number | null;
  upserts: CatalogUpsert[];
  deletes: string[];
};

export function toCatalogUpsert(position: number, model: MarketplaceModel): CatalogUpsert {
  return [
    model.repoId,
    position,
    JSON.stringify(model),
    [model.repoId, model.name, model.description, ...model.tags, model.recommendedTag].join(' '),
    JSON.stringify(
      [...model.tags, ...(model.capabilities ?? [model.capability])].map(tag => tag.toLowerCase()),
    ),
    model.parameterCount ?? null,
    model.isFeatured ? (model.featuredRank ?? position) : null,
  ];
}
