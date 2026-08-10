import { DownloaderHelper } from 'node-downloader-helper';
import fs from 'fs';
import path from 'path';

export class DownloadCancelledError extends Error {
  constructor() {
    super('Download cancelled.');
    this.name = 'DownloadCancelledError';
  }
}

export function throwIfDownloadCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DownloadCancelledError();
}

export async function downloadFileWithResume(input: {
  url: string;
  outputPath: string;
  expectedSize?: number;
  signal?: AbortSignal;
  onProgress?: (completed: number, total?: number, speed?: number) => void;
}): Promise<void> {
  throwIfDownloadCancelled(input.signal);
  const outputDir = path.dirname(input.outputPath);
  fs.mkdirSync(outputDir, { recursive: true });
  if (
    typeof input.expectedSize === 'number' &&
    fs.existsSync(input.outputPath) &&
    fs.statSync(input.outputPath).size === input.expectedSize
  ) {
    input.onProgress?.(input.expectedSize, input.expectedSize, undefined);
    return;
  }

  const downloader = new DownloaderHelper(input.url, outputDir, {
    fileName: path.basename(input.outputPath),
    headers: { 'User-Agent': 'ZhiYuanAgent/llamacpp-backend-manager' },
    override: true,
    removeOnStop: false,
    removeOnFail: false,
    resumeIfFileExists: true,
    resumeOnIncomplete: true,
    resumeOnIncompleteMaxRetry: 3,
    retry: { maxRetries: 3, delay: 1000 },
  });

  downloader.on('progress.throttled', stats => {
    input.onProgress?.(
      stats.downloaded,
      stats.total > 0 ? stats.total : undefined,
      stats.speed > 0 ? stats.speed : undefined,
    );
  });
  downloader.on('end', stats => {
    input.onProgress?.(
      stats.downloadedSize,
      stats.totalSize && stats.totalSize > 0 ? stats.totalSize : undefined,
      undefined,
    );
  });
  downloader.on('error', (): void => undefined);

  const cancel = () => {
    void downloader.stop().catch((): void => undefined);
  };
  input.signal?.addEventListener('abort', cancel, { once: true });
  try {
    await downloader.start();
    throwIfDownloadCancelled(input.signal);
  } catch (error) {
    if (input.signal?.aborted) throw new DownloadCancelledError();
    throw error;
  } finally {
    input.signal?.removeEventListener('abort', cancel);
  }
}
