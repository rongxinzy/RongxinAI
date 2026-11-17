import { cn } from '@shared/lib/utils';
import type * as React from 'react';

export interface MessageActionsProps {
  visible?: boolean;
  align?: 'start' | 'end';
  meta?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}

/**
 * Quiet action + metadata footer row for conversation messages.
 * Hidden until hover or focus-within unless `visible` is pinned true.
 */
export function MessageActions({
  visible = false,
  align = 'start',
  meta,
  children,
  className,
}: MessageActionsProps) {
  return (
    <div
      data-visible={visible}
      className={cn(
        'theme-conversation-actions mt-1 flex items-center gap-2 select-none',
        align === 'end' ? 'justify-end' : 'justify-start',
        visible
          ? ''
          : 'pointer-events-none group-hover/turn:pointer-events-auto group-focus-within/turn:pointer-events-auto',
        className,
      )}
    >
      {align === 'end' ? (
        <>
          {meta}
          {children ? <div className="flex items-center gap-1">{children}</div> : null}
        </>
      ) : (
        <>
          {children ? <div className="flex items-center gap-1">{children}</div> : null}
          {meta}
        </>
      )}
    </div>
  );
}
