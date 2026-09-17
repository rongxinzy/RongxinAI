import type { CoworkSessionSummary } from '../../types/cowork';

/**
 * The moment that decides a session's place in the list.
 *
 * While a run is in flight the key is the run's start, frozen by the store, so
 * streamed messages and status flips cannot move the row. Every other session
 * keys on its last activity, which means starting or stopping a conversation —
 * including pausing a run — puts it on top, and nothing else ever moves.
 */
export const agentSidebarSortKey = (session: CoworkSessionSummary): number =>
  session.runStartedAt ?? (session.updatedAt || session.createdAt);

/**
 * Orders the conversation lists of the Work tree and the Chat list: pinned
 * sessions first by pin order, then by the key above, then by creation time.
 * Pinned sessions stay on their pin order whether or not they run, so a run
 * never moves a row across the pinned block.
 */
export const sortAgentSidebarTasks = (tasks: CoworkSessionSummary[]): CoworkSessionSummary[] =>
  [...tasks].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (a.pinned && b.pinned) {
      const aPinOrder = a.pinOrder ?? a.updatedAt ?? a.createdAt;
      const bPinOrder = b.pinOrder ?? b.updatedAt ?? b.createdAt;
      if (aPinOrder !== bPinOrder) return aPinOrder - bPinOrder;
    }
    const aKey = agentSidebarSortKey(a);
    const bKey = agentSidebarSortKey(b);
    if (aKey !== bKey) return bKey - aKey;
    return b.createdAt - a.createdAt;
  });
