import { Button } from '@shared/components/ui/button';
import { Info, X } from 'lucide-react';
import React from 'react';

interface ToastProps {
  message: string;
  onClose?: () => void;
}

const Toast: React.FC<ToastProps> = ({ message, onClose }) => {
  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center modal-backdrop">
      <div className="w-full max-w-md mx-4 rounded-2xl border border-border-subtle bg-surface text-foreground px-5 py-3.5 shadow-xl backdrop-blur-md animate-scale-in">
        <div className="flex items-center gap-3">
          <div className="shrink-0 rounded-full bg-primary-muted p-2">
            <Info className="h-4 w-4 text-primary" />
          </div>
          <div className="flex-1 text-sm font-medium leading-snug">
            {message}
          </div>
          {onClose && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="shrink-0 text-secondary hover:text-foreground rounded-full p-1 hover:bg-surface-raised transition-colors"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

export default Toast;
