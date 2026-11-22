import fs from 'fs';
import yaml from 'js-yaml';
import path from 'path';

import { isCoreSkill } from '../../shared/skills/constants';
import {
  RONGX_DIR_NAME,
  RONGX_METADATA_FILE_NAME,
  RONGX_PRIMARY_METADATA_FIELDS,
  SKILLS_CONFIG_FILE,
  SKILL_FILE_NAME,
  SKILL_ICON_FILE_NAMES,
  SKILL_ICON_MIME_TYPES,
  SkillCatalogLimit,
} from './constants';
import { listSkillDirs } from './skillDirs';
import { extractDescription, isTruthy, parseFrontmatter } from './skillMarkdown';
import type { SkillDefaultConfig, SkillRecord, SkillStateMap, SkillsConfig } from './types';

export type SkillCatalogInput = {
  primaryRoot: string;
  bundledRoot: string;
  roots: string[];
  state: SkillStateMap;
};

function readCatalogFile(filePath: string): Buffer {
  const file = fs.openSync(filePath, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
  try {
    const info = fs.fstatSync(file);
    if (!info.isFile() || info.size > SkillCatalogLimit.FileBytes) {
      throw new Error('Skill catalog file exceeds the supported limit');
    }
    const buffer = Buffer.allocUnsafe(info.size + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const bytes = fs.readSync(file, buffer, offset, buffer.length - offset, null);
      if (bytes === 0) break;
      offset += bytes;
    }
    if (offset !== info.size) throw new Error('Skill catalog file changed during the read');
    return buffer.subarray(0, offset);
  } finally {
    fs.closeSync(file);
  }
}

const readRongxMetadata = (
  skillDir: string,
): {
  name?: string;
  description?: string;
  author?: string;
  license?: string;
  content?: string;
  fields?: Record<string, string>;
} => {
  const metadataPath = path.join(skillDir, RONGX_DIR_NAME, RONGX_METADATA_FILE_NAME);
  if (!fs.existsSync(metadataPath)) return {};

  try {
    const content = readCatalogFile(metadataPath).toString('utf8');
    const parsed = yaml.load(content);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const metadata = parsed as Record<string, unknown>;
    const name = typeof metadata.name === 'string' ? metadata.name.trim() : '';
    const description = typeof metadata.description === 'string' ? metadata.description.trim() : '';
    const author = typeof metadata.author === 'string' ? metadata.author.trim() : '';
    const license = typeof metadata.license === 'string' ? metadata.license.trim() : '';
    const fields = Object.fromEntries(
      Object.entries(metadata)
        .filter(
          ([key, value]) =>
            value !== undefined &&
            value !== null &&
            !RONGX_PRIMARY_METADATA_FIELDS.includes(
              key as (typeof RONGX_PRIMARY_METADATA_FIELDS)[number],
            ),
        )
        .map(([key, value]) => [
          key,
          typeof value === 'string' ? value.trim() : JSON.stringify(value),
        ]),
    );
    return {
      ...(name ? { name } : {}),
      ...(description ? { description } : {}),
      ...(author ? { author } : {}),
      ...(license ? { license } : {}),
      content,
      ...(Object.keys(fields).length > 0 ? { fields } : {}),
    };
  } catch (error) {
    console.warn('[skills] Failed to read rongx skill metadata:', metadataPath, error);
    return {};
  }
};

const getSkillIconDataUrl = (iconPath: string): string | undefined => {
  try {
    const iconFileName = path
      .basename(iconPath)
      .toLowerCase() as keyof typeof SKILL_ICON_MIME_TYPES;
    const mimeType = SKILL_ICON_MIME_TYPES[iconFileName];
    if (!mimeType) return undefined;
    return `data:${mimeType};base64,${readCatalogFile(iconPath).toString('base64')}`;
  } catch (error) {
    console.warn('[skills] Failed to read skill icon:', iconPath, error);
    return undefined;
  }
};

function parseSkillDir(
  dir: string,
  state: SkillStateMap,
  defaults: Record<string, SkillDefaultConfig>,
  isBuiltIn: boolean,
): SkillRecord | null {
  const skillFile = path.join(dir, SKILL_FILE_NAME);
  if (!fs.existsSync(skillFile)) return null;
  try {
    const raw = readCatalogFile(skillFile).toString('utf8');
    const { frontmatter, content } = parseFrontmatter(raw);
    const name =
      (String(frontmatter.name || '') || path.basename(dir)).trim() || path.basename(dir);
    const description = (
      String(frontmatter.description || '') ||
      extractDescription(content) ||
      name
    ).trim();
    const isOfficial = isTruthy(frontmatter.official) || isTruthy(frontmatter.isOfficial);
    const meta = frontmatter.metadata as Record<string, unknown> | undefined;
    const v = frontmatter.version ?? meta?.version;
    const version = typeof v === 'string' ? v : typeof v === 'number' ? String(v) : undefined;
    const updatedAt = fs.statSync(skillFile).mtimeMs;
    const id = path.basename(dir);
    const prompt = content.trim();
    const rongxMetadata = readRongxMetadata(dir);
    const rongxDir = path.join(dir, RONGX_DIR_NAME);
    const configuredIcon =
      typeof frontmatter.icon === 'string' ? path.basename(frontmatter.icon) : undefined;
    const iconPath = [
      ...SKILL_ICON_FILE_NAMES.map(fileName => path.join(rongxDir, fileName)),
      ...(configuredIcon ? [path.join(dir, configuredIcon)] : []),
      ...SKILL_ICON_FILE_NAMES.map(fileName => path.join(dir, fileName)),
    ].find(filePath => fs.existsSync(filePath));
    const defaultEnabled = defaults[id]?.enabled ?? true;
    // Core skills back first-class product entries and are always enabled.
    const enabled = isCoreSkill(id) ? true : (state[id]?.enabled ?? defaultEnabled);
    const pinned = state[id]?.pinned ?? false;
    return {
      id,
      name,
      description,
      enabled,
      pinned,
      isOfficial,
      isBuiltIn,
      updatedAt,
      prompt,
      skillPath: skillFile,
      iconUrl: iconPath ? getSkillIconDataUrl(iconPath) : state[id]?.iconUrl,
      displayName: state[id]?.displayName || rongxMetadata.name || defaults[id]?.displayName,
      displayDescription: rongxMetadata.description,
      displayAuthor: rongxMetadata.author,
      displayLicense: rongxMetadata.license,
      metadataContent: rongxMetadata.content,
      metadataFields: rongxMetadata.fields,
      version,
    };
  } catch (error) {
    console.warn('[skills] Failed to parse skill:', dir, error);
    return null;
  }
}

export function loadSkillsDefaults(roots: string[]): Record<string, SkillDefaultConfig> {
  const merged: Record<string, SkillDefaultConfig> = {};

  // Load from roots in reverse order so higher priority roots override lower ones
  // roots[0] is user directory (highest priority), roots[1] is app-bundled (lower priority)
  const reversedRoots = [...roots].reverse();

  for (const root of reversedRoots) {
    const configPath = path.join(root, SKILLS_CONFIG_FILE);
    if (!fs.existsSync(configPath)) continue;

    try {
      const raw = readCatalogFile(configPath).toString('utf8');
      const config = JSON.parse(raw) as SkillsConfig;
      if (config.defaults && typeof config.defaults === 'object') {
        for (const [id, settings] of Object.entries(config.defaults)) {
          merged[id] = { ...merged[id], ...settings };
        }
      }
    } catch (error) {
      console.warn('[skills] Failed to load skills config:', configPath, error);
    }
  }

  return merged;
}

export function collectBuiltInSkillIds(builtInRoot: string): Set<string> {
  if (!builtInRoot || !fs.existsSync(builtInRoot)) {
    return new Set();
  }
  try {
    const builtInIds = new Set<string>();
    const configPath = path.join(builtInRoot, SKILLS_CONFIG_FILE);
    if (fs.existsSync(configPath)) {
      const parsed = JSON.parse(readCatalogFile(configPath).toString('utf8'));
      if (parsed?.defaults && typeof parsed.defaults === 'object') {
        Object.keys(parsed.defaults).forEach(id => builtInIds.add(id));
      }
    }
    listSkillDirs(builtInRoot).forEach(dir => builtInIds.add(path.basename(dir)));
    return builtInIds;
  } catch (error) {
    console.warn('[skills] Failed to parse skills.config.json for built-in skill list:', error);
  }
  // In development the bundled and user roots can be the same directory.
  // Treat every bundled directory as protected unless an install operation
  // explicitly marked that ID as user-installed in the persistent state.
  return new Set(listSkillDirs(builtInRoot).map(dir => path.basename(dir)));
}

export function readSkillCatalog(input: SkillCatalogInput): SkillRecord[] {
  const { primaryRoot, bundledRoot, roots, state } = input;
  const defaults = loadSkillsDefaults(roots);
  const builtInIds = collectBuiltInSkillIds(bundledRoot);
  const skills = new Map<string, { record: SkillRecord; bytes: number }>();
  let candidates = 0;
  let totalBytes = 0;
  for (const root of roots.filter(root => root !== primaryRoot).concat(primaryRoot)) {
    const dirs = listSkillDirs(root);
    candidates += dirs.length;
    if (candidates > SkillCatalogLimit.Candidates) throw new Error('Too many Skill directories');
    for (const dir of dirs) {
      const id = path.basename(dir);
      const record = parseSkillDir(
        dir,
        state,
        defaults,
        builtInIds.has(id) && !state[id]?.userInstalled && !state[id]?.iconUrl,
      );
      if (!record) continue;
      let bytes = 0;
      for (const value of Object.values(record)) {
        if (typeof value === 'string') bytes += Buffer.byteLength(value);
      }
      for (const [key, value] of Object.entries(record.metadataFields ?? {})) {
        bytes += Buffer.byteLength(key) + Buffer.byteLength(value);
      }
      totalBytes += bytes - (skills.get(id)?.bytes ?? 0);
      if (totalBytes > SkillCatalogLimit.ResultBytes)
        throw new Error('Skill catalog exceeds the supported size');
      skills.set(id, { record, bytes });
    }
  }
  return Array.from(skills.values(), item => item.record).sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    const orderA = defaults[a.id]?.order ?? 999;
    const orderB = defaults[b.id]?.order ?? 999;
    return orderA !== orderB ? orderA - orderB : a.name.localeCompare(b.name);
  });
}
