import { LlamaCppKvCacheType, resolveLlamaCppKvCacheBpvFactor } from './kvCacheTypes';

export type GgufKvCacheShape = {
  nLayer: number;
  nHeadKv: number;
  headDim: number;
  contextTrainFull?: number;
};

export function estimateKvBytesPerTokenFromGgufShape(input: {
  shape: GgufKvCacheShape;
  cacheTypeK?: string;
  cacheTypeV?: string;
}): number {
  const { nLayer, nHeadKv, headDim } = input.shape;
  if (nLayer <= 0 || nHeadKv <= 0 || headDim <= 0) {
    return 0;
  }
  const f16BytesPerToken = 2 * nLayer * nHeadKv * headDim;
  const bpvFactor = resolveLlamaCppKvCacheBpvFactor(input.cacheTypeK, input.cacheTypeV);
  return Math.max(16, Math.round(f16BytesPerToken * bpvFactor));
}

export function resolveGgufKvCacheShapeFromMetadata(
  metadata: ReadonlyMap<string, unknown>,
): GgufKvCacheShape | undefined {
  const architecture = metadata.get('general.architecture');
  if (typeof architecture !== 'string' || !architecture.trim()) return undefined;

  const prefix = architecture.trim();
  const nLayer = readMetadataUInt(metadata, `${prefix}.block_count`);
  const nHeadKv =
    readMetadataUInt(metadata, `${prefix}.attention.head_count_kv`) ??
    readMetadataUInt(metadata, `${prefix}.attention.head_count`);
  const embeddingLength = readMetadataUInt(metadata, `${prefix}.embedding_length`);
  const nHead = readMetadataUInt(metadata, `${prefix}.attention.head_count`);
  const keyLength = readMetadataUInt(metadata, `${prefix}.attention.key_length`);
  const headDim =
    keyLength ??
    (embeddingLength && nHead && nHead > 0 ? Math.round(embeddingLength / nHead) : undefined);

  if (!nLayer || !nHeadKv || !headDim) return undefined;

  const contextTrainFull =
    readMetadataUInt(metadata, `${prefix}.context_length`) ??
    readMetadataUInt(metadata, 'llama.context_length');

  return {
    nLayer,
    nHeadKv,
    headDim,
    ...(contextTrainFull ? { contextTrainFull } : {}),
  };
}

function readMetadataUInt(metadata: ReadonlyMap<string, unknown>, key: string): number | undefined {
  const value = metadata.get(key);
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.trunc(value);
  }
  if (typeof value === 'bigint' && value > 0n && value <= BigInt(Number.MAX_SAFE_INTEGER)) {
    return Number(value);
  }
  return undefined;
}

export function mergeGgufAndHeuristicKvBytesPerToken(input: {
  ggufBytesPerToken?: number;
  heuristicBytesPerToken: number;
}): number {
  if (input.ggufBytesPerToken && input.ggufBytesPerToken > 0) {
    return input.ggufBytesPerToken;
  }
  return input.heuristicBytesPerToken;
}

export { LlamaCppKvCacheType };
