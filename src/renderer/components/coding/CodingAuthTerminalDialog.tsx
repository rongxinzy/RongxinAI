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

import { i18nService } from '../../services/i18n';

interface AuthTerminalState {
  id: string;
  profileId: string;
  output: string;
}

interface CodingAuthTerminalDialogProps {
  authTerminal: AuthTerminalState | null;
  authTerminalInput: string;
  onAuthTerminalInputChange: (value: string) => void;
  onCancelAuthTerminal: (id: string) => void;
  onSubmitAuthTerminalInput: () => void;
}

/** Terminal hand-off an agent needs to finish an interactive login. */
export const CodingAuthTerminalDialog = ({
  authTerminal,
  authTerminalInput,
  onAuthTerminalInputChange,
  onCancelAuthTerminal,
  onSubmitAuthTerminalInput,
}: CodingAuthTerminalDialogProps) => {
  if (!authTerminal) return null;
  return (
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
  );
};
