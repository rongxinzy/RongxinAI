import { describe, expect, test } from 'vitest';

import {
  applyUvPackageIndexDefaults,
  MANAGED_UV_CONFIG,
  PythonPackageIndexUrl,
} from './pythonPackageIndexes';

describe('managed uv package indexes', () => {
  test('uses Tsinghua first and the official PyPI index as fallback', () => {
    const tsinghuaIndex = MANAGED_UV_CONFIG.indexOf(PythonPackageIndexUrl.Tsinghua);
    const officialIndex = MANAGED_UV_CONFIG.indexOf(PythonPackageIndexUrl.Official);

    expect(tsinghuaIndex).toBeGreaterThan(-1);
    expect(officialIndex).toBeGreaterThan(tsinghuaIndex);
    expect(MANAGED_UV_CONFIG.slice(officialIndex)).toContain('default = true');
  });

  test('sets missing uv index environment variables', () => {
    const env: Record<string, string | undefined> = {};

    applyUvPackageIndexDefaults(env);

    expect(env.UV_INDEX).toBe(PythonPackageIndexUrl.Tsinghua);
    expect(env.UV_DEFAULT_INDEX).toBe(PythonPackageIndexUrl.Official);
  });

  test('can replace inherited uv index environment variables', () => {
    const env = {
      UV_INDEX: 'https://example.com/simple',
      UV_DEFAULT_INDEX: 'https://example.org/simple',
    };

    applyUvPackageIndexDefaults(env, { overwrite: true });

    expect(env.UV_INDEX).toBe(PythonPackageIndexUrl.Tsinghua);
    expect(env.UV_DEFAULT_INDEX).toBe(PythonPackageIndexUrl.Official);
  });
});
