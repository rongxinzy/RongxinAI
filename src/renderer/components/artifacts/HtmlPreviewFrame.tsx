import type { ReactNode } from 'react';

interface HtmlPreviewFrameProps {
  enabled: boolean;
  inset: boolean;
  children: ReactNode;
}

/** Keep HTML viewport chrome outside the document and its scroll container. */
export function HtmlPreviewFrame({ enabled, inset, children }: HtmlPreviewFrameProps) {
  if (!enabled) return <>{children}</>;

  return (
    <div
      className="theme-html-preview-stage flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden"
      data-inset={inset}
    >
      <div
        className="theme-html-preview-viewport flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
        data-inset={inset}
      >
        {children}
      </div>
    </div>
  );
}
