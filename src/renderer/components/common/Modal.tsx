import { Dialog, DialogContent } from '@shared/components/ui/dialog';
import React from 'react';

interface ModalProps {
  isOpen?: boolean;
  onClose: () => void;
  className?: string;
  overlayClassName?: string;
  disablePointerDismissal?: boolean;
  onClick?: React.MouseEventHandler<HTMLDivElement>;
  children: React.ReactNode;
}

/**
 * Modal — A backwards-compatible modal wrapper now implemented with shadcn/ui Dialog.
 *
 * The public props remain unchanged so all existing call sites keep working.
 * The internal `onClick` callback is invoked when the modal content wrapper is
 * clicked (preserving the legacy behavior).
 */
const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  className,
  overlayClassName,
  disablePointerDismissal = false,
  onClick,
  children,
}) => {
  const open = isOpen !== false;

  return (
    <Dialog
      open={open}
      disablePointerDismissal={disablePointerDismissal}
      onOpenChange={nextOpen => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogContent
        className={className}
        overlayClassName={overlayClassName}
        showCloseButton={false}
        onClick={onClick}
      >
        {children}
      </DialogContent>
    </Dialog>
  );
};

export default Modal;
