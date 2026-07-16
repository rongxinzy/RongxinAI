import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtHeader,
} from '@shared/components/ai-elements/chain-of-thought';
import { Reasoning, ReasoningContent, ReasoningTrigger } from '@shared/components/ai-elements/reasoning';
import { Shimmer } from '@shared/components/ai-elements/shimmer';
import { Brain, Info, SparklesIcon, TriangleAlert, Wrench } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';

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

  const renderItem = (
    item: typeof visibleAssistantItems[0],
    _idx: number,
    isFinalAnswer: boolean,
    streamingOverride?: boolean,
  ) => {
    // ── Thinking: collapsed Reasoning block with shimmer ──
    if (item.type === 'assistant' && item.message.metadata?.isThinking) {
      const meta = item.message.metadata;
      const isStreaming = streamingOverride ?? (Boolean(meta?.isStreaming) && !meta?.isFinal);
      const isComplete = Boolean(meta?.isFinal) || streamingOverride === false;
      const content = mapDisplayText
        ? mapDisplayText(item.message.content)
        : item.message.content;
      return (
          <Reasoning
            key={item.message.id}
            isStreaming={isStreaming}
            defaultOpen={true}
            autoClose={false}
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

  // Build step groups: consecutive non-answer items grouped into a single
  // ChainOfThought with a dynamic summary. Answer items appear inline.
  const groups = (() => {
    const result: Array<{ summary: string; items: typeof visibleAssistantItems; streaming: boolean; streamingType: 'thinking' | 'tool' | null }> = [];
    let currentItems: typeof visibleAssistantItems = [];

    const flush = (followedByAnswer = false) => {
      if (currentItems.length === 0) return;
      // An answer after thinking means thinking is definitely done, regardless of metadata.
      const hasStreaming = currentItems.some(item => {
        if (item.type === 'assistant') {
          const meta = item.message.metadata;
          if (followedByAnswer) return false; // answer appeared → thinking is done
          return Boolean(meta?.isStreaming) && !meta?.isFinal;
        }
        if (item.type === 'tool_group') return !item.group.toolResult;
        return false;
      });
      const streamingItem = hasStreaming
        ? (() => {
            for (let i = currentItems.length - 1; i >= 0; i--) {
              const it = currentItems[i];
              if (it.type === 'assistant') {
                const m = it.message.metadata;
                if (followedByAnswer) continue; // answer appeared → thinking done
                if (Boolean(m?.isStreaming) && !m?.isFinal) return it;
              }
              if (it.type === 'tool_group' && !it.group.toolResult) return it;
            }
            return null;
          })()
        : null;
      let summary: string;
      let streamingType: 'thinking' | 'tool' | null = null;
      if (hasStreaming && streamingItem) {
        if (streamingItem.type === 'assistant') {
          summary = '思考中…';
          streamingType = 'thinking';
        } else if (streamingItem.type === 'tool_group') {
          summary = getToolSummary(
            streamingItem.group.toolUse.metadata?.toolName as string
          );
          streamingType = 'tool';
        } else {
          summary = '执行中…';
        }
      } else {
        summary = `执行步骤（${currentItems.length} 步）`;
      }
      result.push({ summary, items: [...currentItems], streaming: hasStreaming, streamingType });
      currentItems = [];
    };

    for (const item of visibleAssistantItems) {
      const isAnswer = item.type === 'assistant' && !item.message.metadata?.isThinking;
      const isStep = item.type === 'assistant' && item.message.metadata?.isThinking
        || item.type === 'tool_group';

      if (isAnswer) {
        flush(true); // answer follows → thinking before it is done
        result.push({ summary: '', items: [item], streaming: Boolean(item.message.metadata?.isStreaming), streamingType: null });
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
  const hasStreamingGroups = groups.some((group) => group.streaming);
  const [intermediateOpen, setIntermediateOpen] = useState(hasStreamingGroups);
  const wasStreamingRef = useRef(hasStreamingGroups);

  useEffect(() => {
    if (hasStreamingGroups) {
      setIntermediateOpen(true);
    } else if (wasStreamingRef.current) {
      setIntermediateOpen(false);
    }
    wasStreamingRef.current = hasStreamingGroups;
  }, [hasStreamingGroups]);

  const intermediateGroups = groups.filter((_, index) => index !== lastAnswerGroupIndex);
  const intermediateItemCount = intermediateGroups.reduce((count, group) => count + group.items.length, 0);
  const finalAnswerGroup = lastAnswerGroupIndex >= 0 ? groups[lastAnswerGroupIndex] : null;

  const renderIntermediateGroup = (group: typeof groups[number], groupKey: string) => {
    const firstItem = group.items[0];
    const isAnswerItem = firstItem?.type === 'assistant' && !firstItem.message.metadata?.isThinking;
    if (isAnswerItem) {
      return renderItem(firstItem, 0, false);
    }

    const isStreaming = group.streaming;
    const headerIcon = isStreaming
      ? group.streamingType === 'thinking' ? Brain
      : group.streamingType === 'tool' ? Wrench
      : SparklesIcon
      : SparklesIcon;
    return (
      <ChainOfThought key={groupKey} defaultOpen={true}>
        <ChainOfThoughtHeader icon={headerIcon}>
          {isStreaming
            ? <span className="animate-pulse">{group.summary}</span>
            : group.summary}
        </ChainOfThoughtHeader>
        <ChainOfThoughtContent>
          {group.items.map((item, idx) => renderItem(item, idx, false, isStreaming))}
        </ChainOfThoughtContent>
      </ChainOfThought>
    );
  };

  return (
    <div className="px-4 py-2">
      <div className="max-w-5xl min-w-[320px] mx-auto">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0 px-4 py-3 space-y-3">
            {intermediateGroups.length > 0 && (
              <ChainOfThought open={intermediateOpen} onOpenChange={setIntermediateOpen}>
                <ChainOfThoughtHeader icon={SparklesIcon}>
                  {i18nService.t('coworkIntermediateProcess').replace('{count}', String(intermediateItemCount))}
                </ChainOfThoughtHeader>
                <ChainOfThoughtContent>
                  {intermediateGroups.map((group, index) => renderIntermediateGroup(group, `intermediate-${index}`))}
                </ChainOfThoughtContent>
              </ChainOfThought>
            )}
            {finalAnswerGroup && renderItem(finalAnswerGroup.items[0], lastAnswerGroupIndex, true)}
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

  function getToolSummary(toolName?: string): string {
    switch (toolName) {
      case 'bash': return '正在执行命令…';
      case 'read': return '正在读取文件…';
      case 'write': return '正在写入文件…';
      case 'edit': return '正在编辑文件…';
      case 'grep': return '正在搜索…';
      case 'find': return '正在查找文件…';
      case 'ls': return '正在列出目录…';
      case 'mcp': return '正在调用工具…';
      default: return toolName ? `正在执行 ${toolName}…` : '执行中…';
    }
  }
};
