import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

/** Scroll positions within this distance of the bottom keep the button hidden. */
const NEAR_BOTTOM_PX = 70;
/** Landing at (or within 1px of) the bottom re-arms output following. */
const AT_BOTTOM_PX = 1;
/** scrollTop drops larger than this count as the user scrolling up. */
const UPWARD_SCROLL_EPSILON_PX = 1;

/** Performs the actual scroll write; a virtualizer replaces direct writes. */
type ConversationScrollWriter = () => void;

export interface ConversationViewport {
  /** Ref callback for the scroll container element. */
  attachScrollElement: (element: HTMLDivElement | null) => void;
  /** Ref callback for the followed content element. */
  attachContentElement: (element: HTMLDivElement | null) => void;
  /** Current scroll container; virtualizers use this as getScrollElement. */
  getScrollElement: () => HTMLDivElement | null;
  /** True while the viewport sits near the bottom (drives the button). */
  isAtBottom: boolean;
  /** Synchronous "output growth should keep following the bottom" state. */
  isFollowingOutput: () => boolean;
  /** Re-arms following and writes the scroll position to the bottom. */
  scrollToBottom: () => void;
  /**
   * Registers the single writer allowed to move the scroll position (e.g. an
   * embedded virtualizer). Pass null to restore direct writes. Returns an
   * unregister function.
   */
  registerScrollWriter: (writer: ConversationScrollWriter | null) => () => void;
}

const distanceFromBottom = (element: HTMLElement): number =>
  Math.max(element.scrollHeight - element.clientHeight - element.scrollTop, 0);

/**
 * Owns the follow-bottom behavior of a conversation scroll container: follow
 * output growth while at the bottom, stop following when the user scrolls
 * up, re-arm when they return to the bottom, and keep "scroll to bottom" on
 * a single write path (direct, or delegated to a registered virtualizer).
 */
export const useConversationViewport = (): ConversationViewport => {
  const [isAtBottom, setIsAtBottom] = useState(true);
  const scrollElementRef = useRef<HTMLDivElement | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const lastScrollTopRef = useRef(0);
  const ignoreScrollTopRef = useRef<number | null>(null);
  const contentHeightRef = useRef<number | undefined>(undefined);
  const followRef = useRef(true);
  const scrollWriterRef = useRef<ConversationScrollWriter | null>(null);

  const writeScrollToBottom = useCallback(() => {
    const element = scrollElementRef.current;
    if (!element) return;
    const writer = scrollWriterRef.current;
    if (writer) {
      writer();
      return;
    }
    const target = Math.max(element.scrollHeight - element.clientHeight, 0);
    ignoreScrollTopRef.current = target;
    element.scrollTop = target;
  }, []);

  const handleScroll = useCallback(() => {
    const element = scrollElementRef.current;
    if (!element) return;
    const scrollTop = element.scrollTop;
    const ignored = ignoreScrollTopRef.current;
    ignoreScrollTopRef.current = null;
    const distance = distanceFromBottom(element);
    setIsAtBottom(distance <= NEAR_BOTTOM_PX);
    if (ignored !== null && Math.abs(scrollTop - ignored) <= AT_BOTTOM_PX) {
      // Our own (possibly clamped) write; keep the current follow state.
      lastScrollTopRef.current = scrollTop;
      if (distance <= AT_BOTTOM_PX) followRef.current = true;
      return;
    }
    const lastScrollTop = lastScrollTopRef.current;
    lastScrollTopRef.current = scrollTop;
    if (scrollTop < lastScrollTop - UPWARD_SCROLL_EPSILON_PX) followRef.current = false;
    if (distance <= AT_BOTTOM_PX) followRef.current = true;
  }, []);

  const attachScrollElement = useCallback(
    (element: HTMLDivElement | null) => {
      const previous = scrollElementRef.current;
      if (previous === element) return;
      if (previous) previous.removeEventListener('scroll', handleScroll);
      scrollElementRef.current = element;
      ignoreScrollTopRef.current = null;
      if (!element) return;
      lastScrollTopRef.current = element.scrollTop;
      setIsAtBottom(distanceFromBottom(element) <= NEAR_BOTTOM_PX);
      element.addEventListener('scroll', handleScroll, { passive: true });
    },
    [handleScroll],
  );

  const handleContentResize = useCallback(
    (entries: ResizeObserverEntry[]) => {
      const element = scrollElementRef.current;
      const entry = entries[entries.length - 1];
      if (!element || !entry) return;
      const height = entry.contentRect.height;
      const previousHeight = contentHeightRef.current;
      contentHeightRef.current = height;
      if (previousHeight === undefined) {
        // First observation: initial positioning belongs to the app (e.g. a
        // saved-position restore), never to the follow logic.
        if (distanceFromBottom(element) > AT_BOTTOM_PX) followRef.current = false;
        return;
      }
      const delta = height - previousHeight;
      if (delta > 0) {
        if (followRef.current) writeScrollToBottom();
      } else if (delta < 0 && distanceFromBottom(element) <= AT_BOTTOM_PX) {
        // Content shrank while at the bottom; close the gap.
        writeScrollToBottom();
      }
    },
    [writeScrollToBottom],
  );

  const attachContentElement = useCallback(
    (element: HTMLDivElement | null) => {
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      contentHeightRef.current = undefined;
      if (!element) return;
      const observer = new ResizeObserver(handleContentResize);
      resizeObserverRef.current = observer;
      observer.observe(element);
    },
    [handleContentResize],
  );

  useEffect(
    () => () => {
      resizeObserverRef.current?.disconnect();
    },
    [],
  );

  const scrollToBottom = useCallback(() => {
    followRef.current = true;
    setIsAtBottom(true);
    writeScrollToBottom();
  }, [writeScrollToBottom]);

  const getScrollElement = useCallback(() => scrollElementRef.current, []);

  const isFollowingOutput = useCallback(() => followRef.current, []);

  const registerScrollWriter = useCallback((writer: ConversationScrollWriter | null) => {
    scrollWriterRef.current = writer;
    return () => {
      if (scrollWriterRef.current === writer) scrollWriterRef.current = null;
    };
  }, []);

  return useMemo(
    () => ({
      attachContentElement,
      attachScrollElement,
      getScrollElement,
      isAtBottom,
      isFollowingOutput,
      registerScrollWriter,
      scrollToBottom,
    }),
    [
      attachContentElement,
      attachScrollElement,
      getScrollElement,
      isAtBottom,
      isFollowingOutput,
      registerScrollWriter,
      scrollToBottom,
    ],
  );
};

export const ConversationViewportContext = createContext<ConversationViewport | null>(null);

export const ConversationViewportProvider = ConversationViewportContext.Provider;

/** Access the owning <Conversation> viewport; must be used inside one. */
export function useConversationViewportContext(): ConversationViewport {
  const viewport = useContext(ConversationViewportContext);
  if (!viewport) {
    throw new Error('conversation viewport context must be used within a Conversation');
  }
  return viewport;
}
