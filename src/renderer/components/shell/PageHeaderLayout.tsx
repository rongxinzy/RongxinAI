import { cn } from '@shared/lib/utils';
import type { ReactNode } from 'react';

interface PageHeaderLayoutProps {
  navigation?: ReactNode;
  content?: ReactNode;
  actions?: ReactNode;
  windowControls?: ReactNode;
  tabs?: ReactNode;
}

/** Presentation only: feature state and native window behavior stay in the caller. */
export function PageHeaderLayout({
  navigation,
  content,
  actions,
  windowControls,
  tabs,
}: PageHeaderLayoutProps) {
  return (
    <header className="shrink-0 bg-background">
      <div
        className={cn(
          'draggable flex h-12 items-center justify-between gap-3 px-4',
          !tabs && 'border-b border-border-subtle',
        )}
      >
        <div className="flex h-8 min-w-0 flex-1 items-center gap-3">
          {navigation}
          {content}
        </div>
        <div className="non-draggable flex shrink-0 items-center gap-1">
          {actions}
          {windowControls}
        </div>
      </div>
      {tabs ? <div className="non-draggable border-b border-border-subtle px-4">{tabs}</div> : null}
    </header>
  );
}
