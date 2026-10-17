/**
 * Workbench contract derivation for Pi sessions.
 *
 * Extracted from PiRuntimeAdapter: maps the requested Cowork session mode and
 * the turn's skill set onto the WorkbenchTaskContract kind (Chat, Research,
 * Shortcut, GenericWork).
 */

import { CoworkSessionMode } from '../../../shared/cowork/constants';
import { WorkbenchContractKind, type WorkbenchTaskContract } from '../../../shared/workbenchTask';
import { isAcademicResearchSkillSet } from './piResearchRun';
import { resolveShortcutWorkflowKind } from './piShortcutWorkflow';

export function createPiWorkbenchContract(
  sessionMode: CoworkSessionMode | undefined,
  skillIds: string[] | undefined,
): WorkbenchTaskContract {
  const research = isAcademicResearchSkillSet(skillIds);
  const shortcut = research ? null : resolveShortcutWorkflowKind(skillIds);
  const kind =
    sessionMode === CoworkSessionMode.Chat
      ? WorkbenchContractKind.Chat
      : research
        ? WorkbenchContractKind.Research
        : shortcut
          ? WorkbenchContractKind.Shortcut
          : WorkbenchContractKind.GenericWork;
  return {
    kind,
    requiresUserAcceptance: false,
    metadata: {
      ...(skillIds?.length ? { skillIds } : {}),
    },
  };
}
