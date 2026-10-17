import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { it, expect } from 'vitest';
import { projectMagpieCatalog } from './catalog';
import { MagpieManager } from './manager';
import { verifyMagpieBinary } from './integrity';

it.skipIf(process.env.ZHIYUAN_MAGPIE_SMOKE !== '1')(
  'connect and disconnect restore Claude Code and Pi configs byte-for-byte',
  async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zhiyuan-magpie-external-agent-'));
    const claudeSettings = path.join(root, '.claude', 'settings.json');
    await fs.mkdir(path.dirname(claudeSettings), { recursive: true });
    const claudeOriginal = `${JSON.stringify({ env: { ANTHROPIC_API_KEY: 'fixture-key' } }, null, 2)}\n`;
    await fs.writeFile(claudeSettings, claudeOriginal);

    const piSettings = path.join(root, '.pi', 'agent', 'settings.json');
    await fs.mkdir(path.dirname(piSettings), { recursive: true });
    const piOriginal = `${JSON.stringify({ defaultModel: 'fixture/pi-model' }, null, 2)}\n`;
    await fs.writeFile(piSettings, piOriginal);

    let gatewayPort = 0;
    const manager = new MagpieManager({
      resourcesRoot: path.resolve(process.env.ZHIYUAN_MAGPIE_RESOURCES || 'resources/magpie'),
      parseCatalog: async bytes =>
        projectMagpieCatalog(JSON.parse(new TextDecoder().decode(bytes))),
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

      await manager.connectAgent('claude');
      const claudeConnected = await fs.readFile(claudeSettings, 'utf8');
      expect(claudeConnected).toContain('ANTHROPIC_BASE_URL');
      expect(claudeConnected).not.toBe(claudeOriginal);

      await manager.connectAgent('pi');
      const piConnected = await fs.readFile(piSettings, 'utf8');
      expect(piConnected).not.toBe(piOriginal);

      await manager.disconnectAgent('claude');
      expect(await fs.readFile(claudeSettings, 'utf8')).toBe(claudeOriginal);

      await manager.disconnectAgent('pi');
      expect(await fs.readFile(piSettings, 'utf8')).toBe(piOriginal);

      expect((await manager.stop()).state).toBe('stopped');
    } finally {
      await manager.stop();
      await fs.rm(root, { recursive: true, force: true });
    }
  },
  90_000,
);
