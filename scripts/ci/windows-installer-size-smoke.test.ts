import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { expect, test } from 'vitest';

const scriptPath = path.join(import.meta.dirname, 'windows-installer-size-smoke.ps1');

test('installer telemetry has no size ceiling and counts all edition components', () => {
  const source = fs.readFileSync(scriptPath, 'utf8');
  expect(source).not.toMatch(/Maximum\w+Bytes|unexpectedly large|exceeds.*budget/);
  expect(source).toContain('$nsisComponentBytes = $componentBytes');
  expect(source).toContain('[measure] windows-webview2-setup');
  expect(source).toContain('[measure] windows-nsis-updater');
});

test.skipIf(process.platform !== 'win32').each(['lite', 'cpu', 'cuda'])(
  '%s reports files over the former ceilings and still rejects missing manifests',
  edition => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'installer-size-'));
    try {
      fs.mkdirSync(path.join(root, 'release'));
      fs.mkdirSync(path.join(root, 'build-tar/windows-components'), { recursive: true });
      const manifestPath = path.join(root, 'build-tar/windows-components/manifest.json');
      fs.writeFileSync(
        manifestPath,
        JSON.stringify({
          components: [
            { key: 'skill-python', archiveSizeBytes: 350 * 1024 * 1024 },
            { key: 'llamacpp-bundled', archiveSizeBytes: 500 * 1024 * 1024 },
          ],
        }),
      );
      // Sparse fixture: exercise real file lengths without allocating gigabytes.
      for (const name of ['Fixture-Setup.exe', 'ZhiYuanAgent-Setup-fixture.exe']) {
        const fd = fs.openSync(path.join(root, 'release', name), 'w');
        try {
          fs.ftruncateSync(fd, 1024 * 1024 * 1024);
        } finally {
          fs.closeSync(fd);
        }
      }
      const run = () =>
        spawnSync(
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            scriptPath,
            '-ProjectRoot',
            root,
          ],
          { encoding: 'utf8', env: { ...process.env, ZHIYUAN_UPDATE_VARIANT: edition } },
        );
      const result = run();
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain('installerBytes=1073741824');
      expect(result.stdout).toContain('componentArchiveBytes=891289600');
      fs.rmSync(manifestPath);
      expect(run().status).not.toBe(0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
);
