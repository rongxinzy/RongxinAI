import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const { validateSkillDependencyDeclarations } = require('./setup-skill-python-runtime.js') as {
  validateSkillDependencyDeclarations: (skillsRoot: string) => {
    ok: boolean;
    missing: string[];
  };
};

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('recognizes standard-library imports used by bundled skill launchers', () => {
  const skillsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-python-declarations-'));
  temporaryDirectories.push(skillsRoot);
  const skillRoot = path.join(skillsRoot, 'fixture');
  fs.mkdirSync(skillRoot);
  fs.writeFileSync(
    path.join(skillRoot, 'launcher.py'),
    [
      'import hashlib',
      'import platform',
      'import runpy',
      'import tarfile',
      'import trimesh',
      '',
    ].join('\n'),
  );
  fs.writeFileSync(path.join(skillRoot, 'requirements.txt'), 'trimesh\n');

  expect(validateSkillDependencyDeclarations(skillsRoot)).toEqual({ ok: true, missing: [] });
});
