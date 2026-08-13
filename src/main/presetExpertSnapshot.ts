import fs from 'fs';
import path from 'node:path';

/**
 * Live snapshot of a bundled expert preset read from disk. Bundled presets
 * are file-sourced like regular skills: editing the preset markdown takes
 * effect on the next session without re-importing. The agents table snapshot
 * remains the fallback when the preset directory is missing or unreadable.
 */
export interface BundledPresetExpertSnapshot {
  promptSnapshot: string;
  skillIds: string[];
}

const PRESET_EXPERTS_DIR = ['zhiyuan-expert-manager', 'presets'];

const stripFrontmatter = (markdown: string): string => {
  const lines = markdown.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return markdown;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].trim() === '---') {
      return lines.slice(index + 1).join('\n').trim();
    }
  }
  return markdown;
};

export function resolveBundledPresetExpertSnapshot(
  skillsRoot: string,
  presetId: string,
): BundledPresetExpertSnapshot | null {
  const presetDir = path.join(skillsRoot, ...PRESET_EXPERTS_DIR, presetId);
  const pluginPath = path.join(presetDir, 'plugin.json');
  if (!fs.existsSync(pluginPath)) return null;

  try {
    const pluginJson = JSON.parse(fs.readFileSync(pluginPath, 'utf-8')) as {
      agents?: unknown;
      [key: string]: unknown;
    };
    const agentPaths = Array.isArray(pluginJson.agents) ? pluginJson.agents : [];
    const firstAgent = agentPaths.find((entry): entry is string => typeof entry === 'string');
    if (!firstAgent) return null;

    const agentMdPath = path.resolve(presetDir, firstAgent);
    if (!fs.existsSync(agentMdPath)) return null;
    const promptSnapshot = stripFrontmatter(fs.readFileSync(agentMdPath, 'utf-8'));
    if (!promptSnapshot) return null;

    // Reuse the registration script's pure resolver for packaged + shared
    // skill IDs; it only reads plugin.json and SKILL.md frontmatter.
    const registerExpertPath = path.join(
      skillsRoot,
      'zhiyuan-expert-manager',
      'scripts',
      'register_expert.js',
    );
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { resolveSkillIds } = require(registerExpertPath) as {
      resolveSkillIds: (pluginJson: unknown, expertDir: string) => string[];
    };

    return { promptSnapshot, skillIds: resolveSkillIds(pluginJson, presetDir) };
  } catch (error) {
    console.warn(`[PresetExpert] failed to read bundled preset '${presetId}':`, error);
    return null;
  }
}
