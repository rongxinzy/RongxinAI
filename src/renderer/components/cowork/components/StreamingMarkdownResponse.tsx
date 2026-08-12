import { MessageResponse } from '@shared/components/ai-elements/message';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  getRevealCharacterCount,
  isPlainTextStreamingTail,
  shouldResetTextReveal,
} from '../../../utils/adaptiveTextReveal';
import {
  StreamingMarkdownSegmenter,
  type StreamingMarkdownSegments,
} from '../../../utils/streamingMarkdownSegments';

const useStreamingMarkdownSegments = (
  content: string,
  isStreaming: boolean,
): StreamingMarkdownSegments => {
  const segmenterRef = useRef<StreamingMarkdownSegmenter | null>(null);
  if (!segmenterRef.current) {
    segmenterRef.current = new StreamingMarkdownSegmenter();
  }

  return segmenterRef.current.update(content, isStreaming);
};

const useAdaptiveTextReveal = (content: string, enabled: boolean): string => {
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
      const revealed = getRevealCharacterCount(target.length - visible.length, timestamp - lastFrameTime);

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

export const StreamingMarkdownResponse = ({
  content,
  isStreaming,
}: {
  content: string;
  isStreaming: boolean;
}) => {
  const { committed, tail } = useStreamingMarkdownSegments(content, isStreaming);
  const shouldAnimateTail = isStreaming && Boolean(tail) && isPlainTextStreamingTail(tail);
  const revealedTail = useAdaptiveTextReveal(tail, shouldAnimateTail);

  if (!committed || !tail) {
    return <MessageResponse>{committed || revealedTail}</MessageResponse>;
  }

  return (
    <div className="flex flex-col gap-4">
      <MessageResponse>{committed}</MessageResponse>
      <MessageResponse>{revealedTail}</MessageResponse>
    </div>
  );
};
