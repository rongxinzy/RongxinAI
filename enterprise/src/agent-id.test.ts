import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import { resolveZhiyuanAgentId } from './agent-id.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('Zhiyuan Agent ID', () => {
  test('generates one stable ID across concurrent startup calls', async () => {
    const userData = createTemporaryDirectory();

    const agentIds = await Promise.all([
      resolveZhiyuanAgentId(userData),
      resolveZhiyuanAgentId(userData),
      resolveZhiyuanAgentId(userData),
    ]);

    expect(new Set(agentIds).size).toBe(1);
    expect(agentIds[0]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    await expect(resolveZhiyuanAgentId(userData)).resolves.toBe(agentIds[0]);
  });

  test('fails closed for a corrupted persisted ID', async () => {
    const userData = createTemporaryDirectory();
    const directory = path.join(userData, 'zhiyuan-enterprise');
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'agent-id'), '../not-an-agent-id');

    await expect(resolveZhiyuanAgentId(userData)).rejects.toThrow('Agent ID file is invalid');
  });
});

function createTemporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-agent-id-'));
  temporaryDirectories.push(directory);
  return directory;
}

describe('Zhiyuan Agent ID wake convergence', () => {
  test('waits out the create-then-write gap instead of reporting corruption', async () => {
    const userData = createTemporaryDirectory();
    const directory = path.join(userData, 'zhiyuan-enterprise');
    fs.mkdirSync(directory, { recursive: true });
    const filePath = path.join(directory, 'agent-id');
    // Simulate KEDA-style concurrent startup: the file exists but is empty
    // for a few milliseconds before the winner's content lands.
    fs.writeFileSync(filePath, '');
    setTimeout(
      () => fs.writeFileSync(filePath, `${'a'.repeat(8)}-0000-4000-8000-aaaaaaaaaaaa\n`),
      40,
    );

    const resolved = await Promise.all([
      resolveZhiyuanAgentId(userData),
      resolveZhiyuanAgentId(userData),
    ]);
    expect(new Set(resolved).size).toBe(1);
  });

  test('still fails closed for genuinely corrupted content', async () => {
    const userData = createTemporaryDirectory();
    const directory = path.join(userData, 'zhiyuan-enterprise');
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'agent-id'), 'not-an-id-at-all');

    await expect(resolveZhiyuanAgentId(userData)).rejects.toThrow('Agent ID file is invalid');
  });
});
