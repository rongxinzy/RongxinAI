import {
  CoworkSessionMode,
  type CoworkSessionMode as CoworkSessionModeValue,
} from '../../shared/cowork/constants';
import type { ProductionLoopState } from '../../shared/productionLoop';
import { WorkbenchContractKind } from '../../shared/workbenchTask';

export interface ProductionWorkflowEntryInput {
  sessionMode?: CoworkSessionModeValue;
  prompt: string;
  goalMode?: boolean;
  inheritedProductionRequired?: boolean;
}

/**
 * This gate controls production tool topology, not per-turn activation. New
 * Work turns keep the controls available in a dormant state; the model starts
 * the workflow only when the request is substantive. Chat stays tool-free and
 * resume activation is resolved separately from the owning task's state.
 */
export const shouldExposeProductionControls = (input: ProductionWorkflowEntryInput): boolean => {
  if (input.sessionMode === CoworkSessionMode.Chat) return false;
  return true;
};

export const shouldRequireProductionOnResume = (
  workflowKind: WorkbenchContractKind,
  previousProduction: Pick<ProductionLoopState, 'skip'> | null,
): boolean => {
  if (
    workflowKind === WorkbenchContractKind.Research ||
    workflowKind === WorkbenchContractKind.Shortcut
  ) {
    return true;
  }
  if (workflowKind !== WorkbenchContractKind.GenericWork) return false;
  return Boolean(previousProduction && !previousProduction.skip);
};
