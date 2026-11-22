import fs from 'fs';
import path from 'path';

import { SKILL_FILE_NAME, SKILLS_DIR_NAME, SkillCatalogLimit } from './constants';

export const listSkillDirs = (
  root: string,
  readEntries: (directory: string) => string[] = directory => fs.readdirSync(directory),
): string[] => {
  if (!fs.existsSync(root)) return [];
  const skillFile = path.join(root, SKILL_FILE_NAME);
  if (fs.existsSync(skillFile)) {
    return [root];
  }

  const entries = readEntries(root);
  return entries
    .map(entry => path.join(root, entry))
    .filter(entryPath => {
      try {
        const stat = fs.lstatSync(entryPath);
        if (!stat.isDirectory() && !stat.isSymbolicLink()) {
          return false;
        }
        return fs.existsSync(path.join(entryPath, SKILL_FILE_NAME));
      } catch {
        return false;
      }
    });
};

export const collectSkillDirsFromSource = (source: string): string[] => {
  const resolved = path.resolve(source);
  const scanLimit = new Error('Skill source directory exceeds the supported scan limit');
  let entriesRead = 0;
  const readEntries = (dir: string): string[] => {
    const directory = fs.opendirSync(dir);
    const entries: string[] = [];
    try {
      for (let entry = directory.readSync(); entry; entry = directory.readSync()) {
        if (++entriesRead > SkillCatalogLimit.SourceEntries) throw scanLimit;
        entries.push(entry.name);
      }
    } finally {
      directory.closeSync();
    }
    return entries.sort();
  };
  if (fs.existsSync(path.join(resolved, SKILL_FILE_NAME))) {
    return [resolved];
  }

  const nestedRoot = path.join(resolved, SKILLS_DIR_NAME);
  if (fs.existsSync(nestedRoot) && fs.statSync(nestedRoot).isDirectory()) {
    const nestedSkills = listSkillDirs(nestedRoot, readEntries);
    if (nestedSkills.length > 0) {
      return nestedSkills;
    }
  }

  const directSkills = listSkillDirs(resolved, readEntries);
  if (directSkills.length > 0) {
    return directSkills;
  }

  return collectSkillDirsRecursively(resolved, readEntries, scanLimit);
};

const collectSkillDirsRecursively = (
  root: string,
  readEntries: (directory: string) => string[],
  scanLimit: Error,
): string[] => {
  const resolvedRoot = path.resolve(root);
  if (!fs.existsSync(resolvedRoot)) return [];

  const matchedDirs: string[] = [];
  const queue: string[] = [resolvedRoot];
  const seen = new Set<string>();

  for (let index = 0; index < queue.length; index++) {
    const current = queue[index];
    const normalized = path.resolve(current);
    if (seen.has(normalized)) continue;
    seen.add(normalized);

    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(normalized);
    } catch {
      continue;
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) continue;

    if (fs.existsSync(path.join(normalized, SKILL_FILE_NAME))) {
      matchedDirs.push(normalized);
      continue;
    }

    let entries: string[] = [];
    try {
      entries = readEntries(normalized);
    } catch (error) {
      if (error === scanLimit) throw error;
      continue;
    }

    for (const entry of entries) {
      if (!entry || entry === '.git' || entry === 'node_modules') continue;
      queue.push(path.join(normalized, entry));
    }
  }

  return matchedDirs;
};
