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

  const ensureTurn = (): ConversationTurn => {
    if (currentTurn) return currentTurn;
    const orphanTurn: ConversationTurn = {
      id: `orphan-${orphanIndex++}`,
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

    const turn = ensureTurn();
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

// ── Filter helpers ──

export const isRenderableAssistantOrSystemMessage = (message: CoworkMessage): boolean => {
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
