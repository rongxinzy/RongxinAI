import {
  CoworkSessionMode,
  type CoworkSessionMode as CoworkSessionModeValue,
} from '../../shared/cowork/constants';

export interface ProductionWorkflowEntryInput {
  sessionMode?: CoworkSessionModeValue;
  prompt: string;
  goalMode?: boolean;
  inheritedProductionWorkflow?: boolean;
}

export interface DirectConversationFastPathInput extends ProductionWorkflowEntryInput {
  skillIds?: readonly string[];
  expertIds?: readonly string[];
  attachmentCount?: number;
}

const DIRECT_CONVERSATION_PHRASES = new Set([
  '你好',
  '您好',
  '哈喽',
  '哈啰',
  '嗨',
  '早上好',
  '上午好',
  '中午好',
  '下午好',
  '晚上好',
  '谢谢',
  '多谢',
  '感谢',
  '好',
  '好的',
  '行',
  '可以',
  '收到',
  '明白',
  '明白了',
  '知道了',
  '了解',
  '没问题',
  '再见',
  '拜拜',
  '回见',
  'hi',
  'hello',
  'hey',
  'thanks',
  'thank you',
  'thx',
  'ok',
  'okay',
  'got it',
  'sounds good',
  'bye',
  'goodbye',
  'see you',
]);

const normalizeDirectConversation = (prompt: string): string =>
  prompt
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[!.\s,~。！、，～]+$/u, '')
    .toLowerCase();

/**
 * Strict system-owned fast path for turns that cannot contain substantive
 * work. Full-string matching is intentional: prefixed instructions such as
 * "你好，删除这个文件" must continue through the model decision gate.
 */
export const shouldAutoSkipDirectConversation = (
  input: DirectConversationFastPathInput,
): boolean => {
  if (input.sessionMode === CoworkSessionMode.Chat) return false;
  if (input.goalMode || input.inheritedProductionWorkflow !== undefined) return false;
  if (input.skillIds?.length || input.expertIds?.length || input.attachmentCount) return false;
  return DIRECT_CONVERSATION_PHRASES.has(normalizeDirectConversation(input.prompt));
};

/**
 * This gate only resolves deterministic runtime state and keeps the production
 * tool topology stable for Work sessions. The separate direct-conversation
 * fast path may persist a system-owned skip without disabling these tools.
 */
export const shouldEnableProductionWorkflow = (input: ProductionWorkflowEntryInput): boolean => {
  if (input.sessionMode === CoworkSessionMode.Chat) return false;
  if (input.inheritedProductionWorkflow !== undefined) {
    return input.inheritedProductionWorkflow;
  }
  return true;
};
