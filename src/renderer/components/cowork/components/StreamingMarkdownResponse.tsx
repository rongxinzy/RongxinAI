import { MessageResponse } from '@shared/components/ai-elements/message';
import {
  isPlainTextStreamingTail,
  useAdaptiveTextReveal,
  useStreamingTextSegments,
} from '@shared/components/ai-elements/streamingText';

import type { StreamingTextSegments } from '@shared/components/ai-elements/streamingText';

export const StreamingMarkdownResponse = ({
  content,
  isStreaming,
}: {
  content: string;
  isStreaming: boolean;
}) => {
  const { committed, tail }: StreamingTextSegments = useStreamingTextSegments(content, isStreaming);
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
