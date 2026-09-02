import { useCallback, useEffect, useRef, useState } from 'react';

const BASE_CHARACTERS_PER_SECOND = 120;
const CATCH_UP_WINDOW_MS = 300;
const MAX_CHARACTERS_PER_SECOND = 1_600;
const IMMEDIATE_SYNC_BACKLOG = 2_000;
const MARKDOWN_SYNTAX = /(^|\n)\s{0,3}(#{1,6}\s|[-*+]\s|\d+\.\s|>|`{3,}|~{3,})|[`*_~\[\]<>|$]/;

export const isPlainTextStreamingTail = (content: string): boolean =>
  !MARKDOWN_SYNTAX.test(content);

export const shouldResetTextReveal = (previousContent: string, nextContent: string): boolean =>
  !nextContent.startsWith(previousContent);

export const getRevealCharacterCount = (backlog: number, elapsedMs: number): number => {
  if (backlog <= 0) return 0;
  if (backlog >= IMMEDIATE_SYNC_BACKLOG) return backlog;

  const catchUpRate = (backlog * 1_000) / CATCH_UP_WINDOW_MS;
  const charactersPerSecond = Math.min(
    MAX_CHARACTERS_PER_SECOND,
    Math.max(BASE_CHARACTERS_PER_SECOND, catchUpRate),
  );
  return Math.min(backlog, Math.max(1, Math.floor((charactersPerSecond * elapsedMs) / 1_000)));
};

export type StreamingTextSegments = {
  committed: string;
  tail: string;
};

const getLastStableBoundary = (content: string): number => {
  let boundary = 0;
  let fence: { character: string; length: number } | null = null;
  let offset = 0;

  for (const line of content.split(/(?<=\n)/)) {
    offset += line.length;
    const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      if (!fence) {
        fence = { character: marker[0], length: marker.length };
      } else if (marker[0] === fence.character && marker.length >= fence.length) {
        fence = null;
        boundary = offset;
      }
      continue;
    }

    if (!fence && line.trim().length === 0) {
      boundary = offset;
    }
  }

  return boundary;
};

/** Commits complete Markdown blocks while streaming; only the tail remains mutable. */
export class StreamingTextSegmenter {
  private committed = '';
  private tail = '';
  private previousContent = '';
  private wasStreaming = false;

  update(content: string, isStreaming: boolean): StreamingTextSegments {
    if (!isStreaming) {
      this.committed = content;
      this.tail = '';
      this.previousContent = content;
      this.wasStreaming = false;
      return this.snapshot();
    }

    const isAppend = this.wasStreaming && content.startsWith(this.previousContent);
    if (isAppend) {
      this.tail += content.slice(this.previousContent.length);
    } else {
      this.committed = '';
      this.tail = content;
    }

    this.previousContent = content;
    this.wasStreaming = true;
    const boundary = getLastStableBoundary(this.tail);
    if (boundary > 0) {
      this.committed += this.tail.slice(0, boundary);
      this.tail = this.tail.slice(boundary);
    }

    return this.snapshot();
  }

  private snapshot(): StreamingTextSegments {
    return { committed: this.committed, tail: this.tail };
  }
}

export const useStreamingTextSegments = (
  content: string,
  isStreaming: boolean,
): StreamingTextSegments => {
  const segmenterRef = useRef<StreamingTextSegmenter | null>(null);
  if (!segmenterRef.current) {
    segmenterRef.current = new StreamingTextSegmenter();
  }

  return segmenterRef.current.update(content, isStreaming);
};

export const useAdaptiveTextReveal = (content: string, enabled: boolean): string => {
  const [visibleContent, setVisibleContent] = useState(enabled ? '' : content);
  const targetRef = useRef(content);
  const visibleRef = useRef(enabled ? '' : content);
  const enabledRef = useRef(enabled);
  const frameRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef<number | null>(null);

  const stop = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    lastFrameTimeRef.current = null;
  }, []);

  const start = useCallback(() => {
    if (frameRef.current !== null) return;

    const tick = (timestamp: number) => {
      if (!enabledRef.current) {
        frameRef.current = null;
        return;
      }
      const lastFrameTime = lastFrameTimeRef.current ?? timestamp;
      lastFrameTimeRef.current = timestamp;
      const target = targetRef.current;
      const visible = visibleRef.current;
      const revealed = getRevealCharacterCount(
        target.length - visible.length,
        timestamp - lastFrameTime,
      );

      if (revealed > 0) {
        const next = target.slice(0, visible.length + revealed);
        visibleRef.current = next;
        setVisibleContent(next);
      }

      if (visibleRef.current.length < targetRef.current.length) {
        frameRef.current = requestAnimationFrame(tick);
      } else {
        frameRef.current = null;
        lastFrameTimeRef.current = null;
      }
    };

    frameRef.current = requestAnimationFrame(tick);
  }, []);

  useEffect(() => {
    enabledRef.current = enabled;
    if (!enabled) {
      stop();
      targetRef.current = content;
      visibleRef.current = content;
      setVisibleContent(content);
      return;
    }

    if (shouldResetTextReveal(targetRef.current, content)) {
      visibleRef.current = '';
      setVisibleContent('');
    }
    targetRef.current = content;
    start();
  }, [content, enabled, start, stop]);

  useEffect(() => stop, [stop]);

  const needsImmediateReset = enabled && shouldResetTextReveal(targetRef.current, content);
  return enabled ? (needsImmediateReset ? '' : visibleContent) : content;
};
