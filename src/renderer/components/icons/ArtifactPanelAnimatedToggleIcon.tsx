import { PanelRightClose, PanelRightOpen } from 'lucide-react';
import type { HTMLAttributes } from 'react';
import { forwardRef, useImperativeHandle } from 'react';

import { cn } from '@shared/lib/utils';

export interface ArtifactPanelAnimatedToggleIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface ArtifactPanelAnimatedToggleIconProps extends HTMLAttributes<HTMLDivElement> {
  open: boolean;
  size?: number;
}

export const ArtifactPanelAnimatedToggleIcon = forwardRef<
  ArtifactPanelAnimatedToggleIconHandle,
  ArtifactPanelAnimatedToggleIconProps
>(({ open, className, size = 16, ...props }, ref) => {
  useImperativeHandle(
    ref,
    () => ({
      startAnimation: () => {},
      stopAnimation: () => {},
    }),
    [],
  );

  const Icon = open ? PanelRightClose : PanelRightOpen;

  return (
    <div
      aria-hidden="true"
      className={cn(
        'artifact-panel-animated-toggle-icon inline-flex size-4 shrink-0 items-center justify-center',
        className,
      )}
      {...props}
    >
      <Icon size={size} />
    </div>
  );
});

ArtifactPanelAnimatedToggleIcon.displayName = 'ArtifactPanelAnimatedToggleIcon';
