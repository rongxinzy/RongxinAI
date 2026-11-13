/**
 * Pi Subagent Tool
 *
 * Multi-mode subagent delegation for Pi SDK (in-process) cowork sessions.
 * Ports the core semantics of the pi-subagents package to the embedded Pi
 * runtime: instead of spawning a `pi` CLI subprocess, each subagent runs as
 * an isolated Pi sub-session created via createAgentSession().
 *
 * Modes (mutually exclusive):
 *   single   — {agent, task}
 *   parallel — {parallel: [{agent, task}, ...]} with a concurrency cap
 *
 * Sub-session constraints:
 *   - no customTools (subagents cannot spawn sub-subagents)
 *   - no AskUserQuestion tool
 *   - cancellation inherited from the parent, aborted on completion
 */

import * as fs from 'fs';
import path from 'path';

import { safeSlice } from '../../../shared/lib/safeSlice';
import { CoreSkillId } from '../../../shared/skills/constants';
import {
  PiSubagentProfileId,
  PiSubagentTerminationReason,
  PiSubagentToolName,
} from './piSubagentConstants';
import {
  runPiSubagent,
  type PiSubagentExecutionMetadata,
  type PiSubagentSession,
} from './piSubagentExecution';
import type { PiExtensionFactory } from './piExtensionTypes';
import type { PiSettingsManager } from './piRuntimeSessionState';

// ── Constants ──

export { PiSubagentToolName } from './piSubagentConstants';

/** Maximum number of subagent sessions running at once in parallel mode. */
export const SUBAGENT_PARALLEL_LIMIT = 4;

/** Separator between presetId and agentId in team member definition filenames. */
const MEMBER_FILE_SEPARATOR = '--';

/** Placeholder for single and parallel subagent execution. */

/** Maximum characters returned by subagent execution to prevent context overflow (clamped to 30,000 for CJK token safety). */
export const PI_SUBAGENT_MAX_OUTPUT_CHARS = 30_000;

// ── Types ──

/**
 * Sub-session surface used here: the runPiSubagent session contract plus
 * abort() for cleanup after the run settles.
 */
interface PiSubagentSubSession extends PiSubagentSession {
  abort(): Promise<void>;
}

/**
 * Minimal Pi module surface used here. piModules.d.ts declares
 * createAgentSession with a narrower session type, so the dynamic import is
 * cast to this interface — the same approach piRuntimeAdapter takes.
 */
interface PiSubagentModules {
  createAgentSession: (options: Record<string, unknown>) => Promise<{
    session: PiSubagentSubSession;
  }>;
}

interface PiSubagentResolvedModel {
  model: Record<string, unknown>;
  /** Opaque model runtime handle, forwarded to sub-session options when set. */
  modelRuntime: unknown;
  /** Output token budget of the resolved model. */
  maxOutputTokens: number;
}

export interface PiSubagentToolDeps {
  /** Resolves the pi agents directory (~/.pi/agent/agents) holding team member definitions. */
  getPiAgentsDir(): string;
  /** Team preset id; when set, member agents `<presetId>--<agentId>.md` are exposed. */
  presetId?: string | null;
  /**
   * Live bundled member source. When the preset ships inside the app's
   * bundled SKILLs, member definitions are read from disk per session so
   * editing a member file takes effect without re-importing; falls back to
   * the synced pi agents directory when absent or when the preset is a
   * user-imported package.
   */
  loadBundledMembers?: (presetId: string) => SubagentProfile[] | null;
  resolvedModel: PiSubagentResolvedModel;
  getResolvedModel?: () => PiSubagentResolvedModel;
  signal?: AbortSignal;
  workspaceRoot?: string;
  /** Absolute bundled web-search skill directory for researcher subagents. */
  webSearchSkillPath?: string;
  /** Builds the per-session Pi resource loader for a subagent system prompt. */
  createPiResourceLoader(
    cwd: string,
    systemPrompt: string,
    maxOutputTokens: number,
    skillIds?: string[],
    extensionFactories?: PiExtensionFactory[],
  ): Promise<unknown>;
}

interface SubagentProfile {
  id: string;
  description: string;
  systemPrompt: string;
  source: 'builtin' | 'member';
}

interface SubagentTaskSpec {
  agent: string;
  task: string;
}

interface SubagentRunResult {
  ok: boolean;
  output: string;
  execution?: PiSubagentExecutionMetadata;
}

interface SubagentToolResult {
  content: Array<{ type: 'text'; text: string }>;
  details: Record<string, unknown>;
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

// ── Pi module loading ──

let _piSubagentModules: Promise<PiSubagentModules> | null = null;

/**
 * Load the Pi coding-agent module once and cache it. Besides matching
 * piRuntimeAdapter's pattern, the cached promise keeps concurrent subagent
 * runs on a single module instance (and a single mock in tests).
 */
function getPiSubagentModules(): Promise<PiSubagentModules> {
  if (!_piSubagentModules) {
    // Pi packages are ESM-only; Vite/esbuild resolves them at build time and
    // piModules.d.ts provides the base declarations for tsc --noEmit.
    _piSubagentModules = import('@earendil-works/pi-coding-agent').then(codingAgent => ({
      createAgentSession:
        codingAgent.createAgentSession as unknown as PiSubagentModules['createAgentSession'],
    }));
  }
  return _piSubagentModules;
}

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
function resolveAgentProfiles(deps: PiSubagentToolDeps): SubagentProfile[] {
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

// ── Sub-session execution ──

/** Run a single subagent profile on a task in an isolated Pi sub-session. */
async function runSubagent(
  deps: PiSubagentToolDeps,
  profile: SubagentProfile,
  task: string,
  signal?: AbortSignal,
): Promise<SubagentRunResult> {
  const startedAt = Date.now();
  let subSession: PiSubagentSubSession | null = null;
  try {
    signal?.throwIfAborted();
    const pi = await getPiSubagentModules();
    signal?.throwIfAborted();
    const cwd = deps.workspaceRoot || process.cwd();
    const resolvedModel = deps.getResolvedModel?.() ?? deps.resolvedModel;
    const maxOutputTokens = resolvedModel.maxOutputTokens;
    const model = resolvedModel.model;
    const subOptions: Record<string, unknown> = {
      cwd,
      model,
      // No customTools: subagents must not recursively spawn sub-subagents,
      // and AskUserQuestion is reserved for the parent session.
    };
    if (
      profile.id === PiSubagentProfileId.Reviewer ||
      profile.id === PiSubagentProfileId.Planner ||
      profile.id === PiSubagentProfileId.Scout
    ) {
      subOptions.tools = ['read', 'grep', 'find', 'ls'];
    }
    const researcherUsesWebSearch =
      profile.id === PiSubagentProfileId.Researcher && Boolean(deps.webSearchSkillPath);
    const systemPrompt = researcherUsesWebSearch
      ? `${profile.systemPrompt}\n\nYou have an explicit retrieval capability. Before reporting a web claim, run the bundled web-search skill:\n` +
        `node "${path.join(deps.webSearchSkillPath || '', 'scripts', 'search.mjs')}" "<query>" 10\n` +
        'Open the returned primary sources where possible. Never substitute model memory for a retrieved citation.'
      : profile.systemPrompt;
    const resourceLoader = researcherUsesWebSearch
      ? await deps.createPiResourceLoader(cwd, systemPrompt, maxOutputTokens, [
          CoreSkillId.WebSearch,
        ])
      : await deps.createPiResourceLoader(cwd, systemPrompt, maxOutputTokens);
    subOptions.resourceLoader = resourceLoader;
    if (
      resourceLoader &&
      typeof resourceLoader === 'object' &&
      'settingsManager' in resourceLoader &&
      (resourceLoader as { settingsManager?: unknown }).settingsManager
    ) {
      const settingsManager = (resourceLoader as { settingsManager: PiSettingsManager })
        .settingsManager;
      subOptions.settingsManager = settingsManager;
    }
    if (resolvedModel.modelRuntime) {
      subOptions.modelRuntime = resolvedModel.modelRuntime;
    }

    const { session } = await pi.createAgentSession(subOptions);
    subSession = session;
    signal?.throwIfAborted();
    const result = await runPiSubagent(session, task, {
      signal,
    });
    const { output, ...execution } = result;
    return {
      ok: execution.terminationReason === PiSubagentTerminationReason.Settled,
      output,
      execution,
    };
  } catch (err) {
    return {
      ok: false,
      output: `Subagent "${profile.id}" failed: ${err instanceof Error ? err.message : String(err)}`,
      execution: {
        terminationReason: PiSubagentTerminationReason.Error,
        durationMs: Math.max(0, Date.now() - startedAt),
        assistantTurns: 0,
        toolCalls: 0,
      },
    };
  } finally {
    if (subSession) {
      try {
        await subSession.abort();
      } catch {
        // Ignore cleanup errors.
      }
    }
  }
}

/**
 * Run tasks with a concurrency cap. Workers never reject (failures are
 * captured per item), giving Promise.allSettled-style isolation: one failed
 * subagent never takes down the group.
 */
async function runWithConcurrency(
  specs: SubagentTaskSpec[],
  limit: number,
  worker: (spec: SubagentTaskSpec) => Promise<SubagentRunResult>,
): Promise<SubagentRunResult[]> {
  const results = new Array<SubagentRunResult>(specs.length);
  let nextIndex = 0;
  const runWorker = async (): Promise<void> => {
    while (nextIndex < specs.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = await worker(specs[index]);
      } catch (err) {
        results[index] = {
          ok: false,
          output: `Error: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, specs.length) }, () => runWorker()));
  return results;
}

// ── Parameter parsing ──

function parseTaskSpec(raw: unknown): SubagentTaskSpec | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const agent = typeof record.agent === 'string' ? record.agent.trim() : '';
  const task = typeof record.task === 'string' ? record.task.trim() : '';
  if (!agent || !task) {
    return null;
  }
  return { agent, task };
}

function parseTaskList(raw: unknown, modeName: string): SubagentTaskSpec[] | string {
  if (!Array.isArray(raw) || raw.length === 0) {
    return `"${modeName}" must be a non-empty array of {agent, task} entries.`;
  }
  const specs: SubagentTaskSpec[] = [];
  for (let index = 0; index < raw.length; index++) {
    const spec = parseTaskSpec(raw[index]);
    if (!spec) {
      return `"${modeName}" entry ${index + 1} requires non-empty "agent" and "task" strings.`;
    }
    specs.push(spec);
  }
  return specs;
}

// ── Tool factory ──

/**
 * Build the multi-mode `subagent` tool for a Pi cowork session.
 * Returns null only when no agent profiles can be resolved (never in practice,
 * since built-in profiles always exist).
 */
export function buildPiSubagentTool(deps: PiSubagentToolDeps): Record<string, unknown> | null {
  const profiles = resolveAgentProfiles(deps);
  if (profiles.length === 0) {
    return null;
  }

  const availableAgentIds = profiles.map(profile => profile.id).join(', ');
  const agentList = profiles.map(profile => `  - ${profile.id}: ${profile.description}`).join('\n');

  const textResult = (text: string, details: Record<string, unknown> = {}): SubagentToolResult => {
    if (text.length > PI_SUBAGENT_MAX_OUTPUT_CHARS) {
      const sliced = safeSlice(text, PI_SUBAGENT_MAX_OUTPUT_CHARS);
      const notice = `\n\n[Subagent output truncated to ${PI_SUBAGENT_MAX_OUTPUT_CHARS.toLocaleString()} characters (total: ${text.length.toLocaleString()} characters)]`;
      return {
        content: [{ type: 'text', text: `${sliced}${notice}` }],
        details: { ...details, truncated: true },
      };
    }
    return {
      content: [{ type: 'text', text }],
      details,
    };
  };

  const unknownAgentMessage = (agentId: string): string =>
    `Unknown agent "${agentId}". Available agents: ${availableAgentIds}`;

  const findProfile = (agentId: string): SubagentProfile | undefined =>
    profiles.find(profile => profile.id === agentId);

  const runSpec = async (
    spec: SubagentTaskSpec,
    signal?: AbortSignal,
  ): Promise<SubagentRunResult> => {
    const profile = findProfile(spec.agent);
    if (!profile) {
      return { ok: false, output: unknownAgentMessage(spec.agent) };
    }
    return runSubagent(deps, profile, spec.task, signal);
  };

  const executeSingle = async (
    spec: SubagentTaskSpec,
    signal?: AbortSignal,
  ): Promise<SubagentToolResult> => {
    const profile = findProfile(spec.agent);
    if (!profile) {
      return textResult(unknownAgentMessage(spec.agent));
    }
    const result = await runSubagent(deps, profile, spec.task, signal);
    signal?.throwIfAborted();
    return textResult(result.output, { agentId: spec.agent, execution: result.execution });
  };

  const executeParallel = async (
    specs: SubagentTaskSpec[],
    signal?: AbortSignal,
  ): Promise<SubagentToolResult> => {
    const results = await runWithConcurrency(specs, SUBAGENT_PARALLEL_LIMIT, spec =>
      runSpec(spec, signal),
    );
    signal?.throwIfAborted();
    const succeeded = results.filter(result => result.ok).length;
    const summary = results
      .map(
        (result, index) =>
          `## ${specs[index].agent} (${result.ok ? 'ok' : 'failed'})\n${result.output}`,
      )
      .join('\n\n');
    return textResult(`${succeeded}/${results.length} subagents succeeded.\n\n${summary}`, {
      mode: 'parallel',
      agentIds: specs.map(spec => spec.agent),
    });
  };

  return {
    name: PiSubagentToolName,
    label: 'Subagent',
    description:
      'Delegate tasks to focused subagents with isolated context.\n' +
      'Available agents:\n' +
      agentList +
      '\n\nModes (mutually exclusive):\n' +
      '- Single: {agent, task} — delegate one task to one agent.\n' +
      `- Parallel: {parallel: [{agent, task}, ...]} — run agents concurrently (max ${SUBAGENT_PARALLEL_LIMIT} at once).`,

    parameters: {
      type: 'object',
      properties: {
        agent: {
          type: 'string',
          description: `Agent to delegate to (single mode). Available: ${availableAgentIds}`,
        },
        task: {
          type: 'string',
          description:
            'Complete, self-contained task description with all necessary context (single mode).',
        },
        parallel: {
          type: 'array',
          description:
            'Parallel mode: independent {agent, task} entries run concurrently. ' +
            'One failing entry does not affect the others.',
          items: {
            type: 'object',
            properties: {
              agent: {
                type: 'string',
                description: `Agent to delegate to. Available: ${availableAgentIds}`,
              },
              task: { type: 'string', description: 'Complete, self-contained task description.' },
            },
            required: ['agent', 'task'],
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    },

    execute: async (
      _toolCallId: string,
      params: Record<string, unknown>,
      signal?: AbortSignal,
    ): Promise<SubagentToolResult> => {
      signal =
        deps.signal && signal ? AbortSignal.any([deps.signal, signal]) : (signal ?? deps.signal);
      signal?.throwIfAborted();
      const hasSingleParams = 'agent' in params || 'task' in params;
      const hasParallel = Array.isArray(params.parallel);
      const modeCount = [hasSingleParams, hasParallel].filter(Boolean).length;

      if (modeCount === 0) {
        return textResult('Provide exactly one mode: {agent, task} or {parallel: [...]}.');
      }
      if (modeCount > 1) {
        return textResult(
          'Subagent modes are mutually exclusive: use only one of {agent, task} or {parallel}.',
        );
      }

      if (hasSingleParams) {
        const agent = typeof params.agent === 'string' ? params.agent.trim() : '';
        const task = typeof params.task === 'string' ? params.task.trim() : '';
        if (!agent || !task) {
          return textResult('Both "agent" and "task" parameters are required.');
        }
        return executeSingle({ agent, task }, signal);
      }

      const specs = parseTaskList(params.parallel, 'parallel');
      if (typeof specs === 'string') {
        return textResult(specs);
      }
      return executeParallel(specs, signal);
    },
  };
}
