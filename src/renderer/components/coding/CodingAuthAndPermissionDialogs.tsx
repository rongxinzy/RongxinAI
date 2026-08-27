import { Terminal } from '@shared/components/ai-elements/terminal';
import { Button } from '@shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shared/components/ui/dialog';
import { Input } from '@shared/components/ui/input';

import {
  CodingPermissionOutcome,
  type CodingAgentProfile,
  type CodingEvent,
} from '../../../shared/codingAgent';
import { i18nService } from '../../services/i18n';

interface AuthTerminalState {
  id: string;
  profileId: string;
  output: string;
}

interface CodingAuthAndPermissionDialogsProps {
  authTerminal: AuthTerminalState | null;
  authTerminalInput: string;
  permission: CodingEvent | null;
  profile: CodingAgentProfile | null;
  onAuthTerminalInputChange: (value: string) => void;
  onCancelAuthTerminal: (id: string) => void;
  onSubmitAuthTerminalInput: () => void;
  onRespondToPermission: (outcome: CodingPermissionOutcome, optionId?: string) => void;
}

export const CodingAuthAndPermissionDialogs = ({
  authTerminal,
  authTerminalInput,
  permission,
  profile,
  onAuthTerminalInputChange,
  onCancelAuthTerminal,
  onSubmitAuthTerminalInput,
  onRespondToPermission,
}: CodingAuthAndPermissionDialogsProps) => (
  <>
    {permission && profile && (
      <Dialog open>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{i18nService.t('codingAgentPermission')}</DialogTitle>
            <DialogDescription>{i18nService.t('codingAgentPermissionDescription')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onRespondToPermission(CodingPermissionOutcome.Cancelled)}
            >
              {i18nService.t('codingAgentCancelPermission')}
            </Button>
            {Array.isArray(permission.payload.options) &&
              permission.payload.options.map(option => {
                const permissionOption =
                  option && typeof option === 'object' ? (option as Record<string, unknown>) : {};
                if (
                  typeof permissionOption.optionId !== 'string' ||
                  typeof permissionOption.name !== 'string'
                )
                  return null;
                return (
                  <Button
                    key={permissionOption.optionId}
                    type="button"
                    onClick={() =>
                      onRespondToPermission(
                        CodingPermissionOutcome.Selected,
                        permissionOption.optionId as string,
                      )
                    }
                  >
                    {permissionOption.name}
                  </Button>
                );
              })}
            {!Array.isArray(permission.payload.options) && (
              <Button
                type="button"
                onClick={() => onRespondToPermission(CodingPermissionOutcome.Selected)}
              >
                {i18nService.t('codingAgentApprovePermission')}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )}
    {authTerminal && (
      <Dialog open onOpenChange={open => !open && onCancelAuthTerminal(authTerminal.id)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{i18nService.t('codingAgentTerminalAuthentication')}</DialogTitle>
            <DialogDescription>
              {i18nService.t('codingAgentTerminalAuthenticationDescription')}
            </DialogDescription>
          </DialogHeader>
          <Terminal output={authTerminal.output} className="max-h-[45dvh] overflow-auto" />
          <div className="flex gap-2">
            <Input
              value={authTerminalInput}
              onChange={event => onAuthTerminalInputChange(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  onSubmitAuthTerminalInput();
                }
              }}
              autoFocus
              aria-label={i18nService.t('codingAgentTerminalInput')}
            />
            <Button type="button" onClick={onSubmitAuthTerminalInput}>
              {i18nService.t('codingAgentSend')}
            </Button>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onCancelAuthTerminal(authTerminal.id)}
            >
              {i18nService.t('codingAgentHandoffCancel')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )}
  </>
);
