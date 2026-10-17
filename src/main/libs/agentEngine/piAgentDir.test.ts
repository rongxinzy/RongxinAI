import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureEmbeddedPiAgentDir } from './piAgentDir';

describe('ensureEmbeddedPiAgentDir', () => {
  const roots: string[] = [];

  afterEach(async () => {
    delete process.env.PI_CODING_AGENT_DIR;
    await Promise.all(roots.map(root => fs.rm(root, { recursive: true, force: true })));
    roots.length = 0;
  });

  it('sets PI_CODING_AGENT_DIR under userData and migrates legacy settings once', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zhiyuan-pi-agent-'));
    roots.push(root);
    const legacyHome = path.join(root, 'legacy-home');
    const legacyAgent = path.join(legacyHome, '.pi', 'agent');
    await fs.mkdir(legacyAgent, { recursive: true });
    await fs.writeFile(path.join(legacyAgent, 'settings.json'), '{"theme":"legacy"}\n');

    const previousHome = process.env.HOME;
    process.env.HOME = legacyHome;

    const agentDir = await ensureEmbeddedPiAgentDir(path.join(root, 'userData'));
    expect(process.env.PI_CODING_AGENT_DIR).toBe(agentDir);
    expect(await fs.readFile(path.join(agentDir, 'settings.json'), 'utf8')).toContain('legacy');
    await ensureEmbeddedPiAgentDir(path.join(root, 'userData'));
    expect(await fs.readFile(path.join(agentDir, 'settings.json'), 'utf8')).toContain('legacy');

    process.env.HOME = previousHome;
  });
});
