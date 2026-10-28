import type { CodingEvent } from '../../../shared/codingAgent';
import { projectSortedCodingEvents, type CodingConversationTurn } from './codingEventProjection';

export interface CodingProjectionCache {
  events: readonly CodingEvent[];
  turns: CodingConversationTurn[];
  /** Index of each turn's first event in `events`. */
  bounds: number[];
}

const sharedPrefixLength = (
  previous: readonly CodingEvent[],
  next: readonly CodingEvent[],
): number => {
  const limit = Math.min(previous.length, next.length);
  let index = 0;
  while (index < limit && previous[index] === next[index]) index += 1;
  return index;
};

/**
 * Reprojects only the turns whose event objects changed. A later token does
 * not rebuild earlier turns. An in-place tool or message update changes that
 * event's object, so its turn is rebuilt.
 */
export const projectCodingEventsIncremental = (
  events: CodingEvent[],
  cache: CodingProjectionCache | null,
): { turns: CodingConversationTurn[]; cache: CodingProjectionCache } => {
  const sorted = events.toSorted((left, right) => left.sequence - right.sequence);
  if (
    cache &&
    cache.events.length === sorted.length &&
    sharedPrefixLength(cache.events, sorted) === sorted.length
  ) {
    return { turns: cache.turns, cache };
  }

  const changeAt = cache ? sharedPrefixLength(cache.events, sorted) : 0;
  let reuse = 0;
  if (cache) {
    for (let index = 0; index < cache.turns.length; index += 1) {
      const end = index + 1 < cache.bounds.length ? cache.bounds[index + 1] : cache.events.length;
      if (end <= changeAt) reuse += 1;
      else break;
    }
    const grew = sorted.length > cache.events.length;
    if (grew && reuse > 0 && cache.turns[reuse - 1].status === null) reuse -= 1;
  }

  const start =
    !cache || reuse === 0 ? 0 : reuse < cache.bounds.length ? cache.bounds[reuse] : changeAt;
  if (!cache || reuse === 0) {
    const projected = projectSortedCodingEvents(sorted);
    return {
      turns: projected.turns,
      cache: { events: sorted, turns: projected.turns, bounds: projected.bounds },
    };
  }

  const suffix = projectSortedCodingEvents(sorted.slice(start));
  const turns = cache.turns.slice(0, reuse).concat(suffix.turns);
  const bounds = cache.bounds.slice(0, reuse).concat(suffix.bounds.map(bound => bound + start));
  return { turns, cache: { events: sorted, turns, bounds } };
};
