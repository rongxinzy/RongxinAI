import { cn } from '@shared/lib/utils';

const PERCENT_MAX = 100;
const ICON_RADIUS = 10;
const ICON_VIEWBOX = 24;
const ICON_CENTER = 12;
const ICON_STROKE_WIDTH = 2;

export const ContextUsageState = {
  Normal: 'normal',
  Warning: 'warning',
  Critical: 'critical',
} as const;

export type ContextUsageState = (typeof ContextUsageState)[keyof typeof ContextUsageState];

export function getContextUsageState(usedTokens: number, maxTokens: number): ContextUsageState {
  const percent = (usedTokens / maxTokens) * PERCENT_MAX;
  if (percent >= 95) return ContextUsageState.Critical;
  if (percent >= 80) return ContextUsageState.Warning;
  return ContextUsageState.Normal;
}

const usageStateClassName: Record<ContextUsageState, string> = {
  [ContextUsageState.Normal]: '',
  [ContextUsageState.Warning]: 'text-warning',
  [ContextUsageState.Critical]: 'text-destructive',
};

export function ContextUsageGauge({
  usedTokens,
  maxTokens,
  className,
}: {
  usedTokens: number;
  maxTokens: number;
  className?: string;
}) {
  const usageState = getContextUsageState(usedTokens, maxTokens);
  const circumference = 2 * Math.PI * ICON_RADIUS;
  const usedPercent = Math.min(usedTokens / maxTokens, 1);
  const dashOffset = circumference * (1 - usedPercent);

  return (
    <svg
      aria-hidden="true"
      className={cn(usageStateClassName[usageState], className)}
      height="20"
      viewBox={`0 0 ${ICON_VIEWBOX} ${ICON_VIEWBOX}`}
      width="20"
    >
      <circle
        cx={ICON_CENTER}
        cy={ICON_CENTER}
        fill="none"
        opacity="0.25"
        r={ICON_RADIUS}
        stroke="currentColor"
        strokeWidth={ICON_STROKE_WIDTH}
      />
      <circle
        cx={ICON_CENTER}
        cy={ICON_CENTER}
        fill="none"
        opacity="0.7"
        r={ICON_RADIUS}
        stroke="currentColor"
        strokeDasharray={`${circumference} ${circumference}`}
        strokeDashoffset={dashOffset}
        strokeLinecap="round"
        strokeWidth={ICON_STROKE_WIDTH}
        style={{ transform: 'rotate(-90deg)', transformOrigin: 'center' }}
      />
    </svg>
  );
}
