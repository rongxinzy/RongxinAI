import { expect, test, vi } from 'vitest';

import { PiRuntimeAdapter } from './piRuntimeAdapter';

test('omitting a checkpoint has no automatic continuation entry point', () => {
  const adapter = new PiRuntimeAdapter();
  expect('requestSummaryReminder' in adapter).toBe(false);
});

test('deterministic omission fallback never starts another model turn', async () => {
  const adapter = new PiRuntimeAdapter();
  const continueSession = vi.spyOn(adapter, 'continueSession');
  const saveSessionSummary = vi.fn(async () => ({
    checkpointId: 'session-1:fallback:message-1',
    syncState: 'pending' as const,
  }));
  Object.assign(adapter, { projectMemoryService: { saveSessionSummary } });

  await adapter.recordSummaryOmission('session-1', {
    workspaceRoot: '/work',
    workbenchRunId: 'run-1',
    lastCompletedAnswerMessageId: 'message-1',
    lastCompletedAnswerText: 'Created the workbook.',
    turnFailed: false,
  } as never);

  expect(saveSessionSummary).toHaveBeenCalledWith(
    expect.objectContaining({ linkId: 'session-1:fallback:message-1' }),
  );
  expect(continueSession).not.toHaveBeenCalled();
});
