import type { ReactNode } from 'react';
import { useInk } from './looseleaf/ink/react/hooks';
import { bubbleRecipe } from './looseleaf/ink/recipes/bubble-ink';

/** Looseleaf's Bubble ink layer, with the host's existing message content inside it. */
export function CompanionMessageBubble({ user, children }: { user: boolean; children: ReactNode }) {
  const { hostRef, hostProps, node } = useInk({
    recipe: bubbleRecipe,
    params: { variant: user ? 'default' : 'muted', tail: user ? 'end' : 'start' },
    kind: 'bubble',
    still: true,
  });
  return (
    <div
      ref={hostRef}
      {...hostProps}
      data-companion-message={user ? 'user' : 'assistant'}
      className={`theme-companion-message relative isolate w-fit min-w-0 max-w-full ${user ? 'ml-auto' : ''}`}
    >
      {node}
      {children}
    </div>
  );
}
