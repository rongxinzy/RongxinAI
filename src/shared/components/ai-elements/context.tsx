import { Button } from '@shared/components/ui/button';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@shared/components/ui/hover-card';
import { Progress } from '@shared/components/ui/progress';
import { cn } from '@shared/lib/utils';
import type { ComponentProps, ReactElement } from 'react';
import { createContext, useContext, useMemo } from 'react';

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

const usageIndicatorClassName: Record<ContextUsageState, string | undefined> = {
  [ContextUsageState.Normal]: undefined,
  [ContextUsageState.Warning]: 'bg-warning',
  [ContextUsageState.Critical]: 'bg-destructive',
};

interface ContextSchema {
  usedTokens: number;
  maxTokens: number;
  modelId?: string;
  usage?: ContextModelUsage;
}

export interface ContextModelUsage {
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
  totalTokens?: number;
}

const ContextContext = createContext<ContextSchema | null>(null);

const useContextValue = (): ContextSchema => {
  const context = useContext(ContextContext);
  if (!context) {
    throw new Error('Context components must be used within Context');
  }
  return context;
};

export type ContextProps = ComponentProps<typeof HoverCard> & ContextSchema;

export function Context({ usedTokens, maxTokens, modelId, usage, ...props }: ContextProps) {
  const contextValue = useMemo(
    () => ({ maxTokens, modelId, usage, usedTokens }),
    [maxTokens, modelId, usage, usedTokens],
  );

  return (
    <ContextContext.Provider value={contextValue}>
      <HoverCard {...props} />
    </ContextContext.Provider>
  );
}

function ContextIcon() {
  const { usedTokens, maxTokens } = useContextValue();
  const usageState = getContextUsageState(usedTokens, maxTokens);
  const circumference = 2 * Math.PI * ICON_RADIUS;
  const usedPercent = Math.min(usedTokens / maxTokens, 1);
  const dashOffset = circumference * (1 - usedPercent);

  return (
    <svg
      aria-hidden="true"
      className={usageStateClassName[usageState]}
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

export type ContextTriggerProps = ComponentProps<typeof Button> & {
  children?: ReactElement;
};

export function ContextTrigger({ children, ...props }: ContextTriggerProps) {
  const { usedTokens, maxTokens } = useContextValue();
  const usedPercent = usedTokens / maxTokens;
  const renderedPercent = new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 1,
    style: 'percent',
  }).format(usedPercent);

  return (
    <HoverCardTrigger
      closeDelay={0}
      delay={0}
      render={
        children ?? (
          <Button type="button" variant="ghost" {...props}>
            <span className="font-medium text-muted-foreground">{renderedPercent}</span>
            <ContextIcon />
          </Button>
        )
      }
    />
  );
}

export type ContextContentProps = ComponentProps<typeof HoverCardContent>;

export function ContextContent({ className, ...props }: ContextContentProps) {
  return <HoverCardContent className={cn("theme-control-sizing-4 min-w-60 divide-y overflow-hidden", className)} {...props} />;
}

export type ContextContentHeaderProps = ComponentProps<'div'>;

export function ContextContentHeader({ children, className, ...props }: ContextContentHeaderProps) {
  const { usedTokens, maxTokens } = useContextValue();
  const usedPercent = Math.min((usedTokens / maxTokens) * PERCENT_MAX, PERCENT_MAX);
  const usageState = getContextUsageState(usedTokens, maxTokens);

  return (
    <div className={cn('w-full space-y-2 p-3', className)} {...props}>
      {children ?? (
        <div className="flex items-center justify-between gap-3 text-xs">
          <span>{usedPercent.toFixed(1)}%</span>
          <span className="font-mono text-muted-foreground">
            {formatTokens(usedTokens)} / {formatTokens(maxTokens)}
          </span>
        </div>
      )}
      <Progress indicatorClassName={usageIndicatorClassName[usageState]} value={usedPercent} />
    </div>
  );
}

export type ContextContentBodyProps = ComponentProps<'div'>;

export function ContextContentBody({ children, className, ...props }: ContextContentBodyProps) {
  return (
    <div className={cn('w-full p-3', className)} {...props}>
      {children}
    </div>
  );
}

const formatTokens = (tokens: number): string =>
  new Intl.NumberFormat('en-US', { notation: 'compact' }).format(tokens);

interface ContextUsageRowProps extends ComponentProps<'div'> {
  label?: string;
  tokens?: number;
}

function ContextUsageRow({ label, tokens, className, ...props }: ContextUsageRowProps) {
  if (!tokens) return null;
  return (
    <div className={cn('flex items-center justify-between text-xs', className)} {...props}>
      <span className="text-muted-foreground">{label}</span>
      <span>{formatTokens(tokens)}</span>
    </div>
  );
}

export type ContextInputUsageProps = Omit<ContextUsageRowProps, 'tokens'>;

export function ContextInputUsage({ label = 'Input', ...props }: ContextInputUsageProps) {
  const { usage } = useContextValue();
  return <ContextUsageRow label={label} tokens={usage?.inputTokens} {...props} />;
}

export type ContextOutputUsageProps = Omit<ContextUsageRowProps, 'tokens'>;

export function ContextOutputUsage({ label = 'Output', ...props }: ContextOutputUsageProps) {
  const { usage } = useContextValue();
  return <ContextUsageRow label={label} tokens={usage?.outputTokens} {...props} />;
}

export type ContextReasoningUsageProps = Omit<ContextUsageRowProps, 'tokens'>;

export function ContextReasoningUsage({ label = 'Reasoning', ...props }: ContextReasoningUsageProps) {
  const { usage } = useContextValue();
  return <ContextUsageRow label={label} tokens={usage?.reasoningTokens} {...props} />;
}

export type ContextCacheUsageProps = Omit<ContextUsageRowProps, 'tokens'>;

export function ContextCacheUsage({ label = 'Cache', ...props }: ContextCacheUsageProps) {
  const { usage } = useContextValue();
  return (
    <ContextUsageRow
      label={label}
      tokens={usage?.cachedInputTokens}
      {...props}
    />
  );
}

export type ContextContentFooterProps = ComponentProps<'div'>;

export function ContextContentFooter({ children, className, ...props }: ContextContentFooterProps) {
  if (children) {
    return <div className={cn('flex w-full items-center justify-between gap-3 bg-secondary p-3 text-xs', className)} {...props}>{children}</div>;
  }
  return null;
}
