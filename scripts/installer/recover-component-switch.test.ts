import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { afterEach, describe, expect, test } from 'vitest';

const scriptPath = path.join(__dirname, 'recover-component-switch.ps1');
const temporaryDirectories: string[] = [];

function fixture(state: string) {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-recovery-'));
  temporaryDirectories.push(runtimeRoot);
  const statePath = path.join(runtimeRoot, 'component-switch-state.txt');
  fs.writeFileSync(statePath, state);
  const component = path.join(runtimeRoot, 'portable-git');
  fs.mkdirSync(component);
  const oldVersion = path.join(component, 'old-version');
  const newVersion = path.join(component, 'new-version');
  for (const version of [oldVersion, newVersion]) {
    fs.mkdirSync(version);
    fs.writeFileSync(path.join(version, 'data.txt'), path.basename(version));
  }
  fs.symlinkSync(newVersion, path.join(component, 'current'), 'junction');
  fs.symlinkSync(newVersion, path.join(component, 'current.next'), 'junction');
  return { runtimeRoot, statePath, component, oldVersion, newVersion };
}

function runRecovery(runtimeRoot: string) {
  return spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      scriptPath,
      '-RuntimeRoot',
      runtimeRoot,
    ],
    { encoding: 'utf8' },
  );
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('validates all recovery rows against the current component contract before mutation', () => {
  const source = fs.readFileSync(scriptPath, 'utf8');
  expect(source).toContain(
    "$state -cnotmatch '^(?:channel-runtime|mcps|portable-git|python|skill-python|skills|uv)\\|(?:True|False)\\z'",
  );
  expect(source).not.toContain('Where-Object');
  expect(source.indexOf('Unsupported component recovery state')).toBeLessThan(
    source.indexOf('[array]::Reverse($states)'),
  );
});

describe.skipIf(process.platform !== 'win32')('component-switch recovery on Windows', () => {
  test('restores an existing portable-git pointer without changing either version', () => {
    const data = fixture('portable-git|True\r\n');
    fs.symlinkSync(data.oldVersion, path.join(data.component, 'current.previous'), 'junction');
    const result = runRecovery(data.runtimeRoot);
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(fs.readFileSync(path.join(data.component, 'current', 'data.txt'), 'utf8')).toBe(
      'old-version',
    );
    expect(fs.readFileSync(path.join(data.newVersion, 'data.txt'), 'utf8')).toBe('new-version');
    expect(fs.existsSync(path.join(data.component, 'current.next'))).toBe(false);
    expect(fs.existsSync(path.join(data.component, 'current.previous'))).toBe(false);
    expect(fs.existsSync(data.statePath)).toBe(false);
  });

  test('rolls back a fresh portable-git switch without deleting the version data', () => {
    const data = fixture('portable-git|False\r\n');
    const result = runRecovery(data.runtimeRoot);
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(fs.existsSync(path.join(data.component, 'current'))).toBe(false);
    expect(fs.existsSync(path.join(data.component, 'current.next'))).toBe(false);
    expect(fs.readFileSync(path.join(data.newVersion, 'data.txt'), 'utf8')).toBe('new-version');
    expect(fs.existsSync(data.statePath)).toBe(false);
  });

  test.each(['retired-runtime|True', '../user-data|False', 'portable-git|invalid'])(
    'rejects an unsupported row and preserves every pointer and journal: %s',
    unsupported => {
      const journal = `${unsupported}\r\nportable-git|False\r\n`;
      const data = fixture(journal);
      const retiredRoot = path.join(data.runtimeRoot, 'retired-runtime');
      fs.mkdirSync(retiredRoot);
      fs.symlinkSync(data.oldVersion, path.join(retiredRoot, 'current.previous'), 'junction');
      const result = runRecovery(data.runtimeRoot);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('Unsupported component recovery state');
      expect(fs.readFileSync(data.statePath, 'utf8')).toBe(journal);
      expect(fs.readFileSync(path.join(data.component, 'current', 'data.txt'), 'utf8')).toBe(
        'new-version',
      );
      expect(fs.existsSync(path.join(data.component, 'current.next'))).toBe(true);
      expect(fs.existsSync(path.join(retiredRoot, 'current.previous'))).toBe(true);
      expect(fs.existsSync(path.join(retiredRoot, 'current'))).toBe(false);
    },
  );
});
