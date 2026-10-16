import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, vi } from 'vitest';
import { validatePackages, downloadVerifiedAsset } from './runtime';
import manifest from './manifest.json';
import { isolatedEnvironment, runProcess } from './process';

test('runtime assets pin exact official release URLs and hashes for every supported target', () => {
  expect(manifest.pythonVersion).toMatch(/^3\.12\.\d+$/);
  for (const assets of Object.values(manifest.platforms)) {
    expect(assets.python.url).toMatch(
      /^https:\/\/github.com\/astral-sh\/python-build-standalone\/releases\/download\/20261013\//,
    );
    expect(assets.uv.url).toMatch(
      /^https:\/\/github.com\/astral-sh\/uv\/releases\/download\/0\.13\.0\//,
    );
    for (const asset of Object.values(assets)) expect(asset.sha256).toMatch(/^[0-9a-f]{64}$/);
  }
});
test('install arguments accept pinned registry names, never shell flags or external source URLs', () => {
  expect(validatePackages(['numpy==2.2.6', 'requests[socks]==2.32.3'])).toHaveLength(2);
  for (const p of [
    '--target=/tmp',
    'git+https://example.com/a',
    '/tmp/local',
    'numpy;rm -rf /',
    'numpy',
    'numpy>=2',
  ])
    expect(() => validatePackages([p])).toThrow('pinned');
});
test('subprocess environment does not forward application credentials or Python path injection', () => {
  process.env.ZHIYUAN_TEST_SECRET = 'no';
  process.env.PYTHONPATH = '/not-allowed';
  try {
    const env = isolatedEnvironment('/cache');
    expect(env.ZHIYUAN_TEST_SECRET).toBeUndefined();
    expect(env.PYTHONPATH).toBeUndefined();
    expect(env.UV_PYTHON_DOWNLOADS).toBe('never');
  } finally {
    delete process.env.ZHIYUAN_TEST_SECRET;
    delete process.env.PYTHONPATH;
  }
});
test('no-shell process returns both streams and the actual failure exit code', async () => {
  if (process.platform === 'win32') return;
  const result = await runProcess(
    process.execPath,
    ['-e', 'console.log("out");console.error("err");process.exit(7)'],
    {
      cwd: process.cwd(),
      env: isolatedEnvironment('/tmp/cache'),
      signal: new AbortController().signal,
    },
  );
  expect(result).toMatchObject({ stdout: 'out\n', stderr: 'err\n', exitCode: 7, truncated: false });
});

test('an altered runtime archive is rejected before extraction', async () => {
  const root = await mkdtemp(join(tmpdir(), 'python-hash-'));
  vi.stubGlobal('fetch', async () => new Response('altered archive'));
  try {
    await expect(
      downloadVerifiedAsset(
        {
          url: 'https://github.com/astral-sh/uv/releases/download/test/uv.tar.gz',
          sha256: '0'.repeat(64),
        },
        join(root, 'archive'),
        new AbortController().signal,
      ),
    ).rejects.toThrow('checksum mismatch');
  } finally {
    vi.unstubAllGlobals();
    await rm(root, { recursive: true, force: true });
  }
});
