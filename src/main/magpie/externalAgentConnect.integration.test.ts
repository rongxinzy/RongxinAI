import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import fsSync from 'node:fs';
import { projectMagpieCatalog } from './catalog';
import { MagpieManager } from './manager';
import { verifyMagpieBinary } from './integrity';
import {
  assertDirectorySnapshotsEqual,
  collectDirectorySnapshot,
  userAgentConfigRoots,
} from './externalAgentHostConfig';

const magpieResources = path.resolve(process.env.ZHIYUAN_MAGPIE_RESOURCES || 'resources/magpie');
const magpiePlatformDir = path.join(magpieResources, `${process.platform}-${process.arch}`);
const magpieBinaryName = process.platform === 'win32' ? 'magpie.exe' : 'magpie';
const magpieBinaryPath = path.join(magpiePlatformDir, magpieBinaryName);

const MANAGED_AGENTS = ['claude', 'codex', 'opencode', 'gemini', 'pi'] as const;

async function writeFixtureTree(root: string): Promise<void> {
  await fs.mkdir(path.join(root, '.claude'), { recursive: true });
  await fs.writeFile(
    path.join(root, '.claude', 'settings.json'),
    `${JSON.stringify({ env: { ANTHROPIC_API_KEY: 'fixture-key' } }, null, 2)}\n`,
  );
  await fs.mkdir(path.join(root, '.codex'), { recursive: true });
  await fs.writeFile(path.join(root, '.codex', 'config.toml'), 'model = "fixture-codex"\n');
  await fs.mkdir(path.join(root, '.config', 'opencode'), { recursive: true });
  await fs.writeFile(
    path.join(root, '.config', 'opencode', 'opencode.json'),
    `${JSON.stringify({ provider: { custom: { baseUrl: 'https://example.invalid' } } }, null, 2)}\n`,
  );
  await fs.mkdir(path.join(root, '.gemini'), { recursive: true });
  await fs.writeFile(
    path.join(root, '.gemini', 'settings.json'),
    `${JSON.stringify({ model: { name: 'fixture-gemini' } }, null, 2)}\n`,
  );
  const piAgent = path.join(root, '.pi', 'agent');
  await fs.mkdir(piAgent, { recursive: true });
  await fs.writeFile(
    path.join(piAgent, 'settings.json'),
    `${JSON.stringify({ defaultModel: 'fixture/pi-model' }, null, 2)}\n`,
  );
  await fs.writeFile(
    path.join(piAgent, 'models.json'),
    `${JSON.stringify({ models: [{ id: 'fixture/pi-model' }] }, null, 2)}\n`,
  );
}

async function installCliStubs(binDir: string): Promise<void> {
  await fs.mkdir(binDir, { recursive: true });
  for (const name of MANAGED_AGENTS) {
    const file = path.join(binDir, name);
    await fs.writeFile(file, '#!/bin/sh\necho "1.0.0-smoke"\n', { mode: 0o755 });
  }
}

function startModelsServer(): Promise<{ server: Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      if (req.url === '/v1/models') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ data: [{ id: 'fixture/smoke-model', object: 'model' }] }));
        return;
      }
      res.statusCode = 404;
      res.end('{}');
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string')
        reject(new Error('models server failed to bind'));
      else resolve({ server, port: address.port });
    });
  });
}

async function snapshotAllAgentRoots(home: string): Promise<Map<string, Map<string, Buffer>>> {
  const out = new Map<string, Map<string, Buffer>>();
  const roots = userAgentConfigRoots(home);
  for (const [id, paths] of Object.entries(roots)) {
    const merged = new Map<string, Buffer>();
    for (const dir of paths) {
      for (const [key, value] of await collectDirectorySnapshot(dir)) {
        merged.set(`${path.basename(dir)}/${key}`, value);
      }
    }
    out.set(id, merged);
  }
  return out;
}

describe('magpie external agent connect smoke', () => {
  it.runIf(process.env.ZHIYUAN_MAGPIE_SMOKE === '1')(
    'connect and disconnect restore all five managed agents byte-for-byte',
    async () => {
      expect(
        fsSync.existsSync(magpieBinaryPath),
        `magpie binary missing at ${magpieBinaryPath}; run scripts/build-magpie-runtime.cjs with Go 1.26.8`,
      ).toBe(true);

      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zhiyuan-magpie-external-agent-'));
      const binDir = path.join(root, 'bin');
      await writeFixtureTree(root);
      await installCliStubs(binDir);
      const { server: modelsServer, port: modelsPort } = await startModelsServer();

      let gatewayPort = 0;
      const manager = new MagpieManager({
        resourcesRoot: magpieResources,
        parseCatalog: async bytes =>
          projectMagpieCatalog(JSON.parse(new TextDecoder().decode(bytes))),
        privateHome: path.join(root, 'service'),
        environment: {
          HOME: root,
          USERPROFILE: root,
          APPDATA: path.join(root, 'appdata'),
          LOCALAPPDATA: path.join(root, 'local'),
          PATH: `${binDir}:${process.env.PATH}`,
          TEMP: root,
          TMP: root,
        },
        gatewayPort: {
          read: () => gatewayPort || undefined,
          write: port => {
            gatewayPort = port;
          },
        },
        verify: (dir, signal) =>
          verifyMagpieBinary(dir, signal, async file => {
            const hash = createHash('sha256');
            for await (const chunk of createReadStream(file)) hash.update(chunk);
            return hash.digest('hex');
          }),
      });

      try {
        expect((await manager.start()).state).toBe('running');
        const saved = await manager.saveProvider({
          name: 'Smoke Fixture Provider',
          api: 'openai-completions',
          baseUrl: `http://127.0.0.1:${modelsPort}/v1`,
          key: 'none',
          models: ['fixture/smoke-model'],
        });
        const provider = saved.find(entry => entry.name === 'Smoke Fixture Provider');
        expect(provider).toBeTruthy();
        if (provider?.off) await manager.setProviderEnabled(provider.id, true);

        const before = await snapshotAllAgentRoots(root);

        for (const agentId of MANAGED_AGENTS) {
          await manager.connectAgent(agentId);
          const live = await manager.agents();
          const agent = live.agents.find(entry => entry.id === agentId);
          const field = agent?.models.find(entry => entry.key === 'model') ?? agent?.models[0];
          if (
            field &&
            (field.options.some(option => option.value === 'fixture/smoke-model') ||
              field.value === 'fixture/smoke-model')
          ) {
            await manager.setModel({
              agentId,
              field: field.key,
              value: 'fixture/smoke-model',
            });
          }
          const userOpenCode = path.join(root, '.config', 'opencode', 'opencode.json');
          if (agentId === 'opencode') {
            expect(await fs.readFile(userOpenCode, 'utf8')).not.toContain('example.invalid');
          }
          if (agentId === 'claude') {
            const claude = await fs.readFile(path.join(root, '.claude', 'settings.json'), 'utf8');
            expect(claude).toContain('ANTHROPIC_BASE_URL');
          }
          await manager.disconnectAgent(agentId);
          const after = await snapshotAllAgentRoots(root);
          assertDirectorySnapshotsEqual(before.get(agentId)!, after.get(agentId)!, agentId);
          if (agentId === 'codex') {
            const codexToml = await fs.readFile(path.join(root, '.codex', 'config.toml'), 'utf8');
            expect(codexToml).not.toContain('[model_providers.magpie]');
            expect(codexToml).toBe('model = "fixture-codex"\n');
          }
        }

        expect((await manager.stop()).state).toBe('stopped');
      } finally {
        await manager.stop();
        await new Promise<void>(resolve => modelsServer.close(() => resolve()));
        await fs.rm(root, { recursive: true, force: true });
      }
    },
    120_000,
  );
});
