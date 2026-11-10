import { createHash } from 'node:crypto';
import { parentPort, workerData } from 'node:worker_threads';

import { buildModelScopeFileUrl } from '../../shared/llamacpp/modelDownloadUrls';
import type { MarketplaceModel } from '../../shared/marketplace';
import { toCatalogUpsert } from './modelCatalogUpdateTypes';

const repoPattern = /^[a-z0-9_-][a-z0-9_.-]*\/[a-z0-9_-][a-z0-9_.-]*$/i;
const safeFile = (file: string) =>
  file.toLowerCase().endsWith('.gguf') &&
  file
    .split('/')
    .every(
      segment =>
        Boolean(segment) && segment !== '.' && segment !== '..' && !/[\\:*?"<>|]/.test(segment),
    );

function normalize(model: MarketplaceModel): MarketplaceModel {
  if (
    !repoPattern.test(model.repoId) ||
    typeof model.name !== 'string' ||
    typeof model.description !== 'string' ||
    !Array.isArray(model.tags) ||
    !model.tags.every(tag => typeof tag === 'string') ||
    !Array.isArray(model.sizes) ||
    (model.capabilities !== undefined &&
      (!Array.isArray(model.capabilities) ||
        !model.capabilities.every(capability => typeof capability === 'string'))) ||
    !Array.isArray(model.files) ||
    model.files.length > 128
  ) {
    throw new Error('Invalid model catalog record');
  }
  const files = model.files.map(file => {
    if (
      typeof file.path !== 'string' ||
      !safeFile(file.path) ||
      !file.revision ||
      !/^[a-f0-9]{40}$/i.test(file.revision) ||
      !file.sha256 ||
      !/^[a-f0-9]{64}$/i.test(file.sha256) ||
      !Number.isSafeInteger(file.sizeBytes) ||
      !file.sizeBytes ||
      file.sizeBytes < 1
    ) {
      throw new Error('Invalid model catalog file');
    }
    return { ...file, downloadUrl: buildModelScopeFileUrl(model.repoId, file.path, file.revision) };
  });
  if (!files.some(file => file.isRecommended && file.kind !== 'mmproj')) {
    throw new Error('Model catalog record has no recommended GGUF');
  }
  return { ...model, source: 'modelscope-gguf', files, installed: false, installedPath: undefined };
}

try {
  const started = performance.now();
  const { bytes, sha256, baseRevision, revision } = workerData as {
    bytes: ArrayBuffer;
    sha256: string;
    baseRevision: number | null;
    revision: number;
  };
  if (createHash('sha256').update(Buffer.from(bytes)).digest('hex') !== sha256) {
    throw new Error('Model catalog update checksum mismatch');
  }
  const update = JSON.parse(Buffer.from(bytes).toString('utf8')) as {
    baseRevision: number | null;
    revision: number;
    updatedAt: string;
    upserts: { position: number; model: MarketplaceModel }[];
    deletes: string[];
  };
  if (
    update.baseRevision !== baseRevision ||
    update.revision !== revision ||
    !Number.isFinite(Date.parse(update.updatedAt)) ||
    !Array.isArray(update.upserts) ||
    update.upserts.length > 5000 ||
    !Array.isArray(update.deletes) ||
    update.deletes.length > 5000 ||
    !update.deletes.every(id => repoPattern.test(id))
  ) {
    throw new Error('Invalid model catalog update');
  }
  const upserts = update.upserts.map(({ position, model }) => {
    if (!Number.isSafeInteger(position) || position < 0) throw new Error('Invalid model position');
    return toCatalogUpsert(position, normalize(model));
  });
  parentPort?.postMessage({ update: { ...update, upserts }, runMs: performance.now() - started });
} catch (error) {
  parentPort?.postMessage({ error: error instanceof Error ? error.message : String(error) });
}
