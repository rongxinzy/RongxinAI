import { createServer as httpServer } from 'node:http';
import { createServer as httpsServer } from 'node:https';
import { once } from 'node:events';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { expect, test } from 'vitest';
import { platformFetch } from './transport';

test('supports HTTP and never follows redirects carrying credentials', async () => {
  let leaked = false;
  const server = httpServer((request, response) => {
    if (request.url === '/redirect') {
      response.writeHead(302, { Location: '/secret' }).end();
    } else {
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

test('continues for a self-signed HTTPS platform without disabling global certificate validation', async () => {
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
