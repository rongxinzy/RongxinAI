/**
 * Pi resource loader construction for the runtime adapter.
 *
 * Extracted from PiRuntimeAdapter: builds the per-session DefaultResourceLoader
 * with ZhiYuanAgent-owned skill roots, prompt overrides, and the tool-call
 * extensions (authorization, bash guardrails, plan mode, codemode, native MCP).
 */

import { WorkbenchApprovalMode } from '../../../shared/workbenchTask';
import { buildPiLoadedMcpConfig, buildPiMcpTransportFactory } from './piMcpExtensionBridge';
import { getPiBashPythonEnvViolation } from './piBashToolGuidelines';
import { PiBuiltinFileToolName } from './piToolConstants';
import { PiPlanModePrompt, isPlanModeBlockedTool } from './piPlanTool';
import {
  PiExtensionEventType,
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

export interface PiResourceLoaderApprovalContext {
  sessionId: string;
  getRunId: () => string | null;
  settingsManager?: PiSettingsManager | null;
  getApprovalMode: () => WorkbenchApprovalMode;
  /** Register the pi 1.0 codemode + tool_search extensions (work sessions). */
  enableCodemode?: boolean;
  /** Explicit MCP server IDs bound to the active session expert. */
  expertMcpIds?: string[];
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
    skillsOverride: (base: {
      skills: Array<{ name?: string; id?: string }>;
      diagnostics: unknown[];
    }) =>
      resourceState.skillIds === undefined
        ? base
        : {
            ...base,
            skills: base.skills.filter(
              skill =>
                resourceState.skillIds?.includes(skill.id || '') ||
                resourceState.skillIds?.includes(skill.name || ''),
            ),
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
          if (host.activeSessions.get(planSessionId)?.planMode !== true) return undefined;
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
          return isPlanModeBlockedTool(event.toolName)
            ? {
                block: true as const,
                reason:
                  'Plan mode is read-only: workspace-mutating tools are refused for this turn. ' +
                  'Publish the plan with plan_write and end the turn before implementing.',
              }
            : undefined;
        });
      },
      ...(approvalContext
        ? [
            (extensionApi: PiExtensionApi) => {
              extensionApi.on(PiExtensionEventType.BeforeAgentStart, event => {
                const active = host.activeSessions.get(approvalContext.sessionId);
                if (!active) return;

                if (active.planMode === true) {
                  event.systemPromptOptions.sections.plan_mode = PiPlanModePrompt;
                } else {
                  delete event.systemPromptOptions.sections.plan_mode;
                }

                const turnMemory = active.pendingTurnMemoryContext?.trim();
                active.pendingTurnMemoryContext = null;
                if (turnMemory) {
                  (active.injectedProjectMemorySections ??= []).push(turnMemory);
                }
                if (active.injectedProjectMemorySections?.length) {
                  event.systemPromptOptions.sections.project_memory =
                    active.injectedProjectMemorySections.join('\n\n');
                } else {
                  delete event.systemPromptOptions.sections.project_memory;
                }
              });

              extensionApi.on(PiExtensionEventType.ToolCall, async event => {
                const runId = approvalContext.getRunId();
                const toolInput =
                  event.input && typeof event.input === 'object'
                    ? (event.input as Record<string, unknown>)
                    : {};
                const authorization = await host.authorizeToolCall({
                  sessionId: approvalContext.sessionId,
                  runId,
                  toolCallId: event.toolCallId,
                  toolName: event.toolName,
                  toolInput,
                  approvalMode: approvalContext.getApprovalMode(),
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
      host.getMcpServerManager()
        ? [
            pi.createMcpExtension({
              loadConfig: () =>
                buildPiLoadedMcpConfig(
                  filterExpertMcpRecords(
                    host.getMcpServerManager()?.lastEnabledRecords ?? [],
                    approvalContext?.expertMcpIds,
                  ),
                ),
              createTransport: buildPiMcpTransportFactory(() =>
                filterExpertMcpRecords(
                  host.getMcpServerManager()?.lastEnabledRecords ?? [],
                  approvalContext?.expertMcpIds,
                ),
              ),
            }),
          ]
        : []),
      ...additionalExtensionFactories,
    ],
  });
  await resourceLoader.reload();
  if (settingsManager) {
    resourceLoader.settingsManager = settingsManager;
  }
  return resourceLoader;
}
