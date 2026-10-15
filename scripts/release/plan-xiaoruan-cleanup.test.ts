import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, test } from 'vitest';

const SCRIPT_PATH = fileURLToPath(
  new URL('./plan-xiaoruan-cleanup.mjs', import.meta.url),
);

const temporaryDirectories: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'xiaoruan-cleanup-test-'));
  temporaryDirectories.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe('plan-xiaoruan-cleanup', () => {
  test('keeps protected 1.0.6 release and recent uploads while deleting expired objects', async () => {
    const tempDir = await makeTempDir();
    const objectListPath = path.join(tempDir, 'objects.json');
    const outputDir = path.join(tempDir, 'cleanup');
    const now = Date.now();

    const sampleObjects = [
      // 1.0.6 protected build (older than 24h, must NOT be deleted)
      {
        Key: 'builds/0e1ed3f56ccfda3ba9c3333dd9cfd7f2e3e7e4ed/37916558030/1/packages.json',
        LastModified: new Date(now - 72 * 60 * 60 * 1000).toISOString(),
      },
      {
        Key: 'builds/0e1ed3f56ccfda3ba9c3333dd9cfd7f2e3e7e4ed/37916558030/1/signed-windows-build/XiaoruanAgent-Setup-1.0.6.exe',
        LastModified: new Date(now - 72 * 60 * 60 * 1000).toISOString(),
      },
      // New upload (< 24h, must NOT be deleted)
      {
        Key: 'builds/recent-sha/12345/1/packages.json',
        LastModified: new Date(now - 2 * 60 * 60 * 1000).toISOString(),
      },
      // Expired old build (> 24h, must be deleted)
      {
        Key: 'builds/0ae04ea4097e3b1b755b704bf008e3f875d97170/35962083334/1/windows-build/晓软智能体-Setup-1.0.0.exe',
        LastModified: new Date(now - 48 * 60 * 60 * 1000).toISOString(),
      },
      // Unrelated key outside builds/ (must NOT be deleted)
      {
        Key: 'other/some-file.txt',
        LastModified: new Date(now - 48 * 60 * 60 * 1000).toISOString(),
      },
    ];

    await fs.writeFile(objectListPath, JSON.stringify({ Contents: sampleObjects }));

    const res = spawnSync(process.execPath, [SCRIPT_PATH, objectListPath, outputDir], {
      encoding: 'utf8',
    });

    expect(res.status).toBe(0);
    expect(res.stdout).toContain('planned deletion of 1 unreferenced objects');

    const batch = JSON.parse(
      await fs.readFile(path.join(outputDir, 'delete-001.json'), 'utf8'),
    );
    expect(batch.Objects).toEqual([
      { Key: 'builds/0ae04ea4097e3b1b755b704bf008e3f875d97170/35962083334/1/windows-build/晓软智能体-Setup-1.0.0.exe' },
    ]);
  });
});
