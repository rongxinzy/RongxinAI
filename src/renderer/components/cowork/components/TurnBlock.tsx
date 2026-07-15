import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtHeader,
} from '@shared/components/ai-elements/chain-of-thought';
import { Reasoning, ReasoningContent, ReasoningTrigger } from '@shared/components/ai-elements/reasoning';
import { Shimmer } from '@shared/components/ai-elements/shimmer';
import { Info, SparklesIcon, TriangleAlert } from 'lucide-react';
import React from 'react';

import type { CoworkErrorKind } from '../../../../common/coworkError';
import { getUserErrorI18nKey } from '../../../../common/coworkError';
import { getScheduledReminderDisplayText } from '../../../../scheduledTask/reminderText';
import { i18nService } from '../../../services/i18n';
import type { Artifact } from '../../../types/artifact';
import type { CoworkMessage, CoworkMessageMetadata } from '../../../types/cowork';
import { ArtifactPreviewCard } from '../../artifacts';
import type { ConversationTurn } from '../helpers/messageGrouping';
import { getToolResultLineCount,getVisibleAssistantItems } from '../helpers/messageGrouping';
import { getToolResultDisplay,hasText } from '../helpers/toolUtils';
import { AssistantBubble } from './AssistantBubble';
import { TypingDots } from './StreamingBar';
import { ToolCard } from './ToolCard';

export const TurnBlock: React.FC<{
  turn: ConversationTurn;
  artifacts?: Artifact[];
  resolveLocalFilePath?: (href: string, text: string) => string | null;
  mapDisplayText?: (value: string) => string;
  showTypingIndicator?: boolean;
  showCopyButtons?: boolean;
}> = ({ turn, artifacts, resolveLocalFilePath, mapDisplayText, showTypingIndicator = false, showCopyButtons = true }) => {
  const visibleAssistantItems = getVisibleAssistantItems(turn.assistantItems);

  const renderSystemMessage = (message: CoworkMessage) => {
    const isError = !hasText(message.content) && typeof message.metadata?.error === 'string';
    const errorKind = message.metadata?.errorKind as CoworkErrorKind | undefined;
    const i18nKey = isError && errorKind ? getUserErrorI18nKey(errorKind) : null;
    const i18nMessage = i18nKey ? i18nService.t(i18nKey) : null;
    const rawContent = i18nMessage
      ? i18nMessage
      : hasText(message.content) ? message.content
      : (typeof message.metadata?.error === 'string' ? message.metadata.error : '');
    const normalizedContent = getScheduledReminderDisplayText(rawContent) ?? rawContent;
    const content = mapDisplayText ? mapDisplayText(normalizedContent) : normalizedContent;
    if (!content.trim()) return null;
    return (
      <div className="rounded-lg border border-border bg-background px-3 py-2">
        <div className="flex items-center gap-2">
          {isError ? (
            <TriangleAlert className="size-4 text-muted-foreground flex-shrink-0" />
          ) : (
            <Info className="size-4 text-muted-foreground flex-shrink-0" />
          )}
          <div className="text-xs whitespace-pre-wrap text-muted-foreground">{content}</div>
        </div>
      </div>
    );
  };

  const renderOrphanToolResult = (message: CoworkMessage) => {
    const toolResultDisplayRaw = getToolResultDisplay(message);
    const toolResultDisplay = mapDisplayText ? mapDisplayText(toolResultDisplayRaw) : toolResultDisplayRaw;
    const isToolError = Boolean(message.metadata?.isError || message.metadata?.error);
    const hasToolResultText = hasText(toolResultDisplay);
    const resultLineCount = hasToolResultText ? getToolResultLineCount(toolResultDisplay) : 0;
    const showNoDetailError = isToolError && !hasToolResultText;
    const fallbackText = showNoDetailError ? i18nService.t('coworkToolNoErrorDetail') : '';
    const displayText = hasToolResultText ? toolResultDisplay : fallbackText;
    return (
      <div className="py-1">
        <div className="flex items-start gap-2">
          <span className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${isToolError ? 'bg-red-500' : 'bg-surface-raised'}`} />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-muted-foreground">{i18nService.t('coworkToolResult')}</div>
            {resultLineCount > 0 && <div className="text-xs text-muted mt-0.5">{resultLineCount} {resultLineCount === 1 ? 'line' : 'lines'} of output</div>}
            {resultLineCount === 0 && showNoDetailError && <div className={`text-xs mt-0.5 ${isToolError ? 'text-red-500/80' : 'text-muted'}`}>{fallbackText}</div>}
            {(hasToolResultText || showNoDetailError) && (
              <div className="mt-2 px-3 py-2 rounded-lg bg-surface-raised max-h-64 overflow-y-auto">
                <pre className={`text-xs whitespace-pre-wrap break-words font-mono ${isToolError ? 'text-red-500' : hasToolResultText ? 'text-foreground' : 'text-muted-foreground italic'}`}>{displayText}</pre>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  // Find the last non-thinking assistant item (final answer)
  const lastAnswerIndex = (() => {
    for (let i = visibleAssistantItems.length - 1; i >= 0; i--) {
      const item = visibleAssistantItems[i];
      if (item.type === 'assistant' && !item.message.metadata?.isThinking) {
        return i;
      }
    }
    return -1;
  })();

  // Turn is "done" when the final answer exists and is not streaming.
  const finalAnswerItem = lastAnswerIndex >= 0 ? visibleAssistantItems[lastAnswerIndex] : null;
  const isTurnDone = finalAnswerItem?.type === 'assistant'
    && !finalAnswerItem.message.metadata?.isStreaming
    && lastAnswerIndex > 0; // need at least one step before the answer

  // Split: execution steps (everything before final answer) vs final answer.
  const executionSteps = isTurnDone ? visibleAssistantItems.slice(0, lastAnswerIndex) : [];
  const stepsAfterFinal = isTurnDone ? visibleAssistantItems.slice(lastAnswerIndex + 1) : [];
  const stepCount = executionSteps.length;

  const renderItem = (item: typeof visibleAssistantItems[0], _idx: number, isFinalAnswer: boolean) => {
    // ── Thinking: collapsed Reasoning block with shimmer ──
    if (item.type === 'assistant' && item.message.metadata?.isThinking) {
      const meta = item.message.metadata;
      const isStreaming = Boolean(meta?.isStreaming);
      const isFinal = Boolean(meta?.isFinal);
      const content = mapDisplayText
        ? mapDisplayText(item.message.content)
        : item.message.content;
      return (
        <Reasoning
          key={item.message.id}
          isStreaming={isStreaming}
          defaultOpen={isStreaming}
        >
          <ReasoningTrigger
            getThinkingMessage={(s, d) => {
              if (s) return <Shimmer duration={1}>思考中…</Shimmer>;
              if (isFinal) return <p>{d ? `已思考 ${d} 秒` : '思考完成'}</p>;
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
          mapDisplayText={mapDisplayText}
        />
      );
    }

    // ── Orphan tool result ──
    if (item.type === 'tool_result') {
      return (
        <div key={item.message.id}>
          {renderOrphanToolResult(item.message)}
        </div>
      );
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
          turnMetadata={isLastAssistant ? (item.message.metadata as CoworkMessageMetadata) : undefined}
        />
      );
    }

    return null;
  };

  return (
    <div className="px-4 py-2">
      <div className="max-w-5xl min-w-[320px] mx-auto">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0 px-4 py-3 space-y-3">
            {isTurnDone ? (
              <>
                {/* Execution steps wrapped in collapsible chain */}
                <ChainOfThought defaultOpen={false}>
                  <ChainOfThoughtHeader icon={SparklesIcon}>
                    执行步骤（{stepCount} 步）
                  </ChainOfThoughtHeader>
                  <ChainOfThoughtContent>
                    {executionSteps.map((item, idx) => renderItem(item, idx, false))}
                  </ChainOfThoughtContent>
                </ChainOfThought>
                {/* Final answer — always visible */}
                {finalAnswerItem && renderItem(finalAnswerItem, lastAnswerIndex, true)}
                {stepsAfterFinal.map((item, idx) =>
                  renderItem(item, lastAnswerIndex + 1 + idx, false)
                )}
              </>
            ) : (
              /* Streaming / no answer yet: everything inline in chronological order */
              visibleAssistantItems.map((item, idx) =>
                renderItem(item, idx, idx === lastAnswerIndex)
              )
            )}
            {showTypingIndicator && <TypingDots />}
            {artifacts && artifacts.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {artifacts.map(artifact => <ArtifactPreviewCard key={artifact.id} artifact={artifact} />)}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
