import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, expect, test } from 'vitest';

import { resolvePiSkillRoots } from './piSkillRoots';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('resolves nested expert skills to their preset root', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-skill-roots-'));
  temporaryDirectories.push(root);
  const regularRoot = path.join(root, 'SKILLs');
  const expertRoot = path.join(regularRoot, 'zhiyuan-expert-manager', 'presets', 'cad', 'skills');
  fs.mkdirSync(path.join(expertRoot, 'text-to-cad'), { recursive: true });
  fs.writeFileSync(path.join(expertRoot, 'text-to-cad', 'SKILL.md'), '---\nname: text-to-cad\n---\n');

  expect(resolvePiSkillRoots(['text-to-cad'], [regularRoot], [expertRoot])).toEqual({
    'text-to-cad': expertRoot,
  });
});

test('keeps regular skills on the regular root and ignores unknown ids', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-skill-roots-'));
  temporaryDirectories.push(root);
  const regularRoot = path.join(root, 'SKILLs');
  fs.mkdirSync(path.join(regularRoot, 'pdf'), { recursive: true });
  fs.writeFileSync(path.join(regularRoot, 'pdf', 'SKILL.md'), '---\nname: pdf\n---\n');

  expect(resolvePiSkillRoots(['pdf', 'missing'], [regularRoot], [])).toEqual({ pdf: regularRoot });
});
