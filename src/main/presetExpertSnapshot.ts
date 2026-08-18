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

export interface BundledPresetMember {
  id: string;
  description: string;
  systemPrompt: string;
}

const PRESET_EXPERTS_DIR = ['zhiyuan-expert-manager', 'presets'];

const normalizeId = (name: string): string =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

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

const readPluginJson = (presetDir: string): Record<string, unknown> | null => {
  const pluginPath = path.join(presetDir, 'plugin.json');
  if (!fs.existsSync(pluginPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(pluginPath, 'utf-8')) as Record<string, unknown>;
  } catch (error) {
    console.warn(`[PresetExpert] failed to read bundled preset plugin.json:`, error);
    return null;
  }
};

const agentFilePath = (presetDir: string, relative: unknown): string | null => {
  if (typeof relative !== 'string' || !relative) return null;
  const resolved = path.resolve(presetDir, relative);
  return fs.existsSync(resolved) ? resolved : null;
};

/** Matches a plugin agents entry against a registered agent id (kebab-case). */
const matchesAgentId = (agentPath: string, agentId: string): boolean => {
  const fileName = path.basename(agentPath).replace(/\.md$/i, '');
  return fileName === agentId || normalizeId(fileName) === agentId;
};

/** Mirror of the registration script's team-lead augmentation (member roster). */
const buildLeadRoster = (
  pluginJson: Record<string, unknown>,
  rawLeadAgent: string | null,
): string | null => {
  const teamInfo = pluginJson.teamInfo as
    | { memberAgents?: unknown; leadAgent?: unknown }
    | undefined;
  const members = Array.isArray(teamInfo?.memberAgents) ? teamInfo.memberAgents : [];
  if (members.length === 0 || teamInfo?.leadAgent !== rawLeadAgent) return null;
  const displayMembers = Array.isArray(pluginJson.members) ? pluginJson.members : [];
  const roster = members
    .map(member => {
      const memberId = String(member);
      const display = (displayMembers as Array<Record<string, unknown>>).find(
        entry => String(entry?.id) === memberId,
      );
      const profession = (display?.profession as { zh?: string; en?: string } | undefined)?.zh
        ?? (display?.profession as { zh?: string; en?: string } | undefined)?.en
        ?? memberId;
      return `- ${memberId}（${profession}）`;
    })
    .join('\n');
  const firstMember = members[0] ? String(members[0]) : 'member-id';
  return [
    '',
    '## 已注册成员映射',
    '',
    roster,
    '',
    `调度成员时，在 subagent 工具的 name 参数中使用成员 ID（如 ${firstMember}），系统会自动路由到对应 Agent。`,
  ].join('\n');
};

export function resolveBundledPresetExpertSnapshot(
  skillsRoot: string,
  presetId: string,
  agentId?: string,
): BundledPresetExpertSnapshot | null {
  const presetDir = path.join(skillsRoot, ...PRESET_EXPERTS_DIR, presetId);
  const pluginJson = readPluginJson(presetDir);
  if (!pluginJson) return null;

  try {
    const agentPaths = Array.isArray(pluginJson.agents) ? pluginJson.agents : [];
    // The main session only loads the single selected agent file: the agent
    // named by `agentId` (lead for teams, the only file for single agents),
    // falling back to the first entry for compatibility.
    const selected =
      (agentId ? agentPaths.find(entry => matchesAgentId(String(entry), agentId)) : undefined) ??
      agentPaths[0];
    const agentMdPath = selected === undefined ? null : agentFilePath(presetDir, selected);
    if (!agentMdPath) return null;

    let promptSnapshot = stripFrontmatter(fs.readFileSync(agentMdPath, 'utf-8'));
    if (!promptSnapshot) return null;

    // Team leads get the same member roster the registration script embeds;
    // without it the live disk snapshot would silently lose the member map.
    const teamInfo = pluginJson.teamInfo as { leadAgent?: unknown } | undefined;
    const rawLeadAgent = typeof teamInfo?.leadAgent === 'string' ? teamInfo.leadAgent : null;
    const leadAgentId = rawLeadAgent ? normalizeId(rawLeadAgent) : null;
    const selectedAgentId =
      agentId ??
      path.basename(agentMdPath).replace(/\.md$/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    if (leadAgentId && selectedAgentId === leadAgentId) {
      const roster = buildLeadRoster(pluginJson, rawLeadAgent);
      if (roster) promptSnapshot = `${promptSnapshot}\n${roster}`;
    }

    // Team members never own skills; only leads and single agents do.
    const isMember = leadAgentId !== null && selectedAgentId !== leadAgentId;
    const skillIds = isMember
      ? []
      : resolveSkillIdsFromRegistry(pluginJson, presetDir, skillsRoot);

    return { promptSnapshot, skillIds };
  } catch (error) {
    console.warn(`[PresetExpert] failed to read bundled preset '${presetId}':`, error);
    return null;
  }
}

/**
 * Live team member definitions for the subagent tool. Members are read from
 * the bundled preset directory so editing a member file takes effect without
 * re-importing; imported packages keep their synced pi agents files.
 */
export function resolveBundledPresetMembers(
  skillsRoot: string,
  presetId: string,
): BundledPresetMember[] | null {
  const presetDir = path.join(skillsRoot, ...PRESET_EXPERTS_DIR, presetId);
  const pluginJson = readPluginJson(presetDir);
  if (!pluginJson || pluginJson.expertType !== 'team') return null;

  const teamInfo = pluginJson.teamInfo as { memberAgents?: unknown } | undefined;
  const members = Array.isArray(teamInfo?.memberAgents) ? teamInfo.memberAgents : [];
  if (members.length === 0) return null;

  const result: BundledPresetMember[] = [];
  for (const member of members) {
    const memberId = String(member);
    const memberPath = agentFilePath(presetDir, path.join('agents', `${memberId}.md`));
    if (!memberPath) {
      console.warn(`[PresetExpert] bundled team member file not found: ${memberId}`);
      continue;
    }
    const content = fs.readFileSync(memberPath, 'utf-8');
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    const systemPrompt = (frontmatterMatch ? frontmatterMatch[2] : content).trim();
    if (!systemPrompt) continue;
    const descriptionMatch = frontmatterMatch?.[1].match(/^description:\s*(.+)$/m);
    result.push({
      id: memberId,
      description: descriptionMatch?.[1].trim() ?? `Team member ${memberId}`,
      systemPrompt,
    });
  }
  return result.length > 0 ? result : null;
}

function resolveSkillIdsFromRegistry(
  pluginJson: Record<string, unknown>,
  presetDir: string,
  skillsRoot: string,
): string[] {
  // Reuse the registration script's pure resolver; it only reads plugin.json
  // and SKILL.md frontmatter. Fall back to the declared skillIds when the
  // script is unavailable so a snapshot never hard-depends on it.
  const registerExpertPath = path.join(
    skillsRoot,
    'zhiyuan-expert-manager',
    'scripts',
    'register_expert.js',
  );
  if (fs.existsSync(registerExpertPath)) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { resolveSkillIds } = require(registerExpertPath) as {
        resolveSkillIds: (pluginJson: unknown, expertDir: string) => string[];
      };
      return resolveSkillIds(pluginJson, presetDir);
    } catch (error) {
      console.warn(`[PresetExpert] failed to resolve skill ids via register script:`, error);
    }
  }
  return Array.isArray(pluginJson.skillIds) ? [...pluginJson.skillIds] : [];
}
