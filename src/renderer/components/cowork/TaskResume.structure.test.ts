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
const turnSource = readFileSync(
  fileURLToPath(new URL('./components/TurnBlock.tsx', import.meta.url)),
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
  expect(viewSource).toContain('onResumeTask={taskResume.select}');
  expect(detailSource).toContain('useRecoverableWorkbenchTaskId(sessionId)');
  expect(detailSource).toContain('requestAnimationFrame(() => promptInputRef.current?.focus())');
  expect(detailSource).toContain('recoverableTaskId={recoverableTaskId}');
  expect(detailSource).toContain('onResumeTask={onResumeTask ? handleResumeTask : undefined}');
  expect(detailSource).toContain('resumeDisabled={resumeDisabled || isStreaming}');
  expect(detailSource).toContain('resumeTaskActive={Boolean(resumeTaskId)}');
});

test('interruption resume control sits inline as a theme button', () => {
  expect(turnSource).toContain('flex flex-wrap items-center gap-x-2');
  expect(turnSource).toContain('variant="default"');
  expect(turnSource).toContain('size="sm"');
  expect(turnSource).toContain("i18nService.t('coworkResumeTaskAction')");
  expect(turnSource).not.toContain('RotateCcw');
});

test('marks the session running before the resume IPC returns', () => {
  const clearEmbed = hookSource.indexOf('setInterruption(null);');
  const runningBefore = hookSource.indexOf('CoworkSessionStatusValue.Running');
  const resumeInvoke = hookSource.indexOf('window.electron.workbenchTask.resume');

  expect(clearEmbed).toBeGreaterThanOrEqual(0);
  expect(runningBefore).toBeGreaterThan(clearEmbed);
  expect(resumeInvoke).toBeGreaterThan(runningBefore);
});

test('retains the resume context when starting the replacement run fails', () => {
  const failureBranch = hookSource.indexOf('if (!result.success)');
  const restoreEmbed = hookSource.indexOf('setInterruption(target);', failureBranch);
  const failureReturn = hookSource.indexOf('return false;', failureBranch);

  expect(failureBranch).toBeGreaterThanOrEqual(0);
  expect(restoreEmbed).toBeGreaterThan(failureBranch);
  expect(failureReturn).toBeGreaterThan(restoreEmbed);
});
