import { expect, test, vi } from 'vitest';
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

test('workspace installs use official PyPI by default and preserve configured indexes', () => {
  vi.stubEnv('UV_INDEX', undefined);
  vi.stubEnv('UV_DEFAULT_INDEX', undefined);
  try {
    expect(runtimeNetworkEnvironment('/cache')).toMatchObject({
      UV_DEFAULT_INDEX: PythonPackageIndexUrl.Official,
    });
    expect(runtimeNetworkEnvironment('/cache').UV_INDEX).toBeUndefined();

    vi.stubEnv('UV_INDEX', 'https://example.com/simple');
    vi.stubEnv('UV_DEFAULT_INDEX', 'https://example.org/simple');
    expect(runtimeNetworkEnvironment('/cache')).toMatchObject({
      UV_INDEX: 'https://example.com/simple',
      UV_DEFAULT_INDEX: 'https://example.org/simple',
    });
  } finally {
    vi.unstubAllEnvs();
  }
});
