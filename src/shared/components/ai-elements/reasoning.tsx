'use client';

import { useControllableState } from '@radix-ui/react-use-controllable-state';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@shared/components/ui/collapsible';
import { cn } from '@shared/lib/utils';
import { cjk } from '@streamdown/cjk';
import { ChevronDownIcon } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import React, {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Streamdown, type StreamdownProps } from 'streamdown';
import { ThinkingOrb } from 'thinking-orbs';

import { LinkSafetyModal } from './linkSafetyModal';
import { Shimmer } from './shimmer';

// Same on-demand pipeline as MessageResponse: plain reasoning text never
// pays for the Shiki/KaTeX/Mermaid runtimes (issue #141).
const RichMessageResponse = React.lazy(() => import('./richMessageResponse'));

interface ReasoningContextValue {
  isStreaming: boolean;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  duration: number | undefined;
  showConnector: boolean;
}

const ReasoningContext = createContext<ReasoningContextValue | null>(null);

export const useReasoning = () => {
  const context = useContext(ReasoningContext);
  if (!context) {
    throw new Error('Reasoning components must be used within Reasoning');
  }
  return context;
};

export type ReasoningProps = ComponentProps<typeof Collapsible> & {
  isStreaming?: boolean;
  autoClose?: boolean;
  showConnector?: boolean;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  duration?: number;
};

const AUTO_CLOSE_DELAY = 1000;
const MS_IN_S = 1000;

export const Reasoning = memo(
  ({
    className,
    isStreaming = false,
    autoClose = true,
    showConnector = false,
    open,
    defaultOpen,
    onOpenChange,
    duration: durationProp,
    children,
    ...props
  }: ReasoningProps) => {
    const resolvedDefaultOpen = defaultOpen ?? isStreaming;
    const isExplicitlyClosed = defaultOpen === false;
    const userClosedRef = useRef(false);

    const [isOpen, setIsOpen] = useControllableState<boolean>({
      defaultProp: resolvedDefaultOpen,
      onChange: onOpenChange,
      prop: open,
    });
    const [duration, setDuration] = useControllableState<number | undefined>({
      defaultProp: undefined,
      prop: durationProp,
    });

    const hasEverStreamedRef = useRef(isStreaming);
    const [hasAutoClosed, setHasAutoClosed] = useState(false);
    const startTimeRef = useRef<number | null>(isStreaming ? Date.now() : null);

    // Track when streaming starts and compute duration when it settles
    useEffect(() => {
      if (isStreaming) {
        hasEverStreamedRef.current = true;
        setHasAutoClosed(false);
        if (startTimeRef.current === null) {
          startTimeRef.current = Date.now();
        }
      } else if (startTimeRef.current !== null) {
        setDuration(Math.ceil((Date.now() - startTimeRef.current) / MS_IN_S));
        startTimeRef.current = null;
      }
    }, [isStreaming, setDuration]);

    // Auto-open when streaming starts (unless explicitly configured closed or user closed it)
    useEffect(() => {
      if (isStreaming && !isOpen && !isExplicitlyClosed && !userClosedRef.current) {
        setIsOpen(true);
      }
    }, [isStreaming, isOpen, setIsOpen, isExplicitlyClosed]);

    // Auto-close when streaming ends (once only, and only if it ever streamed)
    useEffect(() => {
      if (autoClose && hasEverStreamedRef.current && !isStreaming && isOpen && !hasAutoClosed) {
        const timer = setTimeout(() => {
          setIsOpen(false);
          setHasAutoClosed(true);
        }, AUTO_CLOSE_DELAY);

        return () => clearTimeout(timer);
      }
    }, [autoClose, isStreaming, isOpen, setIsOpen, hasAutoClosed]);

    const handleOpenChange = useCallback(
      (newOpen: boolean) => {
        userClosedRef.current = !newOpen;
        setIsOpen(newOpen);
      },
      [setIsOpen],
    );

    const contextValue = useMemo(
      () => ({ duration, isOpen, isStreaming, setIsOpen, showConnector }),
      [duration, isOpen, isStreaming, setIsOpen, showConnector],
    );

    return (
      <ReasoningContext.Provider value={contextValue}>
        <Collapsible
          className={cn('not-prose', className)}
          onOpenChange={handleOpenChange}
          open={isOpen}
          {...props}
        >
          {children}
        </Collapsible>
      </ReasoningContext.Provider>
    );
  },
);

export type ReasoningTriggerProps = ComponentProps<typeof CollapsibleTrigger> & {
  getThinkingMessage?: (isStreaming: boolean, duration?: number) => ReactNode;
};

const defaultGetThinkingMessage = (isStreaming: boolean, duration?: number) => {
  if (isStreaming || duration === 0) {
    return (
      <Shimmer as="span" duration={1}>
        Thinking...
      </Shimmer>
    );
  }
  if (duration === undefined) {
    return <span>Thought for a few seconds</span>;
  }
  return <span>Thought for {duration} seconds</span>;
};

export const ReasoningTrigger = memo(
  ({
    className,
    children,
    getThinkingMessage = defaultGetThinkingMessage,
    ...props
  }: ReasoningTriggerProps) => {
    const { isStreaming, isOpen, duration } = useReasoning();

    return (
      <CollapsibleTrigger
        className={cn(
          'theme-fold-reasoning -mx-2 flex w-fit max-w-full items-center gap-2',
          className,
        )}
        {...props}
      >
        {children ?? (
          <>
            <ThinkingOrb state="working" size={20} paused={!isStreaming} aria-hidden="true" />
            {getThinkingMessage(isStreaming, duration)}
            <ChevronDownIcon
              className={cn('theme-chat-tool-chevron shrink-0', isOpen ? 'rotate-180' : 'rotate-0')}
            />
          </>
        )}
      </CollapsibleTrigger>
    );
  },
);

export type ReasoningContentProps = ComponentProps<typeof CollapsibleContent> & {
  children: string;
};

const basePlugins = { cjk };

// 2026/09/15 lixiang  外链确认弹窗换为 portal 到 body 的自定义弹窗，避免被消息祖先节点裁剪（见 linkSafetyModal.tsx）
const linkSafety: StreamdownProps['linkSafety'] = {
  enabled: true,
  renderModal: props => <LinkSafetyModal {...props} />,
};

// Fenced code, math or mermaid content needs the rich plugin pipeline.
const RICH_CONTENT_PATTERN = /```|~~~|\$\$|\\\(|\\\[|\$[^$\n]+?\$|(?:^|\n)(?: {4,}|\t+)\S/;

export const ReasoningContent = memo(({ className, children, ...props }: ReasoningContentProps) => {
  const { isStreaming, showConnector } = useReasoning();
  const scrollRef = useRef<HTMLDivElement>(null);
  const userScrolledUpRef = useRef(false);

  const text = typeof children === 'string' ? children : '';

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    const handleScroll = () => {
      const distanceToBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
      userScrolledUpRef.current = distanceToBottom > 32;
    };

    element.addEventListener('scroll', handleScroll, { passive: true });
    return () => element.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    if (!isStreaming) {
      userScrolledUpRef.current = false;
    }
  }, [isStreaming]);

  useEffect(() => {
    if (isStreaming && scrollRef.current && !userScrolledUpRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [text, isStreaming]);

  const proseClassName =
    'size-full text-inherit [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&>p+p]:mt-2';

  const base = (
    <Streamdown
      className={proseClassName}
      mode="streaming"
      parseIncompleteMarkdown={isStreaming}
      isAnimating={isStreaming}
      plugins={basePlugins}
      linkSafety={linkSafety}
    >
      {text}
    </Streamdown>
  );

  const content = RICH_CONTENT_PATTERN.test(text) ? (
    <React.Suspense fallback={base}>
      <RichMessageResponse
        className={proseClassName}
        mode="streaming"
        parseIncompleteMarkdown={isStreaming}
        isAnimating={isStreaming}
      >
        {text}
      </RichMessageResponse>
    </React.Suspense>
  ) : (
    base
  );

  return (
    <CollapsibleContent
      className={cn(
        'theme-reasoning-panel pt-1 pb-1.5',
        showConnector && 'theme-reasoning-panel-indented ml-2',
        className,
      )}
      {...props}
    >
      <div
        ref={scrollRef}
        className="min-w-0 max-h-64 overflow-y-auto overscroll-contain scrollbar-gutter-stable [overflow-anchor:none]"
      >
        {content}
      </div>
    </CollapsibleContent>
  );
});

Reasoning.displayName = 'Reasoning';
ReasoningTrigger.displayName = 'ReasoningTrigger';
ReasoningContent.displayName = 'ReasoningContent';
