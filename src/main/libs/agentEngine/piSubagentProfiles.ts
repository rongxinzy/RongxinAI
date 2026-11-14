/** Native child identities and app-managed team member definitions. */
import * as fs from 'node:fs';
import path from 'node:path';
import { PiSubagentProfileId } from './piSubagentConstants';
const MEMBER_FILE_SEPARATOR = '--';
export interface SubagentProfile {
  id: string;
  description: string;
  systemPrompt: string;
  source: 'builtin' | 'member';
}
export interface PiSubagentProfileSource {
  getPiAgentsDir(): string;
  presetId?: string | null;
  loadBundledMembers?: (presetId: string) => SubagentProfile[] | null;
}
// ── Built-in agent profiles ──

const BUILTIN_AGENT_PROFILES: ReadonlyArray<Omit<SubagentProfile, 'source'>> = [
  {
    id: PiSubagentProfileId.Researcher,
    description: 'Web and documentation research; produces findings with cited sources.',
    systemPrompt:
      'You are a research subagent. Investigate the assigned topic using the available ' +
      'web and documentation tools. Produce concise findings and cite a concrete source ' +
      '(URL or document reference) for every claim. Do not modify project files.',
  },
  {
    id: PiSubagentProfileId.Scout,
    description: 'Local codebase recon: relevant files, entry points, data flow, risks.',
    systemPrompt:
      'You are a code reconnaissance subagent. Explore the local workspace to map the ' +
      'files, entry points, and data flow relevant to the assigned task. Report concrete ' +
      'file paths, key symbols, and risks, plus where another agent should start. ' +
      'Do not modify any files.',
  },
  {
    id: PiSubagentProfileId.Planner,
    description: 'Turns existing context into a concrete implementation plan (read-only).',
    systemPrompt:
      'You are a planning subagent. Based on the existing context, produce a concrete, ' +
      'step-by-step implementation plan for the assigned task. You are read-only: never ' +
      'edit files. End with risks and open questions.',
  },
  {
    id: PiSubagentProfileId.Reviewer,
    description: 'Reviews an implementation against the task or plan; reports findings.',
    systemPrompt:
      'You are a code review subagent. Review the implementation against the assigned ' +
      'task or plan. Check correctness, test coverage, edge cases, and unnecessary ' +
      'complexity. Report findings ordered by severity with file references.',
  },
];

// ── Agent profile resolution ──

/**
 * Load team member agent definitions from the pi agents directory.
 * Files are named `<presetId>--<agentId>.md`; YAML frontmatter is stripped and
 * the body becomes the subagent system prompt.
 */
function loadMemberProfiles(piAgentsDir: string, presetId: string): SubagentProfile[] {
  const prefix = `${presetId}${MEMBER_FILE_SEPARATOR}`;
  const profiles: SubagentProfile[] = [];
  if (!fs.existsSync(piAgentsDir)) {
    return profiles;
  }
  for (const entry of fs.readdirSync(piAgentsDir)) {
    if (!entry.startsWith(prefix) || !entry.endsWith('.md')) {
      continue;
    }
    const agentId = entry.slice(prefix.length, -3);
    let systemPrompt = '';
    let description = `Team member ${agentId}`;
    try {
      const content = fs.readFileSync(path.join(piAgentsDir, entry), 'utf-8');
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
      systemPrompt = (frontmatterMatch ? frontmatterMatch[2] : content).trim();
      const descriptionMatch = frontmatterMatch?.[1].match(/^description:\s*(.+)$/m);
      if (descriptionMatch) {
        description = descriptionMatch[1].trim();
      }
    } catch (err) {
      console.warn(
        `[PiSubagentTool] skipping unreadable member agent definition for "${agentId}":`,
        err,
      );
      continue;
    }
    if (!systemPrompt) {
      continue;
    }
    profiles.push({ id: agentId, description, systemPrompt, source: 'member' });
  }
  return profiles;
}

/** Merge built-in profiles with team member agents; members override same-name builtins. */
export function resolveAgentProfiles(deps: PiSubagentProfileSource): SubagentProfile[] {
  const profiles = new Map<string, SubagentProfile>();
  for (const builtin of BUILTIN_AGENT_PROFILES) {
    profiles.set(builtin.id, { ...builtin, source: 'builtin' });
  }
  if (deps.presetId) {
    // Bundled presets are file-sourced: prefer the live member definitions
    // so member edits take effect without re-importing. User-imported
    // packages keep the synced pi agents files.
    const bundled =
      deps.loadBundledMembers?.(deps.presetId) ??
      loadMemberProfiles(deps.getPiAgentsDir(), deps.presetId);
    for (const member of bundled) {
      profiles.set(member.id, member);
    }
  }
  return [...profiles.values()];
}
