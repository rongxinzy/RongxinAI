/**
 * Workbench contract derivation for Pi sessions.
 *
 * Extracted from PiRuntimeAdapter: maps the requested Cowork session mode and
 * the turn's skill set onto the WorkbenchTaskContract kind (Chat, Research,
 * Shortcut, GenericWork).
 */

import { CoworkSessionMode } from '../../../shared/cowork/constants';
import { WorkbenchContractKind, type WorkbenchTaskContract } from '../../../shared/workbenchTask';
/** Goal mode expresses intent; Pi owns tool turns, compaction and completion. */
export const PiGoalModePrompt =
  'Continue working toward the requested goal until the result is complete and verified, ' +
  'or a concrete blocker requires user input. Preserve progress across compaction. ' +
  'Report remaining work honestly if blocked; respect cancellation and explicit budgets.';

export function createPiWorkbenchContract(
  sessionMode: CoworkSessionMode | undefined,
  skillIds: string[] | undefined,
): WorkbenchTaskContract {
  const kind =
    sessionMode === CoworkSessionMode.Chat
      ? WorkbenchContractKind.Chat
      : WorkbenchContractKind.GenericWork;
  return {
    kind,
    requiresUserAcceptance: false,
    metadata: {
      ...(skillIds?.length ? { skillIds } : {}),
    },
  };
}
