import path from 'node:path';
import { Worker } from 'node:worker_threads';

import type { LocalModelCatalog } from './localModelCatalog';
import type { CatalogFetchLike } from './modelCatalogClient';
import type { CatalogUpdate } from './modelCatalogUpdateTypes';

const MAX_MANIFEST_BYTES = 16 * 1024;
const MAX_UPDATE_BYTES = 8 * 1024 * 1024;
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const RETRY_INTERVAL_MS = 60 * 60 * 1000;
const NETWORK_TIMEOUT_MS = 20_000;

type Artifact = { bytes: number; sha256: string };
type Manifest = {
  schema: 1;
  revision: number;
  snapshot: Artifact;
  delta?: Artifact & { baseRevision: number };
};

function isArtifact(value: Artifact | undefined): value is Artifact {
  return Boolean(
    value &&
    Number.isSafeInteger(value.bytes) &&
    value.bytes > 0 &&
    value.bytes <= MAX_UPDATE_BYTES &&
    /^[a-f0-9]{64}$/.test(value.sha256),
  );
}

async function fetchBytes(
  fetchImpl: CatalogFetchLike,
  url: string,
  limit: number,
): Promise<ArrayBuffer> {
  const response = await fetchImpl(url, {
    headers: { Accept: 'application/json', 'X-Zhiyuan-Client-Id': 'zhiyuan-desktop-catalog-v1' },
    signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
  });
  if (!response.ok || !response.body)
    throw new Error(`Model catalog update HTTP ${response.status}`);
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) throw new Error('Model catalog update exceeds the size limit');
      parts.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return bytes.buffer;
}

function verifyUpdate(
  bytes: ArrayBuffer,
  sha256: string,
  baseRevision: number | null,
  revision: number,
): Promise<CatalogUpdate> {
  const queuedAt = performance.now();
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'modelCatalogUpdateWorker.js'), {
      workerData: { bytes, sha256, baseRevision, revision },
      transferList: [bytes],
    });
    const timer = setTimeout(
      () => finish(new Error('Model catalog verification timed out')),
      10_000,
    );
    function finish(error?: Error, update?: CatalogUpdate): void {
      clearTimeout(timer);
      void worker.terminate();
      if (error || !update) reject(error ?? new Error('Model catalog worker returned no update'));
      else resolve(update);
    }
    worker.once('error', error => finish(error));
    worker.once('exit', () => finish(new Error('Model catalog verification worker exited')));
    worker.once('message', (result: { error?: string; update?: CatalogUpdate; runMs?: number }) => {
      console.debug(
        `[Marketplace] Catalog verification ran ${Math.round(result.runMs ?? 0)} ms after ${Math.round(performance.now() - queuedAt)} ms elapsed`,
      );
      finish(result.error ? new Error(result.error) : undefined, result.update);
    });
  });
}

export async function syncModelCatalog(
  catalog: LocalModelCatalog,
  baseUrl: string,
  fetchImpl: CatalogFetchLike,
  verify = verifyUpdate,
): Promise<void> {
  const root = baseUrl.replace(/\/$/, '');
  const manifest = JSON.parse(
    Buffer.from(await fetchBytes(fetchImpl, `${root}/manifest.json`, MAX_MANIFEST_BYTES)).toString(
      'utf8',
    ),
  ) as Manifest;
  if (
    manifest.schema !== 1 ||
    !Number.isSafeInteger(manifest.revision) ||
    !isArtifact(manifest.snapshot)
  ) {
    throw new Error('Invalid model catalog manifest');
  }
  const current = catalog.getLatestVersion().revision;
  if (manifest.revision <= current) return;
  const delta =
    manifest.delta?.baseRevision === current && isArtifact(manifest.delta) ? manifest.delta : null;
  const file = delta
    ? `delta-${current}-${manifest.revision}.json`
    : `snapshot-${manifest.revision}.json`;
  const artifact = delta ?? manifest.snapshot;
  const bytes = await fetchBytes(fetchImpl, `${root}/${file}`, artifact.bytes);
  if (bytes.byteLength !== artifact.bytes) throw new Error('Incomplete model catalog update');
  const update = await verify(bytes, artifact.sha256, delta ? current : null, manifest.revision);
  await catalog.applyUpdate(update);
}

export function createModelCatalogUpdateCheck(
  catalog: LocalModelCatalog,
  baseUrl: string,
  fetchImpl: CatalogFetchLike,
): () => void {
  let nextCheckAt = 0;
  let running = false;
  return () => {
    if (running || Date.now() < nextCheckAt) return;
    running = true;
    void syncModelCatalog(catalog, baseUrl, fetchImpl)
      .then(() => {
        nextCheckAt = Date.now() + CHECK_INTERVAL_MS;
      })
      .catch(error => {
        nextCheckAt = Date.now() + RETRY_INTERVAL_MS;
        console.debug('[Marketplace] Catalog update unavailable:', error);
      })
      .finally(() => {
        running = false;
      });
  };
}
