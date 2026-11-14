import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { ensureEmbeddedPiAgentDir } from './piAgentDir';

const roots: string[] = [];
const previousAgentDir = process.env.ZHIYUAN_AGENT_DIR;
afterEach(async () => {
  if (previousAgentDir === undefined) delete process.env.ZHIYUAN_AGENT_DIR;
  else process.env.ZHIYUAN_AGENT_DIR = previousAgentDir;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

test('creates product resources without inspecting HOME or migrating retired configuration', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'durable-agent-resources-'));
  roots.push(root);
  const cliHome = path.join(root, 'unrelated-cli-home');
  const cliAgent = path.join(cliHome, '.pi', 'agent');
  const userData = path.join(root, 'user data');
  const retiredAgent = path.join(userData, 'pi-agent');
  await fs.mkdir(cliAgent, { recursive: true });
  await fs.mkdir(retiredAgent, { recursive: true });
  await fs.writeFile(path.join(cliAgent, 'settings.json'), 'CLI settings stay here');
  await fs.writeFile(path.join(retiredAgent, 'prompt.md'), 'Retired data stays here');
  const homedir = vi.spyOn(os, 'homedir').mockReturnValue(cliHome);
  vi.stubEnv('PI_CODING_AGENT_DIR', cliAgent);

  const directory = await ensureEmbeddedPiAgentDir(userData);
  expect(directory).toBe(path.join(userData, 'agent-resources'));
  expect(process.env.ZHIYUAN_AGENT_DIR).toBe(directory);
  expect(process.env.PI_CODING_AGENT_DIR).toBe(cliAgent);
  expect(homedir).not.toHaveBeenCalled();
  expect(await fs.readdir(directory)).toEqual([]);
  expect(await fs.readFile(path.join(cliAgent, 'settings.json'), 'utf8')).toBe(
    'CLI settings stay here',
  );
  expect(await fs.readFile(path.join(retiredAgent, 'prompt.md'), 'utf8')).toBe(
    'Retired data stays here',
  );
});

test('reuses product resources without overwriting their existing contents', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'durable-agent-resources-'));
  roots.push(root);
  const directory = await ensureEmbeddedPiAgentDir(root);
  await fs.writeFile(path.join(directory, 'prompt.md'), 'Product-owned prompt');
  expect(await ensureEmbeddedPiAgentDir(root)).toBe(directory);
  expect(await fs.readFile(path.join(directory, 'prompt.md'), 'utf8')).toBe('Product-owned prompt');
});
