import { Button } from '@shared/components/ui/button';
import { CircleCheck, Info, TriangleAlert, X } from 'lucide-react';
import React from 'react';

interface ToastProps {
  message: string;
  isError?: boolean;
  isSuccess?: boolean;
  onClose?: () => void;
}

const Toast: React.FC<ToastProps> = ({ message, isError = false, isSuccess = false, onClose }) => {
  const Icon = isError ? TriangleAlert : isSuccess ? CircleCheck : Info;
  const iconContainerClass = isError
    ? 'bg-destructive/15'
    : isSuccess
      ? 'bg-success/15'
      : 'bg-primary-muted';
  const iconClass = isError ? 'text-destructive' : isSuccess ? 'text-success' : 'text-primary';

  return (
    <div className="pointer-events-none fixed right-4 top-16 z-10000 w-[min(24rem,calc(100vw-2rem))]">
      <div className="pointer-events-auto rounded-xl border border-border-subtle bg-surface px-5 py-3.5 text-foreground shadow-xl backdrop-blur-md animate-scale-in">
        <div className="flex items-center gap-3">
          <div className={`shrink-0 rounded-full p-2 ${iconContainerClass}`}>
            <Icon className={`h-4 w-4 ${iconClass}`} />
          </div>
          <div className="flex-1 text-sm font-medium leading-snug">{message}</div>
          {onClose && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="shrink-0 text-muted-foreground hover:text-foreground"
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
