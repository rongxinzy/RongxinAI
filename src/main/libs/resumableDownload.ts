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
  let resumeState: Awaited<ReturnType<typeof getResumeState>>;
  try {
    resumeState = await getResumeState(input);
  } catch (error) {
    if (input.signal?.aborted) throw new DownloadCancelledError();
    throw error;
  }
  if (resumeState === 'complete') return;

  const downloader = new DownloaderHelper(input.url, outputDir, {
    fileName: path.basename(input.outputPath),
    headers: { 'User-Agent': 'ZhiYuanAgent/llamacpp-backend-manager' },
    override: true,
    removeOnStop: false,
    removeOnFail: false,
    // Resume explicitly below. The helper's automatic resume path starts with
    // an internal HEAD request that cannot be aborted through AbortSignal.
    resumeIfFileExists: false,
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

  let stopPromise: Promise<void> | undefined;
  const stopDownloader = (): Promise<void> => {
    stopPromise ??= downloader.stop().then(
      (): void => undefined,
      (): void => undefined,
    );
    return stopPromise;
  };

  let rejectAbort: ((error: DownloadCancelledError) => void) | undefined;
  const abortPromise = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  const cancel = () => {
    void stopDownloader().finally(() => {
      rejectAbort?.(new DownloadCancelledError());
    });
  };
  input.signal?.addEventListener('abort', cancel, { once: true });
  try {
    const download = resumeState
      ? downloader.resumeFromFile(input.outputPath, resumeState)
      : downloader.start();
    await Promise.race([download, abortPromise]);
    throwIfDownloadCancelled(input.signal);
  } catch (error) {
    if (input.signal?.aborted) throw new DownloadCancelledError();
    throw error;
  } finally {
    input.signal?.removeEventListener('abort', cancel);
  }
}

async function getResumeState(input: {
  url: string;
  outputPath: string;
  expectedSize?: number;
  signal?: AbortSignal;
  onProgress?: (completed: number, total?: number, speed?: number) => void;
}): Promise<
  | 'complete'
  | {
      downloaded: number;
      fileName: string;
      total: number;
    }
  | undefined
> {
  if (!fs.existsSync(input.outputPath)) return undefined;

  const downloaded = fs.statSync(input.outputPath).size;
  let total = input.expectedSize;
  if (total === undefined) {
    const response = await fetch(input.url, {
      method: 'HEAD',
      headers: { 'User-Agent': 'ZhiYuanAgent/llamacpp-backend-manager' },
      signal: input.signal,
    });
    if (!response.ok) throw new Error(`Failed to determine download size: ${response.status}.`);
    const contentLength = Number(response.headers.get('content-length'));
    total = Number.isFinite(contentLength) && contentLength > 0 ? contentLength : undefined;
  }
  throwIfDownloadCancelled(input.signal);

  if (total === undefined) return undefined;
  if (downloaded === total) {
    input.onProgress?.(total, total, undefined);
    return 'complete';
  }
  if (downloaded <= 0 || downloaded > total) return undefined;

  return {
    downloaded,
    fileName: path.basename(input.outputPath),
    total,
  };
}
