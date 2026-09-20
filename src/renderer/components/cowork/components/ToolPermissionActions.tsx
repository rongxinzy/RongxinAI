// 2026/09/16 lixiang  工具授权的拒绝/允许按钮，嵌在终端或工具卡片内，避免再画一张白底授权卡
import { Button } from '@shared/components/ui/button';
import { cn } from '@shared/lib/utils';

import { i18nService } from '../../../services/i18n';
import type { CoworkPermissionRequest, CoworkPermissionResult } from '../../../types/cowork';

export const ToolPermissionActions = ({
  permission,
  onRespond,
  variant = 'light',
}: {
  permission: CoworkPermissionRequest;
  onRespond: (result: CoworkPermissionResult) => void;
  variant?: 'terminal' | 'light';
}) => {
  const isTerminal = variant === 'terminal';

  return (
    <div
      className={cn(
        'flex items-center justify-end gap-2 px-4 py-2',
        isTerminal ? 'border-t border-zinc-800' : 'pt-1',
      )}
    >
      <Button
        variant="ghost"
        size="sm"
        className={isTerminal ? 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100' : undefined}
        onClick={() => onRespond({ behavior: 'deny', message: 'Permission denied' })}
      >
        {i18nService.t('coworkDeny')}
      </Button>
      <Button
        size="sm"
        onClick={() => onRespond({ behavior: 'allow', updatedInput: permission.toolInput })}
      >
        {i18nService.t('coworkApprove')}
      </Button>
    </div>
  );
};
