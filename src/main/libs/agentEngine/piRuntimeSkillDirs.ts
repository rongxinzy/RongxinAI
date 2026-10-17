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
 * (may exist from a previous packaged run). Production: userData/SKILLs only
 * (getSkillsRoot already resolves there).
 */
export function resolveZhiyuanSkillDirs(): string[] {
  const dirs: string[] = [];
  const push = (dir: string): void => {
    if (!dirs.includes(dir) && fs.existsSync(dir)) dirs.push(dir);
  };
  push(getSkillsRoot());
  push(getFeishuConnectorSkillsRoot(app.getPath('userData')));
  if (!app.isPackaged) {
    push(path.join(app.getPath('userData'), 'SKILLs'));
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
