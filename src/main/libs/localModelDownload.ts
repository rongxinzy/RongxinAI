import fs from 'fs';
import { createHash } from 'crypto';

const DOWNLOAD_SPEED_SAMPLE_INTERVAL_MS = 500;
const DOWNLOAD_SPEED_MIN_SAMPLE_DURATION_MS = 100;

export async function downloadLocalModelFile(
  urls: string | readonly string[],
  targetPath: string,
  onProgress: (completed: number, total?: number, speed?: number) => void,
  signal?: AbortSignal,
  expectedSha256?: string,
  expectedSizeBytes?: number,
): Promise<void> {
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
      );
      return;
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
  if (
    /(?:SHA-256 checksum mismatch|byte-size mismatch|invalid GGUF|Install cancelled)/.test(
      error.message,
    )
  ) {
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
): Promise<void> {
  const tempPath = `${targetPath}.download`;
  let completedSuccessfully = false;
  try {
    const resumeFrom = fs.existsSync(tempPath) ? fs.statSync(tempPath).size : 0;
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
      throw new Error(
        'Model download failed due to network error. Please check your network connection or proxy settings.',
      );
    }
    if (!response.ok || !response.body) {
      throw new Error(`Model download failed: HTTP ${response.status}`);
    }
    const resumed = resumeFrom > 0 && response.status === 206;
    const totalHeader = response.headers.get('content-length');
    const contentRangeTotal = parseContentRangeTotal(response.headers.get('content-range'));
    const total =
      contentRangeTotal ??
      (totalHeader ? Number(totalHeader) + (resumed ? resumeFrom : 0) : undefined);
    const file = fs.createWriteStream(tempPath, { flags: resumed ? 'a' : 'w' });
    const reader = response.body.getReader();
    const cancelReader = () => reader.cancel().catch((): void => undefined);
    const onAbort = () => {
      void cancelReader();
    };
    signal?.addEventListener('abort', onAbort);
    let completed = resumed ? resumeFrom : 0;
    try {
      if (completed > 0) onProgress(completed, Number.isFinite(total) ? total : undefined);
      while (true) {
        if (signal?.aborted) throw new Error('Install cancelled');
        const { value, done } = await reader.read();
        if (signal?.aborted) throw new Error('Install cancelled');
        if (done) break;
        completed += value.byteLength;
        if (!file.write(Buffer.from(value))) {
          await new Promise<void>(resolve => file.once('drain', resolve));
        }
        onProgress(
          completed,
          Number.isFinite(total) ? total : undefined,
          calculateSpeed(completed),
        );
      }
      completedSuccessfully = true;
    } finally {
      signal?.removeEventListener('abort', onAbort);
      await cancelReader();
      await new Promise<void>(resolve => file.end(resolve));
    }
    if (completedSuccessfully) {
      const actualSize = fs.statSync(tempPath).size;
      if (
        expectedSizeBytes &&
        Number.isSafeInteger(expectedSizeBytes) &&
        actualSize !== expectedSizeBytes
      ) {
        throw new Error(
          `Model download failed: byte-size mismatch (expected ${expectedSizeBytes}, received ${actualSize}).`,
        );
      }
      if (expectedSha256) {
        const actualSha256 = await sha256File(tempPath);
        if (actualSha256.toLowerCase() !== expectedSha256.trim().toLowerCase()) {
          throw new Error(
            'Model download failed: SHA-256 checksum mismatch. Please retry the download.',
          );
        }
      }
      assertValidGgufFile(tempPath);
      fs.renameSync(tempPath, targetPath);
    }
  } catch (error) {
    if (
      error instanceof Error &&
      /(?:SHA-256 checksum mismatch|byte-size mismatch|invalid GGUF)/.test(error.message) &&
      fs.existsSync(tempPath)
    ) {
      fs.rmSync(tempPath, { force: true });
    }
    throw error;
  }
}

export function assertValidGgufFile(filePath: string): void {
  const fd = fs.openSync(filePath, 'r');
  try {
    const header = Buffer.alloc(8);
    if (fs.readSync(fd, header, 0, header.length, 0) !== header.length) {
      throw new Error('Model download failed: invalid GGUF header.');
    }
    if (header.toString('ascii', 0, 4) !== 'GGUF') {
      throw new Error('Model download failed: invalid GGUF magic bytes.');
    }
    const version = header.readUInt32LE(4);
    if (version < 2 || version > 3) {
      throw new Error(`Model download failed: invalid GGUF version ${version}.`);
    }
  } finally {
    fs.closeSync(fd);
  }
}

export async function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function parseContentRangeTotal(value: string | null): number | undefined {
  if (!value) return undefined;
  const match = value.match(/\/(\d+)$/);
  if (!match) return undefined;
  const total = Number(match[1]);
  return Number.isFinite(total) ? total : undefined;
}
