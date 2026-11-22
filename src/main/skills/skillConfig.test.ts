import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, expect, test, vi } from 'vitest';

import {
  ensureSkillDirDependencies,
  getSkillConfigFromDir,
  setSkillConfigToDir,
} from './skillConfig';

vi.mock('electron', () => ({ app: { isPackaged: true } }));
vi.mock('../libs/npmRuntime', () => ({
  NpmCli: { Npm: 'npm' },
  resolveBundledNpmRuntime: () => null,
}));
vi.mock('./envUtils', () => ({ buildSkillEnv: async () => ({}) }));

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeSkillDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-config-'));
  tempDirs.push(dir);
  return dir;
}

test('getSkillConfigFromDir: missing .env returns an empty config', () => {
  const dir = makeSkillDir();
  expect(getSkillConfigFromDir(dir)).toEqual({ success: true, config: {} });
});

test('getSkillConfigFromDir: parses keys, strips quotes, skips comments', () => {
  const dir = makeSkillDir();
  fs.writeFileSync(
    path.join(dir, '.env'),
    [
      '# comment',
      '',
      'PLAIN=value',
      'DOUBLE="quoted value"',
      "SINGLE='literal value'",
      'ESCAPED="say \\"hi\\""',
      'NO_EQUALS',
      '  SPACED  =  trimmed  ',
    ].join('\n') + '\n',
  );

  const result = getSkillConfigFromDir(dir);
  expect(result.success).toBe(true);
  expect(result.config).toEqual({
    PLAIN: 'value',
    DOUBLE: 'quoted value',
    SINGLE: 'literal value',
    ESCAPED: 'say "hi"',
    SPACED: 'trimmed',
  });
});

test('setSkillConfigToDir quotes values dotenv would misread, and reading restores them', () => {
  const dir = makeSkillDir();
  const config = {
    SIMPLE: 'abc',
    WITH_HASH: 'pass#word',
    WITH_SPACE: 'two words',
    WITH_QUOTE: 'say "hi"',
  };

  const writeResult = setSkillConfigToDir(dir, config);
  expect(writeResult.success).toBe(true);

  const raw = fs.readFileSync(path.join(dir, '.env'), 'utf-8');
  expect(raw).toContain('SIMPLE=abc');
  expect(raw).toContain('WITH_HASH="pass#word"');

  const readResult = getSkillConfigFromDir(dir);
  expect(readResult.success).toBe(true);
  expect(readResult.config).toEqual(config);
});

test('concurrent bundled dependency repairs publish only the dependencies', async () => {
  const root = makeSkillDir();
  const target = path.join(root, '用户', 'mail');
  const bundleRoot = path.join(root, 'bundled');
  const bundle = path.join(bundleRoot, 'mail');
  fs.mkdirSync(path.join(target, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(bundle, 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(target, 'package.json'), '{}');
  fs.writeFileSync(path.join(target, 'a.txt'), 'user version');
  fs.writeFileSync(path.join(bundle, 'a.txt'), 'bundled version');
  fs.writeFileSync(path.join(bundle, 'node_modules', 'runtime.js'), 'fixture');
  fs.writeFileSync(path.join(bundle, 'scripts'), 'collides with the existing directory');

  const repair = ensureSkillDirDependencies(target, bundleRoot);
  expect(ensureSkillDirDependencies(target, bundleRoot)).toBe(repair);
  expect(await repair).toMatchObject({ success: true });
  expect(fs.readFileSync(path.join(target, 'a.txt'), 'utf8')).toBe('user version');
  expect(fs.readFileSync(path.join(target, 'node_modules', 'runtime.js'), 'utf8')).toBe('fixture');
});

test('rejects a non-directory dependency bundle without publishing an installed runtime', async () => {
  const root = makeSkillDir();
  const target = path.join(root, 'user', 'mail');
  const bundleRoot = path.join(root, 'bundled');
  const bundle = path.join(bundleRoot, 'mail');
  fs.mkdirSync(target, { recursive: true });
  fs.mkdirSync(bundle, { recursive: true });
  fs.writeFileSync(path.join(target, 'package.json'), '{}');
  fs.writeFileSync(path.join(bundle, 'node_modules'), 'not a runtime');

  expect(await ensureSkillDirDependencies(target, bundleRoot)).toMatchObject({ success: false });
  expect(fs.existsSync(path.join(target, 'node_modules'))).toBe(false);
});
