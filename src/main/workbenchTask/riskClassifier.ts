import { createHash } from 'crypto';

import { WorkbenchApprovalRiskLevel } from '../../shared/workbenchTask';

const readOnlyTools = new Set(['read', 'grep', 'find', 'ls']);
const internalControlTools = new Set([
  'askuserquestion',
  'agent_loop',
  'work_acceptance',
  'workflow_state',
  'research_state',
]);
const reversibleTools = new Set(['write', 'edit']);
const irreversibleShellPattern =
  /(?:\brm\b|\brmdir\b|\bdel\b|\bremove-item\b|\bformat\b|\bshutdown\b|\bgit\s+push\b|\bgit\s+reset\s+--hard\b|\bdrop\s+(?:table|database)\b)/i;
const safeShellCommandPattern =
  /^(?:\s*(?:cd\s+[^;&|]+\s*&&\s*)?(?:pwd|ls(?:\s+[-\w./]+)?|find\s+[-\w./'"\s]+|grep\s+[-\w./'"\s]+|rg\s+[-\w./'"\s]+|python(?:3)?\s+--version|node\s+--version)\s*)$/i;

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, stableValue(child)]),
    );
  }
  return value;
};

export function classifyWorkbenchToolRisk(
  toolName: string,
  input: Record<string, unknown>,
): WorkbenchApprovalRiskLevel {
  const normalizedName = toolName.trim().toLowerCase();
  if (readOnlyTools.has(normalizedName) || internalControlTools.has(normalizedName)) {
    return WorkbenchApprovalRiskLevel.ReadOnly;
  }
  if (reversibleTools.has(normalizedName)) return WorkbenchApprovalRiskLevel.Reversible;
  if (normalizedName === 'bash' || normalizedName === 'shell') {
    const command = typeof input.command === 'string' ? input.command : JSON.stringify(input);
    return irreversibleShellPattern.test(command)
      ? WorkbenchApprovalRiskLevel.Irreversible
      : WorkbenchApprovalRiskLevel.Unknown;
  }
  return WorkbenchApprovalRiskLevel.Unknown;
}

export function isSafeShellCommand(command: string): boolean {
  return safeShellCommandPattern.test(command.trim()) && !irreversibleShellPattern.test(command);
}

export function createToolIdempotencyKey(
  runId: string,
  toolCallId: string,
  input: Record<string, unknown>,
): string {
  const hash = createHash('sha256')
    .update(JSON.stringify(stableValue(input)))
    .digest('hex');
  return `${runId}:${toolCallId}:${hash}`;
}
