import { Button } from '@shared/components/ui/button';
import React, { useMemo } from 'react';

import { i18nService } from '../../services/i18n';
import type { CoworkPermissionRequest, CoworkPermissionResult } from '../../types/cowork';
import { PermissionRequestCard, PermissionToolBody } from '../permission/PermissionRequestCard';
import { PermissionDangerSafe, detectPermissionDanger } from '../permission/permissionDanger';

interface CoworkPermissionModalProps {
  permission: CoworkPermissionRequest;
  onRespond: (result: CoworkPermissionResult) => void;
}

/**
 * Inline approval card for work-mode tool permission requests. AskUserQuestion
 * requests never reach this component — App routes them to AskUserQuestionCard —
 * so this card only presents a tool name, its input and approve/deny actions.
 */
const CoworkPermissionModal: React.FC<CoworkPermissionModalProps> = ({ permission, onRespond }) => {
  const toolInput = useMemo(() => permission.toolInput ?? {}, [permission.toolInput]);

  const formatToolInput = (input: Record<string, unknown>): string => {
    try {
      return JSON.stringify(input, null, 2);
    } catch {
      return String(input);
    }
  };

  const { level, reasonText } = useMemo(() => {
    if (permission.toolName !== 'Bash') return PermissionDangerSafe;
    return detectPermissionDanger(permission.toolInput ?? null);
  }, [permission.toolName, permission.toolInput]);

  const handleApprove = () => {
    onRespond({ behavior: 'allow', updatedInput: toolInput });
  };

  const handleDeny = () => {
    onRespond({ behavior: 'deny', message: 'Permission denied' });
  };

  return (
    <PermissionRequestCard
      dangerLevel={level}
      dangerReasonText={reasonText}
      footer={
        <>
          <Button variant="ghost" onClick={handleDeny}>
            {i18nService.t('coworkDeny')}
          </Button>
          <Button onClick={handleApprove}>{i18nService.t('coworkApprove')}</Button>
        </>
      }
    >
      <PermissionToolBody
        title={permission.toolName}
        detail={
          typeof toolInput.command === 'string' ? toolInput.command : formatToolInput(toolInput)
        }
      />
    </PermissionRequestCard>
  );
};

export default CoworkPermissionModal;
