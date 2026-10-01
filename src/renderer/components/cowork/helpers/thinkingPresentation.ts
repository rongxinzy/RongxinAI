import { toThinkingDurationSeconds } from '../../../../common/thinkingDuration';
import type { CoworkMessageMetadata } from '../../../types/cowork';

export const getThinkingPresentation = (
  metadata: CoworkMessageMetadata | undefined,
  forceComplete: boolean,
  /** Whether the bubble already has text; an empty one is a leftover placeholder. */
  hasContent = true,
) => ({
  isStreaming:
    hasContent && !forceComplete && Boolean(metadata?.isStreaming) && !metadata?.isFinal,
  isComplete: forceComplete || Boolean(metadata?.isFinal),
  durationSeconds: toThinkingDurationSeconds(metadata?.thinkingDurationMs),
});
