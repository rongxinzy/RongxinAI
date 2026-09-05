import { Button } from '@shared/components/ui/button';
import { useReducedMotion } from 'motion/react';
import { useRef } from 'react';

import {
  SidebarAnimatedSearchIcon,
  type SidebarAnimatedSearchIconHandle,
} from '../icons/SidebarAnimatedSearchIcon';

export function SidebarSearchTrigger({ label, onClick }: { label: string; onClick: () => void }) {
  const iconRef = useRef<SidebarAnimatedSearchIconHandle>(null);
  const reducedMotion = useReducedMotion();
  return (
    <Button
      variant="navigation"
      size="navigation"
      aria-label={label}
      aria-haspopup="dialog"
      onClick={onClick}
      onMouseEnter={() => {
        if (!reducedMotion) iconRef.current?.startAnimation();
      }}
      onMouseLeave={() => iconRef.current?.stopAnimation()}
    >
      <SidebarAnimatedSearchIcon ref={iconRef} />
      <span className="min-w-0 truncate">{label}</span>
    </Button>
  );
}
