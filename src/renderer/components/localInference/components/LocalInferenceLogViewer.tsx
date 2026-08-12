import { LazyLog } from '@melloware/react-logviewer';
import { cn } from '@shared/lib/utils';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

type LocalInferenceLogViewerProps = {
  text: string;
  className?: string;
  toolbar?: ReactNode;
};

type LogScrollMetrics = {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
};

const LOG_BOTTOM_TOLERANCE_PX = 4;
const LOG_SCROLL_FRAME_ATTEMPTS = 8;

export function LocalInferenceLogViewer({ text, className, toolbar }: LocalInferenceLogViewerProps) {
  const logViewerRef = useRef<LazyLog | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const previousTextRef = useRef('');
  const followingRef = useRef(true);
  const programmaticScrollRef = useRef(false);
  const [isFollowing, setIsFollowing] = useState(true);
  const [viewerVersion, setViewerVersion] = useState(0);

  const setFollowing = useCallback((nextFollowing: boolean) => {
    if (followingRef.current === nextFollowing) return;
    followingRef.current = nextFollowing;
    setIsFollowing(nextFollowing);
  }, []);

  const handleScroll = useCallback(
    ({ scrollTop, scrollHeight, clientHeight }: LogScrollMetrics) => {
      if (programmaticScrollRef.current || scrollHeight <= clientHeight) return;

      const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
      setFollowing(distanceFromBottom <= LOG_BOTTOM_TOLERANCE_PX);
    },
    [setFollowing],
  );

  const scrollToLatest = useCallback(() => {
    if (!followingRef.current) return true;

    const logViewer = logViewerRef.current;
    const list = logViewer?.listRef.current;
    const viewport = containerRef.current?.querySelector<HTMLElement>('.react-lazylog');
    if (!list && !viewport) return false;

    programmaticScrollRef.current = true;
    if (list && list.scrollSize > 0) {
      list.scrollTo(list.scrollSize);
    }
    if (viewport) {
      viewport.scrollTop = viewport.scrollHeight;
    }

    const distanceFromBottom = viewport
      ? viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight
      : 0;
    window.requestAnimationFrame(() => {
      programmaticScrollRef.current = false;
    });
    return distanceFromBottom <= LOG_BOTTOM_TOLERANCE_PX;
  }, []);
  const scheduleScrollToLatest = useCallback(() => {
    let frame = 0;
    const run = (remainingFrames: number) => {
      if (!followingRef.current) return;
      const reachedBottom = scrollToLatest();
      if (reachedBottom || remainingFrames === 0) return;
      frame = window.requestAnimationFrame(() => run(remainingFrames - 1));
    };
    frame = window.requestAnimationFrame(() => run(LOG_SCROLL_FRAME_ATTEMPTS));
    return () => window.cancelAnimationFrame(frame);
  }, [scrollToLatest]);
  useEffect(() => {
    const previousText = previousTextRef.current;
    previousTextRef.current = text;

    if (!text || text === previousText) return;
    if (previousText && !text.startsWith(previousText)) {
      previousTextRef.current = '';
      setViewerVersion(version => version + 1);
      return;
    }

    const appendedText = text.slice(previousText.length);
    if (!appendedText) return;

    const logViewer = logViewerRef.current;
    if (!logViewer) return;

    logViewer.appendLines(splitLogLines(appendedText));
    if (isFollowing) scheduleScrollToLatest();
  }, [isFollowing, scheduleScrollToLatest, text, viewerVersion]);

  return (
    <div
      className={cn(
        'flex min-h-0 h-full flex-col overflow-hidden rounded-lg border border-border bg-surface',
        className,
      )}
      data-local-inference-log-viewer
    >
      {toolbar ? <div className="local-inference-log-toolbar">{toolbar}</div> : null}
      <LazyLog
        key={viewerVersion}
        ref={logViewerRef}
        external
        follow={false}
        onScroll={handleScroll}

        enableLineNumbers
        enableMultilineHighlight
        selectableLines
        wrapLines
        extraLines={1}
        className="min-h-0 flex-1"
        style={{ height: '100%', width: '100%' }}
        containerStyle={{ height: '100%', width: '100%' }}
      />
    </div>
  );
}

function splitLogLines(text: string): string[] {
  return text.split(/\r\n|\n|\r/);
}