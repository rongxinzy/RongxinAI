import { createHash } from 'node:crypto';

import { buildModelScopeFileUrl } from '../../shared/llamacpp/modelDownloadUrls';
import type { MarketplaceModel } from '../../shared/marketplace';
import {
  ModelCatalogUpdateLimit,
  toCatalogUpsert,
  type CatalogUpdate,
  type VerifyModelCatalogUpdateInput,
} from './modelCatalogUpdateTypes';

const repoPattern = /^[a-z0-9_-][a-z0-9_.-]*\/[a-z0-9_-][a-z0-9_.-]*$/i;
const safeFile = (file: string) =>
  file.toLowerCase().endsWith('.gguf') &&
  !/imatrix/i.test(file) &&
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

export function verifyModelCatalogUpdate({
  bytes,
  sha256,
  baseRevision,
  revision,
}: VerifyModelCatalogUpdateInput): CatalogUpdate {
  if (!(bytes instanceof ArrayBuffer) || bytes.byteLength > ModelCatalogUpdateLimit.Bytes) {
    throw new Error('Model catalog update exceeds the size limit');
  }
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
    update.upserts.length > ModelCatalogUpdateLimit.Records ||
    !Array.isArray(update.deletes) ||
    update.deletes.length > ModelCatalogUpdateLimit.Records ||
    !update.deletes.every(id => repoPattern.test(id))
  ) {
    throw new Error('Invalid model catalog update');
  }
  const upserts = update.upserts.map(({ position, model }) => {
    if (!Number.isSafeInteger(position) || position < 0) throw new Error('Invalid model position');
    return toCatalogUpsert(position, normalize(model));
  });
  return { baseRevision, revision, updatedAt: update.updatedAt, upserts, deletes: update.deletes };
}
