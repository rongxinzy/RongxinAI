import { Button } from '@shared/components/ui/button';
import { useLayoutEffect, useRef } from 'react';
import { DialogFooter, DialogFooterSurface } from '@shared/components/ui/dialog';
import { FieldDescription, FieldTitle } from '@shared/components/ui/field';
import type { ManagedMemoryRecord } from '../../shared/memory';
import { i18nService } from '../services/i18n';

/** The reviewed snapshot stays visible; the main process verifies the same text on confirmation. */
export function CompanionMemoryReview({
  record,
  busy,
  confirmLabel,
  onCancel,
  onConfirm,
}: {
  record: ManagedMemoryRecord;
  busy: boolean;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = (key: string) => i18nService.t(key);
  const content = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    content.current?.focus({ preventScroll: true });
  }, []);
  return (
    <>
      <div
        ref={content}
        role="region"
        aria-label={t('companionMemoryContent')}
        tabIndex={0}
        className="theme-scroll-viewport flex min-h-0 min-w-0 flex-col gap-2 overflow-y-auto"
      >
        <FieldTitle className="break-words">{record.title}</FieldTitle>
        <FieldDescription className="whitespace-pre-wrap break-words">
          {record.content}
        </FieldDescription>
      </div>
      <DialogFooter surface={DialogFooterSurface.Seamless} className="shrink-0">
        <Button variant="ghost" disabled={busy} onClick={onCancel}>
          {t('cancel')}
        </Button>
        <Button disabled={busy} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </DialogFooter>
    </>
  );
}
