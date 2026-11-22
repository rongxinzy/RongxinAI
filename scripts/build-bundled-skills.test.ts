import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import { buildBundledSkills } from './build-bundled-skills.cjs';

test('a missing locked input aborts the build and leaves local Skill output intact', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'build-bundled-skills-'));
  try {
    const web = path.join(root, 'SKILLs', 'web-search');
    fs.mkdirSync(path.join(web, 'node_modules'), { recursive: true });
    fs.writeFileSync(path.join(web, 'package.json'), '{}');
    fs.writeFileSync(path.join(web, 'node_modules', 'installed'), 'previous output');
    fs.writeFileSync(path.join(web, '.connection'), 'local state');

    expect(() => buildBundledSkills(root)).toThrow('package-lock.json');
    expect(fs.readFileSync(path.join(web, 'node_modules', 'installed'), 'utf8')).toBe(
      'previous output',
    );
    expect(fs.readFileSync(path.join(web, '.connection'), 'utf8')).toBe('local state');
    expect(fs.readdirSync(path.join(root, 'build-tar'))).toEqual([]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
