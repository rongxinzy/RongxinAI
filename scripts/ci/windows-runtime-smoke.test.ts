import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';

test.skipIf(process.platform !== 'win32')(
  'Windows PowerShell preserves fast process exit codes and quoted paths',
  () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-smoke-exit-'));
    const source = fs.readFileSync(path.join(__dirname, 'windows-runtime-smoke.ps1'), 'utf8');
    const helper = source.slice(
      source.indexOf('function Invoke-PackagedElectronChecked'),
      source.indexOf('$osVersion ='),
    );
    const probe = path.join(root, 'probe with spaces.js');
    const script = path.join(root, 'probe.ps1');
    fs.writeFileSync(probe, 'process.exit(Number(process.argv[2]));');
    fs.writeFileSync(
      script,
      `${helper}
$ErrorActionPreference = 'Stop'
1..20 | ForEach-Object {
  Invoke-PackagedElectronChecked $env:ZHIYUAN_SMOKE_NODE @($env:ZHIYUAN_SMOKE_PROBE, '0') 'fast success'
}
$rejected = $false
try {
  Invoke-PackagedElectronChecked $env:ZHIYUAN_SMOKE_NODE @($env:ZHIYUAN_SMOKE_PROBE, '7') 'expected failure'
} catch {
  if ($_.Exception.Message -ne 'expected failure failed with exit code 7') { throw }
  $rejected = $true
}
if (-not $rejected) { throw 'Nonzero exit was accepted' }
'exit-code regression passed'
`,
    );
    try {
      const result = spawnSync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-File', script],
        {
          encoding: 'utf8',
          timeout: 30_000,
          env: {
            ...Object.fromEntries(
              Object.entries(process.env).filter(([name]) => name.toLowerCase() !== 'psmodulepath'),
            ),
            ZHIYUAN_SMOKE_NODE: process.execPath,
            ZHIYUAN_SMOKE_PROBE: probe,
          },
        },
      );
      expect(result.status, result.stderr || result.stdout).toBe(0);
      expect(result.stdout).toContain('exit-code regression passed');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
);
