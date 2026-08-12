import { toThinkingDurationSeconds } from '../../../../common/thinkingDuration';
import type { CoworkMessageMetadata } from '../../../types/cowork';

export const getThinkingPresentation = (
  metadata: CoworkMessageMetadata | undefined,
  forceComplete: boolean,
) => ({
  isStreaming: !forceComplete && Boolean(metadata?.isStreaming) && !metadata?.isFinal,
  isComplete: forceComplete || Boolean(metadata?.isFinal),
  durationSeconds: toThinkingDurationSeconds(metadata?.thinkingDurationMs),
});
