import { ToolState } from '@shared/components/ai-elements/constants';
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockTitle,
} from '@shared/components/ai-elements/code-block';
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
  type ToolPart,
} from '../../ai-elements/tool';
import {
  Terminal,
  TerminalActions,
  TerminalContent,
  TerminalCopyButton,
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
import React, { useMemo } from 'react';

import { i18nService } from '../../../services/i18n';
import type { CoworkPermissionResult } from '../../../types/cowork';
import { CoworkContentNotice } from '../../cowork/components/CoworkContentNotice';
import { usePersistentToggle } from '../../cowork/hooks/usePersistentToggle';
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
    const [open, setOpen] = usePersistentToggle(`tool-open:${part.toolCallId}`, false);
    const [expandedOutput, setExpandedOutput] = usePersistentToggle(
      `tool-output:${part.toolCallId}`,
      false,
    );

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
    const pythonCode =
      part.category === 'python' && typeof part.input?.code === 'string' ? part.input.code : null;
    const pythonCollapse = useMemo(
      () => (pythonCode ? collapseToolText(pythonCode) : { preview: '', collapsible: false }),
      [pythonCode],
    );
    const visiblePythonCode =
      pythonCode === null
        ? null
        : pythonCollapse.collapsible && !showFull
          ? pythonCollapse.preview
          : pythonCode;

    return (
      <div
        data-tool-name={part.toolName}
        data-tool-state={part.phase}
        data-conversation-anchor={`tool:${part.toolCallId}`}
      >
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
                  {visibleOutput ? (
                    <TerminalActions>
                      <TerminalCopyButton />
                    </TerminalActions>
                  ) : null}
                </TerminalHeader>
                <TerminalContent />
              </Terminal>
            ) : visiblePythonCode !== null ? (
              <>
                <CodeBlock compact code={visiblePythonCode} language="python" showLineNumbers>
                  <CodeBlockHeader>
                    <CodeBlockTitle>
                      <FileCode2 className="size-3.5" />
                      <span className="font-mono text-xs text-muted-foreground">python</span>
                    </CodeBlockTitle>
                    <CodeBlockActions>
                      <CodeBlockCopyButton />
                    </CodeBlockActions>
                  </CodeBlockHeader>
                </CodeBlock>
                {!part.isError && part.output !== undefined && (
                  <ToolOutput output={visibleOutput || undefined} errorText={undefined} />
                )}
              </>
            ) : (
              <>
                {part.input != null && <ToolInput input={part.input} displayText={visibleInput} />}
                {webSources.length > 0 && <SourcePills sources={webSources} />}
                {!part.isError && part.output !== undefined && (
                  <ToolOutput output={visibleOutput || undefined} errorText={undefined} />
                )}
              </>
            )}

            {part.isError && (
              <ToolOutput
                output={undefined}
                errorText={visibleOutput || i18nService.t('coworkToolNoErrorDetail')}
              />
            )}

            {(pythonCollapse.collapsible ||
              (inputCollapse.collapsible && !diffSpec && pythonCode === null) ||
              outputCollapse.collapsible) &&
              !forceExpand && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-expanded={expandedOutput}
                  onClick={() => setExpandedOutput(!expandedOutput)}
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
