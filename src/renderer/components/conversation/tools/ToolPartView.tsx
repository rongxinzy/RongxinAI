import { ToolState } from '@shared/components/ai-elements/constants';
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
  type ToolPart,
} from '@shared/components/ai-elements/tool';
import {
  Terminal,
  TerminalContent,
  TerminalHeader,
  TerminalTitle,
} from '@shared/components/ai-elements/terminal';
import { DiffPreview, SourcePills } from '@shared/components/conversation';
import { Button } from '@shared/components/ui/button';
import {
  FileCode2,
  FilePenLine,
  FileText,
  Globe,
  Plug,
  Search,
  Sparkles,
  Terminal as TerminalIcon,
  Wrench,
} from 'lucide-react';
import React, { useMemo, useState } from 'react';

import { i18nService } from '../../../services/i18n';
import type { CoworkPermissionResult } from '../../../types/cowork';
import { CoworkContentNotice } from '../../cowork/components/CoworkContentNotice';
import type { ToolCategory, ToolPhase, ToolTurnPart } from '../model/types';
import { ToolApprovalBar } from './ToolApprovalBar';
import {
  collapseToolText,
  extractFileDiffSpec,
  extractWebSources,
  getToolDisplayName,
  getToolInputSummary,
} from './toolFormatters';

const CATEGORY_ICONS: Record<ToolCategory, React.ReactNode> = {
  shell: <TerminalIcon className="theme-chat-tool-icon" />,
  'file-read': <FileText className="theme-chat-tool-icon" />,
  'file-write': <FilePenLine className="theme-chat-tool-icon" />,
  search: <Search className="theme-chat-tool-icon" />,
  web: <Globe className="theme-chat-tool-icon" />,
  mcp: <Plug className="theme-chat-tool-icon" />,
  python: <FileCode2 className="theme-chat-tool-icon" />,
  skill: <Sparkles className="theme-chat-tool-icon" />,
  other: <Wrench className="theme-chat-tool-icon" />,
};

const PHASE_TO_TOOL_STATE: Record<ToolPhase, ToolPart['state']> = {
  'input-streaming': ToolState.InputStreaming,
  'input-available': ToolState.InputAvailable,
  'approval-requested': ToolState.ApprovalRequested,
  running: ToolState.InputAvailable,
  'output-available': ToolState.OutputAvailable,
  'output-error': ToolState.OutputError,
  'output-denied': ToolState.OutputDenied,
};

export interface ToolPartViewProps {
  part: ToolTurnPart;
  forceExpand?: boolean;
  onRespondToPermission?: (result: CoworkPermissionResult) => void | Promise<void>;
}

export const ToolPartView: React.FC<ToolPartViewProps> = React.memo(
  ({ part, forceExpand = false, onRespondToPermission }) => {
    const [open, setOpen] = useState(false);
    const [expandedOutput, setExpandedOutput] = useState(false);

    const awaitingPermission =
      part.phase === 'approval-requested' &&
      Boolean(part.pendingPermission && onRespondToPermission);
    const isOpen = forceExpand || awaitingPermission || open;

    const summary = useMemo(
      () => getToolInputSummary(part.toolName, part.input),
      [part.input, part.toolName],
    );

    const diffSpec = useMemo(
      () => extractFileDiffSpec(part.toolName, part.input),
      [part.input, part.toolName],
    );

    const webSources = useMemo(
      () => (part.category === 'web' ? extractWebSources(part.input, part.output) : []),
      [part.category, part.input, part.output],
    );

    const serializedInput = useMemo(
      () => (part.input != null ? JSON.stringify(part.input, null, 2) : undefined),
      [part.input],
    );

    const outputCollapse = useMemo(() => collapseToolText(part.output ?? ''), [part.output]);
    const inputCollapse = useMemo(
      () =>
        serializedInput ? collapseToolText(serializedInput) : { preview: '', collapsible: false },
      [serializedInput],
    );
    const showFull = expandedOutput || forceExpand;
    const visibleOutput =
      outputCollapse.collapsible && !showFull ? outputCollapse.preview : (part.output ?? '');
    const visibleInput =
      serializedInput === undefined
        ? undefined
        : inputCollapse.collapsible && !showFull
          ? inputCollapse.preview
          : serializedInput;

    const bashCommand =
      part.category === 'shell' && typeof part.input?.command === 'string'
        ? part.input.command
        : null;

    return (
      <div data-tool-name={part.toolName} data-tool-state={part.phase}>
        <Tool
          open={isOpen}
          onOpenChange={next => {
            if (!awaitingPermission) setOpen(next);
          }}
        >
          <ToolHeader
            type="dynamic-tool"
            toolName={part.toolName}
            state={PHASE_TO_TOOL_STATE[part.phase]}
            title={getToolDisplayName(part.toolName)}
            summary={summary ?? undefined}
            icon={CATEGORY_ICONS[part.category]}
            statusAtEnd
          />
          <ToolContent>
            {diffSpec ? (
              <DiffPreview
                fileName={diffSpec.fileName}
                oldContent={diffSpec.oldContent}
                newContent={diffSpec.newContent}
              />
            ) : part.category === 'shell' && bashCommand ? (
              <Terminal
                output={visibleOutput || `$ ${bashCommand}`}
                isStreaming={part.phase === 'running' || part.phase === 'input-streaming'}
              >
                <TerminalHeader>
                  <TerminalTitle>{`$ ${bashCommand}`}</TerminalTitle>
                </TerminalHeader>
                <TerminalContent />
              </Terminal>
            ) : (
              <>
                {part.input != null && <ToolInput input={part.input} displayText={visibleInput} />}
                {webSources.length > 0 && <SourcePills sources={webSources} />}
                {(part.output !== undefined || part.isError) && (
                  <ToolOutput
                    output={part.isError ? undefined : visibleOutput || undefined}
                    errorText={
                      part.isError
                        ? visibleOutput || i18nService.t('coworkToolNoErrorDetail')
                        : undefined
                    }
                  />
                )}
              </>
            )}

            {(outputCollapse.collapsible || inputCollapse.collapsible) &&
              !forceExpand &&
              !diffSpec && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-expanded={expandedOutput}
                  onClick={() => setExpandedOutput(current => !current)}
                >
                  {i18nService.t(
                    expandedOutput ? 'coworkToolResultCollapse' : 'coworkToolResultShowAll',
                  )}
                </Button>
              )}

            <CoworkContentNotice truncated={part.contentTruncated} />

            {awaitingPermission && part.pendingPermission && onRespondToPermission && (
              <ToolApprovalBar
                permission={part.pendingPermission}
                onRespond={onRespondToPermission}
              />
            )}
          </ToolContent>
        </Tool>
      </div>
    );
  },
);

ToolPartView.displayName = 'ToolPartView';
