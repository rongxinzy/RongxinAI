import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';

import { afterEach, describe, expect, test } from 'vitest';

import { DownloadCancelledError, downloadFileWithResume } from './resumableDownload';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('resumable runtime download', () => {
  test('cancels an in-flight resume preflight before it starts a download', async () => {
    let notifyHeadRequest: (() => void) | undefined;
    let closeHeadRequest: (() => void) | undefined;
    let getRequests = 0;
    const server = http.createServer((request, response) => {
      if (request.method === 'HEAD') {
        notifyHeadRequest?.();
        response.once('close', () => closeHeadRequest?.());
        return;
      }
      getRequests += 1;
      response.statusCode = 500;
      response.end();
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test server failed to start.');

    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-resume-preflight-test-'));
    temporaryDirectories.push(directory);
    const outputPath = path.join(directory, 'runtime.zip');
    fs.writeFileSync(outputPath, Buffer.alloc(1));
    const controller = new AbortController();
    const headRequestReceived = new Promise<void>(resolve => {
      notifyHeadRequest = resolve;
    });
    const headRequestClosed = new Promise<void>(resolve => {
      closeHeadRequest = resolve;
    });
    const download = downloadFileWithResume({
      url: `http://127.0.0.1:${address.port}/runtime.zip`,
      outputPath,
      signal: controller.signal,
    });

    try {
      await headRequestReceived;
      controller.abort();
      await expect(download).rejects.toBeInstanceOf(DownloadCancelledError);
      await headRequestClosed;
      expect(getRequests).toBe(0);
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  test('keeps a cancelled partial file and resumes it with Range', async () => {
    const bytes = Buffer.alloc(512 * 1024, 7);
    const ranges: Array<string | undefined> = [];
    const server = http.createServer((request, response) => {
      response.setHeader('Accept-Ranges', 'bytes');
      if (request.method === 'HEAD') {
        response.setHeader('Content-Length', String(bytes.length));
        response.end();
        return;
      }
      const range = typeof request.headers.range === 'string' ? request.headers.range : undefined;
      ranges.push(range);
      const start = range ? Number(/^bytes=(\d+)-$/.exec(range)?.[1] ?? 0) : 0;
      const payload = bytes.subarray(start);
      response.statusCode = range ? 206 : 200;
      response.setHeader('Content-Length', String(payload.length));
      if (range)
        response.setHeader('Content-Range', `bytes ${start}-${bytes.length - 1}/${bytes.length}`);

      let offset = 0;
      const timer = setInterval(() => {
        if (response.destroyed) {
          clearInterval(timer);
          return;
        }
        const chunk = payload.subarray(offset, offset + 16 * 1024);
        offset += chunk.length;
        if (chunk.length > 0) response.write(chunk);
        if (offset >= payload.length) {
          clearInterval(timer);
          response.end();
        }
      }, 10);
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test server failed to start.');

    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-resume-test-'));
    temporaryDirectories.push(directory);
    const outputPath = path.join(directory, 'runtime.zip');
    const url = `http://127.0.0.1:${address.port}/runtime.zip`;
    const controller = new AbortController();
    const cancelTimer = setTimeout(() => controller.abort(), 60);
    try {
      await expect(
        downloadFileWithResume({
          url,
          outputPath,
          expectedSize: bytes.length,
          signal: controller.signal,
        }),
      ).rejects.toBeInstanceOf(DownloadCancelledError);
      const partialSize = fs.statSync(outputPath).size;
      expect(partialSize).toBeGreaterThan(0);
      expect(partialSize).toBeLessThan(bytes.length);

      await downloadFileWithResume({ url, outputPath, expectedSize: bytes.length });
      expect(fs.readFileSync(outputPath)).toEqual(bytes);
      expect(ranges).toContain(`bytes=${partialSize}-`);
    } finally {
      clearTimeout(cancelTimer);
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
});
