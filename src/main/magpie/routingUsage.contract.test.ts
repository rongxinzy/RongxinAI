import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { createServer, type Server } from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import fsSync from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MagpieUsagePeriod } from '../../shared/magpie/routingUsage';
import { MagpieManager } from './manager';
import { MAGPIE_RUNTIME_API_KEY } from './modelService';
import { verifyMagpieBinary } from './integrity';
import { MagpieRoutingUsageService } from './routingUsageService';

function startUpstreamFixture(): Promise<{ server: Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/v1/models') {
        res.end(JSON.stringify({ data: [{ id: 'smoke-model', object: 'model' }] }));
        return;
      }
      if (req.url === '/v1/chat/completions' && req.method === 'POST') {
        res.end(
          JSON.stringify({
            id: 'chatcmpl-smoke',
            object: 'chat.completion',
            choices: [
              { index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' },
            ],
          }),
        );
        return;
      }
      res.statusCode = 404;
      res.end('{}');
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string')
        reject(new Error('fixture server failed to bind'));
      else resolve({ server, port: address.port });
    });
  });
}

const magpieResources = path.resolve(process.env.ZHIYUAN_MAGPIE_RESOURCES || 'resources/magpie');
const magpieBinaryPath = path.join(
  magpieResources,
  `${process.platform}-${process.arch}`,
  process.platform === 'win32' ? 'magpie.exe' : 'magpie',
);

describe('magpie routing and usage API contract', () => {
  it.skipIf(process.env.ZHIYUAN_MAGPIE_SMOKE !== '1')(
    'reads groups, usage and quotas from the pinned binary and projects a gateway call',
    async () => {
      expect(
        fsSync.existsSync(magpieBinaryPath),
        `magpie binary missing at ${magpieBinaryPath}; run scripts/build-magpie-runtime.cjs with Go 1.26.8`,
      ).toBe(true);
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zhiyuan-magpie-routing-'));
      const upstream = await startUpstreamFixture();
      const manager = new MagpieManager({
        resourcesRoot: path.resolve(process.env.ZHIYUAN_MAGPIE_RESOURCES || 'resources/magpie'),
        privateHome: path.join(root, 'service'),
        environment: {
          HOME: root,
          USERPROFILE: root,
          APPDATA: path.join(root, 'appdata'),
          LOCALAPPDATA: path.join(root, 'local'),
          PATH: process.env.PATH,
          TEMP: root,
          TMP: root,
        },
        verify: (dir, signal) =>
          verifyMagpieBinary(dir, signal, async file => {
            const hash = createHash('sha256');
            for await (const chunk of createReadStream(file)) hash.update(chunk);
            return hash.digest('hex');
          }),
      });
      const usage = new MagpieRoutingUsageService(manager);
      try {
        expect((await manager.start()).state).toBe('running');
        const groups = await usage.routingGroups();
        expect(Array.isArray(groups.groups)).toBe(true);
        expect(Array.isArray(groups.models)).toBe(true);
        const summary = await usage.usageSummary(MagpieUsagePeriod.Week);
        expect(typeof summary.calls).toBe('number');
        const pageBefore = await usage.usageRequests(MagpieUsagePeriod.Week, 0, 5);
        expect(Array.isArray(pageBefore.rows)).toBe(true);
        const quotas = await usage.usageQuotas(false);
        expect(Array.isArray(quotas)).toBe(true);
        const budget = await usage.usageBudget();
        expect(typeof budget.usageAlertPercent).toBe('number');

        const providers = await manager.saveProvider({
          name: 'Smoke upstream',
          api: 'openai-completions',
          baseUrl: `http://127.0.0.1:${upstream.port}/v1`,
          models: ['smoke-model'],
        });
        const provider = providers.find(p => p.models.includes('smoke-model'));
        expect(provider?.id).toBeTruthy();
        if (provider && provider.off) await manager.setProviderEnabled(provider.id, true);

        const gatewayUrl = manager.status().gatewayUrl;
        expect(gatewayUrl).toBeTruthy();
        const chat = await fetch(`${gatewayUrl}/v1/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${MAGPIE_RUNTIME_API_KEY}`,
          },
          body: JSON.stringify({
            model: `${provider!.id}/smoke-model`,
            messages: [{ role: 'user', content: 'ping' }],
          }),
        });
        expect(chat.ok).toBe(true);

        const pageAfter = await usage.usageRequests(MagpieUsagePeriod.All, 0, 25);
        expect(pageAfter.total).toBeGreaterThanOrEqual(1);
        expect(pageAfter.rows.some(row => row.model.includes('smoke-model'))).toBe(true);
      } finally {
        await manager.stop();
        await new Promise<void>(resolve => upstream.server.close(() => resolve()));
        await fs.rm(root, { recursive: true, force: true });
      }
    },
    90_000,
  );
});
