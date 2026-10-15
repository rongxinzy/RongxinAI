import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { expect, test } from 'vitest';

const script = path.join(__dirname, 'migrate-user-skills.ps1');
test('migration retries missing files without overwriting completed user files', () => {
  const source = fs.readFileSync(script, 'utf8');
  expect(source).toContain('[IO.File]::Copy($child.FullName, $temporary, $false)');
  expect(source).toContain('[IO.File]::Move($temporary, $target)');
  expect(source).toContain('Copy-MissingSkillFiles $child.FullName $target');
  expect(source).not.toContain('Copy-Item');
  expect(source).toContain("$ErrorActionPreference = 'Stop'");
});

test.skipIf(process.platform !== 'win32')(
  'real PowerShell resumes partial migration and preserves user data and bundled skills',
  () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'main-skill-migration-'));
    const source = path.join(root, 'source [用户]');
    const target = path.join(root, 'target [用户]');
    try {
      fs.mkdirSync(path.join(source, 'mine'), { recursive: true });
      fs.mkdirSync(path.join(source, 'bundled'));
      fs.mkdirSync(path.join(target, 'mine'), { recursive: true });
      fs.writeFileSync(
        path.join(source, 'skills.config.json'),
        JSON.stringify({ defaults: { bundled: {} } }),
      );
      fs.writeFileSync(path.join(source, 'mine', 'a'), 'old');
      fs.writeFileSync(path.join(source, 'mine', 'b'), 'missing');
      fs.writeFileSync(path.join(target, 'mine', 'a'), 'user-newer');
      const result = spawnSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          script,
          '-Source',
          source,
          '-Destination',
          target,
        ],
        { encoding: 'utf8' },
      );
      expect(result.status, result.stderr + result.stdout).toBe(0);
      expect(fs.readFileSync(path.join(target, 'mine', 'a'), 'utf8')).toBe('user-newer');
      expect(fs.readFileSync(path.join(target, 'mine', 'b'), 'utf8')).toBe('missing');
      expect(fs.existsSync(path.join(target, 'bundled'))).toBe(false);
      expect(fs.readdirSync(path.join(target, 'mine')).sort()).toEqual(['a', 'b']);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
);
