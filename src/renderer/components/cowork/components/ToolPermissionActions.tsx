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
}) => (
  <Confirmation approval={{ id: permission.requestId }} state={ToolState.ApprovalRequested}>
    <ConfirmationRequest>{i18nService.t('codingAgentPermissionEvent')}</ConfirmationRequest>
    <ConfirmationActions>
      <ConfirmationAction
        variant="outline"
        onClick={() =>
          onRespond({ behavior: CoworkPermissionBehavior.Deny, message: 'Permission denied' })
        }
      >
        {i18nService.t('coworkDeny')}
      </ConfirmationAction>
      <ConfirmationAction
        onClick={() =>
          onRespond({
            behavior: CoworkPermissionBehavior.Allow,
            updatedInput: permission.toolInput,
          })
        }
      >
        {i18nService.t('coworkApprove')}
      </ConfirmationAction>
    </ConfirmationActions>
  </Confirmation>
);
