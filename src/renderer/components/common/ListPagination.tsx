import { Button } from '@shared/components/ui/button';
import { cn } from '@shared/lib/utils';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { i18nService } from '../../services/i18n';

interface ListPaginationProps {
  page: number;
  totalPages?: number;
  hasNext?: boolean;
  disabled?: boolean;
  onPageChange: (page: number) => void;
  className?: string;
}

export function ListPagination({
  page,
  totalPages,
  hasNext = false,
  disabled = false,
  onPageChange,
  className,
}: ListPaginationProps) {
  const canGoPrevious = page > 1;
  const canGoNext = totalPages ? page < totalPages : hasNext;

  if (!canGoPrevious && !canGoNext) return null;

  const pageLabel = totalPages
    ? i18nService
        .t('paginationPageInfo')
        .replace('{page}', String(page))
        .replace('{total}', String(totalPages))
    : i18nService.t('paginationCurrentPage').replace('{page}', String(page));

  return (
    <nav
      aria-label={i18nService.t('pagination')}
      className={cn('flex items-center justify-center gap-2', className)}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={i18nService.t('paginationPrevious')}
        title={i18nService.t('paginationPrevious')}
        disabled={disabled || !canGoPrevious}
        onClick={() => onPageChange(page - 1)}
      >
        <ChevronLeft />
      </Button>
      <span className="min-w-20 text-center text-xs text-muted-foreground">{pageLabel}</span>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={i18nService.t('paginationNext')}
        title={i18nService.t('paginationNext')}
        disabled={disabled || !canGoNext}
        onClick={() => onPageChange(page + 1)}
      >
        <ChevronRight />
      </Button>
    </nav>
  );
}
