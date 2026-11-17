import { expect, test } from 'vitest';
import { buildWorkspaceExecutionEnv } from './workspaceExecution';
import { runtimeNetworkEnvironment } from './process';
import { PythonPackageIndexUrl } from '../libs/pythonPackageIndexes';

test('Skill execution receives runtime paths without credentials or Python path injection', () => {
  const env = buildWorkspaceExecutionEnv('/cache', {
    SKILLS_ROOT: '/skills',
    ZHIYUAN_ELECTRON_PATH: '/electron',
    HTTPS_PROXY: 'http://127.0.0.1:7890',
    PYTHONPATH: '/outside-project',
    PYTHONHOME: '/outside-project',
    ANTHROPIC_API_KEY: 'must-not-cross-the-boundary',
  });
  expect(env.SKILLS_ROOT).toBe('/skills');
  expect(env.ZHIYUAN_ELECTRON_PATH).toBe('/electron');
  expect(env.HTTPS_PROXY).toBe('http://127.0.0.1:7890');
  expect(env.PYTHONPATH).toBeUndefined();
  expect(env.PYTHONHOME).toBeUndefined();
  expect(env.ANTHROPIC_API_KEY).toBeUndefined();
});

test('workspace dependency installation shares the managed package index defaults', () => {
  const env = runtimeNetworkEnvironment('/cache');
  expect(env.UV_INDEX).toBe(process.env.UV_INDEX || PythonPackageIndexUrl.Tsinghua);
  expect(env.UV_DEFAULT_INDEX).toBe(process.env.UV_DEFAULT_INDEX || PythonPackageIndexUrl.Official);
});
