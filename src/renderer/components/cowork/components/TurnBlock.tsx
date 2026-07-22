import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtHeader,
} from '@shared/components/ai-elements/chain-of-thought';
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from '@shared/components/ai-elements/reasoning';
import { Shimmer } from '@shared/components/ai-elements/shimmer';
import { Brain, Info, SparklesIcon, TriangleAlert, Wrench } from 'lucide-react';
import React from 'react';

import type { CoworkErrorKind } from '../../../../common/coworkError';
import { getUserErrorI18nKey } from '../../../../common/coworkError';
import { getScheduledReminderDisplayText } from '../../../../scheduledTask/reminderText';
import { i18nService } from '../../../services/i18n';
import type { Artifact } from '../../../types/artifact';
import type { CoworkMessage, CoworkMessageMetadata } from '../../../types/cowork';
import { ArtifactPreviewCard } from '../../artifacts';
import {
  ExecutionStatusKind,
  getCompletedExecutionSummaryText,
  getCurrentExecutionStatus,
  getExecutionStatusText,
  getExecutionSummary,
  getFinalAnswerIndex,
} from '../helpers/executionStatus';
import type { ConversationTurn } from '../helpers/messageGrouping';
import { getToolResultLineCount, getVisibleAssistantItems } from '../helpers/messageGrouping';
import { getThinkingPresentation } from '../helpers/thinkingPresentation';
import { getToolResultDisplay, hasText } from '../helpers/toolUtils';
import { AssistantBubble } from './AssistantBubble';
import { ExecutionSummary } from './ExecutionSummary';
import { TypingDots } from './StreamingBar';
import { ToolCard } from './ToolCard';

export const TurnBlock: React.FC<{
  turn: ConversationTurn;
  artifacts?: Artifact[];
  resolveLocalFilePath?: (href: string, text: string) => string | null;
  mapDisplayText?: (value: string) => string;
  showTypingIndicator?: boolean;
  showCopyButtons?: boolean;
}> = ({
  turn,
  artifacts,
  resolveLocalFilePath,
  mapDisplayText,
  showTypingIndicator = false,
  showCopyButtons = true,
}) => {
  const visibleAssistantItems = getVisibleAssistantItems(turn.assistantItems);

  const renderSystemMessage = (message: CoworkMessage) => {
    const isError = !hasText(message.content) && typeof message.metadata?.error === 'string';
    const errorKind = message.metadata?.errorKind as CoworkErrorKind | undefined;
    const i18nKey = isError && errorKind ? getUserErrorI18nKey(errorKind) : null;
    const i18nMessage = i18nKey ? i18nService.t(i18nKey) : null;
    const rawContent = i18nMessage
      ? i18nMessage
      : hasText(message.content)
        ? message.content
        : typeof message.metadata?.error === 'string'
          ? message.metadata.error
          : '';
    const normalizedContent = getScheduledReminderDisplayText(rawContent) ?? rawContent;
    const content = mapDisplayText ? mapDisplayText(normalizedContent) : normalizedContent;
    if (!content.trim()) return null;
    return (
      <div className="rounded-lg border border-border bg-background px-3 py-2">
        <div className="flex items-center gap-2">
          {isError ? (
            <TriangleAlert className="size-4 text-muted-foreground shrink-0" />
          ) : (
            <Info className="size-4 text-muted-foreground shrink-0" />
          )}
          <div className="text-xs whitespace-pre-wrap text-muted-foreground">{content}</div>
        </div>
      </div>
    );
  };

  const renderOrphanToolResult = (message: CoworkMessage) => {
    const toolResultDisplayRaw = getToolResultDisplay(message);
    const toolResultDisplay = mapDisplayText
      ? mapDisplayText(toolResultDisplayRaw)
      : toolResultDisplayRaw;
    const isToolError = Boolean(message.metadata?.isError || message.metadata?.error);
    const hasToolResultText = hasText(toolResultDisplay);
    const resultLineCount = hasToolResultText ? getToolResultLineCount(toolResultDisplay) : 0;
    const showNoDetailError = isToolError && !hasToolResultText;
    const fallbackText = showNoDetailError ? i18nService.t('coworkToolNoErrorDetail') : '';
    const displayText = hasToolResultText ? toolResultDisplay : fallbackText;
    return (
      <div className="py-1">
        <div className="flex items-start gap-2">
          <span
            className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${isToolError ? 'bg-red-500' : 'bg-surface-raised'}`}
          />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-muted-foreground">
              {i18nService.t('coworkToolResult')}
            </div>
            {resultLineCount > 0 && (
              <div className="text-xs text-muted mt-0.5">
                {resultLineCount} {resultLineCount === 1 ? 'line' : 'lines'} of output
              </div>
            )}
            {resultLineCount === 0 && showNoDetailError && (
              <div className={`text-xs mt-0.5 ${isToolError ? 'text-red-500/80' : 'text-muted'}`}>
                {fallbackText}
              </div>
            )}
            {(hasToolResultText || showNoDetailError) && (
              <div className="mt-2 px-3 py-2 rounded-lg bg-surface-raised max-h-64 overflow-y-auto">
                <pre
                  className={`text-xs whitespace-pre-wrap wrap-break-word font-mono ${isToolError ? 'text-red-500' : hasToolResultText ? 'text-foreground' : 'text-muted-foreground italic'}`}
                >
                  {displayText}
                </pre>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderItem = (
    item: (typeof visibleAssistantItems)[0],
    _idx: number,
    isFinalAnswer: boolean,
    forceComplete = false,
    mutedExecution = false,
  ) => {
    // ── Thinking: collapsed Reasoning block with shimmer ──
    if (item.type === 'assistant' && item.message.metadata?.isThinking) {
      const meta = item.message.metadata;
      const { durationSeconds, isComplete, isStreaming } = getThinkingPresentation(
        meta,
        forceComplete,
      );
      const content = mapDisplayText ? mapDisplayText(item.message.content) : item.message.content;
      return (
        <Reasoning
          key={item.message.id}
          className={mutedExecution ? 'text-muted-foreground' : undefined}
          isStreaming={isStreaming}
          defaultOpen={true}
          autoClose={false}
          duration={durationSeconds}
        >
          <ReasoningTrigger
            getThinkingMessage={(s, d) => {
              if (isComplete) return <p>{d ? `已思考 ${d} 秒` : '思考完成'}</p>;
              if (s) return <Shimmer duration={1}>思考中…</Shimmer>;
              return <p>思考内容</p>;
            }}
          />
          <ReasoningContent>{content}</ReasoningContent>
        </Reasoning>
      );
    }

    // ── Tool call + result ──
    if (item.type === 'tool_group') {
      return (
        <ToolCard
          key={item.group.toolUse.id}
          group={item.group}
          isLastInSequence
          muted={mutedExecution}
          mapDisplayText={mapDisplayText}
        />
      );
    }

    // ── Orphan tool result ──
    if (item.type === 'tool_result') {
      return <div key={item.message.id}>{renderOrphanToolResult(item.message)}</div>;
    }

    // ── System message ──
    if (item.type === 'system') {
      const sys = renderSystemMessage(item.message);
      return sys ? <div key={item.message.id}>{sys}</div> : null;
    }

    // ── Assistant answer ──
    if (item.type === 'assistant') {
      const isLastAssistant = showCopyButtons && isFinalAnswer;
      return (
        <AssistantBubble
          key={item.message.id}
          message={item.message}
          resolveLocalFilePath={resolveLocalFilePath}
          mapDisplayText={mapDisplayText}
          showCopyButton={isLastAssistant}
          turnMetadata={
            isLastAssistant ? (item.message.metadata as CoworkMessageMetadata) : undefined
          }
        />
      );
    }

    return null;
  };

  // Keep user-facing answers visible while grouping execution-only events.
  const groups = (() => {
    const result: Array<{
      items: typeof visibleAssistantItems;
      streaming: boolean;
      status: ReturnType<typeof getCurrentExecutionStatus>;
    }> = [];
    let currentItems: typeof visibleAssistantItems = [];

    const flush = () => {
      if (currentItems.length === 0) return;
      const status = getCurrentExecutionStatus(currentItems);
      result.push({ items: [...currentItems], streaming: Boolean(status), status });
      currentItems = [];
    };

    for (const item of visibleAssistantItems) {
      const isAnswer = item.type === 'assistant' && !item.message.metadata?.isThinking;
      const isStep =
        (item.type === 'assistant' && item.message.metadata?.isThinking) ||
        item.type === 'tool_group' ||
        item.type === 'tool_result' ||
        item.type === 'system';

      if (isAnswer) {
        flush();
        result.push({
          items: [item],
          streaming: Boolean(item.message.metadata?.isStreaming),
          status: null,
        });
      } else if (isStep) {
        currentItems.push(item);
      }
    }
    flush();
    return result;
  })();
  const lastAnswerGroupIndex = groups.reduce((lastIndex, group, index) => {
    const firstItem = group.items[0];
    return firstItem?.type === 'assistant' && !firstItem.message.metadata?.isThinking
      ? index
      : lastIndex;
  }, -1);
  const isEmptyAnswerGroup = (group: (typeof groups)[number]) => {
    const firstItem = group.items[0];
    return (
      firstItem?.type === 'assistant' &&
      !firstItem.message.metadata?.isThinking &&
      !hasText(firstItem.message.content)
    );
  };
  const visibleGroups = groups.filter(group => !isEmptyAnswerGroup(group));
  const executionSummary = getExecutionSummary(visibleAssistantItems);
  const finalAnswerIndex = getFinalAnswerIndex(visibleAssistantItems);
  const finalAnswerStarted =
    finalAnswerIndex === visibleAssistantItems.length - 1 &&
    lastAnswerGroupIndex >= 0 &&
    lastAnswerGroupIndex === groups.length - 1 &&
    !isEmptyAnswerGroup(groups[lastAnswerGroupIndex]);
  const previousGroups = finalAnswerStarted ? groups.slice(0, lastAnswerGroupIndex) : [];
  const finalAnswerGroup = finalAnswerStarted ? groups[lastAnswerGroupIndex] : null;
  const previousItems = previousGroups.flatMap(group => group.items);

  const renderExecutionGroup = (
    group: (typeof groups)[number],
    groupKey: string,
    isFinalAnswer: boolean,
  ) => {
    const firstItem = group.items[0];
    const isAnswerItem = firstItem?.type === 'assistant' && !firstItem.message.metadata?.isThinking;
    if (isAnswerItem) {
      return renderItem(firstItem, 0, isFinalAnswer);
    }

    const isStreaming = group.streaming;
    const headerIcon = isStreaming
      ? group.status?.kind === ExecutionStatusKind.Thinking
        ? Brain
        : group.status?.kind === ExecutionStatusKind.Tool
          ? Wrench
          : SparklesIcon
      : SparklesIcon;
    return (
      <ChainOfThought key={groupKey} defaultOpen={false}>
        <ChainOfThoughtHeader icon={headerIcon}>
          {isStreaming ? (
            <Shimmer duration={1}>{getExecutionStatusText(group.status!)}</Shimmer>
          ) : (
            getCompletedExecutionSummaryText(getExecutionSummary(group.items))
          )}
        </ChainOfThoughtHeader>
        <ChainOfThoughtContent>
          {group.items.map((item, idx) => renderItem(item, idx, false, false, true))}
        </ChainOfThoughtContent>
      </ChainOfThought>
    );
  };
  return (
    <div className="px-4 py-2">
      <div className="max-w-5xl min-w-[320px] mx-auto">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0 px-4 py-3 space-y-3">
            {finalAnswerStarted && previousItems.length > 0 && (
              <ExecutionSummary summary={executionSummary}>
                {previousItems.map((item, index) => {
                  const isAnswer = item.type === 'assistant' && !item.message.metadata?.isThinking;
                  return renderItem(item, index, false, true, !isAnswer);
                })}
              </ExecutionSummary>
            )}
            {finalAnswerStarted && finalAnswerGroup
              ? renderExecutionGroup(finalAnswerGroup, 'final-answer', true)
              : visibleGroups.map((group, index) =>
                  renderExecutionGroup(
                    group,
                    `turn-group-${index}`,
                    index === lastAnswerGroupIndex,
                  ),
                )}
            {showTypingIndicator && <TypingDots />}
            {artifacts && artifacts.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {artifacts.map(artifact => (
                  <ArtifactPreviewCard key={artifact.id} artifact={artifact} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
