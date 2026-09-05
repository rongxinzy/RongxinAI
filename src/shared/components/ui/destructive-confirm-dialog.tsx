import { Button, buttonVariants } from '@shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@shared/components/ui/dialog';
import { type VariantProps } from 'class-variance-authority';
import { cn } from '@shared/lib/utils';

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
        className={cn('theme-confirm-dialog w-full max-w-sm', className)}
      >
        <div className="flex w-full min-w-0 flex-col gap-5 p-6">
          <div className="flex min-w-0 flex-col gap-2">
            <DialogTitle className="theme-confirm-title">{title}</DialogTitle>
            <DialogDescription
              className="theme-confirm-description min-w-0 truncate"
              title={description}
            >
              {description}
            </DialogDescription>
          </div>
          <div className="flex min-w-0 items-center justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              className="theme-confirm-cancel min-w-16"
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
                className="theme-confirm-secondary min-w-16"
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
              className="theme-confirm-button min-w-16"
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
