import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockCopyButton,
  CodeBlockHeader,
} from '@shared/components/ai-elements/code-block';
import { Terminal } from '@shared/components/ai-elements/terminal';
import { Badge } from '@shared/components/ui/badge';
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
import { Code2, CopyIcon, InfoIcon } from 'lucide-react';

import {
  CodingPermissionOutcome,
  type CodingAgentProfile,
  type CodingEvent,
} from '../../../shared/codingAgent';
import { i18nService } from '../../services/i18n';
import {
  CodingPermissionOptionKind,
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

const TOOL_KIND_I18N_KEY: Record<string, string> = {
  read: 'codingAgentToolKindRead',
  edit: 'codingAgentToolKindEdit',
  delete: 'codingAgentToolKindDelete',
  move: 'codingAgentToolKindMove',
  search: 'codingAgentToolKindSearch',
  execute: 'codingAgentToolKindExecute',
  think: 'codingAgentToolKindThink',
  fetch: 'codingAgentToolKindFetch',
  switch_mode: 'codingAgentToolKindSwitchMode',
  other: 'codingAgentToolKindOther',
};

const permissionOptionLabel = (option: CodingPermissionOption): string =>
  isGenericCodingPermissionOption(option) && option.kind && PERMISSION_OPTION_I18N_KEY[option.kind]
    ? i18nService.t(PERMISSION_OPTION_I18N_KEY[option.kind])
    : option.name;

const permissionOptionVariant = (
  option: CodingPermissionOption,
): 'default' | 'outline' | 'destructive' =>
  option.kind === CodingPermissionOptionKind.RejectOnce ||
  option.kind === CodingPermissionOptionKind.AllowAlways
    ? 'outline'
    : option.kind === CodingPermissionOptionKind.RejectAlways
      ? 'destructive'
      : 'default';

const toolKindLabel = (kind: string | null): string | null =>
  kind ? i18nService.t(TOOL_KIND_I18N_KEY[kind] ?? 'codingAgentToolKindOther') : null;

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
            className="min-w-0 w-[60vw] !max-w-none max-h-[92vh] overflow-hidden"
          >
            <DialogHeader className="flex-row items-start gap-4">
              <div className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-primary-muted text-primary">
                <Code2 className="size-7" />
              </div>
              <div className="min-w-0 flex-1">
                <DialogTitle>{i18nService.t('codingAgentPermission')}</DialogTitle>
                <DialogDescription>
                  {i18nService.t('codingAgentPermissionDescription')}
                </DialogDescription>
              </div>
            </DialogHeader>
            <section className="min-w-0 rounded-xl border border-border p-4">
              <div className="flex min-w-0 items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-lg font-semibold text-foreground">
                    {i18nService.t('codingAgentTool')}
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {i18nService.t('codingAgentPermissionToolDescription')}
                  </p>
                </div>
                <Badge className="shrink-0" variant="secondary">
                  <InfoIcon className="size-4" />
                  {toolKindLabel(permissionPresentation.toolKind) ??
                    i18nService.t('codingAgentToolKindOther')}
                </Badge>
              </div>
              {permissionInput && (
                <div className="mt-4">
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    {i18nService.t('codingAgentPermissionToolInput')}
                  </label>
                  <div className="max-h-56 min-w-0 max-w-full overflow-x-auto overflow-y-auto">
                    <CodeBlock code={permissionInput} language="json" showLineNumbers>
                      <CodeBlockHeader className="justify-end">
                        <CodeBlockActions>
                          <CodeBlockCopyButton
                            aria-label={i18nService.t('copyToClipboard')}
                            size="sm"
                          >
                            <CopyIcon size={14} />
                            <span>{i18nService.t('copyToClipboard')}</span>
                          </CodeBlockCopyButton>
                        </CodeBlockActions>
                      </CodeBlockHeader>
                    </CodeBlock>
                  </div>
                </div>
              )}
            </section>
            <DialogFooter className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5">
              <Button
                type="button"
                variant="outline"
                className="col-span-1 w-full min-w-0 whitespace-nowrap"
                onClick={() => onRespondToPermission(CodingPermissionOutcome.Cancelled)}
              >
                <span className="min-w-0 truncate">
                  {i18nService.t('codingAgentCancelPermission')}
                </span>
              </Button>
              {permissionPresentation.options.length > 0
                ? permissionPresentation.options.map(option => (
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
