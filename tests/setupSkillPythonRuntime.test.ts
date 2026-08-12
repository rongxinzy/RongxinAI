import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  listRequirementFiles,
  normalizePlatform,
  parseImportNames,
  rebaseEnvironmentSymlinks,
  validateSkillDependencyDeclarations,
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
        '# comment\nPillow>=10\nscikit-learn>=1\npsycopg2-binary>=2.9\n--extra-index-url https://example.invalid\n',
      );
      expect(parseImportNames(requirements)).toEqual(['PIL', 'sklearn', 'psycopg2']);
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

  it('requires third-party Python imports to be declared by their Skill', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-'));
    try {
      const skillRoot = path.join(root, 'analysis');
      fs.mkdirSync(path.join(skillRoot, 'scripts'), { recursive: true });
      fs.writeFileSync(
        path.join(skillRoot, 'scripts', 'analyze.py'),
        'import json\nimport pandas as pd\nfrom helpers import report\n',
      );
      fs.writeFileSync(path.join(skillRoot, 'scripts', 'helpers.py'), 'def report(): pass\n');

      expect(validateSkillDependencyDeclarations(root)).toEqual({
        ok: false,
        missing: ['analysis: pandas is imported but not declared in requirements.txt'],
      });

      fs.writeFileSync(path.join(skillRoot, 'requirements.txt'), 'pandas>=2.2,<3\n');
      expect(validateSkillDependencyDeclarations(root)).toEqual({ ok: true, missing: [] });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('rebases POSIX environment links to the sibling packaged Python runtime', () => {
    const resourcesRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-python-links-'));
    try {
      const basePython = path.join(resourcesRoot, 'python-mac', 'bin', 'python3');
      const environmentRoot = path.join(resourcesRoot, 'skill-python', 'layers', 'shared');
      const environmentPython = path.join(environmentRoot, 'bin', 'python3');
      fs.mkdirSync(path.dirname(basePython), { recursive: true });
      fs.mkdirSync(path.dirname(environmentPython), { recursive: true });
      fs.writeFileSync(basePython, '');
      fs.symlinkSync(basePython, environmentPython);

      rebaseEnvironmentSymlinks(environmentRoot, basePython);

      const rebasedTarget = fs.readlinkSync(environmentPython);
      expect(path.isAbsolute(rebasedTarget)).toBe(false);
      expect(path.resolve(path.dirname(environmentPython), rebasedTarget)).toBe(basePython);
    } finally {
      fs.rmSync(resourcesRoot, { recursive: true, force: true });
    }
  });
});
