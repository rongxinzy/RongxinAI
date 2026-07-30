import { cn } from '@shared/lib/utils';

type SidebarAnimatedClockIconProps = {
  className?: string;
};

/** A quiet, hand-drawn clock that acknowledges navigation hover once. */
export function SidebarAnimatedClockIcon({ className }: SidebarAnimatedClockIconProps) {
  return (
    <svg
      aria-hidden="true"
      className={cn('sidebar-animated-clock size-4 shrink-0', className)}
      fill="none"
      viewBox="0 0 24 24"
    >
      <g className="sidebar-animated-clock__bells">
        <path d="M5 3 2 6" />
        <path d="m22 6-3-3" />
      </g>
      <circle className="sidebar-animated-clock__face" cx="12" cy="13" r="8" />
      <path className="sidebar-animated-clock__feet" d="M6.38 18.7 4 21M17.64 18.67 20 21" />
      <path className="sidebar-animated-clock__check" d="m9 13 2 2 4-4" />
    </svg>
  );
}
