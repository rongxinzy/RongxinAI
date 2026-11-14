import { afterEach, expect, test } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  resolveNsisOfflineComponentTargets,
  shouldIncludeLlamaCppBundledComponent,
  shouldIncludeStrataBundledComponent,
  writeNsisOfflineComponentRouting,
} from './resolve-nsis-offline-components.cjs';

const previous = process.env.ZHIYUAN_UPDATE_VARIANT;
const requiredKeys = ['skills', 'mcps', 'python', 'skill-python', 'uv'];

afterEach(() => {
  if (previous === undefined) delete process.env.ZHIYUAN_UPDATE_VARIANT;
  else process.env.ZHIYUAN_UPDATE_VARIANT = previous;
});

test('the installer shell, native activation and smoke checks retain the same five required components', () => {
  expect(
    resolveNsisOfflineComponentTargets('lite')
      .map(target => target.key)
      .sort(),
  ).toEqual([...requiredKeys].sort());
  for (const file of [
    'validate-offline-components.ps1',
    'activate-components.ps1',
    'cleanup-after-install.ps1',
  ]) {
    const code = readFileSync(path.join(import.meta.dirname, 'installer', file), 'utf8');
    const declaration = /\$(?:RequiredComponentKeys|requiredKeys)\s*=\s*@\(([^)]+)\)/i.exec(
      code,
    )?.[1];
    expect(declaration, file).toBeDefined();
    expect([...declaration!.matchAll(/'([^']+)'/g)].map(match => match[1]).sort(), file).toEqual(
      [...requiredKeys].sort(),
    );
  }
  const shell = readFileSync(
    path.join(import.meta.dirname, 'installer-shell/app/InstallerEngine.cs'),
    'utf8',
  );
  const declaration = /RequiredComponentKeys\s*=\s*\{([^}]+)\}/.exec(shell)?.[1];
  expect(declaration).toBeDefined();
  expect([...declaration!.matchAll(/"([^"]+)"/g)].map(match => match[1]).sort()).toEqual(
    [...requiredKeys].sort(),
  );
});

test.each(['lite', 'cpu', 'cuda'])(
  '%s NSIS stages, queues and activates its exact manifest set',
  edition => {
    const directory = mkdtempSync(path.join(tmpdir(), 'nsis-routing-'));
    try {
      const targets = resolveNsisOfflineComponentTargets(edition);
      writeNsisOfflineComponentRouting(directory, targets, edition);
      expect(JSON.parse(readFileSync(path.join(directory, 'nsis-targets.json'), 'utf8'))).toEqual(
        targets,
      );
      const source = readFileSync(path.join(directory, 'nsis-components.nsh'), 'utf8');
      for (const { key } of targets) {
        expect(source).toContain(`!insertmacro StageOfflineComponentMetadata "${key}"`);
        expect(source).toContain(
          `!insertmacro QueueOfflineComponent ${key.toUpperCase().replaceAll('-', '_')} "${key}"`,
        );
        expect(source).toContain(`!insertmacro RecordOfflineComponentReady "${key}"`);
      }
      // Regenerating for lite after CUDA must remove all optional routing.
      writeNsisOfflineComponentRouting(
        directory,
        resolveNsisOfflineComponentTargets('lite'),
        'lite',
      );
      expect(readFileSync(path.join(directory, 'nsis-components.nsh'), 'utf8')).not.toContain(
        'llamacpp-bundled',
      );
      expect(() => writeNsisOfflineComponentRouting(directory, targets.slice(1), edition)).toThrow(
        /manifest/,
      );
      expect(() =>
        writeNsisOfflineComponentRouting(directory, [...targets.slice(1), targets[1]], edition),
      ).toThrow(/manifest/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

test('packaging and NSIS consume generated edition routing in all component phases', () => {
  const installer = readFileSync(path.join(import.meta.dirname, 'nsis-installer.nsh'), 'utf8');
  for (const phase of [
    'StageEditionComponents',
    'QueueEditionComponents',
    'RecordEditionComponents',
  ]) {
    expect(installer).toContain(`!insertmacro ${phase}`);
  }
  expect(installer).toContain('windows-components\\nsis-targets.json');
  expect(installer).toContain('windows-components\\nsis-components.nsh');
  expect(
    readFileSync(path.join(import.meta.dirname, 'electron-builder-hooks.cjs'), 'utf8'),
  ).toContain('writeNsisOfflineComponentRouting(componentsDir, componentManifests)');
});

test('lite targets exclude llamacpp-bundled component', () => {
  process.env.ZHIYUAN_UPDATE_VARIANT = 'lite';
  expect(shouldIncludeLlamaCppBundledComponent()).toBe(false);
  expect(resolveNsisOfflineComponentTargets()).toHaveLength(5);
});

test('cpu and cuda targets include llamacpp-bundled component', () => {
  process.env.ZHIYUAN_UPDATE_VARIANT = 'cpu';
  expect(resolveNsisOfflineComponentTargets()).toHaveLength(6);
  expect(shouldIncludeStrataBundledComponent()).toBe(false);
  process.env.ZHIYUAN_UPDATE_VARIANT = 'cuda';
  expect(resolveNsisOfflineComponentTargets()).toHaveLength(7);
  expect(shouldIncludeStrataBundledComponent()).toBe(true);
});
