import { useEffect } from 'react';

import type { CodingEvent } from '../../../shared/codingAgent';
import { observeCodingTurnFailures } from '../../services/codingFailureNotice';

/**
 * Mirror a failed coding turn to the app-wide prompt.
 *
 * The conversation keeps the failure line as history (DESIGN.md keeps durable
 * state in the page); the prompt is what makes the failure noticeable when the
 * user is looking somewhere else — most importantly for external agents, which
 * report an unusable credential by answering a prompt with nothing at all.
 */
export const useTurnFailureToast = (events: CodingEvent[]): void => {
  useEffect(() => {
    observeCodingTurnFailures(events);
  }, [events]);
};
