import { Button } from '@shared/components/ui/button';
import {
  Terminal,
  TerminalActions,
  TerminalContent,
  TerminalCopyButton,
  TerminalHeader,
  TerminalStatus,
  TerminalTitle,
} from '@shared/components/ai-elements/terminal';
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from '@shared/components/ai-elements/tool';
import { cn } from '@shared/lib/utils';
import type { ToolUIPart } from 'ai';
import { Check, ChevronDown } from 'lucide-react';
import React, { useMemo } from 'react';

import { i18nService } from '../../../services/i18n';
import DiffView, { extractDiffFromToolInput } from '../DiffView';
import type { ToolGroupItem } from '../helpers/messageGrouping';
import { usePersistentToggle } from '../hooks/usePersistentToggle';
import type { ParsedTodoItem } from '../helpers/toolUtils';
import {
  formatToolInput,
  getRawToolResult,
  getToolDisplayName,
  getToolResultDisplay,
  isTodoWriteToolName,
  parseTodoWriteItems,
} from '../helpers/toolUtils';

/**
 * Long tool results are mounted lazily: beyond this many lines only the
 * head is rendered until the user expands, so a huge output does not
 * create thousands of DOM nodes and Shiki token spans (issue #141).
 */
const TOOL_RESULT_COLLAPSE_LINE_LIMIT = 200;

const TodoWriteInputView: React.FC<{ items: ParsedTodoItem[] }> = ({ items }) => (
  <div className="flex flex-col gap-2">
    {items.map((item, index) => (
      <div key={`todo-item-${index}`} className="flex items-start gap-2">
        <span
          className={`mt-0.5 size-4 rounded-sm border shrink-0 inline-flex items-center justify-center ${
            item.status === 'completed'
              ? 'bg-green-500/10 border-green-500 text-green-500'
              : item.status === 'in_progress'
                ? 'bg-transparent border-blue-500'
                : 'bg-transparent border-border'
          }`}
        >
          {item.status === 'completed' && <Check className="size-3" />}
        </span>
        <div className="min-w-0 flex-1">
          <div
            className={`text-xs whitespace-pre-wrap wrap-break-word leading-5 ${item.status === 'completed' ? 'text-muted' : 'text-foreground'}`}
          >
            {item.primaryText}
          </div>
        </div>
      </div>
    ))}
  </div>
);

export const ToolCard: React.FC<{
  group: ToolGroupItem;
  isLastInSequence?: boolean;
  muted?: boolean;
  mapDisplayText?: (value: string) => string;
  /** Bypass the collapsed-result preview (e.g. image export capture). */
  forceExpand?: boolean;
}> = ({ group, isLastInSequence = true, muted = false, mapDisplayText, forceExpand = false }) => {
  const { toolUse, toolResult } = group;
  const rawToolName =
    typeof toolUse.metadata?.toolName === 'string' ? toolUse.metadata.toolName : 'Tool';
  const displayName = getToolDisplayName(rawToolName);
  const toolInput = toolUse.metadata?.toolInput;
  const mapText = mapDisplayText ?? ((value: string) => value);
  const toolInputDisplay = toolInput
    ? mapText(formatToolInput(rawToolName, toolInput as Record<string, unknown> | undefined) ?? '')
    : null;
  const isBashTool = ['bash', 'exec', 'shell'].includes(rawToolName.toLowerCase());
  const isTodoWriteTool = isTodoWriteToolName(rawToolName);
  const todoItems = isTodoWriteTool ? parseTodoWriteItems(toolInput) : null;
  const diffDataList = useMemo(
    () => extractDiffFromToolInput(rawToolName, toolInput as Record<string, unknown> | undefined),
    [rawToolName, toolInput],
  );
  const isEditWithDiff = diffDataList !== null && diffDataList.length > 0;

  const hasResult = Boolean(toolResult);
  const isError = Boolean(toolResult?.metadata?.isError || toolResult?.metadata?.error);
  const toolState = hasResult
    ? isError
      ? ('output-error' as const)
      : ('output-available' as const)
    : ('input-available' as const);
  const toolResultDisplay = toolResult ? mapText(getToolResultDisplay(toolResult)) : '';
  // Expansion persists across virtualization unmounts and export remounts.
  const [isToolOpen, setIsToolOpen] = usePersistentToggle(`tool-${toolUse.id}`, false);
  const [isResultExpanded, setIsResultExpanded] = usePersistentToggle(
    `toolresult-${toolUse.id}`,
    false,
  );
  const isResultCollapsible = useMemo(() => {
    if (isError || !toolResultDisplay) return false;
    return toolResultDisplay.split('\n').length > TOOL_RESULT_COLLAPSE_LINE_LIMIT;
  }, [isError, toolResultDisplay]);
  const visibleResultDisplay = useMemo(() => {
    if (!isResultCollapsible || isResultExpanded || forceExpand) return toolResultDisplay;
    return toolResultDisplay.split('\n').slice(0, TOOL_RESULT_COLLAPSE_LINE_LIMIT).join('\n');
  }, [isResultCollapsible, isResultExpanded, forceExpand, toolResultDisplay]);
  // Terminal preserves ANSI codes.  Pi runs bash via spawn + pipe (no TTY), so
  // commands won't auto-color.  We force the prompt to cyan, matching the
  // official ai-elements Terminal example (`[36m$`).
  const u001b = String.fromCharCode(0x1b);
  const terminalOutput = hasResult
    ? (toolInputDisplay ? `${u001b}[36m$ ${toolInputDisplay}${u001b}[0m\n` : '') +
      (toolResult ? getRawToolResult(toolResult) : '')
    : (toolInputDisplay ?? '');

  return (
    <div className="relative">
      {!isLastInSequence && (
        <div className="absolute top-full -bottom-3 left-2 w-px bg-border" aria-hidden="true" />
      )}
      <Tool
        className={cn('mb-0', muted && 'text-muted-foreground')}
        open={isToolOpen}
        onOpenChange={setIsToolOpen}
      >
        <ToolHeader
          type={`tool-${rawToolName}` as ToolUIPart['type']}
          state={toolState}
          title={displayName}
        />
        <ToolContent className="flex flex-col gap-4">
          {isBashTool ? (
            <Terminal output={terminalOutput} isStreaming={!hasResult}>
              <TerminalHeader>
                <TerminalTitle>{displayName}</TerminalTitle>
                <div className="flex items-center gap-1">
                  <TerminalStatus />
                  <TerminalActions>
                    <TerminalCopyButton />
                  </TerminalActions>
                </div>
              </TerminalHeader>
              <TerminalContent />
            </Terminal>
          ) : isTodoWriteTool && todoItems ? (
            <TodoWriteInputView items={todoItems} />
          ) : isEditWithDiff && diffDataList ? (
            <div className="flex flex-col gap-2">
              {diffDataList.map((diff, idx) => (
                <DiffView
                  key={idx}
                  oldStr={diff.oldStr}
                  newStr={diff.newStr}
                  filePath={diff.filePath}
                />
              ))}
            </div>
          ) : (
            <>{toolInputDisplay && <ToolInput input={toolInput ?? {}} />}</>
          )}
          {!isBashTool && hasResult && (
            <>
              <ToolOutput
                output={isEditWithDiff ? undefined : visibleResultDisplay || undefined}
                errorText={
                  isError
                    ? toolResultDisplay || i18nService.t('coworkToolNoErrorDetail')
                    : undefined
                }
              />
              {isResultCollapsible && !forceExpand && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-expanded={isResultExpanded}
                  onClick={() => setIsResultExpanded(!isResultExpanded)}
                  className="theme-page-tool-card-button-1 inline-flex items-center self-start"
                >
                  <ChevronDown
                    className={cn(
                      'size-3 transition-transform duration-200',
                      isResultExpanded && 'rotate-180',
                    )}
                  />
                  {isResultExpanded
                    ? i18nService.t('coworkToolResultCollapse')
                    : i18nService.t('coworkToolResultShowAll')}
                </Button>
              )}
            </>
          )}
        </ToolContent>
      </Tool>
    </div>
  );
};
