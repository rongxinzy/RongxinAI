import { Button } from '@shared/components/ui/button';
import { useCallback, useEffect, useRef, useState } from 'react';

import { CoworkPermissionBehavior } from '../../../../shared/cowork/constants';
import { i18nService } from '../../../services/i18n';
import type { CoworkPermissionRequest, CoworkPermissionResult } from '../../../types/cowork';

export interface ToolApprovalBarProps {
  permission: CoworkPermissionRequest;
  onRespond: (result: CoworkPermissionResult) => void | Promise<void>;
}

/**
 * Inline permission approval bar embedded directly inside the waiting tool row.
 * Supports Cmd/Ctrl+Enter to allow and Escape to deny while active.
 */
export function ToolApprovalBar({ permission, onRespond }: ToolApprovalBarProps) {
  const [isPending, setIsPending] = useState(false);
  const approveRef = useRef<HTMLButtonElement>(null);

  const submit = useCallback(
    async (result: CoworkPermissionResult) => {
      if (isPending) return;
      try {
        const response = onRespond(result);
        if (response && typeof (response as Promise<void>).then === 'function') {
          setIsPending(true);
          await response;
        }
      } finally {
        setIsPending(false);
      }
    },
    [isPending, onRespond],
  );

  const handleAllow = useCallback(
    () =>
      submit({
        behavior: CoworkPermissionBehavior.Allow,
        updatedInput: permission.toolInput,
      }),
    [permission.toolInput, submit],
  );

  const handleDeny = useCallback(
    () =>
      submit({
        behavior: CoworkPermissionBehavior.Deny,
        message: 'Permission denied',
      }),
    [submit],
  );

  useEffect(() => {
    approveRef.current?.focus({ preventScroll: true });
  }, [permission.requestId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isPending) return;
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        void handleAllow();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        void handleDeny();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleAllow, handleDeny, isPending]);

  return (
    <div
      role="region"
      aria-live="polite"
      aria-label={i18nService.t('codingAgentPermissionEvent')}
      className="theme-conversation-approval flex flex-wrap items-center justify-between gap-2"
    >
      <span className="theme-conversation-meta">{i18nService.t('codingAgentPermissionEvent')}</span>
      <div className="flex items-center gap-2">
        <Button type="button" variant="ghost" size="sm" disabled={isPending} onClick={handleDeny}>
          {i18nService.t('coworkDeny')}
        </Button>
        <Button
          ref={approveRef}
          type="button"
          variant="default"
          size="sm"
          disabled={isPending}
          onClick={handleAllow}
        >
          {i18nService.t('coworkApprove')}
        </Button>
      </div>
    </div>
  );
}
