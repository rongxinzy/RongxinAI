import {
  defineExtension,
  hook,
  section,
  ToolTask,
  type Extension,
} from '@earendil-works/pi-durable';
import { NATIVE_READ_ONLY_TOOLS } from '../../workbenchTask/riskClassifier';
import { getSkillsRoot } from '../coworkUtil';
import { getPiBashPythonEnvViolation } from './piBashToolGuidelines';
import { PiPlanModePrompt } from './piPlanTool';
import type { PiRuntimeAdapterHost } from './piRuntimeAdapterHost';
import type { PiResourceLoaderApprovalContext } from './piRuntimeResourceLoader';
import type { ToolAnnotations } from './durableToolTypes';

export function createDurableResourcePolicy(
  host: PiRuntimeAdapterHost,
  approval: PiResourceLoaderApprovalContext | undefined,
): Extension {
  const active = () => (approval ? host.activeSessions.get(approval.sessionId) : undefined);
  const annotations = (name: string): ToolAnnotations | undefined => {
    const session = active()?.piSession as
      | { getToolDefinition?(toolName: string): { annotations?: ToolAnnotations } | undefined }
      | undefined;
    return session?.getToolDefinition?.(name)?.annotations;
  };
  return defineExtension({
    name: 'zhiyuan.resource-policy',
    sections: [
      section('plan_mode', () => (active()?.planMode === true ? PiPlanModePrompt : undefined)),
    ],
    hooks: [
      hook(ToolTask, {
        beforeTool: async call => {
          const shell = call.name === 'bash' || call.name === 'powershell';
          if (shell && typeof call.arguments.command === 'string') {
            const reason = getPiBashPythonEnvViolation(call.arguments.command, getSkillsRoot());
            if (reason) return { block: reason };
          }
          const hints = annotations(call.name);
          if (
            active()?.planMode === true &&
            (shell || (!NATIVE_READ_ONLY_TOOLS.has(call.name) && hints?.readOnlyHint !== true))
          )
            return {
              block:
                'Plan mode is read-only. Use read-only tools, publish the plan with plan_write, and end the turn before implementing.',
            };
          if (!approval) return undefined;
          const decision = await host.authorizeToolCall({
            sessionId: approval.sessionId,
            runId: approval.getRunId(),
            toolCallId: call.id,
            toolName: call.name,
            toolInput: call.arguments,
            approvalMode: approval.getApprovalMode(),
            annotations: hints,
          });
          return decision.allow
            ? undefined
            : { block: decision.reason || 'The action was not approved.' };
        },
      }),
    ],
  });
}
