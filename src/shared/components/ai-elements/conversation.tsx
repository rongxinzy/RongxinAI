'use client';

import { Button } from '@shared/components/ui/button';
import { cn } from '@shared/lib/utils';
import { ArrowDownIcon } from 'lucide-react';

import type { ComponentProps, ReactNode } from 'react';
import { useCallback } from 'react';
import {
  type ConversationViewport,
  ConversationViewportProvider,
  useConversationViewport,
  useConversationViewportContext,
} from './useConversationViewport';

export type ConversationProps = ComponentProps<'div'> & {
  children?: ReactNode | ((viewport: ConversationViewport) => ReactNode);
};

/**
 * Chat scroll container. The scroll position has exactly one owner: either a
 * virtualizer registered through the viewport context, or the follow-bottom
 * hook itself. No second library writes scrollTop here.
 */
export const Conversation = ({ children, ...props }: ConversationProps) => {
  const viewport = useConversationViewport();

  return (
    <ConversationViewportProvider value={viewport}>
      <div {...props}>{typeof children === 'function' ? children(viewport) : children}</div>
    </ConversationViewportProvider>
  );
};

export type ConversationContentProps = ComponentProps<'div'> & {
  /** When false, content-height following is left to an embedded virtualizer. */
  observeContentResize?: boolean;
  reverse?: boolean;
  scrollClassName?: string;
};

export const ConversationContent = ({
  children,
  className,
  observeContentResize = true,
  reverse = true,
  scrollClassName,
  ...props
}: ConversationContentProps) => {
  const viewport = useConversationViewportContext();
  // Browser scroll anchoring would be an unowned second writer of scrollTop:
  // when a node near the top of the viewport is replaced (e.g. a code block
  // swapping to its async shiki-highlighted version) it shifts the viewport,
  // and the follow hook reads that shift as the user scrolling up. The
  // viewport hook / registered virtualizer is the only owner, so turn it off.
  const resolvedScrollClassName = cn(
    'min-w-0 overflow-x-hidden overflow-y-auto [overflow-anchor:none]',
    scrollClassName,
  );
  const contentClassName = cn(
    'flex min-w-0 gap-8 p-4',
    reverse ? 'flex-col-reverse' : 'flex-col',
    className,
  );
  const attachContent = useCallback(
    (element: HTMLDivElement | null) => {
      if (observeContentResize) viewport.attachContentElement(element);
    },
    [observeContentResize, viewport],
  );

  return (
    <div
      ref={viewport.attachScrollElement}
      className={resolvedScrollClassName}
      style={{ height: '100%', width: '100%', scrollbarGutter: 'stable both-edges' }}
    >
      <div {...props} ref={attachContent} className={contentClassName}>
        {children}
      </div>
    </div>
  );
};

export type ConversationScrollButtonProps = ComponentProps<typeof Button>;

export const ConversationScrollButton = ({
  className,
  ...props
}: ConversationScrollButtonProps) => {
  const { isAtBottom, scrollToBottom } = useConversationViewportContext();

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
