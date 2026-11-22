import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { syncEnterpriseConfig } from './enterpriseConfigSync';

const electronPaths = vi.hoisted(() => ({ userData: '' }));

vi.mock('electron', () => ({
  app: { getPath: () => electronPaths.userData },
}));

let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enterprise-config-'));
  electronPaths.userData = path.join(tempDir, 'userData');
  fs.mkdirSync(electronPaths.userData, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

test('syncs current enterprise package content without reading legacy runtime config', async () => {
  const configDir = path.join(electronPaths.userData, 'enterprise-config');
  const skillDir = path.join(configDir, 'skills', 'review');
  const agentDir = path.join(configDir, 'agents', 'profile');
  fs.mkdirSync(path.join(skillDir, 'references'), { recursive: true });
  fs.mkdirSync(agentDir, { recursive: true });
  fs.mkdirSync(path.join(configDir, 'mcp'));
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# Review');
  fs.writeFileSync(path.join(skillDir, 'references', 'guide.md'), '# Guide');
  fs.writeFileSync(path.join(agentDir, 'AGENTS.md'), '# Enterprise');
  fs.writeFileSync(
    path.join(configDir, 'mcp', 'servers.json'),
    JSON.stringify([{ name: 'managed-server' }]),
  );
  fs.writeFileSync(
    path.join(configDir, 'manifest.json'),
    JSON.stringify({
      version: '2.0.0',
      name: 'Current package',
      sync: { skills: true, agents: true, mcp: true },
    }),
  );
  fs.writeFileSync(path.join(configDir, 'openclaw.json'), '{ invalid legacy data');

  const values = new Map<string, unknown>();
  const store = {
    get: (key: string) => values.get(key),
    set: (key: string, value: unknown) => values.set(key, value),
  };
  const workspace = path.join(tempDir, 'workspace');
  const upsert = vi.fn(() => values.has('enterprise_config'));
  const manifest = await syncEnterpriseConfig(
    configDir,
    store as never,
    upsert,
    () => undefined,
    () => workspace,
  );

  expect(manifest?.version).toBe('2.0.0');
  expect(values.get('enterprise_config')).toEqual(manifest);
  expect(
    fs.readFileSync(
      path.join(electronPaths.userData, 'SKILLs', 'review', 'references', 'guide.md'),
      'utf8',
    ),
  ).toBe('# Guide');
  expect(fs.readFileSync(path.join(workspace, 'profile', 'AGENTS.md'), 'utf8')).toBe(
    '# Enterprise',
  );
  expect(upsert).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ name: 'managed-server', transportType: 'stdio' }),
  );
  expect(upsert).toHaveReturnedWith(false);
});

test('does not fall back to a legacy agent workspace', async () => {
  const configDir = path.join(electronPaths.userData, 'enterprise-config');
  fs.mkdirSync(path.join(configDir, 'agents'), { recursive: true });
  fs.writeFileSync(path.join(configDir, 'agents', 'AGENTS.md'), '# Enterprise');
  fs.writeFileSync(
    path.join(configDir, 'manifest.json'),
    JSON.stringify({
      version: '2.0.0',
      name: 'Current package',
      sync: { skills: false, agents: true, mcp: false },
    }),
  );
  const store = { get: () => undefined, set: () => undefined };
  await syncEnterpriseConfig(
    configDir,
    store as never,
    () => undefined,
    () => undefined,
    () => undefined,
  );

  expect(fs.existsSync(path.join(tempDir, '.openclaw'))).toBe(false);
});
