import { createServer as httpServer } from 'node:http';
import { createServer as httpsServer } from 'node:https';
import { once } from 'node:events';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { expect, test } from 'vitest';
import { platformFetch } from './transport';

test('handles empty responses and rejects response-conversion failures without escaping the request', async () => {
  const server = httpServer((request, response) => {
    response.writeHead(Number(request.url?.slice(1)));
    response.end();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test server address');
  const base = `http://127.0.0.1:${address.port}`;
  try {
    for (const status of [204, 205]) {
      const response = await platformFetch(`${base}/${status}`);
      expect(response.status).toBe(status);
      expect(response.body).toBeNull();
      expect(await response.text()).toBe('');
    }
    // Node permits this status, but the Web Response constructor rejects it.
    await expect(platformFetch(`${base}/700`)).rejects.toThrow();
    expect((await platformFetch(`${base}/200`, { method: 'HEAD' })).body).toBeNull();
    expect((await platformFetch(`${base}/200`)).status).toBe(200);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test('supports HTTP and never follows redirects carrying credentials', async () => {
  let leaked = false;
  const server = httpServer((request, response) => {
    if (request.url === '/redirect') response.writeHead(302, { Location: '/secret' }).end();
    else {
      leaked = request.url === '/secret';
      response.end('ok');
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test server address');
  const base = `http://127.0.0.1:${address.port}`;
  try {
    expect(await (await platformFetch(base)).text()).toBe('ok');
    await expect(
      platformFetch(base + '/redirect', { headers: { Authorization: 'Bearer secret' } }),
    ).rejects.toThrow('redirect');
    expect(leaked).toBe(false);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test('follows same-host redirects without credentials and preserves POST bodies', async () => {
  let seenMethod = '';
  let seenBody = '';
  let hits = 0;
  const server = httpServer((request, response) => {
    hits += 1;
    if (request.url === '/v1/chat/completions') {
      response.writeHead(301, { Location: '/v1/chat/completions-final' }).end();
      return;
    }
    seenMethod = request.method ?? '';
    const chunks: Buffer[] = [];
    request.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    request.on('end', () => {
      seenBody = Buffer.concat(chunks).toString('utf8');
      response.end('ok');
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test server address');
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const response = await platformFetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"model":"demo"}',
    });
    expect(await response.text()).toBe('ok');
    expect(hits).toBe(2);
    expect(seenMethod).toBe('POST');
    expect(seenBody).toBe('{"model":"demo"}');
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test('continues for a self-signed HTTPS platform without disabling global certificate validation', async () => {
  let opensslAvailable = true;
  try {
    execFileSync('openssl', ['version'], { stdio: 'ignore' });
  } catch {
    opensslAvailable = false;
  }
  if (!opensslAvailable) return;

  const directory = await mkdtemp(path.join(os.tmpdir(), 'aisphere-tls-'));
  const keyFile = path.join(directory, 'key.pem');
  const certFile = path.join(directory, 'cert.pem');
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-days',
      '1',
      '-subj',
      '/CN=localhost',
      '-keyout',
      keyFile,
      '-out',
      certFile,
    ],
    { stdio: 'ignore' },
  );
  const server = httpsServer(
    { key: await readFile(keyFile), cert: await readFile(certFile) },
    (_request, response) => response.end('secure platform'),
  );
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test server address');
  const url = `https://127.0.0.1:${address.port}`;
  try {
    expect(await (await platformFetch(url)).text()).toBe('secure platform');
    await expect(fetch(url)).rejects.toThrow();
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
