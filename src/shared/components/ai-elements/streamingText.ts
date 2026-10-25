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

const STABLE_COMMIT_BATCH_CHARACTERS = 8_192;

type Fence = { character: string; length: number };

/** Commits complete Markdown blocks while streaming; only the tail remains mutable. */
export class StreamingTextSegmenter {
  private committed = '';
  private tail = '';
  private previousContent = '';
  private wasStreaming = false;
  private pendingLine = '';
  private fence: Fence | null = null;
  private segments: StreamingTextSegments = { committed: '', tail: '' };

  update(content: string, isStreaming: boolean): StreamingTextSegments {
    // Reveal animation frames reuse the source text; do not rescan Markdown on each frame.
    if (content === this.previousContent && isStreaming === this.wasStreaming) return this.segments;
    if (!isStreaming) {
      this.committed = content;
      this.tail = '';
      this.pendingLine = '';
      this.fence = null;
      this.previousContent = content;
      this.wasStreaming = false;
      return this.snapshot();
    }

    const isAppend = this.wasStreaming && content.startsWith(this.previousContent);
    const appended = isAppend ? content.slice(this.previousContent.length) : content;
    if (!isAppend) {
      this.committed = '';
      this.tail = content;
      this.pendingLine = '';
      this.fence = null;
    } else {
      this.tail += appended;
    }

    this.previousContent = content;
    this.wasStreaming = true;
    this.consumeCompleteLines(appended);
    return this.snapshot();
  }

  private consumeCompleteLines(appended: string): void {
    const completedTailLength = this.tail.length - appended.length - this.pendingLine.length;
    this.pendingLine += appended;
    let processedLength = 0;
    let stableBoundary = 0;
    let newlineIndex = this.pendingLine.indexOf('\n');
    while (newlineIndex >= 0) {
      const line = this.pendingLine.slice(0, newlineIndex + 1);
      this.pendingLine = this.pendingLine.slice(newlineIndex + 1);
      processedLength += line.length;
      if (this.consumeLine(line)) stableBoundary = completedTailLength + processedLength;
      newlineIndex = this.pendingLine.indexOf('\n');
    }
    if (
      this.pendingLine &&
      (this.fence || this.pendingLine.trim().length === 0) &&
      this.consumeLine(this.pendingLine)
    ) {
      this.pendingLine = '';
      stableBoundary = this.tail.length;
    }
    if (stableBoundary >= STABLE_COMMIT_BATCH_CHARACTERS) {
      this.committed += this.tail.slice(0, stableBoundary);
      this.tail = this.tail.slice(stableBoundary);
    }
  }

  private consumeLine(line: string): boolean {
    const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      if (!this.fence) {
        this.fence = { character: marker[0], length: marker.length };
      } else if (marker[0] === this.fence.character && marker.length >= this.fence.length) {
        this.fence = null;
        return true;
      }
      return false;
    }
    return !this.fence && line.trim().length === 0;
  }

  private snapshot(): StreamingTextSegments {
    this.segments = { committed: this.committed, tail: this.tail };
    return this.segments;
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
