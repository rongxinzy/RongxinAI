import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { expect, test } from 'vitest';

test.skipIf(process.platform !== 'win32')(
  'diagnostics retain installer failure logs without masking caller failure',
  () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'diagnostic 空格-'));
    try {
      mkdirSync(path.join(root, 'ZhiYuanAgent'));
      writeFileSync(
        path.join(root, 'ZhiYuanAgent/install-timing.log'),
        'phase=component-cache-miss\nfailure=extraction',
      );
      const script = path
        .resolve(__dirname, 'collect-windows-diagnostics.ps1')
        .replaceAll("'", "''");
      const wrapper = path.join(root, 'fail.ps1');
      writeFileSync(wrapper, `& '${script}' -ProjectRoot $env:APPDATA -Label fixture\nexit 9\n`);
      const result = spawnSync('powershell.exe', ['-NoProfile', '-File', wrapper], {
        env: { ...process.env, APPDATA: root },
      });
      expect(result.status).toBe(9);
      expect(
        readFileSync(
          path.join(root, 'acceptance-diagnostics/nsis-fixture/install-timing.log'),
          'utf8',
        ),
      ).toContain('failure=extraction');
      const processes = readFileSync(
        path.join(root, 'acceptance-diagnostics/nsis-fixture/processes.json'),
        'utf8',
      );
      expect(processes).not.toContain('CommandLine');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

test('installer persists diagnostics before bounded cleanup and rethrows the original error', () => {
  const script = readFileSync(path.join(__dirname, 'windows-installer-smoke.ps1'), 'utf8');
  expect(script).toMatch(/-Label 'failure'\s+throw\s+} finally/);
  expect(script.indexOf("-Label 'before-cleanup'")).toBeLessThan(
    script.indexOf('$cleanup = Start-Process'),
  );
  expect(script).toContain('$cleanup.WaitForExit(60000)');
  expect(script).not.toContain('-Wait | Out-Null');
});
