import fs from 'fs';
import { pipeline } from 'node:stream/promises';
import { sha256FileStream } from './fileHasher';

const DOWNLOAD_SPEED_SAMPLE_INTERVAL_MS = 500;
const DOWNLOAD_SPEED_MIN_SAMPLE_DURATION_MS = 100;
const INSTALL_CANCELLED = 'Install cancelled';

class ModelFileValidationError extends Error {}

/** Returns whether a new file was published. Verified existing files are kept in place. */
export async function downloadLocalModelFile(
  urls: string | readonly string[],
  targetPath: string,
  onProgress: (completed: number, total?: number, speed?: number) => void,
  signal?: AbortSignal,
  expectedSha256?: string,
  expectedSizeBytes?: number,
  onVerify?: () => void,
): Promise<boolean> {
  if (signal?.aborted) throw new Error(INSTALL_CANCELLED);
  if (expectedSha256) {
    try {
      const { size } = await fs.promises.stat(targetPath);
      await validateModelFile(targetPath, size, expectedSha256, expectedSizeBytes, signal);
      return false;
    } catch (error) {
      if (signal?.aborted) throw new Error(INSTALL_CANCELLED);
      if (
        !(error instanceof ModelFileValidationError) &&
        (error as NodeJS.ErrnoException)?.code !== 'ENOENT'
      ) {
        throw error;
      }
    }
  }
  const candidates = typeof urls === 'string' ? [urls] : [...urls];
  const errors: string[] = [];
  for (let index = 0; index < candidates.length; index += 1) {
    const url = candidates[index];
    if (index > 0 && fs.existsSync(`${targetPath}.download`)) {
      fs.rmSync(`${targetPath}.download`, { force: true });
    }
    try {
      await downloadFileOnce(
        url,
        targetPath,
        onProgress,
        signal,
        expectedSha256,
        expectedSizeBytes,
        onVerify,
      );
      return true;
    } catch (error) {
      if (!shouldTryNextModelDownloadUrl(error, index, candidates.length)) {
        throw error;
      }
      errors.push(`${error instanceof Error ? error.message : String(error)} (${url})`);
    }
  }
  throw new Error(errors.join('; '));
}

function shouldTryNextModelDownloadUrl(
  error: unknown,
  index: number,
  totalCandidates: number,
): boolean {
  if (index >= totalCandidates - 1) return false;
  if (!(error instanceof Error)) return false;
  if (error instanceof ModelFileValidationError || error.message === INSTALL_CANCELLED) {
    return false;
  }
  return /HTTP 40[34]|HTTP 50[0234]|network error/i.test(error.message);
}

async function downloadFileOnce(
  url: string,
  targetPath: string,
  onProgress: (completed: number, total?: number, speed?: number) => void,
  signal?: AbortSignal,
  expectedSha256?: string,
  expectedSizeBytes?: number,
  onVerify?: () => void,
): Promise<void> {
  const tempPath = `${targetPath}.download`;
  try {
    signal?.throwIfAborted();
    let resumeFrom = fs.existsSync(tempPath) ? fs.statSync(tempPath).size : 0;
    if (expectedSizeBytes && resumeFrom > expectedSizeBytes) {
      await fs.promises.unlink(tempPath);
      resumeFrom = 0;
    }
    if (!expectedSizeBytes || resumeFrom !== expectedSizeBytes) {
      await transferModelFile(url, tempPath, resumeFrom, onProgress, signal, expectedSizeBytes);
    }
    const actualSize = fs.statSync(tempPath).size;
    onProgress(actualSize, actualSize);
    onVerify?.();
    await validateModelFile(tempPath, actualSize, expectedSha256, expectedSizeBytes, signal);
    fs.renameSync(tempPath, targetPath);
  } catch (error) {
    if (signal?.aborted) throw new Error(INSTALL_CANCELLED);
    if (error instanceof ModelFileValidationError) {
      fs.rmSync(tempPath, { force: true });
    }
    throw error;
  }
}

async function validateModelFile(
  filePath: string,
  actualSize: number,
  expectedSha256?: string,
  expectedSizeBytes?: number,
  signal?: AbortSignal,
): Promise<void> {
  if (
    expectedSizeBytes &&
    Number.isSafeInteger(expectedSizeBytes) &&
    actualSize !== expectedSizeBytes
  ) {
    throw new ModelFileValidationError(
      `Model download failed: byte-size mismatch (expected ${expectedSizeBytes}, received ${actualSize}).`,
    );
  }
  await assertValidGgufFile(filePath);
  if (expectedSha256) {
    const actualSha256 = await sha256File(filePath, signal);
    if (actualSha256.toLowerCase() !== expectedSha256.trim().toLowerCase()) {
      throw new ModelFileValidationError(
        'Model download failed: SHA-256 checksum mismatch. Please retry the download.',
      );
    }
  }
  signal?.throwIfAborted();
}

async function transferModelFile(
  url: string,
  tempPath: string,
  resumeFrom: number,
  onProgress: (completed: number, total?: number, speed?: number) => void,
  signal?: AbortSignal,
  expectedSizeBytes?: number,
): Promise<void> {
  let speedSampleAt = Date.now();
  let speedSampleCompleted = resumeFrom;
  let latestSpeed: number | undefined;
  const calculateSpeed = (completed: number): number | undefined => {
    const now = Date.now();
    const elapsedMs = now - speedSampleAt;
    if (elapsedMs >= DOWNLOAD_SPEED_SAMPLE_INTERVAL_MS || latestSpeed === undefined) {
      const transferred = completed - speedSampleCompleted;
      if (transferred > 0) {
        const sampleDurationMs = Math.max(elapsedMs, DOWNLOAD_SPEED_MIN_SAMPLE_DURATION_MS);
        latestSpeed = transferred / (sampleDurationMs / 1000);
      }
      speedSampleAt = now;
      speedSampleCompleted = completed;
    }
    return latestSpeed;
  };
  let response: Response;
  try {
    response = await fetch(url, {
      signal,
      ...(resumeFrom > 0 ? { headers: { Range: `bytes=${resumeFrom}-` } } : {}),
    });
  } catch {
    signal?.throwIfAborted();
    throw new Error(
      'Model download failed due to network error. Please check your network connection or proxy settings.',
    );
  }
  if (!response.ok || !response.body) {
    throw new Error(`Model download failed: HTTP ${response.status}`);
  }
  const resumed = resumeFrom > 0 && response.status === 206;
  if (
    response.status === 206 &&
    !response.headers.get('content-range')?.startsWith(`bytes ${resumeFrom}-`)
  ) {
    await response.body.cancel();
    throw new Error('Model download failed: invalid response range.');
  }
  const totalHeader = response.headers.get('content-length');
  const contentRangeTotal = parseContentRangeTotal(response.headers.get('content-range'));
  const total =
    contentRangeTotal ??
    (totalHeader ? Number(totalHeader) + (resumed ? resumeFrom : 0) : undefined);
  const reader = response.body.getReader();
  const cancelReader = (): void => {
    void reader.cancel().catch(() => {});
  };
  signal?.addEventListener('abort', cancelReader, { once: true });
  async function* chunks() {
    let completed = resumed ? resumeFrom : 0;
    try {
      if (completed > 0) onProgress(completed, Number.isFinite(total) ? total : undefined);
      while (true) {
        signal?.throwIfAborted();
        const { value, done } = await reader.read();
        signal?.throwIfAborted();
        if (done) break;
        completed += value.byteLength;
        if (expectedSizeBytes && completed > expectedSizeBytes) {
          throw new ModelFileValidationError(
            `Model download failed: byte-size mismatch (expected ${expectedSizeBytes}, received at least ${completed}).`,
          );
        }
        yield Buffer.from(value);
        onProgress(
          completed,
          Number.isFinite(total) ? total : undefined,
          calculateSpeed(completed),
        );
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
  }
  let file: Awaited<ReturnType<typeof fs.promises.open>> | undefined;
  try {
    signal?.throwIfAborted();
    file = await fs.promises.open(tempPath, resumed ? 'a' : 'w');
    const destination = file;
    await pipeline(
      chunks(),
      async source => {
        for await (const chunk of source) {
          await destination.writeFile(chunk);
        }
      },
      { signal },
    );
  } finally {
    signal?.removeEventListener('abort', cancelReader);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
    await file?.close();
  }
}

async function assertValidGgufFile(filePath: string): Promise<void> {
  const file = await fs.promises.open(filePath, 'r');
  try {
    const header = Buffer.alloc(8);
    const { bytesRead } = await file.read(header, 0, header.length, 0);
    if (bytesRead !== header.length) {
      throw new ModelFileValidationError('Model download failed: invalid GGUF header.');
    }
    if (header.toString('ascii', 0, 4) !== 'GGUF') {
      throw new ModelFileValidationError('Model download failed: invalid GGUF magic bytes.');
    }
    const version = header.readUInt32LE(4);
    if (version < 2 || version > 3) {
      throw new ModelFileValidationError(`Model download failed: invalid GGUF version ${version}.`);
    }
  } finally {
    await file.close();
  }
}

export async function sha256File(filePath: string, signal?: AbortSignal): Promise<string> {
  const { size } = await fs.promises.stat(filePath);
  return sha256FileStream(filePath, { signal, maxBytes: size, timeoutMs: 60 * 60_000 });
}

function parseContentRangeTotal(value: string | null): number | undefined {
  if (!value) return undefined;
  const match = value.match(/\/(\d+)$/);
  if (!match) return undefined;
  const total = Number(match[1]);
  return Number.isFinite(total) ? total : undefined;
}
