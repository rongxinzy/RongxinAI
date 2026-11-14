/** Delegation uses child conversations owned by the current native tool task. */
import path from 'node:path';
import { subagentParameters } from './piSubagentParameters';
import type { ToolAnnotations, ToolDefinition } from './durableToolTypes';
import { executeDurableSubagent } from './durableSubagent.mjs';
import { safeSlice } from '../../../shared/lib/safeSlice';
import { PiSubagentToolName } from './piSubagentConstants';
import type { PiSubagentExecutionMetadata, PiSubagentChildToolEvent } from './piSubagentConstants';
import {
  resolveAgentProfiles,
  type SubagentProfile,
  type PiSubagentProfileSource,
} from './piSubagentProfiles';
export { PiSubagentToolName } from './piSubagentConstants';
export const PiSubagentToolAnnotations: ToolAnnotations = {
  readOnlyHint: true,
  idempotentHint: true,
  openWorldHint: false,
};
export const SUBAGENT_PARALLEL_LIMIT = 4;
export const PI_SUBAGENT_MAX_OUTPUT_CHARS = 30_000;
export interface PiSubagentToolDeps extends PiSubagentProfileSource {
  signal?: AbortSignal;
  webSearchSkillPath?: string;
  onChildToolActivity?: (event: PiSubagentChildToolEvent) => void;
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
  isError?: boolean;
}
// ── Sub-session execution ──

/** Run a single subagent profile on a task in an isolated Pi sub-session. */
async function runSubagent(
  deps: PiSubagentToolDeps,
  profile: SubagentProfile,
  task: string,
  signal?: AbortSignal,
  key = 'single',
  parentToolCallId?: string,
): Promise<SubagentRunResult> {
  try {
    const child =
      profile.id === 'researcher' && deps.webSearchSkillPath
        ? {
            ...profile,
            systemPrompt: `${profile.systemPrompt}\nUse node ${path.join(deps.webSearchSkillPath, 'scripts', 'search.mjs')} for web search.`,
          }
        : profile;
    return await executeDurableSubagent({
      profile: child,
      task,
      key,
      signal,
      parentToolCallId,
      onChildToolActivity: deps.onChildToolActivity,
    });
  } catch (error) {
    signal?.throwIfAborted();
    return {
      ok: false,
      output: 'Error: ' + (error instanceof Error ? error.message : String(error)),
    };
  }
}

// ── Parameter parsing ──

async function runWithConcurrency(
  specs: SubagentTaskSpec[],
  limit: number,
  worker: (spec: SubagentTaskSpec, index: number) => Promise<SubagentRunResult>,
): Promise<SubagentRunResult[]> {
  const results = new Array<SubagentRunResult>(specs.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, specs.length) }, async () => {
      while (cursor < specs.length) {
        const index = cursor++;
        try {
          results[index] = await worker(specs[index], index);
        } catch (error) {
          results[index] = { ok: false, output: String(error) };
        }
      }
    }),
  );
  return results;
}

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
export function buildPiSubagentTool(deps: PiSubagentToolDeps): ToolDefinition | null {
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
  const errorResult = (text: string): SubagentToolResult => ({
    ...textResult(text),
    isError: true,
  });

  const findProfile = (agentId: string): SubagentProfile | undefined =>
    profiles.find(profile => profile.id === agentId);

  const runSpec = async (
    spec: SubagentTaskSpec,
    signal?: AbortSignal,
    key = 'single',
    parentToolCallId?: string,
  ): Promise<SubagentRunResult> => {
    const profile = findProfile(spec.agent);
    if (!profile) {
      return { ok: false, output: unknownAgentMessage(spec.agent) };
    }
    return runSubagent(deps, profile, spec.task, signal, key, parentToolCallId);
  };

  const executeSingle = async (
    spec: SubagentTaskSpec,
    signal?: AbortSignal,
    key = 'single',
    parentToolCallId?: string,
  ): Promise<SubagentToolResult> => {
    const profile = findProfile(spec.agent);
    if (!profile) {
      return errorResult(unknownAgentMessage(spec.agent));
    }
    const result = await runSubagent(deps, profile, spec.task, signal, key, parentToolCallId);
    signal?.throwIfAborted();
    return {
      ...textResult(result.output, { agentId: spec.agent, execution: result.execution }),
      isError: !result.ok,
    };
  };

  const executeParallel = async (
    specs: SubagentTaskSpec[],
    signal?: AbortSignal,
    parentToolCallId?: string,
  ): Promise<SubagentToolResult> => {
    const results = await runWithConcurrency(specs, SUBAGENT_PARALLEL_LIMIT, (spec, index) =>
      runSpec(spec, signal, `parallel:${index}`, parentToolCallId),
    );
    signal?.throwIfAborted();
    const succeeded = results.filter(result => result.ok).length;
    const summary = results
      .map(
        (result, index) =>
          `## ${specs[index].agent} (${result.ok ? 'ok' : 'failed'})\n${result.output}`,
      )
      .join('\n\n');
    return {
      ...textResult(`${succeeded}/${results.length} subagents succeeded.\n\n${summary}`, {
        mode: 'parallel',
        agentIds: specs.map(spec => spec.agent),
      }),
      isError: succeeded !== results.length,
    };
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
    annotations: PiSubagentToolAnnotations,

    parameters: subagentParameters,

    execute: async (
      toolCallId: string,
      rawParams: unknown,
      signal?: AbortSignal,
    ): Promise<SubagentToolResult> => {
      const params =
        rawParams && typeof rawParams === 'object' && !Array.isArray(rawParams)
          ? (rawParams as Record<string, unknown>)
          : {};
      signal =
        deps.signal && signal ? AbortSignal.any([deps.signal, signal]) : (signal ?? deps.signal);
      signal?.throwIfAborted();
      const hasSingleParams = 'agent' in params || 'task' in params;
      const hasParallel = Array.isArray(params.parallel);
      const modeCount = [hasSingleParams, hasParallel].filter(Boolean).length;

      if (modeCount === 0) {
        return errorResult('Provide exactly one mode: {agent, task} or {parallel: [...]}.');
      }
      if (modeCount > 1) {
        return errorResult(
          'Subagent modes are mutually exclusive: use only one of {agent, task} or {parallel}.',
        );
      }

      if (hasSingleParams) {
        const agent = typeof params.agent === 'string' ? params.agent.trim() : '';
        const task = typeof params.task === 'string' ? params.task.trim() : '';
        if (!agent || !task) {
          return errorResult('Both "agent" and "task" parameters are required.');
        }
        return executeSingle({ agent, task }, signal, 'single', toolCallId);
      }

      const specs = parseTaskList(params.parallel, 'parallel');
      if (typeof specs === 'string') {
        return errorResult(specs);
      }
      return executeParallel(specs, signal, toolCallId);
    },
  };
}
