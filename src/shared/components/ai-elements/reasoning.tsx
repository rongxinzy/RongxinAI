'use client';

import { useControllableState } from '@radix-ui/react-use-controllable-state';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@shared/components/ui/collapsible';
import { cn } from '@shared/lib/utils';
import { cjk } from '@streamdown/cjk';
import { BrainIcon, ChevronDownIcon } from 'lucide-react';
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
import { Streamdown } from 'streamdown';

import { Shimmer } from './shimmer';
import {
  isPlainTextStreamingTail,
  useAdaptiveTextReveal,
  useStreamingTextSegments,
} from './streamingText';

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
    // Track if defaultOpen was explicitly set to false (to prevent auto-open)
    const isExplicitlyClosed = defaultOpen === false;

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
    const startTimeRef = useRef<number | null>(null);

    // Track when streaming starts and compute duration
    useEffect(() => {
      if (isStreaming) {
        hasEverStreamedRef.current = true;
        if (startTimeRef.current === null) {
          startTimeRef.current = Date.now();
        }
      } else if (startTimeRef.current !== null) {
        setDuration(Math.ceil((Date.now() - startTimeRef.current) / MS_IN_S));
        startTimeRef.current = null;
      }
    }, [isStreaming, setDuration]);

    // Auto-open when streaming starts (unless explicitly closed)
    useEffect(() => {
      if (isStreaming && !isOpen && !isExplicitlyClosed) {
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
          className={cn('not-prose', showConnector ? 'relative mb-0' : 'mb-4', className)}
          onOpenChange={handleOpenChange}
          open={isOpen}
          {...props}
        >
          {showConnector && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute top-5 -bottom-3 left-2 w-px bg-border"
            />
          )}
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
    return <Shimmer duration={1}>Thinking...</Shimmer>;
  }
  if (duration === undefined) {
    return <p>Thought for a few seconds</p>;
  }
  return <p>Thought for {duration} seconds</p>;
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
        className={cn('theme-fold-reasoning flex w-full items-center gap-2', className)}
        {...props}
      >
        {children ?? (
          <>
            <BrainIcon className="size-4" />
            {getThinkingMessage(isStreaming, duration)}
            <ChevronDownIcon
              className={cn('size-4 transition-transform', isOpen ? 'rotate-180' : 'rotate-0')}
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

// Fenced code, math or mermaid content needs the rich plugin pipeline.
const RICH_CONTENT_PATTERN = /```|~~~|\$\$|\\\(|\\\[|\$[^$\n]+?\$|(?:^|\n)(?: {4,}|\t+)\S/;

export const ReasoningContent = memo(({ className, children, ...props }: ReasoningContentProps) => {
  const { isStreaming, showConnector } = useReasoning();

  const text = typeof children === 'string' ? children : '';
  const { committed, tail } = useStreamingTextSegments(text, isStreaming);
  const shouldAnimateTail = isStreaming && Boolean(tail) && isPlainTextStreamingTail(tail);
  const revealedTail = useAdaptiveTextReveal(tail, shouldAnimateTail);
  const base = <Streamdown plugins={basePlugins}>{text}</Streamdown>;
  const streamingContent = (
    <>
      {committed && <Streamdown plugins={basePlugins}>{committed}</Streamdown>}
      {revealedTail && <div className="whitespace-pre-wrap wrap-break-word">{revealedTail}</div>}
    </>
  );
  const content = isStreaming ? (
    streamingContent
  ) : RICH_CONTENT_PATTERN.test(text) ? (
    <React.Suspense fallback={base}>
      <RichMessageResponse>{text}</RichMessageResponse>
    </React.Suspense>
  ) : (
    base
  );

  return (
    <CollapsibleContent
      className={cn(
        'theme-reasoning-panel mt-4',
        showConnector && 'theme-reasoning-panel-indented',
        className,
      )}
      {...props}
    >
      <div className="min-w-0 max-h-64 overflow-y-auto overscroll-contain scrollbar-gutter-stable [overflow-anchor:none]">
        {content}
      </div>
    </CollapsibleContent>
  );
});

Reasoning.displayName = 'Reasoning';
ReasoningTrigger.displayName = 'ReasoningTrigger';
ReasoningContent.displayName = 'ReasoningContent';
