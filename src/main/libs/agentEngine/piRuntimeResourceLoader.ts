/**
 * Pi resource loader construction for the runtime adapter.
 *
 * Extracted from PiRuntimeAdapter: builds the per-session DefaultResourceLoader
 * with ZhiYuanAgent-owned skill roots, prompt overrides, and the tool-call
 * extensions (authorization, bash guardrails, plan mode, codemode, native MCP).
 */

import type { Skill, ToolAnnotations } from '@earendil-works/pi-coding-agent';

import { ScheduledTaskResultGuidance } from '../../../scheduledTask/enginePrompt';
import { captureMemoryPromptForE2e } from '../../memory/memoryPromptE2eCapture';
import {
  NATIVE_READ_ONLY_TOOLS,
  NATIVE_REVERSIBLE_TOOLS,
} from '../../workbenchTask/riskClassifier';
import { WorkbenchApprovalMode } from '../../../shared/workbenchTask';
import { buildPiLoadedMcpConfig, buildPiMcpTransportFactory } from './piMcpExtensionBridge';
import type { McpServerRecord } from '../../mcpStore';
import { getPiBashPythonEnvViolation } from './piBashToolGuidelines';
import { PiBuiltinFileToolName } from './piToolConstants';
import { PiPlanModePrompt } from './piPlanTool';
import { PiSkillRuntimeCapabilitiesToolName } from './piSkillRuntimeCapabilitiesTool';
import { PiSkillScriptToolName } from './piSkillScriptTool';
import {
  PiExtensionEventType,
  type PiBeforeAgentStartSystemPromptOptions,
  type PiExtensionApi,
  type PiExtensionFactory,
} from './piExtensionTypes';
import { getSkillsRoot } from '../coworkUtil';
import { createPiSettingsManager } from './piRuntimeSettingsOverrides';
import { resolveSelectedSkillDirs, resolveZhiyuanSkillDirs } from './piRuntimeSkillDirs';
import { collectPiSystemPromptContributions } from './piSystemPromptContributions';
import { createPiPromptOverrides } from './piPromptOverrides';
import type {
  PiModules,
  PiResourceLoader,
  PiResourceState,
  PiSettingsManager,
} from './piRuntimeSessionState';
import type { PiRuntimeAdapterHost } from './piRuntimeAdapterHost';
import { filterExpertMcpRecords } from './expertMcpFilter';
import { createPiEnterpriseProviderExtension } from '../../enterpriseExtension/piEnterpriseProviderExtension';
import { zhiyuanManagedProviderBridge } from '../../enterpriseExtension/managedProviderBridge';

export interface PiResourceLoaderApprovalContext {
  sessionId: string;
  getRunId: () => string | null;
  settingsManager?: PiSettingsManager | null;
  getApprovalMode: () => WorkbenchApprovalMode;
  /** True for ephemeral subagent sessions; skips parent turn memory/plan injection. */
  isSubagent?: boolean;
  /** Register the pi 1.0 codemode + tool_search extensions (work sessions). */
  enableCodemode?: boolean;
  /** Explicit MCP server IDs bound to the active session expert. */
  expertMcpIds?: string[];
}

/**
 * Preserves Pi's structured XML sections (<tools> and <rules>) when a custom
 * preamble (such as ZhiYuan product preamble) is provided. Without this, Pi's
 * buildSystemPromptSections omits <tools> and <rules> whenever customPrompt is set.
 */
export function ensureNativeSystemPromptSections(
  options: PiBeforeAgentStartSystemPromptOptions,
): void {
  if (!options.customPrompt) {
    return;
  }

  const selectedTools = options.selectedTools ?? [];
  const hiddenTools = options.hiddenTools ?? [];
  const toolSnippets = options.toolSnippets ?? {};
  const toolGuidelines = options.toolGuidelines ?? {};
  const promptGuidelines = options.promptGuidelines ?? [];

  const declaredTools = selectedTools.filter(name => !hiddenTools.includes(name));

  if (!options.sections.tools) {
    const visibleTools = declaredTools.filter(name => Boolean(toolSnippets[name]));
    options.sections.tools =
      visibleTools.length > 0
        ? `${visibleTools.map(name => `- ${name}: ${toolSnippets[name]}`).join('\n')}\n\nAdditional tools may be available.`
        : '(none)';
  }

  if (!options.sections.rules) {
    const rules: string[] = [];
    const seen = new Set<string>();
    const addRule = (rule: string) => {
      const normalized = rule.trim();
      if (!normalized || seen.has(normalized)) return;
      seen.add(normalized);
      rules.push(normalized);
    };

    const hasBash = declaredTools.includes('bash');
    const hasPowerShell = declaredTools.includes('powershell');
    const hasGrep = declaredTools.includes('grep');
    const hasFind = declaredTools.includes('find');
    const hasLs = declaredTools.includes('ls');

    if ((hasBash || hasPowerShell) && !hasGrep && !hasFind && !hasLs) {
      if (hasBash && hasPowerShell) {
        addRule(
          'Use bash or PowerShell for file operations like listing, searching, and finding files',
        );
      } else if (hasPowerShell) {
        addRule('Use PowerShell for file operations like listing, searching, and finding files');
      } else {
        addRule('Use bash for file operations like ls, rg, find');
      }
    }

    for (const name of declaredTools) {
      for (const rule of toolGuidelines[name] ?? []) {
        addRule(rule);
      }
    }

    for (const rule of promptGuidelines) {
      addRule(rule);
    }

    addRule('Be concise in your responses');
    addRule('Show file paths clearly when working with files');

    options.sections.rules = rules.map(rule => `- ${rule}`).join('\n');
  }
}

export async function createPiRuntimeResourceLoader(
  host: PiRuntimeAdapterHost,
  pi: PiModules,
  cwd: string,
  resourceState: PiResourceState,
  approvalContext?: PiResourceLoaderApprovalContext,
  additionalExtensionFactories: PiExtensionFactory[] = [],
): Promise<PiResourceLoader> {
  const settingsManager = approvalContext?.settingsManager ?? createPiSettingsManager(pi, cwd);
  const mcpSource = host.getMcpServerSource();
  let mcpRecords: McpServerRecord[] = [];
  type DiscoveredSkill = Skill & { id?: string };
  const matchesSkillId = (skill: DiscoveredSkill, ids: readonly string[]): boolean =>
    ids.includes(skill.id ?? '') || ids.includes(skill.name);
  let unselectedSkills: DiscoveredSkill[] = [];
  resourceState.describeQueuedSkills = skillIds =>
    pi
      .formatSkillsForPrompt(unselectedSkills.filter(skill => matchesSkillId(skill, skillIds)))
      .trim();
  const resourceLoader = new pi.DefaultResourceLoader({
    cwd,
    agentDir: pi.getAgentDir(),
    ...(settingsManager ? { settingsManager } : {}),
    // ZhiYuanAgent skills come exclusively from the app-managed SKILLs dirs —
    // never from the developer's global ~/.agents/skills (which would leak
    // dev-only tooling skills like ai-sdk/shadcn into user sessions).
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    // Work discovers the app-managed skill roots. Chat and isolated subagents
    // (`nativeToolsOnly`) only load explicitly selected skills and expert preset
    // roots, avoiding full bundled Skill enumeration and `<available_skills>` bloat.
    additionalSkillPaths: [
      ...(resourceState.chatMode || resourceState.nativeToolsOnly
        ? resolveSelectedSkillDirs(resourceState.skillIds)
        : resolveZhiyuanSkillDirs()),
      ...resourceState.expertSkillDirs,
    ],
    skillsOverride: (base: { skills: DiscoveredSkill[]; diagnostics: unknown[] }) => {
      const selected = resourceState.skillIds;
      unselectedSkills = selected
        ? base.skills.filter(skill => !matchesSkillId(skill, selected))
        : [];
      return selected
        ? { ...base, skills: base.skills.filter(skill => matchesSkillId(skill, selected)) }
        : base;
    },
    ...createPiPromptOverrides(resourceState, () =>
      collectPiSystemPromptContributions({
        chatMode: resourceState.chatMode,
        nativeToolsOnly: resourceState.nativeToolsOnly,
        fileToolsEnabled: resourceState.fileToolsEnabled,
        maxOutputTokens: resourceState.maxOutputTokens,
        unattended: resourceState.unattended,
      }),
    ),
    extensionFactories: [
      (extensionApi: PiExtensionApi) => {
        extensionApi.on(PiExtensionEventType.BeforeAgentStart, event => {
          ensureNativeSystemPromptSections(event.systemPromptOptions);
        });
      },
      (extensionApi: PiExtensionApi) => {
        extensionApi.on(PiExtensionEventType.ToolCall, event => {
          if (
            (event.toolName !== PiBuiltinFileToolName.Bash &&
              event.toolName !== PiBuiltinFileToolName.PowerShell) ||
            !event.input ||
            typeof event.input !== 'object'
          ) {
            return undefined;
          }
          const command = (event.input as Record<string, unknown>).command;
          if (typeof command !== 'string') return undefined;
          const reason = getPiBashPythonEnvViolation(command, getSkillsRoot());
          return reason ? { block: true as const, reason } : undefined;
        });
      },
      (extensionApi: PiExtensionApi) => {
        extensionApi.on(PiExtensionEventType.ToolCall, event => {
          const planSessionId = approvalContext?.sessionId;
          if (!planSessionId) return undefined;
          const active = host.activeSessions.get(planSessionId);
          if (active?.planMode !== true) return undefined;
          if (
            event.toolName === PiBuiltinFileToolName.Bash ||
            event.toolName === PiBuiltinFileToolName.PowerShell
          ) {
            return {
              block: true as const,
              reason:
                'Plan mode is read-only: shell commands (bash/powershell) are refused because they can modify the workspace. ' +
                'Use read-only tools, publish the plan with plan_write, and end the turn before implementing.',
            };
          }
          if (NATIVE_REVERSIBLE_TOOLS.has(event.toolName)) {
            return {
              block: true as const,
              reason:
                'Plan mode is read-only: workspace-mutating tools are refused for this turn. ' +
                'Publish the plan with plan_write and end the turn before implementing.',
            };
          }
          const toolDef = (
            active?.piSession as
              | { getToolDefinition?: (name: string) => { annotations?: ToolAnnotations } }
              | undefined
          )?.getToolDefinition?.(event.toolName);
          const isReadOnly =
            toolDef?.annotations?.readOnlyHint === true ||
            NATIVE_READ_ONLY_TOOLS.has(event.toolName);
          if (!isReadOnly) {
            return {
              block: true as const,
              reason:
                'Plan mode is read-only: workspace-mutating tools are refused for this turn. ' +
                'Publish the plan with plan_write and end the turn before implementing.',
            };
          }
          return undefined;
        });
      },
      ...(approvalContext
        ? [
            (extensionApi: PiExtensionApi) => {
              extensionApi.on(PiExtensionEventType.BeforeAgentStart, event => {
                const active = host.activeSessions.get(approvalContext.sessionId);
                if (!active) return undefined;

                if (active.scheduledTaskRun) {
                  event.systemPromptOptions.sections.scheduled_task_result =
                    ScheduledTaskResultGuidance;
                } else {
                  delete event.systemPromptOptions.sections.scheduled_task_result;
                }

                // Never mutate systemPromptOptions.sections for turn-scoped plan mode
                // or memory so message 0 stays immutable for upstream KV caching.
                delete event.systemPromptOptions.sections.plan_mode;
                delete event.systemPromptOptions.sections.project_memory;

                if (approvalContext.isSubagent) return undefined;

                const hasSelectableSkills =
                  resourceState.skillIds === undefined || resourceState.skillIds.length > 0;
                if (
                  hasSelectableSkills &&
                  resourceState.fileToolsEnabled &&
                  !resourceState.chatMode &&
                  Array.isArray(event.systemPromptOptions.selectedTools)
                ) {
                  for (const skillToolName of [
                    PiSkillScriptToolName,
                    PiSkillRuntimeCapabilitiesToolName,
                  ]) {
                    if (!event.systemPromptOptions.selectedTools.includes(skillToolName)) {
                      event.systemPromptOptions.selectedTools.push(skillToolName);
                    }
                  }
                }

                // Native preflight compaction may have opened a new context window.
                const { sessionId } = approvalContext;
                const pending = active.pendingTurnMemory;
                active.pendingTurnMemory = undefined;
                const memoryDelta = resourceState.chatMode
                  ? null
                  : host.memoryInjectionDedup.takeDelta(sessionId, pending?.context ?? '');
                if (pending) {
                  captureMemoryPromptForE2e({
                    sessionId,
                    userPrompt: pending.userPrompt,
                    memoryContext: memoryDelta,
                    initialPrompt: pending.userPrompt,
                  });
                }

                const turnContextParts: string[] = [];
                if (active.planMode === true) turnContextParts.push(PiPlanModePrompt);
                if (memoryDelta) turnContextParts.push(memoryDelta);
                if (turnContextParts.length === 0) return undefined;

                return {
                  message: {
                    customType:
                      active.planMode === true && memoryDelta
                        ? 'turn_context'
                        : active.planMode === true
                          ? 'plan_mode'
                          : 'project_memory',
                    content: turnContextParts.join('\n\n'),
                    display: false,
                  },
                };
              });

              extensionApi.on(PiExtensionEventType.ToolCall, async event => {
                const runId = approvalContext.getRunId();
                const toolInput =
                  event.input && typeof event.input === 'object'
                    ? (event.input as Record<string, unknown>)
                    : {};
                const active = host.activeSessions.get(approvalContext.sessionId);
                const toolDef = (
                  active?.piSession as
                    | { getToolDefinition?: (name: string) => { annotations?: ToolAnnotations } }
                    | undefined
                )?.getToolDefinition?.(event.toolName);
                const authorization = await host.authorizeToolCall({
                  sessionId: approvalContext.sessionId,
                  runId,
                  toolCallId: event.toolCallId,
                  toolName: event.toolName,
                  toolInput,
                  approvalMode: approvalContext.getApprovalMode(),
                  annotations: toolDef?.annotations,
                });
                if (authorization.allow) return undefined;
                return {
                  block: true as const,
                  reason: authorization.reason || 'The action was not approved.',
                };
              });
            },
          ]
        : []),
      // Work sessions register codemode + tool_search dormantly so both explicit
      // codemode activation (`+codemode`) and Pi's native MCP exposures can use them.
      ...(!resourceState.chatMode &&
      resourceState.nativeToolsOnly !== true &&
      pi.createCodemodeExtension &&
      pi.createToolSearchExtension
        ? [pi.createCodemodeExtension(), pi.createToolSearchExtension()]
        : []),
      ...(!resourceState.chatMode &&
      resourceState.nativeToolsOnly !== true &&
      pi.createMcpExtension &&
      mcpSource
        ? [
            pi.createMcpExtension({
              loadConfig: () => {
                mcpRecords = filterExpertMcpRecords(
                  mcpSource.listEnabled(),
                  approvalContext?.expertMcpIds,
                );
                return buildPiLoadedMcpConfig(mcpRecords);
              },
              createTransport: buildPiMcpTransportFactory(
                () => mcpRecords,
                mcpSource.refreshOAuthRecord,
              ),
            }),
          ]
        : []),
      createPiEnterpriseProviderExtension(zhiyuanManagedProviderBridge),
      ...additionalExtensionFactories,
    ],
  });
  await resourceLoader.reload();
  if (settingsManager) {
    resourceLoader.settingsManager = settingsManager;
  }
  return resourceLoader;
}
