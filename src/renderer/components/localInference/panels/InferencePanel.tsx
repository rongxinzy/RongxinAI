import {
  ChevronRightIcon,
  CpuChipIcon,
  PaperAirplaneIcon,
  ServerStackIcon,
  StopIcon,
} from '@heroicons/react/24/outline';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { LlamaCppModel as OllamaModel } from '../../../../shared/llamacpp';
import { i18nService } from '../../../services/i18n';
import { EmptyState } from '../components/Common';
import { ChatBubble, InferenceInlineErrorCard } from '../components/InferenceMessageParts';
import { CHAT_MANUAL_SCROLL_OVERRIDE_MS,smallOutlineButtonClass } from '../constants';
import { useI18nLanguage } from '../hooks/useI18nLanguage';
import type { InferenceMessage, LocalInferenceInlineError } from '../types';
import {
  buildStreamingAssistantMessage,
  findLatestUserMessageIndex,
} from '../utils/chat';
import {
  getAssistantScrollTop,
  getNewAssistantScrollTargetIndex,
  hasHiddenContentBelow,
  isScrollNearBottom,
} from '../utils/scroll';

export function InferencePanel({
  isRunning,
  selectedModel,
  loadedModels,
  systemPrompt,
  prompt,
  messages,
  inlineError,
  streamingText,
  streamingThinking,
  sending,
  cancelling,
  onModelChange,
  onSystemPromptChange,
  onPromptChange,
  onSend,
  onStop,
  onOpenModels,
}: {
  isRunning: boolean;
  selectedModel: string;
  loadedModels: OllamaModel[];
  systemPrompt: string;
  prompt: string;
  messages: InferenceMessage[];
  inlineError: LocalInferenceInlineError | null;
  streamingText: string;
  streamingThinking: string;
  sending: boolean;
  cancelling: boolean;
  onModelChange: (value: string) => void;
  onSystemPromptChange: (value: string) => void;
  onPromptChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  onOpenModels: () => void;
}) {
  useI18nLanguage();
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const latestTurnStartRef = useRef<HTMLDivElement>(null);
  const latestTurnScrollTargetIndexRef = useRef<number | null>(null);
  const pendingLatestTurnAlignRef = useRef(false);
  const lockLatestTurnAnchorRef = useRef(false);
  const autoFollowStreamRef = useRef(true);
  const manualScrollOverrideUntilRef = useRef(0);
  const streamFollowFrameRef = useRef<number | null>(null);
  const programmaticScrollRef = useRef<{ mode: 'align' | 'bottom'; until: number } | null>(null);
  const composingRef = useRef(false);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  const currentModelName = selectedModel || loadedModels[0]?.name || '';

  const markProgrammaticScroll = useCallback(
    (mode: 'align' | 'bottom', behavior: ScrollBehavior) => {
      const duration = behavior === 'smooth' ? 400 : 120;
      programmaticScrollRef.current = {
        mode,
        until: window.performance.now() + duration,
      };
    },
    [],
  );

  const stopStreamAutoFollow = useCallback(() => {
    autoFollowStreamRef.current = false;
    manualScrollOverrideUntilRef.current = window.performance.now() + CHAT_MANUAL_SCROLL_OVERRIDE_MS;
    if (streamFollowFrameRef.current !== null) {
      window.cancelAnimationFrame(streamFollowFrameRef.current);
      streamFollowFrameRef.current = null;
    }
  }, []);

  const syncScrollIndicators = useCallback(() => {
    const element = chatScrollRef.current;
    if (!element) return;
    const hiddenBelow = hasHiddenContentBelow({
      scrollTop: element.scrollTop,
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    });
    const nearBottom = isScrollNearBottom({
      scrollTop: element.scrollTop,
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    });
    const activeProgrammaticScroll =
      programmaticScrollRef.current &&
      window.performance.now() <= programmaticScrollRef.current.until
        ? programmaticScrollRef.current
        : null;
    const manualOverrideActive = window.performance.now() <= manualScrollOverrideUntilRef.current;
    if (!activeProgrammaticScroll) {
      programmaticScrollRef.current = null;
      autoFollowStreamRef.current = manualOverrideActive ? false : nearBottom;
    } else if (activeProgrammaticScroll.mode === 'bottom') {
      autoFollowStreamRef.current = true;
      manualScrollOverrideUntilRef.current = 0;
      setShowJumpToBottom(false);
      return;
    } else {
      autoFollowStreamRef.current = false;
    }
    setShowJumpToBottom(hiddenBelow);
  }, []);

  const submitPrompt = () => {
    latestTurnScrollTargetIndexRef.current = getNewAssistantScrollTargetIndex(messages.length);
    pendingLatestTurnAlignRef.current = true;
    lockLatestTurnAnchorRef.current = true;
    autoFollowStreamRef.current = true;
    manualScrollOverrideUntilRef.current = 0;
    onSend();
  };

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = 'smooth') => {
      const element = chatScrollRef.current;
      if (!element) return;
      markProgrammaticScroll('bottom', behavior);
      pendingLatestTurnAlignRef.current = false;
      lockLatestTurnAnchorRef.current = false;
      autoFollowStreamRef.current = true;
      manualScrollOverrideUntilRef.current = 0;
      element.scrollTo({
        top: Math.max(0, element.scrollHeight - element.clientHeight),
        behavior,
      });
    },
    [markProgrammaticScroll],
  );

  const scrollLatestTurnStartIntoView = useCallback(
    (behavior: ScrollBehavior = 'auto') => {
      const container = chatScrollRef.current;
      const element = latestTurnStartRef.current;
      if (!container || !element) return;
      const top = getAssistantScrollTop({
        containerScrollTop: container.scrollTop,
        containerTop: container.getBoundingClientRect().top,
        targetTop: element.getBoundingClientRect().top,
      });
      markProgrammaticScroll('align', behavior);
      autoFollowStreamRef.current = false;
      manualScrollOverrideUntilRef.current = 0;
      container.scrollTo({ top, behavior });
    },
    [markProgrammaticScroll],
  );

  useEffect(() => {
    if (!sending) return;
    if (!pendingLatestTurnAlignRef.current) return;
    if (latestTurnScrollTargetIndexRef.current !== messages.length) return;
    const frame = window.requestAnimationFrame(() => {
      scrollLatestTurnStartIntoView('auto');
      pendingLatestTurnAlignRef.current = false;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [messages.length, scrollLatestTurnStartIntoView, sending]);

  useEffect(() => {
    syncScrollIndicators();
  }, [messages.length, sending, streamingText, streamingThinking, syncScrollIndicators]);

  useEffect(() => {
    if (!sending || pendingLatestTurnAlignRef.current || !autoFollowStreamRef.current) return;
    if (streamFollowFrameRef.current !== null) {
      window.cancelAnimationFrame(streamFollowFrameRef.current);
    }
    streamFollowFrameRef.current = window.requestAnimationFrame(() => {
      streamFollowFrameRef.current = null;
      const element = chatScrollRef.current;
      if (!element) return;
      element.scrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
      syncScrollIndicators();
    });
    return () => {
      if (streamFollowFrameRef.current !== null) {
        window.cancelAnimationFrame(streamFollowFrameRef.current);
        streamFollowFrameRef.current = null;
      }
    };
  }, [sending, streamingText, streamingThinking, syncScrollIndicators]);

  useEffect(() => {
    if (sending) return;
    if (!lockLatestTurnAnchorRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      scrollLatestTurnStartIntoView('auto');
    });
    return () => window.cancelAnimationFrame(frame);
  }, [scrollLatestTurnStartIntoView, sending]);

  useEffect(() => {
    if (sending) return;
    pendingLatestTurnAlignRef.current = false;
    latestTurnScrollTargetIndexRef.current = null;
    lockLatestTurnAnchorRef.current = false;
    autoFollowStreamRef.current = true;
    manualScrollOverrideUntilRef.current = 0;
    programmaticScrollRef.current = null;
  }, [sending]);

  useEffect(() => {
    if (sending || cancelling || !currentModelName) return;
    const frame = window.requestAnimationFrame(() => {
      promptRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [cancelling, currentModelName, sending]);

  if (!isRunning || loadedModels.length === 0) {
    return (
      <EmptyState
        title={i18nService.t(
          !isRunning ? 'localInferenceServiceStopped' : 'localInferenceNoLoadedModels',
        )}
        action={
          <button
            type="button"
            onClick={onOpenModels}
            className="inline-flex h-9 items-center rounded-lg border border-border px-3 text-sm text-foreground hover:bg-surface-raised"
          >
            {i18nService.t('localInferenceOpenModels')}
          </button>
        }
      />
    );
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <div className="shrink-0 border-b border-border-subtle bg-surface/40">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-6 py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate text-base font-medium text-foreground">{currentModelName}</h2>
              <p className="text-xs text-secondary">{i18nService.t('localInferenceTitle')}</p>
            </div>
            <button
              type="button"
              onClick={onOpenModels}
              className={smallOutlineButtonClass}
            >
              <ServerStackIcon className="h-3.5 w-3.5" />
              {i18nService.t('localInferenceOpenModels')}
            </button>
          </div>
          <div className="grid gap-4 lg:grid-cols-[minmax(220px,320px)_minmax(0,1fr)]">
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-secondary">
                {i18nService.t('localInferenceModel')}
              </span>
              <select
                value={currentModelName}
                onChange={event => onModelChange(event.target.value)}
                className="h-10 w-full rounded-xl border border-border bg-surface-input px-3 text-sm text-foreground outline-none transition-colors focus:border-primary/60"
              >
                {loadedModels.map(model => (
                  <option key={model.name} value={model.name}>
                    {model.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1.5">
              <div className="space-y-0.5">
                <span className="text-xs font-medium text-secondary">
                  {i18nService.t('localInferenceSystemPrompt')}
                </span>
                <p className="text-[11px] leading-4 text-secondary">
                  {i18nService.t('localInferenceSystemPromptHint')}
                </p>
              </div>
              <textarea
                value={systemPrompt}
                onChange={event => onSystemPromptChange(event.target.value)}
                className="min-h-24 w-full resize-y rounded-2xl border border-border bg-surface-input px-3 py-3 text-sm text-foreground outline-none transition-colors focus:border-primary/60"
              />
            </label>
          </div>
        </div>
      </div>
      <div
        ref={chatScrollRef}
        className="local-inference-chat-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-0 [scrollbar-gutter:stable_both-edges]"
        onWheelCapture={event => {
          if (sending && event.deltaY < 0) {
            stopStreamAutoFollow();
          }
        }}
        onScroll={syncScrollIndicators}
        style={{
          scrollbarWidth: 'thin',
          scrollbarColor: 'var(--lobster-scroll-thumb) transparent',
          overflowAnchor: 'none',
        }}
      >
        {messages.length === 0 && !sending && (
          <div className="flex min-h-full flex-col items-center justify-center px-6 py-12 text-center">
            <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center gap-5">
              <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-surface-raised text-secondary">
                <CpuChipIcon className="h-8 w-8" />
              </div>
              <div className="space-y-2">
                <p className="text-xl font-medium text-foreground">
                  {i18nService.t('localInferenceEmptyChat')}
                </p>
                <p className="text-sm text-secondary">{currentModelName}</p>
              </div>
            </div>
          </div>
        )}
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 pb-28 pt-8 select-text">
          {messages.map((message, index) => {
            const isLatestTurnStart =
              message.role === 'user' &&
              (sending
                ? index === messages.length - 1
                : index === findLatestUserMessageIndex(messages));
            return (
              <div
                key={index}
                ref={isLatestTurnStart ? latestTurnStartRef : undefined}
                data-message-index={index}
              >
                <ChatBubble message={message} />
              </div>
            );
          })}
          {sending && (
            <div data-message-index={messages.length}>
              <ChatBubble
                message={buildStreamingAssistantMessage({
                  content: streamingText,
                  thinking: streamingThinking,
                })}
                streaming
              />
            </div>
          )}
          {inlineError && (
            <InferenceInlineErrorCard error={inlineError} onOpenModels={onOpenModels} />
          )}
        </div>
      </div>
      {showJumpToBottom && (
        <div className="pointer-events-none absolute inset-x-0 bottom-28 flex justify-center px-4">
          <button
            type="button"
            onClick={() => scrollToBottom()}
            className="pointer-events-auto inline-flex h-10 w-10 items-center justify-center rounded-full border border-border-subtle bg-surface-overlay/95 text-secondary shadow-popover backdrop-blur transition-colors hover:bg-surface-raised hover:text-foreground"
            aria-label={i18nService.t('localInferenceJumpToBottom')}
            title={i18nService.t('localInferenceJumpToBottom')}
          >
            <ChevronRightIcon className="h-4 w-4 rotate-90" />
          </button>
        </div>
      )}
      <div className="sticky bottom-0 z-20 flex-shrink-0 px-6 pb-6 pt-3">
        <div className="mx-auto w-full max-w-5xl rounded-[28px] border border-border bg-surface-overlay/95 p-2 shadow-card backdrop-blur">
          <textarea
            ref={promptRef}
            value={prompt}
            onChange={event => onPromptChange(event.target.value)}
            onCompositionStart={() => {
              composingRef.current = true;
            }}
            onCompositionEnd={() => {
              composingRef.current = false;
            }}
            onKeyDown={event => {
              if (
                event.key === 'Enter' &&
                !event.shiftKey &&
                !sending &&
                !composingRef.current &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                submitPrompt();
              }
            }}
            className="min-h-20 w-full resize-none rounded-3xl border-0 bg-transparent px-4 py-3 text-sm text-foreground outline-none placeholder:text-secondary"
            placeholder={i18nService.t('localInferencePromptPlaceholder')}
          />
          <div className="flex items-center justify-end px-2 pb-1">
            <button
              type="button"
              onClick={sending ? onStop : submitPrompt}
              disabled={!currentModelName || cancelling || (!prompt.trim() && !sending)}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-white transition-colors hover:bg-primary-hover disabled:opacity-40"
              aria-label={
                sending
                  ? i18nService.t('localInferenceStopGeneration')
                  : i18nService.t('localInferenceSend')
              }
            >
              {sending ? (
                <StopIcon className="h-4 w-4" />
              ) : (
                <PaperAirplaneIcon className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
