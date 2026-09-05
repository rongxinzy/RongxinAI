'use client';

import { Button } from '@shared/components/ui/button';
import { cn } from '@shared/lib/utils';
import type { UIMessage } from 'ai';
import { ArrowDownIcon, DownloadIcon } from 'lucide-react';
import type { ComponentProps } from 'react';
import { useCallback } from 'react';
import { StickToBottom, useStickToBottomContext } from 'use-stick-to-bottom';

export type ConversationProps = ComponentProps<typeof StickToBottom>;

export const Conversation = ({ className, ...props }: ConversationProps) => (
  <StickToBottom
    className={cn('relative flex-1 overflow-y-hidden', className)}
    initial="smooth"
    resize="smooth"
    role="log"
    {...props}
  />
);

export type ConversationContentProps = ComponentProps<typeof StickToBottom.Content> & {
  observeContentResize?: boolean;
  reverse?: boolean;
};

export const ConversationContent = ({
  children,
  className,
  observeContentResize = true,
  reverse = true,
  scrollClassName,
  ...props
}: ConversationContentProps) => {
  const context = useStickToBottomContext();
  const resolvedScrollClassName = cn('min-w-0 overflow-x-hidden overflow-y-auto', scrollClassName);
  const contentClassName = cn(
    'flex min-w-0 gap-8 p-4',
    reverse ? 'flex-col-reverse' : 'flex-col',
    className,
  );
  const passiveContentRef = useCallback(
    (element: HTMLDivElement | null) => {
      context.contentRef.current = element;
    },
    [context.contentRef],
  );

  if (observeContentResize) {
    return (
      <StickToBottom.Content
        className={contentClassName}
        scrollClassName={resolvedScrollClassName}
        {...props}
      >
        {children}
      </StickToBottom.Content>
    );
  }

  return (
    <div
      ref={context.scrollRef}
      className={resolvedScrollClassName}
      style={{ height: '100%', width: '100%', scrollbarGutter: 'stable both-edges' }}
    >
      <div {...props} ref={passiveContentRef} className={contentClassName}>
        {typeof children === 'function' ? children(context) : children}
      </div>
    </div>
  );
};

export type ConversationEmptyStateProps = ComponentProps<'div'> & {
  title?: string;
  description?: string;
  icon?: React.ReactNode;
};

export const ConversationEmptyState = ({
  className,
  title = 'No messages yet',
  description = 'Start a conversation to see messages here',
  icon,
  children,
  ...props
}: ConversationEmptyStateProps) => (
  <div
    className={cn(
      'flex size-full flex-col items-center justify-center gap-3 p-8 text-center',
      className,
    )}
    {...props}
  >
    {children ?? (
      <>
        {icon && <div className="text-muted-foreground">{icon}</div>}
        <div className="space-y-1">
          <h3 className="font-medium text-sm">{title}</h3>
          {description && <p className="text-muted-foreground text-sm">{description}</p>}
        </div>
      </>
    )}
  </div>
);

export type ConversationScrollButtonProps = ComponentProps<typeof Button>;

export const ConversationScrollButton = ({
  className,
  ...props
}: ConversationScrollButtonProps) => {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();

  const handleScrollToBottom = useCallback(() => {
    scrollToBottom();
  }, [scrollToBottom]);

  return (
    !isAtBottom && (
      <Button
        className={cn(
          'theme-page-conversation-button-variant-1 absolute bottom-4 left-[50%] translate-x-[-50%]',
          className,
        )}
        onClick={handleScrollToBottom}
        size="icon"
        type="button"
        variant="outline"
        {...props}
      >
        <ArrowDownIcon className="size-4" />
      </Button>
    )
  );
};

const getMessageText = (message: UIMessage): string =>
  message.parts
    .filter(part => part.type === 'text')
    .map(part => part.text)
    .join('');

export type ConversationDownloadProps = Omit<ComponentProps<typeof Button>, 'onClick'> & {
  messages: UIMessage[];
  filename?: string;
  formatMessage?: (message: UIMessage, index: number) => string;
};

const defaultFormatMessage = (message: UIMessage): string => {
  const roleLabel = message.role.charAt(0).toUpperCase() + message.role.slice(1);
  return `**${roleLabel}:** ${getMessageText(message)}`;
};

export const messagesToMarkdown = (
  messages: UIMessage[],
  formatMessage: (message: UIMessage, index: number) => string = defaultFormatMessage,
): string => messages.map((msg, i) => formatMessage(msg, i)).join('\n\n');

export const ConversationDownload = ({
  messages,
  filename = 'conversation.md',
  formatMessage = defaultFormatMessage,
  className,
  children,
  ...props
}: ConversationDownloadProps) => {
  const handleDownload = useCallback(() => {
    const markdown = messagesToMarkdown(messages, formatMessage);
    const blob = new Blob([markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }, [messages, filename, formatMessage]);

  return (
    <Button
      className={cn('theme-page-conversation-button-variant-2 absolute top-4 right-4', className)}
      onClick={handleDownload}
      size="icon"
      type="button"
      variant="outline"
      {...props}
    >
      {children ?? <DownloadIcon className="size-4" />}
    </Button>
  );
};
