'use client';

import { CodeBlock } from '@shared/components/ai-elements/code-block';
import { ToolState } from '@shared/components/ai-elements/constants';
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
  ClockIcon,
  Loader2Icon,
  WrenchIcon,
  XCircleIcon,
} from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { isValidElement } from 'react';

import { i18nService } from '../../services/i18n';

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
  [ToolState.InputAvailable]: <Loader2Icon className="animate-spin motion-reduce:animate-none" />,
  [ToolState.InputStreaming]: <Loader2Icon className="animate-spin motion-reduce:animate-none" />,
  [ToolState.OutputAvailable]: <CheckCircleIcon />,
  [ToolState.OutputDenied]: <XCircleIcon />,
  [ToolState.OutputError]: <XCircleIcon />,
};

const getStatusBadge = (status: ToolPart['state'], customLabel?: string) => {
  const label = customLabel ?? i18nService.t(statusLabelKeys[status]);
  const iconOnly = status === ToolState.OutputAvailable && customLabel === undefined;
  return (
    <Badge
      className="theme-chat-tool-status"
      variant="secondary"
      data-tool-state={status}
      aria-label={iconOnly ? label : undefined}
      title={iconOnly ? label : undefined}
    >
      {statusIcons[status]}
      {iconOnly ? null : label}
    </Badge>
  );
};

const getCompactInputEntries = (input: ToolPart['input']): Array<[string, string]> | null => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const entries = Object.entries(input as Record<string, unknown>).filter(
    ([, val]) => val !== undefined,
  );
  if (entries.length === 0 || entries.length > 6) return null;
  const formatted: Array<[string, string]> = [];
  for (const [key, val] of entries) {
    if (
      val !== null &&
      typeof val !== 'string' &&
      typeof val !== 'number' &&
      typeof val !== 'boolean'
    ) {
      return null;
    }
    const text = String(val);
    if (text.includes('\n') || text.length > 160) return null;
    formatted.push([key, text]);
  }
  return formatted;
};

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
        'theme-chat-tool-trigger group/trigger -mx-2 flex w-full items-center gap-2',
        className,
      )}
      {...props}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="theme-chat-tool-icon flex shrink-0 items-center justify-center">
          {icon ?? <WrenchIcon className="theme-chat-tool-icon" />}
        </span>
        <span className="theme-chat-tool-title shrink-0 truncate">{title ?? derivedName}</span>
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
    className={cn('theme-chat-tool-content ml-2 flex min-w-0 flex-col gap-2', className)}
    {...props}
  />
);

export type ToolInputProps = ComponentProps<'div'> & {
  input: ToolPart['input'];
  /** Redacted serialized input for display; the original input stays intact. */
  displayText?: string;
};

export const ToolInput = ({ className, input, displayText, ...props }: ToolInputProps) => {
  const compactEntries = displayText ? null : getCompactInputEntries(input);
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5 overflow-hidden', className)} {...props}>
      <h4 className="theme-chat-tool-label">{i18nService.t('coworkToolInput')}</h4>
      {compactEntries ? (
        <dl className="theme-conversation-tool-params grid min-w-0 grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          {compactEntries.map(([key, val]) => (
            <div key={key} className="contents">
              <dt className="font-mono text-muted-foreground">{key}</dt>
              <dd className="min-w-0 wrap-anywhere font-mono text-foreground">{val}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <CodeBlock compact code={displayText ?? JSON.stringify(input, null, 2)} language="json" />
      )}
    </div>
  );
};

export type ToolOutputProps = ComponentProps<'div'> & {
  output: ToolPart['output'];
  errorText: ToolPart['errorText'];
};

export const ToolOutput = ({ className, output, errorText, ...props }: ToolOutputProps) => {
  if (!(output || errorText)) {
    return null;
  }

  let Output: ReactNode = null;

  if (typeof output === 'object' && !isValidElement(output)) {
    Output = <CodeBlock compact code={JSON.stringify(output, null, 2)} language="json" />;
  } else if (typeof output === 'string') {
    Output = <CodeBlock compact code={output} language="text" />;
  } else if (output) {
    Output = <div>{output as ReactNode}</div>;
  }

  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)} {...props}>
      {(!errorText || Output) && (
        <h4 className="theme-chat-tool-label">
          {i18nService.t(errorText ? 'codingAgentToolFailed' : 'coworkToolResult')}
        </h4>
      )}
      <div className="flex min-w-0 flex-col gap-2 overflow-x-auto [&_table]:w-full">
        {errorText && (
          <div className="theme-conversation-tool-error whitespace-pre-wrap wrap-anywhere">
            {errorText}
          </div>
        )}
        {Output}
      </div>
    </div>
  );
};
