import { Skeleton } from '@shared/components/ui/skeleton';
import { cn } from '@shared/lib/utils';

const shimmerClassName = 'skeleton';

const conversationLoadingTurns = [
  {
    userClassName: 'h-12 w-2/5',
    assistantLineClassNames: ['w-4/5', 'w-2/3', 'w-1/2'],
  },
  {
    userClassName: 'h-10 w-1/3',
    assistantLineClassNames: ['w-3/4', 'w-1/2'],
  },
  {
    userClassName: 'h-16 w-1/2',
    assistantLineClassNames: ['w-5/6', 'w-3/4', 'w-2/5'],
  },
  {
    userClassName: 'h-12 w-2/5',
    assistantLineClassNames: ['w-2/3', 'w-1/2'],
  },
] as const;

export const CoworkSessionTitleLoadingSkeleton = () => (
  <Skeleton className={cn(shimmerClassName, 'h-4 w-48')} />
);

export const CoworkConversationLoadingSkeleton = () => (
  <div
    className="mx-auto flex h-full w-full max-w-5xl flex-col justify-between gap-6 overflow-hidden px-8 py-6"
    role="status"
    aria-busy="true"
  >
    {conversationLoadingTurns.map(turn => (
      <div
        key={`${turn.userClassName}-${turn.assistantLineClassNames.length}`}
        className="flex flex-col gap-4"
        data-slot="session-loading-turn"
      >
        <div className="flex justify-end">
          <Skeleton className={cn(shimmerClassName, 'theme-scene-loading-message', turn.userClassName)} />
        </div>
        <div className="flex flex-col gap-2">
          {turn.assistantLineClassNames.map(lineClassName => (
            <Skeleton key={lineClassName} className={cn(shimmerClassName, 'h-4', lineClassName)} />
          ))}
        </div>
      </div>
    ))}
  </div>
);

export const CoworkSessionColdStartSkeleton = () => (
  <div className="flex min-h-0 flex-1 flex-col bg-background">
    <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
      <CoworkSessionTitleLoadingSkeleton />
      <Skeleton className={cn(shimmerClassName, 'size-8')} />
    </div>

    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1">
        <CoworkConversationLoadingSkeleton />
      </div>
      <div className="shrink-0 px-4 pb-4">
        <Skeleton className={cn(shimmerClassName, 'theme-scene-loading-composer mx-auto h-24 w-full max-w-5xl')} />
      </div>
    </div>
  </div>
);
