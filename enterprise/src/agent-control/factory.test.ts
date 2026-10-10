import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, expect, test } from 'vitest';

import { createZhiyuanAgentControlBackend } from './factory.js';
import type { AgentControlClient } from './types.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('creates a headless backend that can run and close independently of Electron', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-agent-backend-'));
  temporaryDirectories.push(directory);
  const backend = createZhiyuanAgentControlBackend({
    client: clientFixture(),
    databasePath: path.join(directory, 'state.sqlite'),
    skillRoot: path.join(directory, 'skills'),
    agentVersion: '2026.8.0',
    platform: 'windows',
  });

  await expect(backend.runOnce()).resolves.toBe(30_000);
  await backend.close();
  await backend.close();
  expect(() => backend.start()).toThrow(/closed/);
  await expect(backend.runOnce()).rejects.toThrow(/closed/);
});

function clientFixture(): AgentControlClient {
  return {
    getSkillManifest: async () => ({ notModified: true, etag: null }),
    downloadSkillPackage: async () => new Uint8Array(),
    reportSkillSyncResult: async () => undefined,
    uploadEventBatch: async () => ({ accepted: [], rejected: [] }),
    heartbeat: async () => ({
      serverTime: '2026-08-26T00:00:00.000Z',
      controlEvents: { pending: false, watermark: '' },
      nextHeartbeatAfterSeconds: 30,
    }),
    listControlEvents: async () => ({ items: [], nextCursor: null }),
    acknowledgeControlEvent: async () => undefined,
    reportControlEventResult: async () => undefined,
  };
}
