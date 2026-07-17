import { app } from 'electron';
import path from 'path';
import { afterEach, expect, test, vi } from 'vitest';

import { LlamaCppManager } from './llamacppManager';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

test('uses LocalAppData for the default Windows model library', () => {
  vi.spyOn(app, 'getPath').mockImplementation(name => {
    if (name === 'appData') return 'C:\\Users\\tester\\AppData\\Roaming';
    return 'C:\\Users\\tester\\AppData\\Roaming\\ZhiYuanAgent';
  });
  vi.stubEnv('LOCALAPPDATA', 'C:\\Users\\tester\\AppData\\Local');
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

  const manager = new LlamaCppManager(() => ({}));

  expect(manager.getModelsDir()).toBe(
    path.join('C:\\Users\\tester\\AppData\\Local', 'ZhiYuanAgent', 'models'),
  );
});
