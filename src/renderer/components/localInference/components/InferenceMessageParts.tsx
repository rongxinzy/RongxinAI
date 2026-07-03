import {
  ChevronRightIcon,
  ClipboardDocumentIcon,
  ExclamationTriangleIcon,
  ServerStackIcon,
} from '@heroicons/react/24/outline';
import { useCallback, useEffect, useRef, useState } from 'react';

import { i18nService } from '../../../services/i18n';
import MarkdownContent from '../../MarkdownContent';
import type { InferenceMessage, LocalInferenceInlineError } from '../types';
import {
  formatMessageTimestamp,
  formatMetricsSummary,
  formatThoughtDuration,
} from '../utils/chat';

export function ChatBubble({
  message,
  streaming = false,
}: {
  message: InferenceMessage;
  streaming?: boolean;
}) {
  const isUser = message.role === 'user';
  const hasThinking = Boolean(message.thinking?.trim());
  const hasVisibleContent = Boolean(message.content.trim());
  const [reasoningOpen, setReasoningOpen] = useState(streaming);

  useEffect(() => {
    if (streaming) {
      setReasoningOpen(true);
      return;
    }
    if (hasThinking && hasVisibleContent) {
      setReasoningOpen(false);
    }
  }, [hasThinking, hasVisibleContent, streaming]);

  return (
    <article className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={isUser ? 'max-w-[86%]' : 'w-full'}>
        {isUser ? (
          <div className="flex justify-end">
            <div className="w-fit rounded-2xl bg-primary px-4 py-2.5 text-sm leading-7 text-primary-foreground shadow-sm">
              <div className="whitespace-pre-wrap break-words">{message.content}</div>
            </div>
          </div>
        ) : (
          <div className="text-sm leading-7 text-foreground">
            {hasThinking && (
              <ReasoningPanel
                content={message.thinking ?? ''}
                isOpen={reasoningOpen}
                isStreaming={streaming && !hasVisibleContent}
                durationSeconds={message.reasoningDurationSeconds}
                onToggle={() => setReasoningOpen(current => !current)}
              />
            )}
            {message.waiting && <WaitingDots />}
            {message.content.trim() ? (
              <div className="mt-1">
                <MarkdownContent content={message.content} />
                {streaming && !message.waiting && hasVisibleContent && (
                  <span className="ml-0.5 inline-block h-4 w-2 animate-pulse bg-foreground/45 align-text-bottom" />
                )}
              </div>
            ) : null}
          </div>
        )}
        <MessageMetaRow message={message} isUser={isUser} />
      </div>
    </article>
  );
}

function ReasoningPanel({
  content,
  isOpen,
  isStreaming,
  durationSeconds,
  onToggle,
}: {
  content: string;
  isOpen: boolean;
  isStreaming: boolean;
  durationSeconds?: number;
  onToggle: () => void;
}) {
  return (
    <div className="mb-3">
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center gap-2 text-left text-sm text-secondary transition-colors hover:text-foreground [&>span:first-child]:hidden"
      >
        <span className="text-base leading-none">+</span>
        <ThinkingStatusText isStreaming={isStreaming} durationSeconds={durationSeconds} />
        <ChevronRightIcon className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
      </button>
      {isOpen && <ThinkingContent content={content} streaming={isStreaming} />}
    </div>
  );
}

function MessageMetaRow({
  message,
  isUser,
}: {
  message: InferenceMessage;
  isUser: boolean;
}) {
  const handleCopy = useCallback(async () => {
    const segments = [message.content.trim(), message.thinking?.trim() ?? ''].filter(Boolean);
    await navigator.clipboard.writeText(segments.join('\n\n'));
  }, [message.content, message.thinking]);

  return (
    <div
      className={`mt-2 flex flex-wrap items-center gap-3 text-xs text-secondary ${
        isUser ? 'justify-end' : 'justify-start'
      }`}
    >
      <span>{formatMessageTimestamp(message.createdAt)}</span>
      <button
        type="button"
        onClick={() => void handleCopy()}
        className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
        title={i18nService.t('copy')}
      >
        <ClipboardDocumentIcon className="h-4 w-4" />
      </button>
      {!isUser && message.metrics && <span>{formatMetricsSummary(message.metrics)}</span>}
    </div>
  );
}

function ThinkingStatusText({
  isStreaming,
  durationSeconds,
}: {
  isStreaming: boolean;
  durationSeconds?: number;
}) {
  if (isStreaming) {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-secondary">
        <span>{i18nService.t('localInferenceThinkingInProgress')}</span>
        <span className="flex items-center gap-1 pt-px">
          <span className="h-1 w-1 rounded-full bg-current animate-pulse" />
          <span className="h-1 w-1 rounded-full bg-current animate-pulse [animation-delay:150ms]" />
          <span className="h-1 w-1 rounded-full bg-current animate-pulse [animation-delay:300ms]" />
        </span>
      </span>
    );
  }

  return <span>{formatThoughtDuration(durationSeconds)}</span>;
}

function ThinkingContent({
  content,
  streaming,
}: {
  content: string;
  streaming: boolean;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [hasOverflow, setHasOverflow] = useState(false);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const wrapper = wrapperRef.current;
      const element = contentRef.current;
      if (!wrapper || !element) return;
      if (!streaming) {
        element.style.transform = 'translateY(0)';
        setHasOverflow(element.scrollHeight > wrapper.clientHeight);
        return;
      }
      const wrapperHeight = wrapper.clientHeight;
      const contentHeight = element.scrollHeight;
      if (contentHeight > wrapperHeight) {
        element.style.transform = `translateY(-${contentHeight - wrapperHeight}px)`;
        setHasOverflow(true);
      } else {
        element.style.transform = 'translateY(0)';
        setHasOverflow(false);
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [content, streaming]);

  return (
    <div
      ref={wrapperRef}
      className={`relative ml-2 mt-2 max-h-48 rounded-xl border-l-2 border-dotted border-border-subtle pl-4 ${
        streaming
          ? 'overflow-hidden'
          : 'overflow-y-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
      }`}
    >
      <div
        ref={contentRef}
        className={`whitespace-pre-wrap break-words pr-1 text-sm leading-7 text-secondary/85 ${
          streaming ? 'transition-transform duration-200' : ''
        }`}
      >
        {content}
        {streaming && (
          <span className="ml-0.5 inline-block h-4 w-2 animate-pulse bg-foreground/45 align-text-bottom" />
        )}
      </div>
      {streaming && hasOverflow && (
        <div className="pointer-events-none absolute inset-x-0 top-0 h-8 bg-gradient-to-b from-surface-raised/95 to-transparent" />
      )}
    </div>
  );
}

function WaitingDots() {
  return (
    <div
      className="inline-flex items-center gap-1 rounded-full border border-border-subtle bg-surface-raised px-3 py-2"
      aria-label={i18nService.t('localInferenceAwaitingResponse')}
    >
      {[0, 1, 2].map(index => (
        <span
          key={index}
          className="h-1.5 w-1.5 animate-pulse rounded-full bg-secondary"
          style={{ animationDelay: `${index * 120}ms` }}
        />
      ))}
    </div>
  );
}

export function InferenceInlineErrorCard({
  error,
  onOpenModels,
}: {
  error: LocalInferenceInlineError;
  onOpenModels: () => void;
}) {
  const detail =
    error.kind === 'context-overflow' &&
    error.requestedTokens != null &&
    error.availableTokens != null
      ? i18nService
        .t('localInferenceContextOverflowDetails')
        .replace('{requested}', error.requestedTokens.toLocaleString())
        .replace('{available}', error.availableTokens.toLocaleString())
      : null;

  return (
    <div className="rounded-[24px] border border-red-500/20 bg-red-500/10 px-5 py-4 text-left shadow-sm">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-red-500/12 text-red-500">
          <ExclamationTriangleIcon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="space-y-1">
            <p className="text-base font-semibold text-red-400">
              {i18nService.t('localInferenceContextOverflowTitle')}
            </p>
            <p className="text-sm text-red-100/75">
              {i18nService.t('localInferenceContextOverflowDescription')}
            </p>
            {detail ? <p className="text-xs text-red-100/60">{detail}</p> : null}
          </div>
          <button
            type="button"
            onClick={onOpenModels}
            className="inline-flex h-10 items-center gap-2 rounded-full border border-red-400/25 bg-white/5 px-4 text-sm font-medium text-white transition-colors hover:bg-white/10"
          >
            <ServerStackIcon className="h-4 w-4" />
            {i18nService.t('localInferenceOpenModels')}
          </button>
        </div>
      </div>
    </div>
  );
}
