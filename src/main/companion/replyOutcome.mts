import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { setImmediate } from 'node:timers/promises';
import type { ConversationId, Cursor, Storage, SubmissionRecord } from '@earendil-works/pi-durable';
import { CompanionRequestState } from '../../shared/companion/constants.js';
import type { CompanionConversation } from '../../shared/companion/types.js';
import { CompanionNativeSettlement } from './activity.js';

export function companionReplyState(record: SubmissionRecord): CompanionRequestState {
  if (record.status === CompanionNativeSettlement.Done) return CompanionRequestState.Answered;
  if (record.status === CompanionNativeSettlement.Unanswered) {
    return record.reason === CompanionNativeSettlement.Aborted
      ? CompanionRequestState.Stopped
      : CompanionRequestState.Unanswered;
  }
  return CompanionRequestState.Accepted;
}

/** Read native receipts, not UI history length or a second persisted status ledger. */
export async function latestCompanionReply(
  storage: Storage,
  conversationId: ConversationId,
  petId: string,
): Promise<CompanionConversation['lastReply']> {
  let cursor: Cursor | undefined;
  do {
    const page = await storage.scanSubmissions(
      { conversationId, order: 'descending' },
      32,
      cursor,
      context,
    );
    const input = page.items.find(item => item.type === 'input' && item.requestId);
    if (input)
      return {
        petId,
        requestId: input.requestId!,
        submissionId: input.id,
        state: companionReplyState(input),
      };
    cursor = page.next;
    // Compaction writes do not describe the user's latest request; yield between bounded pages.
    if (cursor) await setImmediate();
  } while (cursor);
  return undefined;
}
