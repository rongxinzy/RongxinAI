import {
  WorkbenchOutputMode,
  WorkbenchRunStatus,
  type WorkbenchOutputRequirement,
  type WorkbenchOutputRequirementInput,
} from '../../shared/workbenchTask';
import type { WorkbenchTaskRepository } from './repository';

export function normalizeOutputRequirements(
  requirements: WorkbenchOutputRequirementInput[],
): WorkbenchOutputRequirement[] {
  if (!Array.isArray(requirements) || requirements.length === 0 || requirements.length > 16) {
    throw new Error('Provide between one and sixteen output requirements.');
  }
  return requirements.map(requirement => {
    const rawFormats = requirement.formats ?? [];
    if (
      !Object.values(WorkbenchOutputMode).includes(requirement.mode) ||
      !Array.isArray(rawFormats) ||
      rawFormats.length > 16
    ) {
      throw new Error('Invalid output requirement.');
    }
    const formats = [
      ...new Set(
        rawFormats.map(format => {
          if (typeof format !== 'string') throw new Error('Invalid output format.');
          const normalized = format.trim().toLowerCase().replace(/^\./, '');
          if (!/^[a-z0-9_+-]{1,32}$/.test(normalized)) throw new Error('Invalid output format.');
          return normalized;
        }),
      ),
    ].sort();
    // Text deliverables are never matched against a format, so a text
    // requirement that carries one (models write ["markdown"] for a written
    // answer) is normalized instead of rejected: rejecting it leaves the task
    // without a contract and blocks every later tool call forever.
    return {
      mode: requirement.mode,
      formats: requirement.mode === WorkbenchOutputMode.Text ? [] : formats,
    };
  });
}

export function setWorkbenchOutputRequirements(
  repository: WorkbenchTaskRepository,
  sessionId: string,
  runId: string,
  requirements: WorkbenchOutputRequirementInput[],
): void {
  const normalized = normalizeOutputRequirements(requirements);
  repository.transaction(() => {
    const run = repository.getRun(runId);
    const task = run ? repository.getTask(run.taskId) : null;
    if (
      !task ||
      task.sessionId !== sessionId ||
      task.activeRunId !== runId ||
      run?.status !== WorkbenchRunStatus.Running
    ) {
      throw new Error('The output contract must belong to the active run.');
    }
    const existing = task.contract.outputRequirements;
    if (existing?.length && JSON.stringify(existing) !== JSON.stringify(normalized)) {
      throw new Error(
        'The output requirements are already committed. Start a new task to change them.',
      );
    }
    repository.updateTaskContract(task.id, { ...task.contract, outputRequirements: normalized });
  });
}
