import { Button } from '@shared/components/ui/button';
import { Info, X } from 'lucide-react';
import React from 'react';

interface ToastProps {
  message: string;
  onClose?: () => void;
}

const Toast: React.FC<ToastProps> = ({ message, onClose }) => {
  return (
    <div className="pointer-events-none fixed right-4 top-4 z-10000 w-[min(24rem,calc(100vw-2rem))]">
      <div className="pointer-events-auto rounded-xl border border-border-subtle bg-surface px-5 py-3.5 text-foreground shadow-xl backdrop-blur-md animate-scale-in">
        <div className="flex items-center gap-3">
          <div className="shrink-0 rounded-full bg-primary-muted p-2">
            <Info className="h-4 w-4 text-primary" />
          </div>
          <div className="flex-1 text-sm font-medium leading-snug">{message}</div>
          {onClose && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="shrink-0 text-muted-foreground hover:text-foreground rounded-full p-1 hover:bg-surface-raised transition-colors"
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
