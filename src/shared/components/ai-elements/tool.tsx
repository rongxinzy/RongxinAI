'use client';

import { Badge } from '@shared/components/ui/badge';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@shared/components/ui/collapsible';
import { cn } from '@shared/lib/utils';
import type { DynamicToolUIPart, ToolUIPart } from 'ai';
import {
  CheckCircleIcon,
  ChevronDownIcon,
  CircleIcon,
  ClockIcon,
  WrenchIcon,
  XCircleIcon,
} from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { isValidElement } from 'react';
import { i18nService } from '../../../renderer/services/i18n';
import { ToolState } from './constants';

import { CodeBlock } from './code-block';

export type ToolProps = ComponentProps<typeof Collapsible>;

export const Tool = ({ className, ...props }: ToolProps) => (
  <Collapsible className={cn('theme-chat-tool group not-prose w-full', className)} {...props} />
);

export type ToolPart = ToolUIPart | DynamicToolUIPart;

export type ToolHeaderProps = {
  title?: string;
  /** A command, path or query that remains readable while details are folded. */
  summary?: string;
  className?: string;
  statusLabel?: string;
  /** Places the execution status beside the collapse control. */
  statusAtEnd?: boolean;
  /** Overrides the default wrench icon, e.g. to reflect an ACP tool kind. */
  icon?: ReactNode;
} & (
  | { type: ToolUIPart['type']; state: ToolUIPart['state']; toolName?: never }
  | {
      type: DynamicToolUIPart['type'];
      state: DynamicToolUIPart['state'];
      toolName: string;
    }
);

const statusLabelKeys: Record<ToolPart['state'], string> = {
  [ToolState.ApprovalRequested]: 'codingAgentPermissionEvent',
  [ToolState.ApprovalResponded]: 'codingAgentPermissionApproved',
  [ToolState.InputAvailable]: 'codingAgentToolRunning',
  [ToolState.InputStreaming]: 'codingAgentToolPending',
  [ToolState.OutputAvailable]: 'codingAgentToolCompleted',
  [ToolState.OutputDenied]: 'codingAgentPermissionRejected',
  [ToolState.OutputError]: 'codingAgentToolFailed',
};

const statusIcons: Record<ToolPart['state'], ReactNode> = {
  [ToolState.ApprovalRequested]: <ClockIcon />,
  [ToolState.ApprovalResponded]: <CheckCircleIcon />,
  [ToolState.InputAvailable]: <ClockIcon />,
  [ToolState.InputStreaming]: <CircleIcon />,
  [ToolState.OutputAvailable]: <CheckCircleIcon />,
  [ToolState.OutputDenied]: <XCircleIcon />,
  [ToolState.OutputError]: <XCircleIcon />,
};

export const getStatusBadge = (
  status: ToolPart['state'],
  label = i18nService.t(statusLabelKeys[status]),
) => (
  <Badge className="theme-chat-tool-status" variant="secondary" data-tool-state={status}>
    {statusIcons[status]}
    {label}
  </Badge>
);

export const ToolHeader = ({
  className,
  title,
  summary,
  type,
  state,
  statusLabel,
  toolName,
  statusAtEnd = false,
  icon,
  ...props
}: ToolHeaderProps) => {
  const derivedName = type === 'dynamic-tool' ? toolName : type.split('-').slice(1).join('-');
  const statusBadge = getStatusBadge(state, statusLabel);

  return (
    <CollapsibleTrigger
      className={cn(
        'theme-chat-tool-trigger group/trigger flex w-full items-center gap-2',
        className,
      )}
      {...props}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="theme-chat-tool-icon flex shrink-0 items-center justify-center">
          {icon ?? <WrenchIcon className="theme-chat-tool-icon" />}
        </span>
        <span className="theme-chat-tool-title min-w-0 truncate">{title ?? derivedName}</span>
        {summary && (
          <span className="theme-chat-tool-summary min-w-0 flex-1 truncate" title={summary}>
            {summary}
          </span>
        )}
        {!statusAtEnd && statusBadge}
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        {statusAtEnd && statusBadge}
        <ChevronDownIcon className="theme-chat-tool-chevron" />
      </div>
    </CollapsibleTrigger>
  );
};

export type ToolContentProps = ComponentProps<typeof CollapsibleContent>;

export const ToolContent = ({ className, ...props }: ToolContentProps) => (
  <CollapsibleContent
    className={cn('theme-chat-tool-content ml-4 flex min-w-0 flex-col gap-3', className)}
    {...props}
  />
);

export type ToolInputProps = ComponentProps<'div'> & {
  input: ToolPart['input'];
  /** Redacted serialized input for display; the original input stays intact. */
  displayText?: string;
};

export const ToolInput = ({ className, input, displayText, ...props }: ToolInputProps) => (
  <div className={cn('flex min-w-0 flex-col gap-2 overflow-hidden', className)} {...props}>
    <h4 className="theme-chat-tool-label">{i18nService.t('coworkToolInput')}</h4>
    <CodeBlock code={displayText ?? JSON.stringify(input, null, 2)} language="json" />
  </div>
);

export type ToolOutputProps = ComponentProps<'div'> & {
  output: ToolPart['output'];
  errorText: ToolPart['errorText'];
};

export const ToolOutput = ({ className, output, errorText, ...props }: ToolOutputProps) => {
  if (!(output || errorText)) {
    return null;
  }

  let Output = <div>{output as ReactNode}</div>;

  if (typeof output === 'object' && !isValidElement(output)) {
    Output = <CodeBlock code={JSON.stringify(output, null, 2)} language="json" />;
  } else if (typeof output === 'string') {
    Output = <CodeBlock code={output} language="text" />;
  }

  return (
    <div className={cn('flex min-w-0 flex-col gap-2', className)} {...props}>
      <h4 className="theme-chat-tool-label">
        {i18nService.t(errorText ? 'codingAgentToolFailed' : 'coworkToolResult')}
      </h4>
      <div
        className={cn(
          'overflow-x-auto whitespace-pre-wrap [&_table]:w-full',
          errorText && 'theme-chat-tool-output-error',
        )}
      >
        {errorText && <div>{errorText}</div>}
        {Output}
      </div>
    </div>
  );
};
