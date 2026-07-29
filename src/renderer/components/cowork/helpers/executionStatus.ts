import { i18nService } from '../../../services/i18n';

import type { AssistantTurnItem } from './messageGrouping';
import { getToolInputSummary, hasText, normalizeToolName, truncatePreview } from './toolUtils';

export const ExecutionStatusKind = {
  Thinking: 'thinking',
  Tool: 'tool',
} as const;

export type ExecutionStatusKind =
  (typeof ExecutionStatusKind)[keyof typeof ExecutionStatusKind];

export type ExecutionStatus =
  | { kind: typeof ExecutionStatusKind.Thinking }
  | {
      kind: typeof ExecutionStatusKind.Tool;
      toolName?: string;
      target?: string;
    };

export type ExecutionSummary = {
  thinkingSteps: number;
  toolCalls: number;
  completedTools: number;
  failedTools: number;
  incompleteTools: number;
};

const getToolTarget = (toolName: string | undefined, toolInput: unknown): string | undefined => {
  if (!toolInput || typeof toolInput !== 'object') return undefined;
  const summary = getToolInputSummary(toolName, toolInput as Record<string, unknown>);
  if (!summary) return undefined;
  return truncatePreview(summary.replace(/\s+/g, ' ').trim(), 80);
};

export const getCurrentExecutionStatus = (
  items: AssistantTurnItem[],
): ExecutionStatus | null => {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item.type === 'assistant') {
      const metadata = item.message.metadata;
      if (metadata?.isThinking && metadata.isStreaming && !metadata.isFinal) {
        return { kind: ExecutionStatusKind.Thinking };
      }
      continue;
    }

    if (item.type === 'tool_group' && !item.group.toolResult) {
      const metadata = item.group.toolUse.metadata;
      const toolName = typeof metadata?.toolName === 'string' ? metadata.toolName : undefined;
      return {
        kind: ExecutionStatusKind.Tool,
        toolName,
        target: getToolTarget(toolName, metadata?.toolInput),
      };
    }
  }

  return null;
};

export const getFinalAnswerIndex = (
  items: AssistantTurnItem[],
  allowCompletedFallback = false,
): number => {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (
      item.type === 'assistant' &&
      !item.message.metadata?.isThinking &&
      item.message.metadata?.isFinalAnswer === true &&
      hasText(item.message.content)
    ) {
      return index;
    }
  }
  const hasStreamingAnswer = items.some(
    item =>
      item.type === 'assistant' &&
      !item.message.metadata?.isThinking &&
      item.message.metadata?.isStreaming,
  );
  if (!allowCompletedFallback || hasStreamingAnswer || getCurrentExecutionStatus(items)) return -1;
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (
      item.type === 'assistant' &&
      !item.message.metadata?.isThinking &&
      !item.message.metadata?.isStreaming &&
      hasText(item.message.content)
    ) {
      return index;
    }
  }
  return -1;
};

const getToolActionTranslationKey = (toolName: string | undefined): string => {
  switch (normalizeToolName(toolName ?? '')) {
    case 'bash':
    case 'exec':
    case 'shell':
      return 'coworkExecutionCommand';
    case 'read':
    case 'readfile':
      return 'coworkExecutionRead';
    case 'write':
    case 'writefile':
      return 'coworkExecutionWrite';
    case 'edit':
    case 'editfile':
    case 'multiedit':
      return 'coworkExecutionEdit';
    case 'grep':
    case 'glob':
    case 'find':
      return 'coworkExecutionSearch';
    case 'ls':
      return 'coworkExecutionList';
    case 'mcp':
      return 'coworkExecutionTool';
    default:
      return 'coworkExecutionRunning';
  }
};

export const getExecutionStatusText = (status: ExecutionStatus): string => {
  if (status.kind === ExecutionStatusKind.Thinking) {
    return i18nService.t('coworkExecutionThinking');
  }

  const actionText = i18nService.t(getToolActionTranslationKey(status.toolName));
  return status.target ? `${actionText} ${status.target}` : actionText;
};

export const getExecutionSummary = (items: AssistantTurnItem[]): ExecutionSummary | null => {
  const thinkingSteps = items.filter(
    item => item.type === 'assistant' && Boolean(item.message.metadata?.isThinking),
  ).length;
  const toolGroups = items.filter(
    (item): item is Extract<AssistantTurnItem, { type: 'tool_group' }> =>
      item.type === 'tool_group',
  );
  if (thinkingSteps === 0 && toolGroups.length === 0) return null;

  const failedTools = toolGroups.filter(group => {
    const metadata = group.group.toolResult?.metadata;
    return Boolean(metadata?.isError || metadata?.error);
  }).length;
  const incompleteTools = toolGroups.filter(group => !group.group.toolResult).length;

  return {
    thinkingSteps,
    toolCalls: toolGroups.length,
    completedTools: toolGroups.length - failedTools - incompleteTools,
    failedTools,
    incompleteTools,
  };
};

export const getCompletedExecutionSummaryText = (summary: ExecutionSummary | null): string => {
  if (!summary || (summary.thinkingSteps === 0 && summary.toolCalls === 0)) {
    return i18nService.t('coworkIntermediateProcess');
  }
  if (summary.thinkingSteps === 0) {
    return i18nService
      .t('coworkExecutionCompletedToolsSummary')
      .replace('{tools}', String(summary.toolCalls));
  }
  if (summary.toolCalls === 0) {
    return i18nService
      .t('coworkExecutionCompletedThinkingSummary')
      .replace('{thinking}', String(summary.thinkingSteps));
  }
  const template = i18nService.t('coworkExecutionCompletedSummary');
  return template
    .replace('{thinking}', String(summary.thinkingSteps))
    .replace('{tools}', String(summary.toolCalls));
};
