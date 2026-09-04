import type { CoworkMessage } from '../../../types/cowork';
import { getToolResultDisplay, hasText } from './toolUtils';

// ── Types ──

export type ToolGroupItem = {
  type: 'tool_group';
  toolUse: CoworkMessage;
  toolResult?: CoworkMessage | null;
};

export type DisplayItem = { type: 'message'; message: CoworkMessage } | ToolGroupItem;

export type AssistantTurnItem =
  | { type: 'assistant'; message: CoworkMessage }
  | { type: 'system'; message: CoworkMessage }
  | { type: 'tool_group'; group: ToolGroupItem }
  | { type: 'tool_result'; message: CoworkMessage };

export type ConversationTurn = {
  id: string;
  userMessage: CoworkMessage | null;
  assistantItems: AssistantTurnItem[];
};

// ── buildDisplayItems ──

export const buildDisplayItems = (messages: CoworkMessage[]): DisplayItem[] => {
  const items: DisplayItem[] = [];
  const groupsByToolUseId = new Map<string, ToolGroupItem>();
  let pendingAdjacentGroup: ToolGroupItem | null = null;

  for (const message of messages) {
    if (message.type === 'tool_use') {
      const group: ToolGroupItem = { type: 'tool_group', toolUse: message };
      items.push(group);
      const toolUseId = message.metadata?.toolUseId;
      if (typeof toolUseId === 'string' && toolUseId.trim())
        groupsByToolUseId.set(toolUseId, group);
      pendingAdjacentGroup = group;
      continue;
    }

    if (message.type === 'tool_result') {
      let matched = false;
      const toolUseId = message.metadata?.toolUseId;
      if (typeof toolUseId === 'string' && groupsByToolUseId.has(toolUseId)) {
        const group = groupsByToolUseId.get(toolUseId);
        if (group) {
          group.toolResult = message;
          matched = true;
        }
      } else if (pendingAdjacentGroup && !pendingAdjacentGroup.toolResult) {
        pendingAdjacentGroup.toolResult = message;
        matched = true;
      }
      pendingAdjacentGroup = null;
      if (!matched) items.push({ type: 'message', message });
      continue;
    }

    pendingAdjacentGroup = null;
    items.push({ type: 'message', message });
  }

  return items;
};

// ── buildConversationTurns ──

export const buildConversationTurns = (items: DisplayItem[]): ConversationTurn[] => {
  const turns: ConversationTurn[] = [];
  let currentTurn: ConversationTurn | null = null;
  let orphanIndex = 0;

  const ensureTurn = (anchorMessageId: string): ConversationTurn => {
    if (currentTurn) return currentTurn;
    const orphanTurn: ConversationTurn = {
      id: anchorMessageId ? `orphan:${anchorMessageId}` : `orphan-${orphanIndex++}`,
      userMessage: null,
      assistantItems: [],
    };
    turns.push(orphanTurn);
    currentTurn = orphanTurn;
    return orphanTurn;
  };

  for (const item of items) {
    if (item.type === 'message' && item.message.type === 'user') {
      currentTurn = {
        id: item.message.id,
        userMessage: item.message,
        assistantItems: [],
      };
      turns.push(currentTurn);
      continue;
    }

    const anchorMessageId = item.type === 'tool_group' ? item.toolUse.id : item.message.id;
    const turn = ensureTurn(anchorMessageId);
    if (item.type === 'tool_group') {
      turn.assistantItems.push({ type: 'tool_group', group: item });
      continue;
    }

    const message = item.message;
    if (message.type === 'assistant') {
      turn.assistantItems.push({ type: 'assistant', message });
    } else if (message.type === 'system') {
      turn.assistantItems.push({ type: 'system', message });
    } else if (message.type === 'tool_result') {
      turn.assistantItems.push({ type: 'tool_result', message });
    } else if (message.type === 'tool_use') {
      turn.assistantItems.push({
        type: 'tool_group',
        group: { type: 'tool_group', toolUse: message },
      });
    }
  }

  return turns;
};

// ── Incremental turn stabilization (issue #141) ──

/**
 * Reuses the previous assistant item when its payload is referentially
 * unchanged, so memoized turn children can bail out during streaming.
 */
const reuseAssistantTurnItem = (
  previous: AssistantTurnItem | undefined,
  next: AssistantTurnItem,
): AssistantTurnItem => {
  if (!previous || previous.type !== next.type) return next;
  if (next.type === 'tool_group') {
    const previousGroup = (previous as Extract<AssistantTurnItem, { type: 'tool_group' }>).group;
    return previousGroup.toolUse === next.group.toolUse &&
      previousGroup.toolResult === next.group.toolResult
      ? previous
      : next;
  }
  return (previous as { message: CoworkMessage }).message ===
    (next as { message: CoworkMessage }).message
    ? previous
    : next;
};

const reuseConversationTurn = (
  previous: ConversationTurn | undefined,
  next: ConversationTurn,
): ConversationTurn => {
  if (!previous || previous.userMessage !== next.userMessage) return next;
  if (previous.assistantItems.length !== next.assistantItems.length) return next;
  const items = next.assistantItems.map((item, index) =>
    reuseAssistantTurnItem(previous.assistantItems[index], item),
  );
  const allReused = items.every((item, index) => item === previous.assistantItems[index]);
  return allReused ? previous : { ...next, assistantItems: items };
};

export const getConversationTurnMessageIds = (turn: ConversationTurn): string[] => {
  const ids: string[] = [];
  if (turn.userMessage) ids.push(turn.userMessage.id);
  for (const item of turn.assistantItems) {
    if (item.type === 'tool_group') {
      ids.push(item.group.toolUse.id);
      if (item.group.toolResult) ids.push(item.group.toolResult.id);
    } else {
      ids.push(item.message.id);
    }
  }
  return ids;
};

/**
 * Rebuilds the turn list while preserving object identity for every turn
 * whose messages did not change. Streaming deltas only alter the active
 * tail turn, so all completed turns keep stable references and memoized
 * TurnBlock subtrees skip re-rendering entirely.
 */
export const stabilizeConversationTurns = (
  previousTurns: ConversationTurn[],
  nextTurns: ConversationTurn[],
): ConversationTurn[] => {
  const previousById = new Map(previousTurns.map(turn => [turn.id, turn]));
  const previousByMessageId = new Map<string, ConversationTurn>();
  for (const turn of previousTurns) {
    for (const messageId of getConversationTurnMessageIds(turn)) {
      previousByMessageId.set(messageId, turn);
    }
  }

  const claimedTurnIds = new Set<string>();
  let allReused = previousTurns.length === nextTurns.length;
  const stabilized = nextTurns.map((nextTurn, index) => {
    const exactPrevious = previousById.get(nextTurn.id);
    const previous =
      (exactPrevious && !claimedTurnIds.has(exactPrevious.id) ? exactPrevious : undefined) ??
      getConversationTurnMessageIds(nextTurn)
        .map(messageId => previousByMessageId.get(messageId))
        .find((candidate): candidate is ConversationTurn =>
          Boolean(candidate && !claimedTurnIds.has(candidate.id)),
        );
    const preferredTurnId = previous?.id ?? nextTurn.id;
    let uniqueTurnId = preferredTurnId;
    if (claimedTurnIds.has(uniqueTurnId)) {
      const messageAnchor = getConversationTurnMessageIds(nextTurn)[0] ?? String(index);
      uniqueTurnId = `${preferredTurnId}:${messageAnchor}`;
      let duplicateIndex = 1;
      while (claimedTurnIds.has(uniqueTurnId)) {
        uniqueTurnId = `${preferredTurnId}:${messageAnchor}:${duplicateIndex++}`;
      }
    }
    const normalizedNext =
      uniqueTurnId === nextTurn.id ? nextTurn : { ...nextTurn, id: uniqueTurnId };
    const turn = reuseConversationTurn(previous, normalizedNext);
    claimedTurnIds.add(turn.id);
    if (turn !== previousTurns[index]) allReused = false;
    return turn;
  });
  return allReused ? previousTurns : stabilized;
};

// ── Rail indices (data-driven; issue #141) ──

export type TurnRailIndices = {
  /** Rail item index for the user message, or -1 when the turn has none. */
  user: number;
  /** Rail item index for the aggregated assistant content, or -1 when empty. */
  assistant: number;
};

/**
 * Computes the navigation-rail item index for every turn from data alone,
 * so turn rows can mount lazily (virtualization) without breaking rail
 * numbering. Counting must stay in sync with the rail item list: one item
 * per user message plus one per turn with non-empty assistant content.
 */
export const buildTurnRailIndices = (turns: ConversationTurn[]): TurnRailIndices[] => {
  const indices: TurnRailIndices[] = [];
  let counter = 0;
  for (const turn of turns) {
    let assistantContent = '';
    for (const item of turn.assistantItems) {
      if (item.type === 'assistant' && item.message?.content) {
        assistantContent += item.message.content;
      }
    }
    indices.push({
      user: turn.userMessage ? counter++ : -1,
      assistant: assistantContent ? counter++ : -1,
    });
  }
  return indices;
};

// ── Filter helpers ──

export const isRenderableAssistantOrSystemMessage = (message: CoworkMessage): boolean => {
  if (message.type === 'system' && message.metadata?.interruption) return true;
  if (hasText(message.content) || hasText(message.metadata?.error)) return true;
  if (message.metadata?.isThinking)
    return hasText(message.content) || Boolean(message.metadata?.isStreaming);
  return false;
};

export const isVisibleAssistantTurnItem = (item: AssistantTurnItem): boolean => {
  if (item.type === 'assistant' || item.type === 'system')
    return isRenderableAssistantOrSystemMessage(item.message);
  if (item.type === 'tool_result')
    return hasText(getToolResultDisplay(item.message as CoworkMessage));
  return true;
};

export const getVisibleAssistantItems = (
  assistantItems: AssistantTurnItem[],
): AssistantTurnItem[] => assistantItems.filter(isVisibleAssistantTurnItem);

export const hasRenderableAssistantContent = (turn: ConversationTurn): boolean =>
  getVisibleAssistantItems(turn.assistantItems).length > 0;

export const getToolResultLineCount = (result: string): number => {
  if (!result) return 0;
  return result.split('\n').length;
};
