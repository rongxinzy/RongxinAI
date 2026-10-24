/**
 * Skill directory resolution for Pi sessions.
 *
 * Extracted from PiRuntimeAdapter: resolves which app-managed SKILLs roots and
 * per-skill directories a Pi resource loader may scan. ZhiYuanAgent skills come
 * exclusively from the app-managed SKILLs dirs, never from the developer's
 * global ~/.agents/skills.
 */

import * as fs from 'fs';
import { app } from 'electron';
import path from 'path';

import { getSkillsRoot } from '../coworkUtil';
import { getFeishuConnectorSkillsRoot } from '../feishuConnectorPaths';

/**
 * Skill directories exposed to Pi sessions, in priority order.
 * Development: project-root SKILLs/ (via getSkillsRoot) plus userData/SKILLs
 * (may exist from a previous packaged run). Production: userData/SKILLs
 * (getSkillsRoot already resolves there), then the bundled resources/SKILLs
 * fallback so a default skill deleted from (or not yet synced to) userData
 * stays loadable.
 */
/** Packaged-only fallback roots; tolerate incomplete Electron test doubles. */
function resolveBundledSkillsRoots(): string[] {
  const roots: string[] = [];
  if (typeof process.resourcesPath === 'string' && process.resourcesPath.length > 0) {
    roots.push(path.join(process.resourcesPath, 'SKILLs'));
  }
  try {
    if (typeof app.getAppPath === 'function') {
      roots.push(path.join(app.getAppPath(), 'SKILLs'));
    }
  } catch {
    // Unit tests often mock electron.app without getAppPath.
  }
  return roots;
}

export function resolveZhiyuanSkillDirs(): string[] {
  return collectZhiyuanSkillRoots({
    isPackaged: app.isPackaged,
    userSkillsRoot: getSkillsRoot(),
    userDataSkillsRoot: path.join(app.getPath('userData'), 'SKILLs'),
    bundledSkillsRoots: resolveBundledSkillsRoots(),
    feishuRoot: getFeishuConnectorSkillsRoot(app.getPath('userData')),
    exists: dir => fs.existsSync(dir),
  });
}

export interface ZhiyuanSkillRootsInput {
  isPackaged: boolean;
  userSkillsRoot: string;
  userDataSkillsRoot: string;
  bundledSkillsRoots: string[];
  feishuRoot: string;
  exists: (dir: string) => boolean;
}

/**
 * Pure root collection behind resolveZhiyuanSkillDirs: userData first, then
 * the feishu connector skills, then — packaged builds only — the bundled
 * SKILLs roots. Development keeps the extra userData/SKILLs root (possible
 * leftover from a previous packaged run) instead of the bundled fallback.
 */
export function collectZhiyuanSkillRoots(input: ZhiyuanSkillRootsInput): string[] {
  const dirs: string[] = [];
  const push = (dir: string): void => {
    if (!dirs.includes(dir) && input.exists(dir)) dirs.push(dir);
  };
  push(input.userSkillsRoot);
  push(input.feishuRoot);
  if (input.isPackaged) {
    for (const root of input.bundledSkillsRoots) {
      push(root);
    }
  } else {
    push(input.userDataSkillsRoot);
  }
  return dirs;
}

/**
 * Resolve only the skill directories explicitly selected for a Chat turn.
 * This performs bounded existence checks instead of enumerating every Skill
 * root, keeping default Chat startup independent of the bundled Skill tree.
 */
export function resolveSelectedSkillDirs(
  skillIds: string[] | undefined,
  roots: string[] = resolveZhiyuanSkillDirs(),
): string[] {
  if (!skillIds?.length) return [];
  const dirs: string[] = [];
  for (const skillId of skillIds) {
    if (!skillId || path.basename(skillId) !== skillId) continue;
    for (const root of roots) {
      const candidate = path.join(root, skillId);
      if (fs.existsSync(path.join(candidate, 'SKILL.md')) && !dirs.includes(candidate)) {
        dirs.push(candidate);
      }
    }
  }
  return dirs;
}

/**
 * Bundled preset skill directories for the session's selected experts.
 * File-sourced like regular skills: editing a preset SKILL.md takes effect
 * on the next session. Falls back to the imported userData copies when the
 * preset directory is not present in this build.
 */
export function resolveExpertPresetSkillDirs(
  expertIds: string[] | undefined,
  getAgent: (agentId: string) => { presetId?: string } | null | undefined,
): string[] {
  const dirs: string[] = [];
  if (!expertIds?.length) return dirs;
  const skillsRoot = getSkillsRoot();
  for (const expertId of expertIds) {
    const agent = getAgent(expertId);
    const presetId = agent?.presetId?.trim();
    if (!presetId) continue;
    const dir = path.join(skillsRoot, 'zhiyuan-expert-manager', 'presets', presetId, 'skills');
    if (!dirs.includes(dir) && fs.existsSync(dir)) dirs.push(dir);
  }
  return dirs;
}
