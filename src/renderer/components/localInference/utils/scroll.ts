import {
  ASSISTANT_SCROLL_TOP_OFFSET,
  CHAT_HIDDEN_BELOW_THRESHOLD,
  CHAT_NEAR_BOTTOM_THRESHOLD,
} from '../constants';

export function isScrollNearBottom({
  scrollTop,
  clientHeight,
  scrollHeight,
  threshold = CHAT_NEAR_BOTTOM_THRESHOLD,
}: {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
  threshold?: number;
}): boolean {
  return scrollHeight - (scrollTop + clientHeight) <= threshold;
}

export function hasHiddenContentBelow({
  scrollTop,
  clientHeight,
  scrollHeight,
  threshold = CHAT_HIDDEN_BELOW_THRESHOLD,
}: {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
  threshold?: number;
}): boolean {
  return scrollTop + clientHeight < scrollHeight - threshold;
}

export function getAssistantScrollTop({
  containerScrollTop,
  containerTop,
  targetTop,
  offset = ASSISTANT_SCROLL_TOP_OFFSET,
}: {
  containerScrollTop: number;
  containerTop: number;
  targetTop: number;
  offset?: number;
}): number {
  return Math.max(0, containerScrollTop + (targetTop - containerTop) - offset);
}

export function getNewAssistantScrollTargetIndex(historyLength: number): number {
  return historyLength + 1;
}

