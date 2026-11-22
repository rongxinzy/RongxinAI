import type Database from 'better-sqlite3';
import { CompanionRequestState } from '../../shared/companion/constants';

export function interruptPendingCompanionReplies(db: Database.Database): number {
  return db
    .prepare('UPDATE companion_chat_turns SET state = ? WHERE state = ?')
    .run(CompanionRequestState.Unanswered, CompanionRequestState.Accepted).changes;
}
