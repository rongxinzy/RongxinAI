/**
 * aimock-backed provider endpoint for the long-task scenario.
 *
 * Replaces PiProviderTapeServer with @copilotkit/aimock fixtures: semantic
 * request matching (userMessage/turnIndex/tool predicates) instead of strict
 * seq+hash, so prompt drift does not invalidate a whole recording. Record
 * mode proxies the live gateway and saves fixtures under `fixturesDir`;
 * replay mode serves them with no network.
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

import { LLMock } from '@copilotkit/aimock';

export interface AimockProviderHandle {
  /** OpenAI-compatible base URL, including the /v1 suffix. */
  baseUrl: string;
  port: number;
  stop: () => Promise<void>;
}

export interface AimockProviderOptions {
  fixturesDir: string;
  /** Record mode: proxy fixture misses to this OpenAI-compatible upstream. */
  recordUpstream?: string;
  /** Record mode: bearer injected on upstream passthrough (never recorded). */
  recordApiKey?: string;
  logLevel?: 'silent' | 'warn' | 'info' | 'debug';
}

export async function startAimockProvider(
  options: AimockProviderOptions,
): Promise<AimockProviderHandle> {
  fs.mkdirSync(options.fixturesDir, { recursive: true });
  let upstream = options.recordUpstream;
  let shim: http.Server | null = null;
  if (upstream) {
    // The adapter addresses models by their slash-qualified catalog id
    // (e.g. "fixture/glm-5.3"); the upstream gateway only knows bare names.
    shim = await startModelRewriteProxy(upstream);
    upstream = `http://127.0.0.1:${(shim.address() as import('node:net').AddressInfo).port}`;
  }
  const mock = new LLMock({
    port: 0,
    logLevel: options.logLevel ?? 'warn',
    record: upstream
      ? {
          providers: { openai: upstream },
          providerKeys: options.recordApiKey ? { openai: options.recordApiKey } : undefined,
          fixturePath: options.fixturesDir,
        }
      : undefined,
  });
  if (!options.recordUpstream) {
    // Recorded fixtures gate on the record-time model id; the scenario's model
    // is env-dependent, so drop the model predicate at load (single-model
    // scenario — turnIndex still discriminates requests).
    for (const file of fs.readdirSync(options.fixturesDir)) {
      if (!file.endsWith('.json')) continue;
      const raw = JSON.parse(
        fs.readFileSync(path.join(options.fixturesDir, file), 'utf8'),
      ) as { fixtures?: Array<{ match?: Record<string, unknown> }> };
      const entries = raw.fixtures ?? [];
      for (const entry of entries) delete entry.match?.model;
      mock.addFixtures(entries as never);
    }
  }
  await mock.start();
  const url = mock.url;
  return {
    baseUrl: `${url}/v1`,
    port: Number(new URL(url).port),
    stop: async () => {
      await mock.stop();
      shim?.close();
    },
  };
}

/** Proxy that rewrites JSON request bodies' `model` field to its bare suffix. */
function startModelRewriteProxy(target: string): Promise<http.Server> {
  const targetUrl = new URL(target);
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      let body = Buffer.concat(chunks);
      if ((req.headers['content-type'] ?? '').includes('application/json') && body.length > 0) {
        try {
          const parsed = JSON.parse(body.toString('utf8')) as Record<string, unknown>;
          if (typeof parsed.model === 'string' && parsed.model.includes('/')) {
            parsed.model = parsed.model.split('/').pop();
            body = Buffer.from(JSON.stringify(parsed), 'utf8');
          }
        } catch {
          // Non-JSON or unexpected body: forward untouched.
        }
      }
      const upstreamReq = http.request(
        {
          hostname: targetUrl.hostname,
          port: targetUrl.port,
          path: req.url,
          method: req.method,
          headers: { ...req.headers, host: targetUrl.host, 'content-length': body.length },
        },
        upstreamRes => {
          res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
          upstreamRes.pipe(res);
        },
      );
      upstreamReq.on('error', error => {
        res.writeHead(502);
        res.end(String(error));
      });
      upstreamReq.end(body);
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}
