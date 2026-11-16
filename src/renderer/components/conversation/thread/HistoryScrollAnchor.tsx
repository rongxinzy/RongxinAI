import React from 'react';
import { useStickToBottomContext, type StickToBottomContext } from 'use-stick-to-bottom';

type Anchor = { element: HTMLElement; top: number; messageKey?: string };
interface AnchorProps {
  firstTurnId?: string;
  lastTurnId?: string;
  viewport: StickToBottomContext;
  children?: React.ReactNode;
}

/** Snapshot before DOM mutation; layout effects run too late to measure the old anchor. */
class PrependAnchor extends React.Component<AnchorProps, Record<string, never>, Anchor | null> {
  getSnapshotBeforeUpdate(previous: AnchorProps): Anchor | null {
    const { viewport, firstTurnId, lastTurnId } = this.props;
    if (
      !previous.firstTurnId ||
      previous.firstTurnId === firstTurnId ||
      previous.lastTurnId !== lastTurnId ||
      viewport.state.isAtBottom
    )
      return null;
    const scroller = viewport.scrollRef.current;
    if (!scroller) return null;
    const bounds = scroller.getBoundingClientRect();
    const messages = scroller.querySelectorAll<HTMLElement>('[data-conversation-anchor]');
    const candidates =
      messages.length > 0 ? messages : scroller.querySelectorAll<HTMLElement>('[data-turn-id]');
    for (const element of candidates) {
      const rect = element.getBoundingClientRect();
      if (rect.bottom > bounds.top && rect.top < bounds.bottom) {
        return { element, top: rect.top, messageKey: element.dataset.conversationAnchor };
      }
    }
    return null;
  }

  componentDidUpdate(_previous: AnchorProps, _state: Record<string, never>, anchor: Anchor | null) {
    if (!anchor) return;
    // A page may start inside a turn. Loading its user prompt replaces the
    // orphan turn wrapper, so recover the same message in the new subtree.
    const element = anchor.element.isConnected
      ? anchor.element
      : [
          ...(this.props.viewport.scrollRef.current?.querySelectorAll<HTMLElement>(
            '[data-conversation-anchor]',
          ) ?? []),
        ].find(element => element.dataset.conversationAnchor === anchor.messageKey);
    if (!element) return;
    const delta = element.getBoundingClientRect().top - anchor.top;
    // Use the existing scroll owner's setter so its escape/follow bookkeeping stays authoritative.
    this.props.viewport.state.scrollTop += delta;
  }

  render() {
    return this.props.children;
  }
}

export function HistoryScrollAnchor(props: Omit<AnchorProps, 'viewport'>) {
  const viewport = useStickToBottomContext();
  return <PrependAnchor {...props} viewport={viewport} />;
}
