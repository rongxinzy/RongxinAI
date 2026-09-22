import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';

let userDataRoot = '';
vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => process.cwd(),
    getPath: () => userDataRoot,
  },
}));
vi.mock('./claudeSettings', () => ({}));
vi.mock('./systemProxy', () => ({}));
vi.mock('./coworkLogger', () => ({ coworkLog: vi.fn() }));
import { applyApplicationRuntimeEnv } from './coworkUtil';

const sharedPython = path.resolve('resources/skill-python/layers/shared/bin/python');
afterEach(() => {
  if (userDataRoot) fs.rmSync(userDataRoot, { recursive: true, force: true });
});

test.skipIf(process.platform === 'win32' || !fs.existsSync(sharedPython))(
  'a clean dev profile runs actual shared Python imports and binds uv',
  () => {
    userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'managed-python-probe-'));
    const env: NodeJS.ProcessEnv = { PATH: '/usr/bin:/bin', HOME: userDataRoot };
    applyApplicationRuntimeEnv(env);
    const run = spawnSync(
      '/bin/bash',
      ['-c', 'python3 -c "import sys,pandas,numpy,docx,pptx; print(sys.executable)"'],
      {
        env,
        encoding: 'utf8',
        timeout: 30000,
      },
    );
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('skill-python/layers/shared/bin/python3');
    expect(env.UV_PYTHON).toContain('python-');
    const uv = spawnSync('/bin/bash', ['-c', 'uv --version'], {
      env,
      encoding: 'utf8',
      timeout: 5000,
    });
    expect(uv.status).toBe(0);
  },
);
