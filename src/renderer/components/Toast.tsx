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
  // 错误 / 成功是「实心圆盘 + 白色字形」；信息档不再加浅蓝底盘：Info 图标自带圆环，
  // 叠在底盘上会变成同心双环，又挤又糊。直接把图标放到同样的 24px 槽位里最干净。
  const iconContainerClass = isError
    ? 'size-6 bg-destructive text-destructive-foreground'
    : isSuccess
      ? 'size-6 bg-success text-success-foreground'
      : 'size-6';
  const iconClass = isError
    ? 'size-3.5 text-destructive-foreground'
    : isSuccess
      ? 'size-3.5 text-success-foreground'
      : 'size-5 text-primary';
  const toastClass = isError
    ? 'bg-foreground text-background'
    : 'bg-popover text-popover-foreground';

  return (
    <div className="pointer-events-none fixed left-1/2 top-4 z-10000 w-fit max-w-[calc(100vw-2rem)] -translate-x-1/2">
      <div className={`pointer-events-auto animate-fade-in-down rounded-lg border border-border px-4 py-3 shadow-xl ${toastClass}`}>
        <div className="flex items-center gap-3">
          <div className={`inline-flex size-6 shrink-0 items-center justify-center rounded-full leading-none ${iconContainerClass}`}>
            <Icon className={`${iconClass} shrink-0`} strokeWidth={isNeutral ? 2 : 2.5} />
          </div>
          <div className="flex-1 text-sm font-medium leading-snug">{message}</div>
        </div>
      </div>
    </div>
  );
};

export default Toast;
