import { app } from 'electron';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'path';
import { afterEach, expect, test, vi } from 'vitest';

import { LlamaCppManager } from './llamacppManager';

let tempRoot: string | undefined;

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
});

test('uses LocalAppData for the default Windows model library', async () => {
  // The manager constructor materializes its marketplace cache directory, so
  // the mocked appData paths must live inside a real temp directory — with
  // literal C:\ strings the test used to create backslash-named directories
  // in the repository root (work package M).
  tempRoot = await mkdtemp(path.join(tmpdir(), 'llamacpp-library-path-'));
  const appData = path.join(tempRoot, 'AppData', 'Roaming');
  vi.spyOn(app, 'getPath').mockImplementation(name =>
    name === 'appData' ? appData : path.join(appData, 'ZhiYuanAgent'),
  );
  const localAppData = path.join(tempRoot, 'AppData', 'Local');
  vi.stubEnv('LOCALAPPDATA', localAppData);
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

  const manager = new LlamaCppManager(() => ({}));

  expect(manager.getModelsDir()).toBe(path.join(localAppData, 'ZhiYuanAgent', 'models'));
});
