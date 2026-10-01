import { i18nService } from '../../../services/i18n';
import type { CoworkToolActivity } from '../../../../shared/cowork/toolActivity';

import type { AssistantTurnItem } from './messageGrouping';
import { getToolInputSummary, hasText, normalizeToolName, truncatePreview } from './toolUtils';

export const ExecutionStatusKind = {
  Thinking: 'thinking',
  Tool: 'tool',
} as const;

export type ExecutionStatusKind = (typeof ExecutionStatusKind)[keyof typeof ExecutionStatusKind];

export type ExecutionStatus =
  | { kind: typeof ExecutionStatusKind.Thinking }
  | {
      kind: typeof ExecutionStatusKind.Tool;
      toolName?: string;
      target?: string;
    };

const getToolTarget = (toolName: string | undefined, toolInput: unknown): string | undefined => {
  if (!toolInput || typeof toolInput !== 'object') return undefined;
  const summary = getToolInputSummary(toolName, toolInput as Record<string, unknown>);
  if (!summary) return undefined;
  return truncatePreview(summary.replace(/\s+/g, ' ').trim(), 80);
};

export const getToolActivityExecutionStatus = (activity: CoworkToolActivity): ExecutionStatus => ({
  kind: ExecutionStatusKind.Tool,
  toolName: activity.toolName,
  target: getToolTarget(activity.toolName, activity.toolInput),
});

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
      item.message.metadata?.isStreaming &&
      hasText(item.message.content),
  );
  // 2026/09/20 lixiang  轮次已结束时即使仍有未回填的 tool_result，也兜底展示最后一条回答，
  // 避免卡在「Running」工具态、用户看不到结果（issue #805）
  if (!allowCompletedFallback || hasStreamingAnswer) return -1;
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
    case 'applypatch':
    case 'notebookedit':
      return 'coworkExecutionEdit';
    case 'grep':
    case 'glob':
    case 'find':
    case 'websearch':
      return 'coworkExecutionSearch';
    case 'ls':
      return 'coworkExecutionList';
    case 'mcp':
      return 'coworkExecutionTool';
    case 'webfetch':
      return 'coworkExecutionFetch';
    case 'task':
    case 'subagent':
      return 'coworkExecutionDelegate';
    case 'todowrite':
      return 'coworkExecutionTodo';
    case 'process':
      return 'coworkExecutionProcess';
    case 'cron':
      return 'coworkExecutionSchedule';
    case 'workflowstate':
    case 'researchstate':
      return 'coworkExecutionWorkflow';
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
