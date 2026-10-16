import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, expect, test } from 'vitest';

import { collectBuiltInSkillIds, loadSkillsDefaults } from './skillRecords';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeRoot(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), name));
  tempDirs.push(dir);
  return dir;
}

function writeSkill(root: string, id: string, frontmatter: string): void {
  const dir = path.join(root, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\n${frontmatter}---\n# ${id}\n`);
}

test('loadSkillsDefaults: user root (first) overrides bundled root (later)', () => {
  const userRoot = makeRoot('skill-defaults-user-');
  const bundledRoot = makeRoot('skill-defaults-bundled-');

  fs.writeFileSync(
    path.join(userRoot, 'skills.config.json'),
    JSON.stringify({
      version: 1,
      defaults: { 'user-skill': { order: 1, enabled: false }, shared: { order: 5 } },
    }),
  );
  fs.writeFileSync(
    path.join(bundledRoot, 'skills.config.json'),
    JSON.stringify({
      version: 1,
      defaults: {
        'bundled-skill': { order: 2, displayName: 'Bundled' },
        shared: { order: 9, enabled: true },
      },
    }),
  );

  const defaults = loadSkillsDefaults([userRoot, bundledRoot]);
  expect(defaults['user-skill']).toEqual({ order: 1, enabled: false });
  expect(defaults['bundled-skill']).toEqual({ order: 2, displayName: 'Bundled' });
  // User settings win for shared ids; bundled keys the user omits are kept.
  expect(defaults.shared).toEqual({ order: 5, enabled: true });
});

test('loadSkillsDefaults: ignores roots without a config file', () => {
  const emptyRoot = makeRoot('skill-defaults-empty-');
  expect(loadSkillsDefaults([emptyRoot])).toEqual({});
});

test('collectBuiltInSkillIds: unions config defaults and on-disk skill folders', () => {
  const root = makeRoot('skill-builtin-ids-');
  fs.writeFileSync(
    path.join(root, 'skills.config.json'),
    JSON.stringify({ version: 1, defaults: { configured: { order: 1 } } }),
  );
  writeSkill(root, 'on-disk', 'name: On Disk\n');

  const ids = collectBuiltInSkillIds(root);
  expect(ids.has('configured')).toBe(true);
  expect(ids.has('on-disk')).toBe(true);
  expect(ids.has('missing')).toBe(false);
});

test('collectBuiltInSkillIds: missing root yields an empty set', () => {
  expect(collectBuiltInSkillIds(path.join(os.tmpdir(), 'skill-builtin-does-not-exist'))).toEqual(
    new Set(),
  );
});
