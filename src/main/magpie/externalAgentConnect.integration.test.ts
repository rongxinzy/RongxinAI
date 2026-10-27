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
import { readFileIfExists, userAgentConfigRoots } from './externalAgentHostConfig';
import { claudeApiKey, piModelRef } from './externalAgentConnect.settingsPreservation.test';

const magpieResources = path.resolve(process.env.ZHIYUAN_MAGPIE_RESOURCES || 'resources/magpie');
const magpiePlatformDir = path.join(magpieResources, `${process.platform}-${process.arch}`);
const magpieBinaryName = process.platform === 'win32' ? 'magpie.exe' : 'magpie';
const magpieBinaryPath = path.join(magpiePlatformDir, magpieBinaryName);

const MANAGED_AGENTS = ['claude', 'codex', 'opencode', 'gemini', 'pi'] as const;

const USER_ARTIFACTS: Record<(typeof MANAGED_AGENTS)[number], string[]> = {
  claude: ['projects/smoke/transcript.jsonl', '.credentials.json'],
  codex: ['sessions/smoke-session.json'],
  opencode: [],
  gemini: ['sessions/smoke.json'],
  pi: ['sessions/smoke-session.json'],
};

async function writeFixtureTree(root: string): Promise<Map<string, Buffer>> {
  const opencodeOriginal = Buffer.from(
    `${JSON.stringify(
      {
        provider: {
          mine: { baseUrl: 'https://mine.provider.test/v1', apiKey: 'user-mine-key' },
        },
        model: 'user/mine-model',
      },
      null,
      2,
    )}\n`,
  );
  const codexOriginal = Buffer.from('model = "fixture-codex"\n');
  const claudeSettingsOriginal = Buffer.from(
    `${JSON.stringify({ env: { ANTHROPIC_API_KEY: 'fixture-key' } }, null, 2)}\n`,
  );
  const piSettingsOriginal = Buffer.from(
    `${JSON.stringify({ defaultModel: 'fixture/pi-model' }, null, 2)}\n`,
  );
  const snapshots = new Map<string, Buffer>([
    ['opencode.json', opencodeOriginal],
    ['codex.config.toml', codexOriginal],
  ]);

  await fs.mkdir(path.join(root, '.claude'), { recursive: true });
  await fs.writeFile(path.join(root, '.claude', 'settings.json'), claudeSettingsOriginal);
  await fs.mkdir(path.join(root, '.codex'), { recursive: true });
  await fs.writeFile(path.join(root, '.codex', 'config.toml'), codexOriginal);
  await fs.mkdir(path.join(root, '.config', 'opencode'), { recursive: true });
  await fs.writeFile(path.join(root, '.config', 'opencode', 'opencode.json'), opencodeOriginal);
  await fs.mkdir(path.join(root, '.gemini'), { recursive: true });
  await fs.writeFile(
    path.join(root, '.gemini', 'settings.json'),
    `${JSON.stringify({ model: { name: 'fixture-gemini' } }, null, 2)}\n`,
  );
  const piAgent = path.join(root, '.pi', 'agent');
  await fs.mkdir(piAgent, { recursive: true });
  await fs.writeFile(path.join(piAgent, 'settings.json'), piSettingsOriginal);
  await fs.writeFile(
    path.join(piAgent, 'models.json'),
    `${JSON.stringify({ models: [{ id: 'fixture/pi-model' }] }, null, 2)}\n`,
  );
  return snapshots;
}

async function expectClaudeAndPiSettingsPreserved(
  claudeSettingsPath: string,
  piSettingsPath: string,
): Promise<void> {
  expect(claudeApiKey(await fs.readFile(claudeSettingsPath, 'utf8'))).toBe('fixture-key');
  expect(piModelRef(await fs.readFile(piSettingsPath, 'utf8'))).toBe('fixture/pi-model');
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

async function writeUserArtifacts(
  home: string,
  agentId: (typeof MANAGED_AGENTS)[number],
): Promise<void> {
  const roots = userAgentConfigRoots(home)[agentId];
  if (!roots?.[0]) return;
  for (const relative of USER_ARTIFACTS[agentId]) {
    const file = path.join(roots[0], relative);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, `${relative} fixture payload\n`);
  }
}

async function expectUserArtifactsIntact(
  home: string,
  agentId: (typeof MANAGED_AGENTS)[number],
): Promise<void> {
  const roots = userAgentConfigRoots(home)[agentId];
  if (!roots?.[0]) return;
  for (const relative of USER_ARTIFACTS[agentId]) {
    const file = path.join(roots[0], relative);
    expect(await fs.readFile(file, 'utf8')).toBe(`${relative} fixture payload\n`);
  }
}

function createManager(root: string, binDir: string, gatewayPortRef: { value: number }) {
  return new MagpieManager({
    resourcesRoot: magpieResources,
    parseCatalog: async bytes => projectMagpieCatalog(JSON.parse(new TextDecoder().decode(bytes))),
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
      read: () => gatewayPortRef.value || undefined,
      write: port => {
        gatewayPortRef.value = port;
      },
    },
    verify: (dir, signal) =>
      verifyMagpieBinary(dir, signal, async file => {
        const hash = createHash('sha256');
        for await (const chunk of createReadStream(file)) hash.update(chunk);
        return hash.digest('hex');
      }),
  });
}

describe('magpie external agent connect smoke', () => {
  it.runIf(process.env.ZHIYUAN_MAGPIE_SMOKE === '1')(
    'connect and disconnect preserve user data and only touch wired agents',
    async () => {
      expect(
        fsSync.existsSync(magpieBinaryPath),
        `magpie binary missing at ${magpieBinaryPath}; run scripts/build-magpie-runtime.cjs with Go 1.26.8`,
      ).toBe(true);

      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zhiyuan-magpie-external-agent-'));
      const binDir = path.join(root, 'bin');
      const baseline = await writeFixtureTree(root);
      await installCliStubs(binDir);
      const { server: modelsServer, port: modelsPort } = await startModelsServer();
      const gatewayPortRef = { value: 0 };
      const manager = createManager(root, binDir, gatewayPortRef);
      const opencodePath = path.join(root, '.config', 'opencode', 'opencode.json');
      const codexPath = path.join(root, '.codex', 'config.toml');
      const claudeSettingsPath = path.join(root, '.claude', 'settings.json');
      const piSettingsPath = path.join(root, '.pi', 'agent', 'settings.json');
      try {
        expect((await manager.start()).state).toBe('running');
        const saved = await manager.saveProvider({
          name: 'Smoke Fixture Provider',
          api: 'openai-completions',
          baseUrl: `http://127.0.0.1:${modelsPort}/v1`,
          models: ['fixture/smoke-model'],
        });
        const provider = saved.find(entry => entry.name === 'Smoke Fixture Provider');
        expect(provider).toBeTruthy();
        if (provider?.off) await manager.setProviderEnabled(provider.id, true);

        const piBaseline = await readFileIfExists(path.join(root, '.pi', 'agent', 'models.json'));
        await manager.connectAgent('claude');
        await writeUserArtifacts(root, 'claude');
        await manager.disconnectAllAgents();
        await expectUserArtifactsIntact(root, 'claude');
        const piAfterDisconnectAll = await readFileIfExists(
          path.join(root, '.pi', 'agent', 'models.json'),
        );
        expect(piAfterDisconnectAll?.equals(piBaseline!)).toBe(true);

        for (const agentId of MANAGED_AGENTS) {
          await manager.connectAgent(agentId);
          await writeUserArtifacts(root, agentId);
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
          if (agentId === 'opencode') {
            const merged = await fs.readFile(opencodePath, 'utf8');
            expect(merged).toContain('mine.provider.test');
            expect(merged).toContain('user-mine-key');
          }
          await manager.disconnectAgent(agentId);
          await expectUserArtifactsIntact(root, agentId);
          if (agentId === 'opencode') {
            expect(await fs.readFile(opencodePath, 'utf8')).toBe(
              baseline.get('opencode.json')!.toString('utf8'),
            );
          }
          if (agentId === 'codex') {
            expect(await fs.readFile(codexPath, 'utf8')).toBe(
              baseline.get('codex.config.toml')!.toString('utf8'),
            );
          }
          if (agentId === 'claude' || agentId === 'pi') {
            await expectClaudeAndPiSettingsPreserved(claudeSettingsPath, piSettingsPath);
          }
          await manager.disconnectAgent(agentId);
          if (agentId === 'opencode') {
            expect(await fs.readFile(opencodePath, 'utf8')).toBe(
              baseline.get('opencode.json')!.toString('utf8'),
            );
          }
          if (agentId === 'codex') {
            expect(await fs.readFile(codexPath, 'utf8')).toBe(
              baseline.get('codex.config.toml')!.toString('utf8'),
            );
          }
          if (agentId === 'claude' || agentId === 'pi') {
            await expectClaudeAndPiSettingsPreserved(claudeSettingsPath, piSettingsPath);
          }
        }

        expect((await manager.stop()).state).toBe('stopped');
      } finally {
        await manager.stop();
        await new Promise<void>(resolve => modelsServer.close(() => resolve()));
        await fs.rm(root, { recursive: true, force: true });
      }
    },
    180_000,
  );
});
