/**
 * Marketplace search IPC contracts (channel + args + result), single source of
 * truth for `ipcHandlers/marketplace.ts`, the `marketplace` preload namespace,
 * and the renderer `MarketplaceApi` types.
 *
 * Search params mirror `MarketplaceSearchParams` in `src/shared/marketplace/types.ts`.
 * The result is the catalog service's `MarketplaceSearchResult`; models are a
 * large evolving projection, so the result schema keeps only the fields every
 * consumer reads and stays `passthrough`.
 */
import { z } from 'zod';

import { defineIpcContract, type IpcContractChannels } from '../ipc/contract';
import { MarketplaceDeviceProfile, MarketplaceIpcChannel } from './constants';

export const MarketplaceSearchParamsSchema = z
  .object({
    source: z.enum(['modelscope-gguf', 'all']).optional(),
    query: z.string().optional(),
    tags: z.array(z.string()).optional(),
    task: z.enum(['all', 'chat', 'reasoning', 'embedding', 'code', 'vision']).optional(),
    size: z.enum(['all', 'small', 'desktop', 'workstation', 'large']).optional(),
    limit: z.number().optional(),
    pageNumber: z.number().optional(),
    cursor: z.string().optional(),
    device: z.enum(MarketplaceDeviceProfile).optional(),
    featuredOnly: z.boolean().optional(),
    fit: z.enum(['all', 'recommended', 'excellent', 'compatible', 'unsupported']).optional(),
    quantization: z.string().optional(),
    minStars: z.number().optional(),
    language: z.string().optional(),
  })
  .passthrough();

export const MarketplaceSearchRequestSchema = z.object({
  requestId: z.string().min(1),
  params: MarketplaceSearchParamsSchema,
});

export const MarketplaceSearchResultSchema = z
  .object({
    models: z.array(z.object({}).passthrough()),
    totalCount: z.number().optional(),
    nextCursor: z.string().optional(),
    hasMore: z.boolean().optional(),
    warning: z.string().optional(),
    source: z.enum(['d1', 'cloud-catalog', 'modelscope', 'curated']).optional(),
    catalogUpdatedAt: z.string().optional(),
    scoreVersion: z.string().optional(),
  })
  .passthrough();

export const marketplaceContract = defineIpcContract({
  search: {
    channel: MarketplaceIpcChannel.Search,
    args: z.tuple([MarketplaceSearchRequestSchema]),
    result: MarketplaceSearchResultSchema,
  },
  cancelSearch: {
    channel: MarketplaceIpcChannel.CancelSearch,
    args: z.tuple([z.string()]),
    result: z.object({ cancelled: z.boolean() }),
  },
});

/** Preload channel map for the marketplace namespace (zod-free values). */
export const marketplaceContractChannels: IpcContractChannels<typeof marketplaceContract> = {
  search: MarketplaceIpcChannel.Search,
  cancelSearch: MarketplaceIpcChannel.CancelSearch,
} as const;
