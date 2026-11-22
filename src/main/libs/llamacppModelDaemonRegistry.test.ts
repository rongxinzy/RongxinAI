import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import {
  readLlamaCppModelDaemonRegistry,
  removeLlamaCppModelDaemonRegistry,
  writeLlamaCppModelDaemonRegistry,
} from './llamacppModelDaemonRegistry';

test('startup cleanup removes only the exact daemon registry', async () => {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'llamacpp-daemon-registry-'));
  const registry = {
    pid: 5001,
    controlPort: 18080,
    startedAt: '2026-09-29T00:00:00.000Z',
  };
  try {
    await writeLlamaCppModelDaemonRegistry(userDataPath, registry);
    await removeLlamaCppModelDaemonRegistry(userDataPath, { ...registry, startedAt: 'later' });
    expect(await readLlamaCppModelDaemonRegistry(userDataPath)).toEqual(registry);
    await removeLlamaCppModelDaemonRegistry(userDataPath, registry);
    expect(await readLlamaCppModelDaemonRegistry(userDataPath)).toBeNull();
  } finally {
    await fs.rm(userDataPath, { recursive: true, force: true });
  }
});
