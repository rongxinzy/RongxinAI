import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, expect, test } from 'vitest';

import { getSkillConfigFromDir, setSkillConfigToDir } from './skillConfig';

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
