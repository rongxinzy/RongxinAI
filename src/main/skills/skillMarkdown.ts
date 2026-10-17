import fs from 'fs';
import yaml from 'js-yaml';
import path from 'path';

import { SKILL_FILE_NAME } from './constants';

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export const parseFrontmatter = (
  raw: string,
): { frontmatter: Record<string, unknown>; content: string } => {
  const normalized = raw.replace(/^\uFEFF/, '');
  const match = normalized.match(FRONTMATTER_RE);
  if (!match) {
    return { frontmatter: {}, content: normalized };
  }

  let frontmatter: Record<string, unknown> = {};
  try {
    const parsed = yaml.load(match[1]);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      frontmatter = parsed as Record<string, unknown>;
    }
  } catch (e) {
    console.warn('[skills] Failed to parse YAML frontmatter:', e);
  }

  const content = normalized.slice(match[0].length);
  return { frontmatter, content };
};

export const isTruthy = (value?: unknown): boolean => {
  if (value === true) return true;
  if (!value) return false;
  if (typeof value !== 'string') return false;
  const normalized = value.trim().toLowerCase();
  return normalized === 'true' || normalized === 'yes' || normalized === '1';
};

export const extractDescription = (content: string): string => {
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    return trimmed.replace(/^#+\s*/, '');
  }
  return '';
};

export const normalizeFolderName = (name: string): string => {
  const normalized = name.replace(/[^a-zA-Z0-9-_]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized || 'skill';
};

export const normalizeSkillName = (name: string): string =>
  name
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '-');

const getSkillNameFromDir = (skillDir: string): string => {
  const skillFile = path.join(skillDir, SKILL_FILE_NAME);
  const raw = fs.readFileSync(skillFile, 'utf8');
  const { frontmatter } = parseFrontmatter(raw);
  return (
    (String(frontmatter.name || '') || path.basename(skillDir)).trim() || path.basename(skillDir)
  );
};

export const findDuplicateSkillName = (
  skillDirs: string[],
  installedSkillNames: Iterable<string>,
): string | null => {
  const knownNames = new Set(Array.from(installedSkillNames, normalizeSkillName).filter(Boolean));

  for (const skillDir of skillDirs) {
    const name = getSkillNameFromDir(skillDir);
    const normalizedName = normalizeSkillName(name);
    if (knownNames.has(normalizedName)) return name;
    knownNames.add(normalizedName);
  }

  return null;
};

export const isZipFile = (filePath: string): boolean =>
  path.extname(filePath).toLowerCase() === '.zip';

/**
 * Compare two semver-like version strings (e.g. "1.0.0" vs "1.0.1").
 * Returns 1 if a > b, -1 if a < b, 0 if equal.
 * Non-numeric segments are treated as 0.
 */
export const compareVersions = (a: string, b: string): number => {
  const pa = a.split('.').map(s => parseInt(s, 10) || 0);
  const pb = b.split('.').map(s => parseInt(s, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
};

/**
 * Requirements are part of a bundled Skill's runtime contract. Existing
 * userData copies must be repaired when a newly bundled requirements file is
 * added or changed, even if an older Skill used the same metadata version.
 */
export const hasMatchingBundledRequirements = (targetDir: string, bundledDir: string): boolean => {
  const bundledRequirements = path.join(bundledDir, 'requirements.txt');
  if (!fs.existsSync(bundledRequirements)) return true;

  const targetRequirements = path.join(targetDir, 'requirements.txt');
  if (!fs.existsSync(targetRequirements)) return false;

  try {
    return fs.readFileSync(targetRequirements).equals(fs.readFileSync(bundledRequirements));
  } catch {
    return false;
  }
};

export const resolveWithin = (root: string, target: string): string => {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(root, target);
  if (resolvedTarget === resolvedRoot) return resolvedTarget;
  if (!resolvedTarget.startsWith(resolvedRoot + path.sep)) {
    throw new Error('Invalid target path');
  }
  return resolvedTarget;
};
