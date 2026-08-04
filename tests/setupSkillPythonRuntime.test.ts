import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  listRequirementFiles,
  normalizePlatform,
  parseImportNames,
} from '../scripts/setup-skill-python-runtime.js';

describe('setup-skill-python-runtime', () => {
  it('normalizes supported packaging platforms', () => {
    expect(normalizePlatform('windows')).toBe('win32');
    expect(normalizePlatform('macOS')).toBe('darwin');
    expect(normalizePlatform('linux')).toBe('linux');
  });

  it('maps package names to import names and ignores requirement options', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-python-'));
    try {
      const requirements = path.join(root, 'requirements.txt');
      fs.writeFileSync(
        requirements,
        '# comment\nPillow>=10\nscikit-learn>=1\n--extra-index-url https://example.invalid\n',
      );
      expect(parseImportNames(requirements)).toEqual(['PIL', 'sklearn']);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('finds requirements files only at Skill roots', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-'));
    try {
      fs.mkdirSync(path.join(root, 'xlsx'), { recursive: true });
      fs.mkdirSync(path.join(root, 'docx'), { recursive: true });
      fs.writeFileSync(path.join(root, 'xlsx', 'requirements.txt'), 'openpyxl>=3\n');
      expect(listRequirementFiles(root).map(entry => entry.skillId)).toEqual(['xlsx']);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
