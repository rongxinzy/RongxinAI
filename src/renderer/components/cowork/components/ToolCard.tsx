import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from '@shared/components/ai-elements/tool';
import { ToolState } from '@shared/components/ai-elements/constants';
import { Button } from '@shared/components/ui/button';
import React, { useMemo } from 'react';

import { i18nService } from '../../../services/i18n';
import type { CoworkPermissionRequest, CoworkPermissionResult } from '../../../types/cowork';
import type { ToolGroupItem } from '../helpers/messageGrouping';
import {
  getToolDisplayName,
  getToolInputSummary,
  getToolResultDisplay,
} from '../helpers/toolUtils';
import { usePersistentToggle } from '../hooks/usePersistentToggle';
import { CoworkContentNotice } from './CoworkContentNotice';
import { ToolPermissionActions } from './ToolPermissionActions';

const TOOL_RESULT_COLLAPSE_LINE_LIMIT = 200;

/** Adapts persisted messages to the official Tool components. */
export const ToolCard: React.FC<{
  group: ToolGroupItem;
  mapDisplayText?: (value: string) => string;
  forceExpand?: boolean;
  pendingPermission?: CoworkPermissionRequest | null;
  onRespondToPermission?: (result: CoworkPermissionResult) => void;
}> = ({
  group,
  mapDisplayText,
  forceExpand = false,
  pendingPermission = null,
  onRespondToPermission,
}) => {
  const { toolUse, toolResult } = group;
  const name = typeof toolUse.metadata?.toolName === 'string' ? toolUse.metadata.toolName : 'Tool';
  const awaitingPermission = Boolean(pendingPermission && onRespondToPermission);
  const isError = Boolean(toolResult?.metadata?.isError || toolResult?.metadata?.error);
  const state = awaitingPermission
    ? ToolState.ApprovalRequested
    : toolResult
      ? isError
        ? ToolState.OutputError
        : ToolState.OutputAvailable
      : ToolState.InputAvailable;
  const rawResult = toolResult ? getToolResultDisplay(toolResult) : '';
  const result = mapDisplayText ? mapDisplayText(rawResult) : rawResult;
  const [open, setOpen] = usePersistentToggle(`tool-${toolUse.id}`, false);
  const [expanded, setExpanded] = usePersistentToggle(`toolresult-${toolUse.id}`, false);
  const lines = useMemo(() => result.split('\n'), [result]);
  const collapsible = !isError && lines.length > TOOL_RESULT_COLLAPSE_LINE_LIMIT;
  const visibleResult =
    collapsible && !expanded && !forceExpand
      ? lines.slice(0, TOOL_RESULT_COLLAPSE_LINE_LIMIT).join('\n')
      : result;
  // Preserve display redaction for parameters as well as results.
  const input = toolUse.metadata?.toolInput;
  const displayInput =
    input != null && mapDisplayText ? mapDisplayText(JSON.stringify(input, null, 2)) : undefined;
  const rawSummary = getToolInputSummary(name, input);
  const summary = rawSummary && mapDisplayText ? mapDisplayText(rawSummary) : rawSummary;

  return (
    <Tool
      open={forceExpand || awaitingPermission || open}
      onOpenChange={next => {
        if (!awaitingPermission) setOpen(next);
      }}
    >
      <ToolHeader
        type="dynamic-tool"
        toolName={name}
        state={state}
        title={getToolDisplayName(name)}
        summary={summary ?? undefined}
        statusAtEnd
      />
      <ToolContent>
        {input != null && <ToolInput input={input} displayText={displayInput} />}
        {toolResult && (
          <ToolOutput
            output={isError ? undefined : visibleResult || undefined}
            errorText={isError ? result || i18nService.t('coworkToolNoErrorDetail') : undefined}
          />
        )}
        {collapsible && !forceExpand && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
          >
            {i18nService.t(expanded ? 'coworkToolResultCollapse' : 'coworkToolResultShowAll')}
          </Button>
        )}
        <CoworkContentNotice truncated={toolResult?.metadata?.contentTruncated} />
        {pendingPermission && onRespondToPermission && (
          <ToolPermissionActions permission={pendingPermission} onRespond={onRespondToPermission} />
        )}
      </ToolContent>
    </Tool>
  );
};
