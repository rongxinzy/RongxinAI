import type { Ref } from 'react';
import CoworkPromptInput from '../CoworkPromptInput';
import PendingMessageQueue from '../PendingMessageQueue';
import type { CoworkPromptInputProps, CoworkPromptInputRef } from '../promptInput/types';

interface SessionComposerOverlayProps extends Omit<CoworkPromptInputProps, 'topAccessory'> {
  overlayRef: Ref<HTMLDivElement>;
  promptInputRef: Ref<CoworkPromptInputRef>;
  pendingSessionId?: string;
}

/** Keep the measured composer surface separate from the virtualized conversation. */
export function SessionComposerOverlay({
  overlayRef,
  promptInputRef,
  pendingSessionId,
  ...inputProps
}: SessionComposerOverlayProps) {
  return (
    <div ref={overlayRef} className="pointer-events-none absolute inset-x-0 bottom-0 z-20 px-4">
      <div className="mx-auto w-full max-w-4xl min-w-[320px] pl-4">
        <div className="theme-composer-backdrop pointer-events-auto relative min-w-0">
          <CoworkPromptInput
            ref={promptInputRef}
            {...inputProps}
            topAccessory={
              pendingSessionId ? (
                <PendingMessageQueue
                  sessionId={pendingSessionId}
                  isStreaming={Boolean(inputProps.isStreaming)}
                />
              ) : null
            }
          />
        </div>
      </div>
    </div>
  );
}
