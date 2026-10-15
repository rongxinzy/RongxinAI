import { afterAll, beforeAll, expect, test } from 'vitest';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AISphere } from '../../../shared/aisphere';
import { AISphereService } from './service';
import { AISphereRequestPool } from './requestPool';
import { startAISphereGateway } from './gateway';

let directory: string;
let workerFile: string;
beforeAll(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'aisphere-worker-'));
  workerFile = path.join(directory, 'worker.cjs');
  await build({
    entryPoints: [path.resolve('src/main/extensions/aisphere/requestWorker.ts')],
    outfile: workerFile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
  });
});
afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

test('gateway uses each model exact endpoint and credential, clamps output, and preserves tool rejection status', async () => {
  const calls: Array<{ url: string; key: string | undefined; body: string | undefined }> = [];
  const service = new AISphereService(async url =>
    Response.json(
      url.endsWith(AISphere.VerifyPath)
        ? { data: 'ok' }
        : {
            code: 0,
            model_list: ['a', 'b'].map(name => ({
              name,
              url: `http://upstream.test/${name}/complete`,
              api_key: `key-${name}`,
              max_output: 50,
            })),
          },
    ),
  );
  const gateway = await startAISphereGateway(
    service,
    async (url, options) => {
      calls.push({ url, key: options?.headers?.Authorization, body: options?.body });
      return new Response('tools are not supported', { status: 400 });
    },
    new AISphereRequestPool(workerFile),
  );
  const values = new Map<string, unknown>();
  await service.initialize(
    {
      get: <T>(key: string) => values.get(key) as T | undefined,
      set: (key, value) => {
        values.set(key, value);
      },
    },
    gateway.baseUrl,
  );
  await service.connect('http://platform.test');
  try {
    for (const model of ['a', 'b']) {
      const response = await fetch(gateway.baseUrl + AISphere.ChatPath, {
        method: 'POST',
        headers: { Authorization: `Bearer ${service.token}` },
        body: JSON.stringify({ model, messages: [], max_tokens: 500 }),
      });
      expect(response.status).toBe(400);
      expect(await response.text()).toBe('tools are not supported');
    }
    expect(calls.map(call => [call.url, call.key])).toEqual([
      ['http://upstream.test/a/complete', 'Bearer key-a'],
      ['http://upstream.test/b/complete', 'Bearer key-b'],
    ]);
    expect(JSON.parse(calls[0].body!).max_tokens).toBe(50);
    const forbidden = await fetch(gateway.baseUrl + AISphere.ChatPath, {
      method: 'POST',
      headers: { Authorization: `Bearer ${service.token}` },
      body: JSON.stringify({ model: 'outside', messages: [] }),
    });
    expect(forbidden.status).toBe(503);
    expect(calls).toHaveLength(2);
    const unauthorized = await fetch(gateway.baseUrl + AISphere.ChatPath, {
      method: 'POST',
      body: '{}',
    });
    expect(unauthorized.status).toBe(403);
  } finally {
    await gateway.close();
  }
});

test('worker rejects malformed, cancelled, and oversized payloads and remains reusable', async () => {
  const pool = new AISphereRequestPool(workerFile);
  try {
    const signal = new AbortController().signal;
    await expect(pool.run('not json', signal)).rejects.toThrow();
    const cancelled = new AbortController();
    cancelled.abort();
    await expect(pool.run('{}', cancelled.signal)).rejects.toThrow();
    await expect(
      pool.run(JSON.stringify({ model: 'a', messages: [] }), signal),
    ).resolves.toMatchObject({ model: 'a' });
  } finally {
    pool.close();
  }
});
