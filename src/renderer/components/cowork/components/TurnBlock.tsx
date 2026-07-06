import { Info, TriangleAlert } from 'lucide-react';
import React from 'react';

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
import { ThinkingBlock } from './ThinkingBlock';
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
    const rawContent = hasText(message.content) ? message.content
      : (typeof message.metadata?.error === 'string' ? message.metadata.error : '');
    const normalizedContent = getScheduledReminderDisplayText(rawContent) ?? rawContent;
    const content = mapDisplayText ? mapDisplayText(normalizedContent) : normalizedContent;
    if (!content.trim()) return null;
    return (
      <div className="rounded-lg border border-border bg-background px-3 py-2">
        <div className="flex items-center gap-2">
          {isError ? <TriangleAlert className="h-4 w-4 text-secondary flex-shrink-0" />
            : <Info className="h-4 w-4 text-secondary flex-shrink-0" />}
          <div className="text-xs whitespace-pre-wrap text-secondary">{content}</div>
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
            <div className="text-sm font-medium text-secondary">{i18nService.t('coworkToolResult')}</div>
            {resultLineCount > 0 && <div className="text-xs text-muted mt-0.5">{resultLineCount} {resultLineCount === 1 ? 'line' : 'lines'} of output</div>}
            {resultLineCount === 0 && showNoDetailError && <div className={`text-xs mt-0.5 ${isToolError ? 'text-red-500/80' : 'text-muted'}`}>{fallbackText}</div>}
            {(hasToolResultText || showNoDetailError) && (
              <div className="mt-2 px-3 py-2 rounded-lg bg-surface-raised max-h-64 overflow-y-auto">
                <pre className={`text-xs whitespace-pre-wrap break-words font-mono ${isToolError ? 'text-red-500' : hasToolResultText ? 'text-foreground' : 'text-secondary italic'}`}>{displayText}</pre>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="px-4 py-2">
      <div className="max-w-5xl min-w-[320px] mx-auto">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0 px-4 py-3 space-y-3">
            {visibleAssistantItems.map((item, index) => {
              if (item.type === 'assistant') {
                if (item.message.metadata?.isThinking) {
                  return <ThinkingBlock key={item.message.id} message={item.message} mapDisplayText={mapDisplayText} />;
                }
                const hasToolGroupAfter = visibleAssistantItems.slice(index + 1).some(laterItem => laterItem.type === 'tool_group');
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
              if (item.type === 'tool_group') {
                const nextItem = visibleAssistantItems[index + 1];
                const isLastInSequence = !nextItem || nextItem.type !== 'tool_group';
                return <ToolCard key={`tool-${item.group.toolUse.id}`} group={item.group} isLastInSequence={isLastInSequence} mapDisplayText={mapDisplayText} />;
              }
              if (item.type === 'system') {
                const systemMessage = renderSystemMessage(item.message);
                if (!systemMessage) return null;
                return <div key={item.message.id}>{systemMessage}</div>;
              }
              return <div key={item.message.id}>{renderOrphanToolResult(item.message)}</div>;
            })}
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
