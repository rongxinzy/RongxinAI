import { Card, CardContent, CardFooter, CardHeader } from '@shared/components/ui/card';
import { Skeleton } from '@shared/components/ui/skeleton';
import type { ReactNode } from 'react';

/** Shared geometry for loaded cards and placeholders; no model or service state. */
export function MarketplaceCardLayout({
  header,
  children,
  footer,
  loading = false,
}: {
  header: ReactNode;
  children: ReactNode;
  footer: ReactNode;
  loading?: boolean;
}) {
  return (
    <Card
      data-marketplace-model-card={loading ? undefined : 'true'}
      aria-hidden={loading || undefined}
      className="h-full min-w-0 gap-4 rounded-lg border border-border bg-card p-4 shadow-none ring-0 has-data-[slot=card-footer]:pb-4"
    >
      <CardHeader className="flex min-h-16 min-w-0 flex-row items-start gap-3 p-0">
        {header}
      </CardHeader>
      <CardContent className="flex min-w-0 flex-wrap items-center justify-between gap-2 p-0">
        {children}
      </CardContent>
      <CardFooter className="mt-auto flex min-w-0 flex-wrap items-center gap-2 border-0 bg-transparent p-0">
        {footer}
      </CardFooter>
    </Card>
  );
}

export function MarketplaceModelCardSkeleton() {
  return (
    <MarketplaceCardLayout
      loading
      header={
        <>
          <Skeleton className="size-10 shrink-0 rounded-lg" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-4 w-24" />
          </div>
          <Skeleton className="size-8 shrink-0" />
        </>
      }
      footer={
        <>
          <Skeleton className="h-8 min-w-0 flex-1" />
          <Skeleton className="h-8 w-24 shrink-0" />
        </>
      }
    >
      <Skeleton className="h-5 w-36" />
      <Skeleton className="h-5 w-24" />
    </MarketplaceCardLayout>
  );
}
