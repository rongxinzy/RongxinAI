import { useState } from 'react';

import type { CodingEvent, CodingPermissionOutcome } from '../../../shared/codingAgent';
import { CodingPermissionCard } from './CodingPermissionCard';

interface CodingPermissionOverlayProps {
  /** Permission awaiting the user's answer, or null when nothing is pending. */
  permission: CodingEvent | null;
  onRespond: (
    requestId: string,
    outcome: CodingPermissionOutcome,
    optionId?: string,
  ) => void | Promise<void>;
}

/**
 * Pending approval for a coding session. Work mode floats its approval card over
 * the composer slot so the card covers the disabled input while the user
 * decides; coding mode mirrors that placement instead of stacking the card in
 * the conversation or above the composer.
 */
export const CodingPermissionOverlay = ({
  permission,
  onRespond,
}: CodingPermissionOverlayProps) => {
  const [answering, setAnswering] = useState(false);
  const requestId =
    typeof permission?.payload.requestId === 'string' ? permission.payload.requestId : null;
  if (!permission || !requestId) return null;

  // A second answer would reach the agent after the request is settled and come
  // back as an error banner, so the footer stays disabled until it returns.
  const answer = (outcome: CodingPermissionOutcome, optionId?: string) => {
    if (answering) return;
    setAnswering(true);
    void Promise.resolve(onRespond(requestId, outcome, optionId)).finally(() =>
      setAnswering(false),
    );
  };

  return (
    <div className="pointer-events-auto absolute inset-x-0 bottom-0 z-10">
      <div className="px-4 pb-4">
        <div className="mx-auto max-w-5xl">
          <CodingPermissionCard event={permission} onRespond={answer} disabled={answering} />
        </div>
      </div>
    </div>
  );
};
