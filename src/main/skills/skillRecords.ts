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
} from './constants';
import { listSkillDirs } from './skillDirs';
import { extractDescription, isTruthy, parseFrontmatter } from './skillMarkdown';
import type { SkillDefaultConfig, SkillRecord, SkillStateMap, SkillsConfig } from './types';

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
    const content = fs.readFileSync(metadataPath, 'utf8');
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
    return `data:${mimeType};base64,${fs.readFileSync(iconPath).toString('base64')}`;
  } catch (error) {
    console.warn('[skills] Failed to read skill icon:', iconPath, error);
    return undefined;
  }
};

export function parseSkillDir(
  dir: string,
  state: SkillStateMap,
  defaults: Record<string, SkillDefaultConfig>,
  isBuiltIn: boolean,
): SkillRecord | null {
  const skillFile = path.join(dir, SKILL_FILE_NAME);
  if (!fs.existsSync(skillFile)) return null;
  try {
    const raw = fs.readFileSync(skillFile, 'utf8');
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
      const raw = fs.readFileSync(configPath, 'utf8');
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
      const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
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
