import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from '@shared/components/ai-elements/reasoning';
import { Shimmer } from '@shared/components/ai-elements/shimmer';
import React, { useEffect, useRef, useState } from 'react';

import { i18nService } from '../../../services/i18n';
import { useLiveMessageText } from '../../../services/useLiveMessageText';
import type { ReasoningTurnPart } from '../model/types';

interface ThinkingPartViewProps {
  part: ReasoningTurnPart;
}

/**
 * Renders a reasoning block using native Streamdown streaming and collapsed
 * settled presentation, reading live deltas from LiveTextStore while active.
 */
export const ThinkingPartView: React.FC<ThinkingPartViewProps> = React.memo(({ part }) => {
  const liveContent = useLiveMessageText(part.message.id, part.isStreaming);
  const content = (part.isStreaming ? liveContent : undefined) ?? part.message.content ?? '';
  const startedAtRef = useRef<number | null>(
    part.isStreaming ? part.message.timestamp || Date.now() : null,
  );
  const [liveSeconds, setLiveSeconds] = useState(0);

  useEffect(() => {
    if (!part.isStreaming) {
      startedAtRef.current = null;
      setLiveSeconds(0);
      return;
    }
    const baseAt = startedAtRef.current ?? part.message.timestamp ?? Date.now();
    startedAtRef.current = baseAt;
    const syncElapsed = () => {
      setLiveSeconds(Math.max(0, Math.floor((Date.now() - baseAt) / 1000)));
    };
    syncElapsed();
    const timer = window.setInterval(syncElapsed, 1000);
    return () => window.clearInterval(timer);
  }, [part.isStreaming, part.message.timestamp]);

  if (!content.trim() && !part.isStreaming) return null;

  return (
    <Reasoning
      isStreaming={part.isStreaming}
      autoClose
      showConnector
      duration={part.durationSeconds}
    >
      <ReasoningTrigger
        getThinkingMessage={(streaming, duration) => {
          const seconds = duration ?? part.durationSeconds;
          if (streaming) {
            return (
              <span className="inline-flex items-center gap-2">
                <Shimmer as="span" duration={1.5}>
                  {i18nService.t('codingAgentReasoningActive')}
                </Shimmer>
                {liveSeconds > 0 ? (
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {i18nService
                      .t('coworkWorkingElapsed')
                      .replace('{seconds}', String(liveSeconds))}
                  </span>
                ) : null}
              </span>
            );
          }
          const key =
            part.isComplete && seconds
              ? 'localInferenceThoughtForSeconds'
              : part.isComplete
                ? 'codingAgentReasoningComplete'
                : 'reasoning';
          return <span>{i18nService.t(key).replace('{seconds}', String(seconds ?? 0))}</span>;
        }}
      />
      <ReasoningContent>{content}</ReasoningContent>
    </Reasoning>
  );
});

ThinkingPartView.displayName = 'ThinkingPartView';
