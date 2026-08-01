import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtHeader,
} from '@shared/components/ai-elements/chain-of-thought';
import { ReasoningContent, ReasoningTrigger } from '@shared/components/ai-elements/reasoning';
import { Shimmer } from '@shared/components/ai-elements/shimmer';
import { Info, SparklesIcon, TriangleAlert, Wrench } from 'lucide-react';
import React from 'react';

import type { CoworkErrorKind } from '../../../../common/coworkError';
import { getUserErrorI18nKey } from '../../../../common/coworkError';
import { getScheduledReminderDisplayText } from '../../../../scheduledTask/reminderText';
import type { CoworkToolActivity } from '../../../../shared/cowork/toolActivity';
import { i18nService } from '../../../services/i18n';
import { ArtifactRole, type Artifact } from '../../../types/artifact';
import type { CoworkMessage, CoworkMessageMetadata } from '../../../types/cowork';
import ArtifactPreviewCard from '../../artifacts/ArtifactPreviewCard';
import {
  ExecutionStatusKind,
  getCompletedExecutionSummaryText,
  getCurrentExecutionStatus,
  getExecutionStatusText,
  getExecutionSummary,
  getFinalAnswerIndex,
  getToolActivityExecutionStatus,
} from '../helpers/executionStatus';
import type { ConversationTurn } from '../helpers/messageGrouping';
import { getToolResultLineCount, getVisibleAssistantItems } from '../helpers/messageGrouping';
import { getThinkingPresentation } from '../helpers/thinkingPresentation';
import { getToolResultDisplay, hasText } from '../helpers/toolUtils';
import { AssistantBubble } from './AssistantBubble';
import { ExecutionSummary } from './ExecutionSummary';
import { PersistentChainOfThought, PersistentReasoning } from './PersistentCollapsible';
import { TypingDots } from './StreamingBar';
import { ToolCard } from './ToolCard';

const TurnBlockComponent: React.FC<{
  turn: ConversationTurn;
  artifacts?: Artifact[];
  resolveLocalFilePath?: (href: string, text: string) => string | null;
  mapDisplayText?: (value: string) => string;
  showTypingIndicator?: boolean;
  showCopyButtons?: boolean;
  isTurnComplete?: boolean;
  toolActivities?: CoworkToolActivity[];
  /** Expand long tool results fully (image export capture). */
  expandToolResults?: boolean;
}> = ({
  turn,
  artifacts,
  resolveLocalFilePath,
  mapDisplayText,
  showTypingIndicator = false,
  showCopyButtons = true,
  isTurnComplete = true,
  toolActivities = [],
  expandToolResults = false,
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
    isLastInSequence = true,
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
        <PersistentReasoning
          key={item.message.id}
          persistKey={`reasoning-${item.message.id}`}
          className={mutedExecution ? 'text-muted-foreground' : undefined}
          isStreaming={isStreaming}
          defaultOpen={false}
          autoClose={false}
          duration={durationSeconds}
          showConnector={!isLastInSequence}
        >
          <ReasoningTrigger
            getThinkingMessage={(s, d) => {
              if (isComplete) return <p>{d ? `已思考 ${d} 秒` : '思考完成'}</p>;
              if (s) return <Shimmer duration={1}>思考中…</Shimmer>;
              return <p>思考内容</p>;
            }}
          />
          <ReasoningContent className="pl-4">{content}</ReasoningContent>
        </PersistentReasoning>
      );
    }

    // ── Tool call + result ──
    if (item.type === 'tool_group') {
      return (
        <ToolCard
          key={item.group.toolUse.id}
          group={item.group}
          isLastInSequence={isLastInSequence}
          muted={mutedExecution}
          mapDisplayText={mapDisplayText}
          forceExpand={expandToolResults}
        />
      );
    }

    // ── Orphan tool result ──
    if (item.type === 'tool_result') {
      return (
        <div key={item.message.id} className="relative">
          {!isLastInSequence && (
            <div aria-hidden="true" className="absolute top-full -bottom-3 left-2 w-px bg-border" />
          )}
          {renderOrphanToolResult(item.message)}
        </div>
      );
    }

    // ── System message ──
    if (item.type === 'system') {
      const sys = renderSystemMessage(item.message);
      return sys ? (
        <div key={item.message.id} className="relative">
          {!isLastInSequence && (
            <div aria-hidden="true" className="absolute top-full -bottom-3 left-2 w-px bg-border" />
          )}
          {sys}
        </div>
      ) : null;
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
      followedByAnswer: boolean;
    }> = [];
    let currentItems: typeof visibleAssistantItems = [];

    const flush = (followedByAnswer = false) => {
      if (currentItems.length === 0) return;
      result.push({ items: [...currentItems], followedByAnswer });
      currentItems = [];
    };

    for (const item of visibleAssistantItems) {
      const isAnswer =
        item.type === 'assistant' &&
        !item.message.metadata?.isThinking &&
        hasText(item.message.content);
      const isStep =
        (item.type === 'assistant' && item.message.metadata?.isThinking) ||
        item.type === 'tool_group' ||
        item.type === 'tool_result' ||
        item.type === 'system';

      if (isAnswer) {
        flush(true);
        result.push({
          items: [item],
          followedByAnswer: false,
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
  const finalAnswerIndex = getFinalAnswerIndex(visibleAssistantItems, isTurnComplete);
  const finalAnswerItem = finalAnswerIndex >= 0 ? visibleAssistantItems[finalAnswerIndex] : null;
  const executionItems =
    finalAnswerIndex >= 0
      ? visibleAssistantItems.filter((_, index) => index !== finalAnswerIndex)
      : [];
  const executionSummary = getExecutionSummary(executionItems);
  const latestToolActivity = toolActivities[toolActivities.length - 1];
  const toolActivityStatus = latestToolActivity
    ? getToolActivityExecutionStatus(latestToolActivity)
    : null;
  const lastVisibleGroup = visibleGroups[visibleGroups.length - 1];
  const lastVisibleGroupFirstItem = lastVisibleGroup?.items[0];
  const hasTrailingExecutionGroup = Boolean(
    lastVisibleGroupFirstItem &&
    !(
      lastVisibleGroupFirstItem.type === 'assistant' &&
      !lastVisibleGroupFirstItem.message.metadata?.isThinking
    ),
  );

  const isExecutionStep = (item: (typeof visibleAssistantItems)[number] | undefined) =>
    item?.type === 'tool_group' ||
    item?.type === 'tool_result' ||
    item?.type === 'system' ||
    (item?.type === 'assistant' && Boolean(item.message.metadata?.isThinking));

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

    const showCompletedSummary = group.followedByAnswer;
    const currentStatus = showCompletedSummary ? null : getCurrentExecutionStatus(group.items);
    const isActiveTool = currentStatus?.kind === ExecutionStatusKind.Tool;
    return (
      <PersistentChainOfThought
        key={`${groupKey}-${showCompletedSummary ? 'summarized' : 'working'}`}
        persistKey={`cot-${turn.id}-${groupKey}`}
        defaultOpen={false}
      >
        <ChainOfThoughtHeader icon={isActiveTool ? Wrench : SparklesIcon}>
          {showCompletedSummary ? (
            getCompletedExecutionSummaryText(getExecutionSummary(group.items))
          ) : currentStatus ? (
            <Shimmer duration={1}>{getExecutionStatusText(currentStatus)}</Shimmer>
          ) : (
            <Shimmer duration={1}>{i18nService.t('coworkIntermediateProcess')}</Shimmer>
          )}
        </ChainOfThoughtHeader>
        <ChainOfThoughtContent>
          {group.items.map((item, idx) =>
            renderItem(item, idx, false, false, true, idx === group.items.length - 1),
          )}
        </ChainOfThoughtContent>
      </PersistentChainOfThought>
    );
  };
  return (
    <div className="px-4 py-2">
      <div className="max-w-5xl min-w-[320px] mx-auto">
        <div className="flex items-start gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-3 px-4 py-3">
            {finalAnswerItem && executionItems.length > 0 && (
              <ExecutionSummary summary={executionSummary} persistKey={`execsummary-${turn.id}`}>
                {executionItems.map((item, index) => {
                  const isAnswer = item.type === 'assistant' && !item.message.metadata?.isThinking;
                  const connectsToNextStep =
                    isExecutionStep(item) && isExecutionStep(executionItems[index + 1]);
                  return renderItem(item, index, false, true, !isAnswer, !connectsToNextStep);
                })}
              </ExecutionSummary>
            )}
            {finalAnswerItem
              ? renderItem(finalAnswerItem, finalAnswerIndex, true)
              : visibleGroups.map((group, index) =>
                  renderExecutionGroup(
                    group,
                    `turn-group-${index}`,
                    index === lastAnswerGroupIndex,
                  ),
                )}
            {toolActivityStatus && !finalAnswerItem && !hasTrailingExecutionGroup && (
              <ChainOfThought key="transient-working-summary" defaultOpen={false}>
                <ChainOfThoughtHeader icon={Wrench}>
                  <Shimmer duration={1}>{getExecutionStatusText(toolActivityStatus)}</Shimmer>
                </ChainOfThoughtHeader>
              </ChainOfThought>
            )}
            {showTypingIndicator && <TypingDots />}
            {artifacts?.some(artifact => artifact.role === ArtifactRole.Deliverable) && (
              <div className="flex flex-wrap gap-2 pt-1">
                {artifacts
                  .filter(artifact => artifact.role === ArtifactRole.Deliverable)
                  .map(artifact => (
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

// Memo boundary: with stabilized turn references, completed turns skip
// re-rendering entirely while the streaming tail updates (issue #141).
export const TurnBlock = React.memo(TurnBlockComponent);
