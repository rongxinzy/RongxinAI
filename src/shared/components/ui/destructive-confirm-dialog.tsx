import { Button, buttonVariants } from '@shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@shared/components/ui/dialog';
import { type VariantProps } from 'class-variance-authority';
import { cn } from '@shared/lib/utils';
import { AlertTriangle } from 'lucide-react';

type ButtonVariant = NonNullable<VariantProps<typeof buttonVariants>['variant']>;

type DestructiveConfirmDialogProps = {
  open: boolean;
  title: string;
  description: string;
  cancelLabel: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
  confirmDisabled?: boolean;
  isConfirming?: boolean;
  cancelVariant?: ButtonVariant;
  confirmVariant?: ButtonVariant;
  /** Optional lesser-emphasis danger action rendered between cancel and confirm. */
  secondaryConfirmLabel?: string;
  onSecondaryConfirm?: () => void;
  className?: string;
};

function DestructiveConfirmDialog({
  open,
  title,
  description,
  cancelLabel,
  confirmLabel,
  onCancel,
  onConfirm,
  confirmDisabled = false,
  isConfirming = false,
  cancelVariant = 'ghost',
  confirmVariant = 'destructive',
  secondaryConfirmLabel,
  onSecondaryConfirm,
  className,
}: DestructiveConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={nextOpen => {
        if (!nextOpen) onCancel();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className={cn(
          'w-full max-w-sm rounded-xl border border-border bg-surface p-0 shadow-modal',
          className,
        )}
      >
        <div className="flex w-full min-w-0 flex-col gap-5 p-6">
          <div className="flex min-w-0 items-start gap-3">
            <span
              aria-hidden="true"
              className="flex size-5 shrink-0 items-center justify-center text-destructive"
            >
              <AlertTriangle className="size-4" />
            </span>
            <div className="flex min-w-0 flex-col gap-2">
              <DialogTitle className="text-base font-semibold text-foreground">{title}</DialogTitle>
              <DialogDescription
                className="min-w-0 truncate text-sm leading-6 text-muted-foreground"
                title={description}
              >
                {description}
              </DialogDescription>
            </div>
          </div>
          <div className="-mx-6 -mb-6 flex min-w-0 flex-wrap items-center justify-end gap-2 rounded-b-xl border-t border-border-subtle bg-muted/50 px-6 py-4">
            <Button
              type="button"
              variant={cancelVariant}
              className={cn(
                'h-8 min-w-16 cursor-pointer px-3 shadow-none',
                cancelVariant === 'ghost' &&
                  '!border-0 text-muted-foreground hover:bg-surface-raised hover:text-foreground',
              )}
              data-destructive-confirm-cancel-button="true"
              disabled={isConfirming}
              onClick={onCancel}
            >
              {cancelLabel}
            </Button>
            {secondaryConfirmLabel && onSecondaryConfirm ? (
              <Button
                type="button"
                variant="ghost"
                className="h-8 min-w-16 cursor-pointer !border-0 px-3 text-destructive shadow-none hover:bg-surface-raised"
                data-destructive-confirm-secondary-button="true"
                disabled={isConfirming}
                onClick={onSecondaryConfirm}
              >
                {secondaryConfirmLabel}
              </Button>
            ) : null}
            <Button
              type="button"
              variant={confirmVariant}
              className="h-8 min-w-16 cursor-pointer px-3 shadow-none"
              data-destructive-confirm-button="true"
              disabled={confirmDisabled || isConfirming}
              onClick={onConfirm}
            >
              {confirmLabel}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export { DestructiveConfirmDialog, type DestructiveConfirmDialogProps };
