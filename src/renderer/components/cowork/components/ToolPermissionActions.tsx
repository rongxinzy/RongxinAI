import React, { useState } from 'react';
import {
  Confirmation,
  ConfirmationAction,
  ConfirmationActions,
  ConfirmationRequest,
} from '@shared/components/ai-elements/confirmation';
import { ToolState } from '@shared/components/ai-elements/constants';
import { CoworkPermissionBehavior } from '../../../../shared/cowork/constants';
import { i18nService } from '../../../services/i18n';
import type { CoworkPermissionRequest, CoworkPermissionResult } from '../../../types/cowork';

export const ToolPermissionActions = ({
  permission,
  onRespond,
}: {
  permission: CoworkPermissionRequest;
  onRespond: (result: CoworkPermissionResult) => void;
}) => {
  const [isPending, setIsPending] = useState(false);

  const handleDeny = async () => {
    if (isPending) return;
    const response = onRespond({
      behavior: CoworkPermissionBehavior.Deny,
      message: 'Permission denied',
    });
    if (response && typeof (response as Promise<void>).then === 'function') {
      setIsPending(true);
      try {
        await response;
      } finally {
        setIsPending(false);
      }
    }
  };

  const handleApprove = async () => {
    if (isPending) return;
    const response = onRespond({
      behavior: CoworkPermissionBehavior.Allow,
      updatedInput: permission.toolInput,
    });
    if (response && typeof (response as Promise<void>).then === 'function') {
      setIsPending(true);
      try {
        await response;
      } finally {
        setIsPending(false);
      }
    }
  };

  return (
    <Confirmation approval={{ id: permission.requestId }} state={ToolState.ApprovalRequested}>
      <ConfirmationRequest>{i18nService.t('codingAgentPermissionEvent')}</ConfirmationRequest>
      <ConfirmationActions>
        <ConfirmationAction variant="ghost" disabled={isPending} onClick={handleDeny}>
          {i18nService.t('coworkDeny')}
        </ConfirmationAction>
        <ConfirmationAction disabled={isPending} onClick={handleApprove}>
          {i18nService.t('coworkApprove')}
        </ConfirmationAction>
      </ConfirmationActions>
    </Confirmation>
  );
};
