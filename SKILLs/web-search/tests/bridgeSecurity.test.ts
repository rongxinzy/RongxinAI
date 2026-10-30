import { fork } from 'node:child_process';
import { once } from 'node:events';
import http from 'node:http';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { test, expect } from 'vitest';

const fixture = fileURLToPath(new URL('./bridge-child.cjs', import.meta.url));
const json = Buffer.from(JSON.stringify({ query: '中文搜索' }));
const cases = [
  { name: 'normal JSON', body: json, status: 400, error: 'connectionId is required' },
  {
    name: 'valid gzip',
    body: gzipSync(json),
    encoding: 'gzip',
    status: 400,
    error: 'connectionId is required',
  },
  { name: 'malformed JSON', body: Buffer.from('{'), status: 400, error: 'Invalid JSON body:' },
  { name: 'oversized JSON', body: Buffer.alloc(2 * 1024 * 1024 + 1, 0x20), status: 413 },
  {
    name: 'oversized inflated JSON',
    body: gzipSync(Buffer.alloc(2 * 1024 * 1024 + 1, 0x20)),
    encoding: 'gzip',
    status: 413,
  },
  { name: 'malformed gzip', body: Buffer.from('invalid gzip'), encoding: 'gzip', status: 400 },
  // GHSA-27r3-jxmh-p828: the decoder finishes before trailing bytes arrive.
  {
    name: 'gzip with trailing bytes',
    body: Buffer.concat([gzipSync(json), Buffer.from([0]), Buffer.alloc(100 * 1024, 0x58)]),
    encoding: 'gzip',
    status: 400,
    error: 'connectionId is required',
  },
];

test.each(cases)(
  'bridge survives $name and remains healthy',
  async ({ body, encoding, status, error }) => {
    const child = fork(fixture, [], { cwd: path.dirname(fixture), silent: true });
    let stderr = '';
    child.stderr?.on('data', chunk => {
      stderr += chunk.toString();
    });
    const exit = once(child, 'exit');
    const timeout = setTimeout(() => child.kill('SIGKILL'), 12000);
    try {
      const ready = await Promise.race([
        once(child, 'message').then(([message]) => message as { port: number }),
        exit.then(() => {
          throw new Error(`Bridge exited before ready: ${stderr}`);
        }),
      ]);
      const response = await new Promise<{ status: number | undefined; text: string }>(
        (resolve, reject) => {
          const request = http.request(
            {
              host: '127.0.0.1',
              port: ready.port,
              method: 'POST',
              path: '/api/browser/disconnect',
              agent: false,
              headers: {
                'Content-Type': 'application/json',
                'Content-Length': body.length,
                ...(encoding ? { 'Content-Encoding': encoding } : {}),
              },
            },
            incoming => {
              let text = '';
              incoming.setEncoding('utf8');
              incoming.on('data', chunk => {
                text += chunk;
              });
              incoming.on('end', () => resolve({ status: incoming.statusCode, text }));
              incoming.on('error', reject);
            },
          );
          request.on('error', reject);
          request.setTimeout(3000, () => request.destroy(new Error('Request timed out')));
          request.end(body);
        },
      );
      expect(response.status).toBe(status);
      if (error) expect(response.text).toContain(error);
      await delay(200); // Catch asynchronous decoder errors after the response.
      expect(child.exitCode, stderr).toBeNull();
      const health = await fetch(`http://127.0.0.1:${ready.port}/api/health`, {
        signal: AbortSignal.timeout(2000),
      });
      expect(health.status).toBe(200);
      expect(await health.json()).toMatchObject({
        success: true,
        data: { status: 'healthy', connections: 0 },
      });
    } finally {
      if (child.connected) child.send('stop');
      else child.kill('SIGKILL');
      await exit;
      clearTimeout(timeout);
    }
  },
  15000,
);
