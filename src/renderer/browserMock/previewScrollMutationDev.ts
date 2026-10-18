import {
  PreviewScrollMutation,
  type PreviewScrollMutation as PreviewScrollMutationType,
} from './streamReplay';

/** Preview-only scroll sabotage for Playwright gates (never imported from production UI). */
export function installPreviewScrollMutation(mutation: PreviewScrollMutationType | null): void {
  if (!mutation || typeof window === 'undefined') return;

  if (mutation === PreviewScrollMutation.NoTailFollow) {
    window.setInterval(() => {
      const scroller =
        document.querySelector<HTMLElement>('[role="log"] .cowork-conversation-scroll') ??
        document.querySelector<HTMLElement>('[role="log"] .overflow-y-auto');
      if (!scroller) return;
      const maxScroll = Math.max(scroller.scrollHeight - scroller.clientHeight, 0);
      if (scroller.scrollTop >= maxScroll - 8) {
        scroller.scrollTop = Math.max(0, scroller.scrollTop - 48);
      }
    }, 30);
  }
}
