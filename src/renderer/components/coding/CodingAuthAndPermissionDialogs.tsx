import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockHeaderSurface,
  CodeBlockLineNumberMode,
  CodeBlockTitle,
} from '@shared/components/ai-elements/code-block';
import { Terminal } from '@shared/components/ai-elements/terminal';
import { Button } from '@shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogFooterSurface,
  DialogHeader,
  DialogTitle,
} from '@shared/components/ui/dialog';
import { Input } from '@shared/components/ui/input';
import { Code2, CopyIcon } from 'lucide-react';

import {
  CodingPermissionOutcome,
  type CodingAgentProfile,
  type CodingEvent,
} from '../../../shared/codingAgent';
import { i18nService } from '../../services/i18n';
import {
  CodingPermissionOptionKind,
  CodingPermissionOptionName,
  isCommandAllowPermissionOption,
  isGenericCodingPermissionOption,
  formatCodingPermissionInput,
  parseCodingPermission,
  type CodingPermissionOption,
} from './codingPermission';

const PERMISSION_OPTION_I18N_KEY: Record<string, string> = {
  [CodingPermissionOptionKind.AllowOnce]: 'codingAgentPermissionAllowOnce',
  [CodingPermissionOptionKind.AllowAlways]: 'codingAgentPermissionAllowAlways',
  [CodingPermissionOptionKind.RejectOnce]: 'codingAgentPermissionRejectOnce',
  [CodingPermissionOptionKind.RejectAlways]: 'codingAgentPermissionRejectAlways',
};

const permissionOptionLabel = (option: CodingPermissionOption): string =>
  option.name.trim().toLowerCase() === CodingPermissionOptionName.Reject
    ? i18nService.t('codingAgentPermissionReject')
    : isGenericCodingPermissionOption(option) && option.kind && PERMISSION_OPTION_I18N_KEY[option.kind]
      ? i18nService.t(PERMISSION_OPTION_I18N_KEY[option.kind])
      : option.name;

const permissionOptionVariant = (
  option: CodingPermissionOption,
): 'default' | 'outline' | 'destructive' =>
  option.name.trim().toLowerCase() === CodingPermissionOptionName.Reject ||
  option.kind === CodingPermissionOptionKind.RejectAlways
    ? 'destructive'
    : option.kind === CodingPermissionOptionKind.RejectOnce
      ? 'outline'
      : 'default';

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
  onAuthTerminalInputChange,
  onCancelAuthTerminal,
  onSubmitAuthTerminalInput,
  onRespondToPermission,
}: CodingAuthAndPermissionDialogsProps) => {
  const permissionPresentation = permission ? parseCodingPermission(permission) : null;
  const permissionInput = permissionPresentation
    ? formatCodingPermissionInput(permissionPresentation.toolInput)
    : '';
  const permissionOptions = permissionPresentation?.options.filter(
    option => !isCommandAllowPermissionOption(option),
  );

  return (
    <>
      {permission && permissionPresentation && (
        <Dialog
          open
          onOpenChange={open => {
            if (!open) onRespondToPermission(CodingPermissionOutcome.Cancelled);
          }}
        >
          <DialogContent
            className="min-w-0 w-[30vw] !max-w-none max-h-[92vh] overflow-hidden"
          >
            <DialogHeader className="flex-row items-start gap-4">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-muted text-primary">
                <Code2 className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <DialogTitle>{i18nService.t('codingAgentPermission')}</DialogTitle>
                <DialogDescription>
                  {i18nService.t('codingAgentPermissionDescription')}
                </DialogDescription>
              </div>
            </DialogHeader>
            {permissionInput && (
              <div className="max-h-56 min-w-0 max-w-full overflow-hidden">
                <CodeBlock
                  code={permissionInput}
                  language="json"
                  showLineNumbers
                  lineNumberMode={CodeBlockLineNumberMode.Approval}
                  className="min-w-0"
                >
                  <CodeBlockHeader
                    className="justify-between"
                    showDivider={false}
                    surface={CodeBlockHeaderSurface.Seamless}
                  >
                    <CodeBlockTitle>{i18nService.t('codingAgentTool')}</CodeBlockTitle>
                    <CodeBlockActions>
                      <CodeBlockCopyButton aria-label={i18nService.t('copy')} size="sm">
                        <CopyIcon size={14} />
                        <span>{i18nService.t('copy')}</span>
                      </CodeBlockCopyButton>
                    </CodeBlockActions>
                  </CodeBlockHeader>
                </CodeBlock>
              </div>
            )}
            <DialogFooter
              surface={DialogFooterSurface.Seamless}
              className="grid grid-cols-1 md:grid-cols-3"
            >
              {permissionOptions && permissionOptions.length > 0
                ? permissionOptions.map(option => (
                    <Button
                      key={option.optionId}
                      type="button"
                      variant={permissionOptionVariant(option)}
                      className="col-span-1 w-full min-w-0 whitespace-nowrap"
                      onClick={() =>
                        onRespondToPermission(CodingPermissionOutcome.Selected, option.optionId)
                      }
                      title={permissionOptionLabel(option)}
                    >
                      <span className="min-w-0 truncate">{permissionOptionLabel(option)}</span>
                    </Button>
                  ))
                : (
                    <Button
                      type="button"
                      className="col-span-1 w-full min-w-0 whitespace-nowrap"
                      onClick={() => onRespondToPermission(CodingPermissionOutcome.Selected)}
                    >
                      <span className="min-w-0 truncate">
                        {i18nService.t('codingAgentApprovePermission')}
                      </span>
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
};
