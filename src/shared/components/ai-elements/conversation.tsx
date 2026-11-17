'use client';

import { Button } from '@shared/components/ui/button';
import { cn } from '@shared/lib/utils';
import { ArrowDownIcon } from 'lucide-react';
import type { ComponentProps } from 'react';
import { useCallback, useEffect, useRef } from 'react';
import { StickToBottom, useStickToBottom, useStickToBottomContext } from 'use-stick-to-bottom';

export type ConversationProps = Omit<ComponentProps<typeof StickToBottom>, 'children'> & {
  children?: ComponentProps<typeof StickToBottom>['children'];
};

function isWallClockFrozen(startDateMs: number, startPerfMs: number): boolean {
  if (typeof performance === 'undefined') return false;
  const elapsedPerf = performance.now() - startPerfMs;
  const elapsedDate = Date.now() - startDateMs;
  return elapsedPerf > 30 && elapsedDate === 0;
}

/**
 * Chat scroll container powered by `use-stick-to-bottom`.
 * Automatically follows streaming growth at the tail, pauses on user scroll-up,
 * and re-arms when returning to the bottom.
 */
export const Conversation = ({
  className,
  initial = 'instant',
  resize = 'smooth',
  instance: externalInstance,
  targetScrollTop,
  mass,
  damping,
  stiffness,
  children,
  ...props
}: ConversationProps) => {
  const startDateRef = useRef(Date.now());
  const startPerfRef = useRef(typeof performance !== 'undefined' ? performance.now() : 0);
  const fallbackInstance = useStickToBottom({
    initial,
    resize,
    targetScrollTop,
    mass,
    damping,
    stiffness,
  });
  const instance = externalInstance ?? fallbackInstance;
  const instanceRef = useRef(instance);
  instanceRef.current = instance;

  useEffect(() => {
    const content = instance.contentRef.current;
    if (!content || typeof ResizeObserver === 'undefined') return;

    // use-stick-to-bottom schedules ResizeObserver scrolls with `wait: true`
    // (`Number(true) === 1`), which never clears if `Date.now()` is mocked.
    // Re-sync instantly when clocks are frozen (tests) or `resize="instant"`,
    // and otherwise follow smoothly.
    const observer = new ResizeObserver(() => {
      const current = instanceRef.current;
      if (!current.state.isAtBottom || current.state.escapedFromLock) return;
      const clockFrozen = isWallClockFrozen(startDateRef.current, startPerfRef.current);
      const effectiveAnimation = resize === 'instant' || clockFrozen ? 'instant' : resize;
      if (effectiveAnimation === 'instant') {
        current.state.scrollTop = current.state.calculatedTargetScrollTop;
      }
      void current.scrollToBottom({
        animation: effectiveAnimation,
        preserveScrollPosition: true,
      });
    });

    observer.observe(content);
    return () => observer.disconnect();
  }, [instance.contentRef, resize]);

  return (
    <StickToBottom
      className={cn('relative overflow-y-hidden', className)}
      initial={initial}
      resize={resize}
      instance={instance}
      role="log"
      {...props}
    >
      {children}
    </StickToBottom>
  );
};

export type ConversationContentProps = ComponentProps<typeof StickToBottom.Content> & {
  reverse?: boolean;
  scrollClassName?: string;
  scrollTabIndex?: number;
};

export const ConversationContent = ({
  children,
  className,
  reverse = false,
  scrollClassName,
  scrollTabIndex,
  ...props
}: ConversationContentProps) => {
  const resolvedScrollClassName = cn(
    'min-w-0 overflow-x-hidden overflow-y-auto [overflow-anchor:none]',
    scrollClassName,
  );
  const contentClassName = cn(
    'flex min-w-0 gap-6 p-4',
    reverse ? 'flex-col-reverse' : 'flex-col',
    className,
  );

  return (
    <StickToBottom.Content
      {...(scrollTabIndex !== undefined ? { tabIndex: scrollTabIndex } : {})}
      scrollClassName={resolvedScrollClassName}
      className={contentClassName}
      {...props}
    >
      {children}
    </StickToBottom.Content>
  );
};

export type ConversationScrollButtonProps = ComponentProps<typeof Button>;

export const ConversationScrollButton = ({
  className,
  ...props
}: ConversationScrollButtonProps) => {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();

  const handleScrollToBottom = useCallback(() => {
    void scrollToBottom('smooth');
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
        variant="secondary"
        {...props}
      >
        <ArrowDownIcon className="size-4" />
      </Button>
    )
  );
};
