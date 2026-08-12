import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, expect, test } from 'vitest';

import { __skillManagerTestUtils } from './skillManager';

const {
  parseFrontmatter,
  isTruthy,
  extractDescription,
  normalizeSkillName,
  findDuplicateSkillName,
  hasMatchingBundledRequirements,
} = __skillManagerTestUtils;

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('bundled Skill requirements trigger repair for an older userData copy', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-manager-runtime-sync-'));
  tempRoots.push(root);
  const bundledDir = path.join(root, 'bundled', 'xlsx');
  const targetDir = path.join(root, 'userData', 'xlsx');
  fs.mkdirSync(bundledDir, { recursive: true });
  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(path.join(bundledDir, 'requirements.txt'), 'pandas>=2.2,<3\n');

  expect(hasMatchingBundledRequirements(targetDir, bundledDir)).toBe(false);

  fs.writeFileSync(path.join(targetDir, 'requirements.txt'), 'pandas>=2.2,<3\n');
  expect(hasMatchingBundledRequirements(targetDir, bundledDir)).toBe(true);

  fs.writeFileSync(path.join(targetDir, 'requirements.txt'), 'pandas>=2.1,<3\n');
  expect(hasMatchingBundledRequirements(targetDir, bundledDir)).toBe(false);
});

// ==================== parseFrontmatter ====================

test('parseFrontmatter: simple key-value pairs', () => {
  const raw = '---\nname: demo\ndescription: A simple skill\nofficial: true\n---\n# Content here\n';
  const { frontmatter, content } = parseFrontmatter(raw);
  expect(frontmatter.name).toBe('demo');
  expect(frontmatter.description).toBe('A simple skill');
  expect(frontmatter.official).toBe(true); // YAML parses 'true' as boolean
  expect(content.trim()).toBe('# Content here');
});

test('skill name identity normalizes case, whitespace, underscores, and hyphens', () => {
  expect(normalizeSkillName('  Document_Reader  ')).toBe('document-reader');
});

test('duplicate skill names are rejected even when their folders differ', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-manager-duplicate-name-'));
  tempRoots.push(root);
  const firstDir = path.join(root, 'first-folder');
  const secondDir = path.join(root, 'second-folder');
  fs.mkdirSync(firstDir);
  fs.mkdirSync(secondDir);
  fs.writeFileSync(path.join(firstDir, 'SKILL.md'), '---\nname: Document Reader\n---\n');
  fs.writeFileSync(path.join(secondDir, 'SKILL.md'), '---\nname: document_reader\n---\n');

  expect(findDuplicateSkillName([firstDir], ['document-reader'])).toBe('Document Reader');
  expect(findDuplicateSkillName([firstDir, secondDir], [])).toBe('document_reader');
});
test('parseFrontmatter: block scalar with pipe (|)', () => {
  const raw =
    '---\nname: demo\ndescription: |\n  A multi-line description.\n  Second line.\n---\n# Content\n';
  const { frontmatter, content } = parseFrontmatter(raw);
  expect(frontmatter.name).toBe('demo');
  expect(frontmatter.description).toBe('A multi-line description.\nSecond line.\n');
  expect(content.trim()).toBe('# Content');
});

test('parseFrontmatter: folded scalar with greater-than (>)', () => {
  const raw = '---\nname: demo\ndescription: >\n  A folded\n  description.\n---\n# Content\n';
  const { frontmatter } = parseFrontmatter(raw);
  expect(frontmatter.name).toBe('demo');
  expect(frontmatter.description).toBe('A folded description.\n');
});

test('parseFrontmatter: quoted strings', () => {
  const raw = '---\nname: "quoted name"\ndescription: \'single quoted\'\n---\n# Content\n';
  const { frontmatter } = parseFrontmatter(raw);
  expect(frontmatter.name).toBe('quoted name');
  expect(frontmatter.description).toBe('single quoted');
});

test('parseFrontmatter: nested objects', () => {
  const raw =
    '---\nname: demo\nmetadata:\n  short-description: A short desc\n  version: 2\n---\n# Content\n';
  const { frontmatter } = parseFrontmatter(raw);
  expect(frontmatter.name).toBe('demo');
  expect(frontmatter.metadata).toEqual({ 'short-description': 'A short desc', version: 2 });
});

test('parseFrontmatter: arrays', () => {
  const raw = '---\nname: demo\ntags:\n  - tool\n  - search\n  - web\n---\n# Content\n';
  const { frontmatter } = parseFrontmatter(raw);
  expect(frontmatter.tags).toEqual(['tool', 'search', 'web']);
});

test('parseFrontmatter: boolean values as native YAML booleans', () => {
  const raw = '---\nname: demo\nofficial: true\nisOfficial: false\n---\n# Content\n';
  const { frontmatter } = parseFrontmatter(raw);
  expect(frontmatter.official).toBe(true);
  expect(frontmatter.isOfficial).toBe(false);
});

test('parseFrontmatter: no frontmatter returns empty object and full content', () => {
  const raw = '# Just a heading\nSome content\n';
  const { frontmatter, content } = parseFrontmatter(raw);
  expect(frontmatter).toEqual({});
  expect(content).toBe(raw);
});

test('parseFrontmatter: empty frontmatter returns empty object', () => {
  const raw = '---\n\n---\n# Content\n';
  const { frontmatter, content } = parseFrontmatter(raw);
  expect(frontmatter).toEqual({});
  expect(content.trim()).toBe('# Content');
});

test('parseFrontmatter: BOM is stripped', () => {
  const raw = '\uFEFF---\nname: bom-test\n---\n# Content\n';
  const { frontmatter } = parseFrontmatter(raw);
  expect(frontmatter.name).toBe('bom-test');
});

test('parseFrontmatter: Windows line endings (CRLF)', () => {
  const raw = '---\r\nname: win\r\ndescription: windows\r\n---\r\n# Content\r\n';
  const { frontmatter } = parseFrontmatter(raw);
  expect(frontmatter.name).toBe('win');
  expect(frontmatter.description).toBe('windows');
});

test('parseFrontmatter: invalid YAML returns empty frontmatter gracefully', () => {
  const raw = '---\n: invalid\n  bad:\n    - [\n---\n# Content\n';
  const { frontmatter, content } = parseFrontmatter(raw);
  expect(frontmatter).toEqual({});
  expect(content).toMatch(/# Content/);
});

// ==================== isTruthy ====================

test('isTruthy: native boolean true', () => {
  expect(isTruthy(true)).toBe(true);
});

test('isTruthy: native boolean false', () => {
  expect(isTruthy(false)).toBe(false);
});

test('isTruthy: string "true"', () => {
  expect(isTruthy('true')).toBe(true);
  expect(isTruthy('True')).toBe(true);
  expect(isTruthy('TRUE')).toBe(true);
});

test('isTruthy: string "yes" and "1"', () => {
  expect(isTruthy('yes')).toBe(true);
  expect(isTruthy('1')).toBe(true);
});

test('isTruthy: string "false" and others', () => {
  expect(isTruthy('false')).toBe(false);
  expect(isTruthy('no')).toBe(false);
  expect(isTruthy('0')).toBe(false);
  expect(isTruthy('random')).toBe(false);
});

test('isTruthy: undefined and null', () => {
  expect(isTruthy(undefined)).toBe(false);
  expect(isTruthy(null)).toBe(false);
});

test('isTruthy: number and object', () => {
  expect(isTruthy(1)).toBe(false);
  expect(isTruthy({})).toBe(false);
});

// ==================== extractDescription ====================

test('extractDescription: extracts first non-empty line', () => {
  expect(extractDescription('\n\nFirst line\nSecond line\n')).toBe('First line');
});

test('extractDescription: strips markdown heading markers', () => {
  expect(extractDescription('## Heading\nContent')).toBe('Heading');
  expect(extractDescription('### Sub heading')).toBe('Sub heading');
});

test('extractDescription: returns empty string for empty content', () => {
  expect(extractDescription('')).toBe('');
  expect(extractDescription('\n\n\n')).toBe('');
});

// ==================== Integration: real-world SKILL.md patterns ====================

test('integration: typical official skill frontmatter', () => {
  const raw = [
    '---',
    'name: docx',
    'description: "Comprehensive document creation, editing, and analysis"',
    'license: Proprietary. LICENSE.txt has complete terms',
    'official: true',
    '---',
    '',
    '# DOCX creation, editing, and analysis',
    'Detailed instructions here.',
  ].join('\n');

  const { frontmatter, content } = parseFrontmatter(raw);
  expect(frontmatter.name).toBe('docx');
  expect(frontmatter.description).toBe('Comprehensive document creation, editing, and analysis');
  expect(frontmatter.license).toBe('Proprietary. LICENSE.txt has complete terms');
  expect(isTruthy(frontmatter.official)).toBe(true);
  expect(content).toMatch(/# DOCX creation/);
});

test('integration: skill with metadata nested object', () => {
  const raw = [
    '---',
    'name: create-plan',
    'description: Create a concise plan',
    'official: true',
    'metadata:',
    '  short-description: Create a plan',
    '---',
    '',
    '# Create Plan',
  ].join('\n');

  const { frontmatter } = parseFrontmatter(raw);
  expect(frontmatter.name).toBe('create-plan');
  expect(frontmatter.metadata).toEqual({ 'short-description': 'Create a plan' });
});

test('integration: skill with block scalar description', () => {
  const raw = [
    '---',
    'name: demo',
    'description: |',
    '  A multi-line description.',
    '  Second line.',
    '---',
    '',
    '# Demo Skill',
  ].join('\n');

  const { frontmatter, content } = parseFrontmatter(raw);
  expect(frontmatter.name).toBe('demo');
  expect(String(frontmatter.description || '').trim()).toBe(
    'A multi-line description.\nSecond line.',
  );
  expect(content).toMatch(/# Demo Skill/);
});
