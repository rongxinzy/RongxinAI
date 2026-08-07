import { Skeleton } from '@shared/components/ui/skeleton';

export const CoworkSessionTitleLoadingSkeleton = () => <Skeleton className="h-4 w-48" />;

export const CoworkConversationLoadingSkeleton = () => (
  <div
    className="mx-auto flex h-full w-full max-w-5xl flex-col justify-end gap-6 px-8 py-6"
    role="status"
    aria-busy="true"
  >
    <div className="flex justify-end">
      <Skeleton className="h-16 w-2/3 rounded-lg" />
    </div>
    <div className="flex flex-col gap-2">
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-4 w-1/2" />
    </div>
  </div>
);

export const CoworkSessionColdStartSkeleton = () => (
  <div className="flex min-h-0 flex-1 flex-col bg-background">
    <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
      <CoworkSessionTitleLoadingSkeleton />
      <Skeleton className="size-8" />
    </div>

    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1">
        <CoworkConversationLoadingSkeleton />
      </div>
      <div className="shrink-0 px-4 pb-4">
        <Skeleton className="mx-auto h-24 w-full max-w-5xl rounded-xl" />
      </div>
    </div>
  </div>
);
