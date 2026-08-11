import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const viewSource = readFileSync(
  fileURLToPath(new URL('./CoworkView.tsx', import.meta.url)),
  'utf8',
);
const detailSource = readFileSync(
  fileURLToPath(new URL('./CoworkSessionDetail.tsx', import.meta.url)),
  'utf8',
);
const hookSource = readFileSync(
  fileURLToPath(new URL('./hooks/useTaskResumeContext.ts', import.meta.url)),
  'utf8',
);

test('routes an explicitly selected interruption through a resume run', () => {
  const resumeBranch = viewSource.indexOf('if (taskResume.interruption)');
  const normalRunGuard = viewSource.indexOf(
    'if (continuingSessionIdsRef.current.has(currentSession.id))',
    resumeBranch,
  );

  expect(resumeBranch).toBeGreaterThanOrEqual(0);
  expect(normalRunGuard).toBeGreaterThan(resumeBranch);
  expect(viewSource).toContain('amendment: prompt');
  expect(viewSource).toContain('resumeTaskId={taskResume.interruption?.taskId}');
});

test('binds the recoverable message action to the persistent prompt input', () => {
  expect(detailSource).toContain('useRecoverableWorkbenchTaskId(sessionId)');
  expect(detailSource).toContain('requestAnimationFrame(() => promptInputRef.current?.focus())');
  expect(detailSource).toContain('recoverableTaskId={recoverableTaskId}');
  expect(detailSource).toContain('onResumeTask={onResumeTask ? handleResumeTask : undefined}');
  expect(detailSource).toContain('resumeTaskActive={Boolean(resumeTaskId)}');
});

test('retains the resume context when starting the replacement run fails', () => {
  const failureBranch = hookSource.indexOf('if (!result.success)');
  const failureReturn = hookSource.indexOf('return false;', failureBranch);
  const clearSelection = hookSource.indexOf('setInterruption(null);', failureBranch);

  expect(failureBranch).toBeGreaterThanOrEqual(0);
  expect(failureReturn).toBeGreaterThan(failureBranch);
  expect(clearSelection).toBeGreaterThan(failureReturn);
});
