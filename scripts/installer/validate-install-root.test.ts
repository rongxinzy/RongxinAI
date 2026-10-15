import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { expect, test } from 'vitest';

const script = path.join(__dirname, 'validate-install-root.ps1');
const installer = fs.readFileSync(path.resolve('scripts/nsis-installer.nsh'), 'utf8');
const macro = (name: string) => installer.split(`!macro ${name}\n`)[1]?.split('!macroend')[0] || '';

test('native prepare, stock process hook and uninstall validate ownership before destructive actions', () => {
  const validate = macro('ValidateInstallRoot MODE');
  expect(validate).toContain('-File "$PLUGINSDIR\\validate-install-root.ps1"');
  expect(validate).toContain('SetErrorLevel 1');
  expect(validate).toContain('Quit');
  for (const name of [
    'PrepareExistingInstallForExtraction TOKEN',
    'customCheckAppRunning',
    'customUnInstall',
  ]) {
    const body = macro(name);
    expect(body.indexOf('!insertmacro ValidateInstallRoot')).toBeGreaterThanOrEqual(0);
    expect(body.indexOf('!insertmacro ValidateInstallRoot')).toBeLessThan(
      body.indexOf('!insertmacro StopAppProcesses'),
    );
  }
  const uninstall = macro('customUnInstall');
  expect(uninstall.indexOf('!insertmacro ValidateInstallRoot uninstall')).toBeLessThan(
    uninstall.indexOf('-File "$PLUGINSDIR\\uninstall-cleanup.ps1"'),
  );
  expect(macro('customCheckAppRunning')).toContain('!insertmacro StageInstallSafetyScripts');
  for (const name of ['StopAppProcesses', 'CountInstallDirProcesses RESULT']) {
    expect(macro(name)).toContain('-File "$PLUGINSDIR\\manage-install-processes.ps1"');
    expect(macro(name)).not.toContain('-Command');
  }
});

test.skipIf(process.platform !== 'win32')(
  'real PowerShell rejects foreign/protected/linked roots and allows owned or fresh literal paths',
  () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'install-root-guard-'));
    const data = path.join(root, 'data');
    const runtime = path.join(root, 'runtimes');
    const fresh = path.join(root, '安装 [literal] $x `tick $(never)');
    const run = (installDir: string, mode = 'install', runtimeRoot = runtime, appDataRoot = data) =>
      spawnSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          script,
          '-InstallDir',
          installDir,
          '-RuntimeRoot',
          runtimeRoot,
          '-AppDataRoot',
          appDataRoot,
          '-Mode',
          mode,
        ],
        { encoding: 'utf8', timeout: 20_000 },
      );
    const accept = (target: string, mode = 'install') => {
      const result = run(target, mode);
      expect(result.error, result.stderr).toBeUndefined();
      expect(result.status, result.stderr + result.stdout).toBe(0);
    };
    const reject = (
      target: string,
      mode = 'install',
      runtimeRoot = runtime,
      appDataRoot = data,
    ) => {
      const result = run(target, mode, runtimeRoot, appDataRoot);
      expect(result.error, result.stderr).toBeUndefined();
      expect(result.status, result.stderr + result.stdout).not.toBe(0);
    };
    try {
      accept(fresh);
      expect(fs.existsSync(fresh)).toBe(false);
      fs.mkdirSync(fresh);
      accept(fresh);
      reject(fresh, 'uninstall');
      fs.writeFileSync(path.join(fresh, 'personal.txt'), 'keep');
      reject(fresh);
      fs.writeFileSync(path.join(fresh, '知远.exe'), 'owned executable fixture');
      reject(fresh);
      fs.mkdirSync(path.join(fresh, 'resources'));
      fs.writeFileSync(path.join(fresh, 'resources', 'app.asar'), 'owned archive fixture');
      accept(fresh);
      accept(fresh, 'uninstall');
      for (const target of [
        path.parse(root).root,
        os.homedir(),
        path.dirname(os.homedir()),
        process.env.ProgramFiles!,
        path.join(process.env.SystemRoot!, 'new-install-fixture'),
        path.join(process.env.SystemRoot!, 'System32', 'new-install-fixture'),
        data,
        runtime,
        path.join(data, 'child'),
        path.join(runtime, 'child'),
        root,
      ]) {
        reject(target);
      }
      reject(fresh, 'install', fresh);
      reject(fresh, 'install', runtime, path.join(fresh, 'userdata'));
      const link = path.join(root, 'linked');
      fs.symlinkSync(fresh, link, 'junction');
      reject(link);
      reject(path.join(link, 'child'));
      reject(fresh, 'install', path.join(link, 'runtime'));
      fs.unlinkSync(link);
      const external = path.join(root, 'external');
      fs.mkdirSync(external);
      fs.writeFileSync(path.join(external, 'app.asar'), 'foreign');
      fs.rmSync(path.join(fresh, 'resources'), { recursive: true });
      fs.symlinkSync(external, path.join(fresh, 'resources'), 'junction');
      reject(fresh);
      expect(fs.readFileSync(path.join(fresh, 'personal.txt'), 'utf8')).toBe('keep');
      expect(fs.readFileSync(path.join(external, 'app.asar'), 'utf8')).toBe('foreign');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
  90_000,
);
