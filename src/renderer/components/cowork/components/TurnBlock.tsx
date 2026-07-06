import { Info, TriangleAlert } from 'lucide-react';
import React from 'react';

import type { CoworkErrorKind } from '../../../../common/coworkError';
import { getUserErrorI18nKey } from '../../../../common/coworkError';
import { getScheduledReminderDisplayText } from '../../../../scheduledTask/reminderText';
import { i18nService } from '../../../services/i18n';
import type { Artifact } from '../../../types/artifact';
import type { CoworkMessage, CoworkMessageMetadata } from '../../../types/cowork';
import { ArtifactPreviewCard } from '../../artifacts';
import type { AssistantTurnItem,ConversationTurn } from '../helpers/messageGrouping';
import { getToolResultLineCount,getVisibleAssistantItems } from '../helpers/messageGrouping';
import { getToolResultDisplay,hasText } from '../helpers/toolUtils';
import { AssistantBubble } from './AssistantBubble';
import { CoworkChain } from './CoworkChain';
import { TypingDots } from './StreamingBar';

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
    // If the main process stored an errorKind, translate it via i18n so the
    // user sees a friendly message (e.g. "任务执行出错，请重试…") instead of
    // the raw Pi error string (e.g. "content is not iterable").
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

  // Split items into "chain" (thinking + tool calls) and "visible" (final text, etc.)
  const { chainItems, visibleItems } = React.useMemo(() => {
    const chain: AssistantTurnItem[] = [];
    const visible: AssistantTurnItem[] = [];

    for (const item of visibleAssistantItems) {
      if (
        item.type === 'assistant' && item.message.metadata?.isThinking
      ) {
        chain.push(item);
      } else if (item.type === 'tool_group') {
        chain.push(item);
      } else {
        visible.push(item);
      }
    }

    return { chainItems: chain, visibleItems: visible };
  }, [visibleAssistantItems]);

  const hasChain = chainItems.length > 0;

  return (
    <div className="px-4 py-2">
      <div className="max-w-5xl min-w-[320px] mx-auto">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0 px-4 py-3 space-y-3">
            {/* ── Chain of Thought wrapper (thinking + tool calls) ── */}
            {hasChain ? (
              <CoworkChain items={chainItems} mapDisplayText={mapDisplayText}>
                {/* Visible non-chain items rendered after the chain */}
                {visibleItems.map((item) => renderVisibleItem(item, visibleItems))}
              </CoworkChain>
            ) : (
              /* No chain: render everything flat (backward compatible) */
              visibleItems.map((item) => renderVisibleItem(item, visibleItems))
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

  // ── helper ──

  function renderVisibleItem(
    item: AssistantTurnItem,
    allVisible: AssistantTurnItem[],
  ) {
    if (item.type === 'assistant') {
      const itemIndex = allVisible.indexOf(item);
      const hasToolGroupAfter = allVisible.slice(itemIndex + 1).some(
        (laterItem) => laterItem.type === 'tool_group',
      );
      const isLastAssistant = showCopyButtons && !hasToolGroupAfter;
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
    if (item.type === 'system') {
      const systemMessage = renderSystemMessage(item.message);
      if (!systemMessage) return null;
      return <div key={item.message.id}>{systemMessage}</div>;
    }
    if (item.type === 'tool_result') {
      return <div key={item.message.id}>{renderOrphanToolResult(item.message)}</div>;
    }
    return null;
  }
};
