/**
 * Approval guard for SoL-Pi Action Fusion `then_run` commands.
 *
 * Action Fusion fuses `edit`/`write` with a follow-up bash command. The fused
 * command is executed inside the tool (a direct bash definition call), so it
 * never surfaces as a model-initiated `bash` tool call and would bypass the
 * app's approval pipeline and command safety checks entirely.
 *
 * This guard intercepts the fused `edit`/`write` tool call (which IS visible
 * as a `tool_call` event, with `input.then_run` present) and routes the
 * embedded command through the same authorization used for `bash` calls.
 * When the command is not approved, the whole fused call is blocked BEFORE
 * the file mutation runs — the write is never replayed against a denied
 * command. This is a deliberate, stricter-than-upstream deviation: upstream
 * always applies the edit first; here a denied command means neither the
 * edit nor the command executes.
 */
import {
  PiExtensionEventType,
  type PiExtensionFactory,
  type PiToolCallEvent,
  type PiToolCallEventResult,
} from '../agentEngine/piExtensionTypes';

export const SolPiFusedToolName = {
  Edit: 'edit',
  Write: 'write',
} as const;
export type SolPiFusedToolName = (typeof SolPiFusedToolName)[keyof typeof SolPiFusedToolName];

export const SOLPI_FUSED_TOOLS: readonly string[] = [
  SolPiFusedToolName.Edit,
  SolPiFusedToolName.Write,
];

export const SOLPI_THEN_RUN_FIELD = 'then_run';

export interface SolPiThenRunCommand {
  command: string;
  timeout?: number;
}

export interface SolPiThenRunAuthorization {
  allow: boolean;
  reason?: string;
}

/** Context the app needs to route the embedded command through approvals. */
export interface SolPiThenRunAuthorizationContext {
  toolCallId: string;
}

/** Extract and validate `then_run` from a fused edit/write tool call input. */
export function extractThenRunCommand(
  toolName: string,
  input: unknown,
): { status: 'absent' } | { status: 'malformed'; reason: string } | { status: 'present'; thenRun: SolPiThenRunCommand } {
  if (!SOLPI_FUSED_TOOLS.includes(toolName)) return { status: 'absent' };
  if (!input || typeof input !== 'object' || !(SOLPI_THEN_RUN_FIELD in input)) {
    return { status: 'absent' };
  }
  const raw = (input as Record<string, unknown>)[SOLPI_THEN_RUN_FIELD];
  if (raw === undefined || raw === null) return { status: 'absent' };
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { status: 'malformed', reason: 'then_run must be an object with a command string.' };
  }
  const record = raw as Record<string, unknown>;
  if (typeof record.command !== 'string' || record.command.trim().length === 0) {
    return { status: 'malformed', reason: 'then_run.command must be a non-empty string.' };
  }
  if (record.timeout !== undefined && typeof record.timeout !== 'number') {
    return { status: 'malformed', reason: 'then_run.timeout must be a number of seconds.' };
  }
  return {
    status: 'present',
    thenRun: { command: record.command, timeout: record.timeout as number | undefined },
  };
}

/**
 * Build the guard extension factory. `authorize` must apply the app's bash
 * command safety and workbench approval checks to the embedded command.
 */
export function createSolPiThenRunGuardExtensionFactory(
  authorize: (
    thenRun: SolPiThenRunCommand,
    context: SolPiThenRunAuthorizationContext,
  ) => Promise<SolPiThenRunAuthorization>,
): PiExtensionFactory {
  return extensionApi => {
    extensionApi.on(PiExtensionEventType.ToolCall, async (event: PiToolCallEvent) => {
      const extracted = extractThenRunCommand(event.toolName, event.input);
      if (extracted.status === 'absent') return undefined;
      if (extracted.status === 'malformed') {
        return { block: true, reason: extracted.reason };
      }
      const authorization = await authorize(extracted.thenRun, { toolCallId: event.toolCallId });
      const result: PiToolCallEventResult | undefined = authorization.allow
        ? undefined
        : {
            block: true,
            reason:
              authorization.reason ||
              'The follow-up command of this fused edit/write call was not approved.',
          };
      return result;
    });
  };
}
