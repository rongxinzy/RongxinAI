import { expect, test, vi } from 'vitest';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import type {
  ConversationId,
  Cursor,
  Storage,
  SubmissionId,
  SubmissionRecord,
} from '@earendil-works/pi-durable';
import { latestCompanionReply } from './replyOutcome.mjs';
import { CompanionRequestState } from '../../shared/companion/constants';

test('native passive writes do not hide the latest admitted user input across bounded scan pages', async () => {
  const conversationId = 1 as ConversationId;
  const cursor = { offset: 32 } as unknown as Cursor;
  const passive: SubmissionRecord = {
    id: 2 as SubmissionId,
    conversationId,
    type: 'write',
    status: 'queued',
  };
  const input: SubmissionRecord = {
    id: 1 as SubmissionId,
    conversationId,
    type: 'input',
    requestId: 'request',
    status: 'unanswered',
    reason: 'faulted',
  };
  const scanSubmissions = vi
    .fn()
    .mockResolvedValueOnce({ items: Array(32).fill(passive), next: cursor })
    .mockResolvedValueOnce({ items: [input] });
  // This pure projection only depends on the public scan method; no SQLite or Harness is faked here.
  const storage = { scanSubmissions } as unknown as Storage;
  expect(await latestCompanionReply(storage, conversationId, 'pet')).toEqual({
    petId: 'pet',
    requestId: 'request',
    submissionId: 1,
    state: CompanionRequestState.Unanswered,
  });
  expect(scanSubmissions).toHaveBeenNthCalledWith(
    1,
    { conversationId, order: 'descending' },
    32,
    undefined,
    BACKGROUND_CONTEXT,
  );
  expect(scanSubmissions).toHaveBeenNthCalledWith(
    2,
    { conversationId, order: 'descending' },
    32,
    cursor,
    BACKGROUND_CONTEXT,
  );
});
