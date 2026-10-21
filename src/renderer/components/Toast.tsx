import { Check, Info, X } from 'lucide-react';
import React from 'react';

interface ToastProps {
  message: string;
  isError?: boolean;
  isSuccess?: boolean;
}

const Toast: React.FC<ToastProps> = ({ message, isError = false, isSuccess = false }) => {
  const Icon = isError ? X : isSuccess ? Check : Info;
  const isNeutral = !isError && !isSuccess;
  // Status is carried by the icon color alone. No filled disc, no second ring.
  const iconClass = isError
    ? 'size-4 text-destructive'
    : isSuccess
      ? 'size-4 text-success'
      : 'size-4 text-primary';

  return (
    <div className="pointer-events-none fixed left-1/2 top-4 z-10000 w-fit max-w-[calc(100vw-2rem)] -translate-x-1/2">
      <div className="pointer-events-auto animate-fade-in-down rounded-xl border border-border bg-popover px-4 py-3 text-popover-foreground shadow-lg">
        <div className="flex items-center gap-3">
          <div className="inline-flex size-6 shrink-0 items-center justify-center leading-none">
            <Icon className={`${iconClass} shrink-0`} strokeWidth={isNeutral ? 2 : 2.25} />
          </div>
          <div className="flex-1 text-sm font-medium leading-snug">{message}</div>
        </div>
      </div>
    </div>
  );
};

export default Toast;
