'use client';

import { Button } from '@shared/components/ui/button';
import { cn } from '@shared/lib/utils';
import { ArrowDownIcon } from 'lucide-react';

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
