import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { expect, test } from 'vitest';

import { CcConnectSidecarManager } from './ccConnectSidecarManager';
import { settleWithin } from './startupGate';

test.skipIf(process.platform === 'win32')(
  'reaps a Channel sidecar that ignores SIGTERM before both stop callers finish',
  async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'zhiyuan-channel-stop-'));
    const executable = path.join(directory, 'sidecar');
    await fs.writeFile(
      executable,
      `#!/usr/bin/env node\nprocess.on('SIGTERM', () => {});\nconsole.log('url=http://127.0.0.1:1234');\nsetInterval(() => {}, 1000);\n`,
      { mode: 0o700 },
    );
    const manager = new CcConnectSidecarManager(executable, path.join(directory, 'config.toml'));
    try {
      await manager.start('bridge_url = "fixture"\nbridge_token = "fixture"');
      await expect(manager.waitForControlUrl()).resolves.toBe('http://127.0.0.1:1234');
      const pid = manager.pid!;
      const stopping = Promise.all([manager.stop(), manager.stop()]);
      expect(await settleWithin(stopping, 3_500)).toBe(true);
      await stopping;
      expect(manager.running).toBe(false);
      expect(() => process.kill(pid, 0)).toThrow();
    } finally {
      if (manager.pid) process.kill(manager.pid, 'SIGKILL');
      await manager.stop();
      await fs.rm(directory, { recursive: true, force: true });
    }
  },
);

test('cancels pending control URL discovery without leaving a listener', async () => {
  const manager = new CcConnectSidecarManager('unused', 'unused');
  const controller = new AbortController();
  const waiting = manager.waitForControlUrl(60_000, controller.signal);
  const rejected = expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
  controller.abort();
  await rejected;
  expect(manager.listenerCount('controlUrl')).toBe(0);
});
