import {
  CoworkSessionMode,
  type CoworkSessionMode as CoworkSessionModeValue,
} from '../../shared/cowork/constants';

export interface ProductionWorkflowEntryInput {
  sessionMode?: CoworkSessionModeValue;
  prompt: string;
  goalMode?: boolean;
  inheritedProductionWorkflow?: boolean;
}

/**
 * This gate only resolves deterministic runtime state. The model decides whether
 * a new Work turn needs the production workflow by calling commit_plan or
 * skip_workflow; natural-language intent must not be classified here.
 */
export const shouldEnableProductionWorkflow = (input: ProductionWorkflowEntryInput): boolean => {
  if (input.sessionMode === CoworkSessionMode.Chat) return false;
  if (input.inheritedProductionWorkflow !== undefined) {
    return input.inheritedProductionWorkflow;
  }
  return true;
};
