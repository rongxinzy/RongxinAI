import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, test } from 'vitest';

type Target = { key: string; prefix: string; sentinel: string };
const require = createRequire(import.meta.url);
const { resolveNsisOfflineComponentTargets } =
  require('../resolve-nsis-offline-components.cjs') as {
    resolveNsisOfflineComponentTargets: (edition: string) => Target[];
  };
const sevenZip = path.resolve('node_modules/7zip-bin/win/x64/7za.exe');
const temporaryDirectories: string[] = [];
const hash = (value: string | Buffer) => crypto.createHash('sha256').update(value).digest('hex');

function fixture(edition: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zy-component-editions-'));
  temporaryDirectories.push(root);
  const plugin = path.join(root, 'plugin');
  const runtime = path.join(root, 'runtimes');
  const install = path.join(root, 'app');
  const resources = path.join(install, 'resources');
  for (const directory of [plugin, runtime, resources])
    fs.mkdirSync(directory, { recursive: true });
  const targets = resolveNsisOfflineComponentTargets(edition);
  const components = targets.map(target => ({ ...target, contentId: hash(target.key) }));
  for (const target of components) {
    const staging = path.join(root, 'staging', target.key);
    const sentinel = path.join(staging, target.sentinel);
    fs.mkdirSync(path.dirname(sentinel), { recursive: true });
    fs.writeFileSync(sentinel, target.key);
    const archive = path.join(plugin, `component-${target.key}.7z`);
    const packed = spawnSync(sevenZip, ['a', archive, target.prefix], { cwd: staging });
    expect(packed.status, String(packed.stderr)).toBe(0);
    for (const [suffix, value] of [
      ['version', target.contentId],
      ['sha256', hash(fs.readFileSync(archive))],
      ['sentinel-sha256', hash(target.key)],
    ])
      fs.writeFileSync(path.join(plugin, `component-${target.key}.${suffix}`), value);
  }
  const manifest = path.join(root, 'manifest.json');
  const routing = path.join(root, 'targets.json');
  const state = path.join(runtime, 'component-switch-state.txt');
  fs.writeFileSync(manifest, JSON.stringify({ components }));
  fs.writeFileSync(routing, JSON.stringify(targets));
  return {
    root,
    plugin,
    runtime,
    install,
    resources,
    targets,
    components,
    manifest,
    routing,
    state,
  };
}

function run(script: string, args: string[]) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key.toUpperCase() !== 'PSMODULEPATH'),
  );
  env.PSModulePath = path.join(process.env.SystemRoot!, 'System32/WindowsPowerShell/v1.0/Modules');
  const result = spawnSync(
    path.join(process.env.SystemRoot!, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      path.join(__dirname, script),
      ...args,
    ],
    {
      encoding: 'utf8',
      env,
    },
  );
  return result;
}

function validate(data: ReturnType<typeof fixture>, mode: string) {
  return run('validate-offline-components.ps1', [
    '-Mode',
    mode,
    '-PluginDir',
    data.plugin,
    '-RuntimeRoot',
    data.runtime,
    '-ComponentTargetsPath',
    data.routing,
    '-SevenZipPath',
    sevenZip,
  ]);
}

function activate(data: ReturnType<typeof fixture>) {
  return run('activate-components.ps1', [
    '-PluginDir',
    data.plugin,
    '-RuntimeRoot',
    data.runtime,
    '-ManifestPath',
    data.manifest,
    '-TargetsPath',
    data.routing,
    '-StatePath',
    data.state,
  ]);
}

function cleanup(data: ReturnType<typeof fixture>) {
  return run('cleanup-after-install.ps1', [
    '-InstallDir',
    data.install,
    '-RuntimeRoot',
    data.runtime,
    '-ManifestPath',
    data.manifest,
    '-OldInstallPathFile',
    path.join(data.root, 'no-backup.txt'),
    '-UseExactOldInstallPath',
  ]);
}

function expectSuccess(result: ReturnType<typeof run>) {
  expect(result.status, result.stderr || result.stdout || result.error?.message).toBe(0);
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    fs.rmSync(directory, { recursive: true, force: true });
});

describe.skipIf(process.platform !== 'win32')('Windows edition component lifecycle', () => {
  test.each(['lite', 'cpu', 'cuda'])(
    '%s targets validate, expand, activate, recover and clean up',
    edition => {
      const data = fixture(edition);
      expectSuccess(validate(data, 'cache'));
      expectSuccess(validate(data, 'expand'));
      const cached = validate(data, 'cache');
      expectSuccess(cached);
      for (const target of data.targets) expect(cached.stdout).toContain(`cache-hit:${target.key}`);

      expectSuccess(activate(data));
      expectSuccess(
        run('link-runtime-junctions.ps1', [
          '-ResourceRoot',
          data.resources,
          '-RuntimeRoot',
          data.runtime,
          '-ManifestPath',
          data.manifest,
        ]),
      );
      for (const target of data.targets) {
        expect(fs.readFileSync(path.join(data.resources, target.sentinel), 'utf8')).toBe(
          target.key,
        );
      }
      // An interrupted first activation must recover optional engines too.
      expectSuccess(run('recover-component-switch.ps1', ['-RuntimeRoot', data.runtime]));
      expect(fs.existsSync(data.state)).toBe(false);
      for (const target of data.targets)
        expect(fs.existsSync(path.join(data.runtime, target.key, 'current'))).toBe(false);

      expectSuccess(activate(data));
      // A subsequent upgrade must restore all previous pointers after interruption.
      expectSuccess(activate(data));
      expectSuccess(run('recover-component-switch.ps1', ['-RuntimeRoot', data.runtime]));
      for (const component of data.components) {
        const oldId = hash(`old:${component.key}`);
        const old = path.join(data.runtime, component.key, oldId);
        fs.mkdirSync(old);
        fs.writeFileSync(path.join(old, '.complete'), `${oldId}|archive|1|10`);
        fs.writeFileSync(path.join(old, 'old.txt'), 'old');
      }
      expectSuccess(cleanup(data));
      for (const component of data.components) {
        expect(
          fs.existsSync(path.join(data.runtime, component.key, hash(`old:${component.key}`))),
        ).toBe(false);
        expect(fs.existsSync(path.join(data.runtime, component.key, component.contentId))).toBe(
          true,
        );
      }
      expectSuccess(
        run('uninstall-cleanup.ps1', ['-InstallDir', data.install, '-RuntimeRoot', data.runtime]),
      );
      for (const component of data.components) {
        expect(fs.existsSync(path.join(data.resources, component.prefix))).toBe(false);
        expect(fs.existsSync(path.join(data.runtime, component.key, component.contentId))).toBe(
          false,
        );
      }
    },
    60_000,
  );

  test.each(['unknown', 'duplicate', 'missing'])(
    'rejects %s components before activation or cleanup',
    defect => {
      const data = fixture('cuda');
      let components = [...data.components];
      if (defect === 'unknown')
        components.push({
          key: 'unknown-engine',
          prefix: 'unknown-engine',
          sentinel: 'unknown-engine/manifest.json',
          contentId: hash('unknown'),
        });
      if (defect === 'duplicate') components.push(components[0]);
      if (defect === 'missing') components = components.slice(1);
      fs.writeFileSync(data.routing, JSON.stringify(components));
      fs.writeFileSync(data.manifest, JSON.stringify({ components }));
      expect(validate(data, 'cache').status).not.toBe(0);
      expect(activate(data).status).not.toBe(0);
      expect(cleanup(data).status).not.toBe(0);
      expect(fs.existsSync(data.state)).toBe(false);
    },
  );
});
