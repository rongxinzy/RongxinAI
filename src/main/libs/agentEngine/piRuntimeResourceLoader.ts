/**
 * Pi resource loader construction for the runtime adapter.
 *
 * Extracted from PiRuntimeAdapter: builds the per-session DefaultResourceLoader
 * with ZhiYuanAgent-owned skill roots, prompt overrides, and the tool-call
 * extensions (workbench authorization, bash guardrails, plan mode, codemode,
 * native MCP). Also exposes the single MCP gateway proxy tool used when the
 * native MCP extension is disabled.
 */

import { WorkbenchApprovalMode } from '../../../shared/workbenchTask';
import { buildPiLoadedMcpConfig, buildPiMcpTransportFactory } from './piMcpExtensionBridge';
import { getPiBashCommandViolation, normalizePiBashTimeoutSeconds } from './piBashToolGuidelines';
import { PiBuiltinFileToolName } from './piWriteTokenLimit';
import { McpPiAdapter } from './mcpPiAdapter';
import { isPlanModeBlockedTool } from './piPlanTool';
import {
  PiExtensionEventType,
  type PiExtensionApi,
  type PiExtensionFactory,
} from './piExtensionTypes';
import { getSkillsRoot } from '../coworkUtil';
import type { McpServerManager } from '../mcpServerManager';
import { createPiSettingsManager, applyPiShellOverride } from './piRuntimeSettingsOverrides';
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

export interface PiResourceLoaderApprovalContext {
  sessionId: string;
  getRunId: () => string | null;
  settingsManager?: PiSettingsManager | null;
  getApprovalMode: () => WorkbenchApprovalMode;
  /** Register the pi 1.0 codemode + tool_search extensions (work sessions). */
  enableCodemode?: boolean;
  /** Register pi's builtin MCP extension, replacing the gateway tool. */
  enableMcpNative?: boolean;
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
    // Work discovers the app-managed skill roots. Chat only loads explicitly
    // selected skills and expert preset roots, so a plain conversation does
    // not scan the full bundled Skill tree during startup.
    additionalSkillPaths: [
      ...(resourceState.chatMode
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
        fileToolsEnabled: resourceState.fileToolsEnabled,
        maxOutputTokens: resourceState.maxOutputTokens,
        platform: process.platform,
        unattended: resourceState.unattended,
        mcpToolManifest: resourceState.chatMode
          ? []
          : (host.getMcpServerManager()?.toolManifest ?? []),
        mcpServerStatuses: resourceState.chatMode
          ? []
          : (host.getMcpServerManager()?.serverStatuses ?? []),
        codemodeEnabled: approvalContext?.enableCodemode === true,
        mcpNativeBridge: approvalContext?.enableMcpNative === true,
      }),
    ),
    extensionFactories: [
      ...(approvalContext?.getRunId()
        ? [
            (extensionApi: PiExtensionApi) => {
              extensionApi.on(PiExtensionEventType.ToolCall, async event => {
                const runId = approvalContext.getRunId();
                if (!runId) {
                  return {
                    block: true as const,
                    reason: 'No active workbench run is available.',
                  };
                }
                const toolInput =
                  event.input && typeof event.input === 'object'
                    ? (event.input as Record<string, unknown>)
                    : {};
                const authorization = await host.getWorkbenchTaskService()?.authorizeToolCall({
                  sessionId: approvalContext.sessionId,
                  runId,
                  toolCallId: event.toolCallId,
                  toolName: event.toolName,
                  toolInput,
                  approvalMode: approvalContext.getApprovalMode(),
                });
                if (!authorization) return undefined;
                if (authorization.allow) return undefined;
                if (authorization.terminateRun) {
                  // The run cannot continue: end the turn with a visible error
                  // instead of returning another tool error the model would
                  // answer with yet another tool call.
                  host.recovery.endTerminatedWorkbenchTurn(
                    approvalContext.sessionId,
                    authorization.reason ?? 'The workbench run can no longer continue.',
                  );
                }
                return {
                  block: true as const,
                  reason: authorization.reason || 'The action was not approved.',
                };
              });
            },
          ]
        : []),
      (extensionApi: PiExtensionApi) => {
        extensionApi.on(PiExtensionEventType.ToolCall, event => {
          if (
            event.toolName !== PiBuiltinFileToolName.Bash ||
            !event.input ||
            typeof event.input !== 'object'
          ) {
            return undefined;
          }
          const input = event.input as Record<string, unknown>;
          input.timeout = normalizePiBashTimeoutSeconds(input.timeout);
          const command = (event.input as Record<string, unknown>).command;
          if (typeof command !== 'string') return undefined;
          const reason = getPiBashCommandViolation(command, process.platform, getSkillsRoot());
          return reason ? { block: true as const, reason } : undefined;
        });
      },
      (extensionApi: PiExtensionApi) => {
        extensionApi.on(PiExtensionEventType.ToolCall, event => {
          const planSessionId = approvalContext?.sessionId;
          if (!planSessionId) return undefined;
          if (host.activeSessions.get(planSessionId)?.planMode !== true) return undefined;
          if (event.toolName === PiBuiltinFileToolName.Bash) {
            return {
              block: true as const,
              reason:
                'Plan mode is read-only: bash is refused because shell commands can modify the workspace. ' +
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
      // Codemode lets the model orchestrate parallel tool calls from a
      // QuickJS sandbox; both extensions register inactive and are activated
      // through the defaultTools override next to the compaction settings.
      ...(approvalContext?.enableCodemode &&
      pi.createCodemodeExtension &&
      pi.createToolSearchExtension
        ? [pi.createCodemodeExtension(), pi.createToolSearchExtension()]
        : []),
      ...(approvalContext?.enableMcpNative && pi.createMcpExtension && host.getMcpServerManager()
        ? [
            pi.createMcpExtension({
              loadConfig: () =>
                buildPiLoadedMcpConfig(host.getMcpServerManager()?.lastEnabledRecords ?? []),
              createTransport: buildPiMcpTransportFactory(
                () => host.getMcpServerManager()?.lastEnabledRecords ?? [],
              ),
            }),
          ]
        : []),
      ...additionalExtensionFactories,
    ],
  });
  await resourceLoader.reload();
  // Pi's resource reload refreshes settings from disk, so apply the resolved
  // per-process shell override after reload and share the same manager with
  // createAgentSession. This makes bundled PortableGit usable by every Pi
  // session without changing the user's global Pi settings file.
  applyPiShellOverride(settingsManager);
  resourceLoader.settingsManager = settingsManager;
  return resourceLoader;
}

/**
 * Build a single MCP proxy tool (pi-mcp-adapter pattern) instead of
 * registering every MCP tool as an individual customTool.
 *
 * One proxy tool costs ~200 system-prompt tokens regardless of how many
 * MCP servers/tools are configured, vs N × ~200 tokens for per-tool
 * registration. Uses ZhiYuanAgent's McpServerManager for tool execution
 * rather than creating duplicate MCP connections.
 */
export function buildPiMcpProxyTool(
  mcpServerManager: McpServerManager | null,
): Record<string, unknown> | null {
  if (!mcpServerManager) return null;
  return new McpPiAdapter(mcpServerManager).buildGatewayTool();
}
