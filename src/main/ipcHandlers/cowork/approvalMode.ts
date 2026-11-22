import {
  CoworkPermissionMode,
  type CoworkPermissionMode as CoworkPermissionModeType,
} from '../../../shared/cowork/constants';
import { WorkbenchApprovalMode } from '../../../shared/workbenchTask';

/**
 * Map desktop Cowork permission mode to Pi WorkbenchApprovalMode.
 * - AllowAll -> AllowAll (run without prompting)
 * - Ask ("Ask before sensitive actions") -> Auto (allow reversible workspace
 *   writes/edits; still prompt for shell mutations, python execution, skill
 *   scripts, destructive actions, and unknown/external tools)
 */
export function resolveCoworkApprovalMode(
  mode: CoworkPermissionModeType | undefined,
): WorkbenchApprovalMode {
  return mode === CoworkPermissionMode.AllowAll
    ? WorkbenchApprovalMode.AllowAll
    : WorkbenchApprovalMode.Auto;
}
