import {
  WorkbenchOutputMode,
  WorkbenchRunStatus,
  type WorkbenchOutputRequirement,
} from '../../shared/workbenchTask';
import type { WorkbenchTaskRepository } from './repository';

export function normalizeOutputRequirements(
  requirements: WorkbenchOutputRequirement[],
): WorkbenchOutputRequirement[] {
  if (!Array.isArray(requirements) || requirements.length === 0 || requirements.length > 16) {
    throw new Error('Provide between one and sixteen output requirements.');
  }
  return requirements.map(requirement => {
    if (
      !Object.values(WorkbenchOutputMode).includes(requirement.mode) ||
      !Array.isArray(requirement.formats) ||
      requirement.formats.length > 16
    ) {
      throw new Error('Invalid output requirement.');
    }
    const formats = [
      ...new Set(
        requirement.formats.map(format => {
          if (typeof format !== 'string') throw new Error('Invalid output format.');
          const normalized = format.trim().toLowerCase().replace(/^\./, '');
          if (!/^[a-z0-9_+-]{1,32}$/.test(normalized)) throw new Error('Invalid output format.');
          return normalized;
        }),
      ),
    ].sort();
    if (requirement.mode === WorkbenchOutputMode.Text && formats.length) {
      throw new Error('Text output does not take file formats.');
    }
    return { mode: requirement.mode, formats };
  });
}

export function setWorkbenchOutputRequirements(
  repository: WorkbenchTaskRepository,
  sessionId: string,
  runId: string,
  requirements: WorkbenchOutputRequirement[],
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
