/**
 * Marketplace search IPC contracts (channel + args + result), single source of
 * truth for `ipcHandlers/marketplace.ts`, the `marketplace` preload namespace,
 * and the renderer `MarketplaceApi` types.
 *
 * Search params mirror `MarketplaceSearchParams` in `src/shared/marketplace/types.ts`.
 * The result is the catalog service's `MarketplaceSearchResult`; models are a
 * large evolving projection, so the result schema keeps only the fields every
 * consumer reads.
 */
import { z } from 'zod';

import { defineIpcContract } from '../ipc/contract';
import { MarketplaceDeviceProfile, MarketplaceIpcChannel } from './constants';
import type { MarketplaceSearchResult } from './types';

const MarketplaceSearchParamsSchema = z.object({
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
});

export const MarketplaceSearchRequestSchema = z.object({
  requestId: z.string().min(1),
  params: MarketplaceSearchParamsSchema,
});

/**
 * The catalog service owns this projection (`MarketplaceModel` is a large
 * evolving type in ./types); result validation only pins the envelope fields,
 * with `models` cast to the shared type.
 */
const MarketplaceSearchResultSchema = z.custom<MarketplaceSearchResult>(
  value => typeof value === 'object' && value !== null,
);

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
