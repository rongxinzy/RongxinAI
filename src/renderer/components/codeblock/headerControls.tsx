import { Button } from '@shared/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@shared/components/ui/tooltip';
import React from 'react';

// ---------------------------------------------------------------------------
// Shared header controls
// ---------------------------------------------------------------------------

export const CodeBlockTooltip: React.FC<{
  content: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}> = ({ content, children, className }) => (
  <TooltipProvider delay={300}>
    <Tooltip>
      <TooltipTrigger render={<div className={className}>{children}</div>} />
      <TooltipContent side="bottom" align="end" className="theme-code-hint">
        {content}
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
);

/** Thin icon button used in the code block header */
export const HeaderButton: React.FC<{
  onClick: () => void;
  ariaLabel: string;
  active?: boolean;
  children: React.ReactNode;
}> = ({ onClick, ariaLabel, active = false, children }) => (
  <Button
    type="button"
    variant="ghost"
    size="icon"
    onClick={onClick}
    data-active={active || undefined}
    className="theme-code-header-button transform-gpu"
    aria-label={ariaLabel}
  >
    {children}
  </Button>
);
