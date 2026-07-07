import { Button } from '@shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shared/components/ui/dialog';
import { Label } from '@shared/components/ui/label';
import { Switch } from '@shared/components/ui/switch';
import { Globe, Lock, RefreshCw } from 'lucide-react';

import { i18nService } from '../../../services/i18n';

type LocalInferenceAccessSettingsDialogProps = {
  isOpen: boolean;
  saving: boolean;
  allowLanAccess: boolean;
  willRestartOnSave: boolean;
  currentHost: string;
  port: string;
  exampleModelName?: string;
  onAllowLanAccessChange: (value: boolean) => void;
  onClose: () => void;
  onSave: () => void;
};

const LOCALHOST_HOST = '127.0.0.1';
const LAN_HOST = '0.0.0.0';
const DEFAULT_PORT = '8080';

export function LocalInferenceAccessSettingsDialog({
  isOpen,
  saving,
  allowLanAccess,
  willRestartOnSave,
  currentHost,
  port,
  exampleModelName,
  onAllowLanAccessChange,
  onClose,
  onSave,
}: LocalInferenceAccessSettingsDialogProps) {
  const resolvedPort = port.trim() || DEFAULT_PORT;
  const listenHost = currentHost.trim() || (allowLanAccess ? LAN_HOST : LOCALHOST_HOST);
  const endpointBase = allowLanAccess
    ? `http://<LAN-IP>:${resolvedPort}/v1`
    : `http://${listenHost}:${resolvedPort}/v1`;
  const modelName = exampleModelName?.trim() || '<model-name>';

  return (
    <Dialog
      open={isOpen}
      onOpenChange={open => {
        if (!open && !saving) onClose();
      }}
    >
      <DialogContent className="w-[min(42rem,calc(100%-2rem))] max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{i18nService.t('localInferenceAccessSettings')}</DialogTitle>
          <DialogDescription>
            {i18nService.t('localInferenceAccessSettingsDescription')}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex items-start justify-between gap-4 rounded-lg border border-border bg-muted/20 p-4">
            <div className="flex min-w-0 flex-col gap-1">
              <Label htmlFor="llamacpp-allow-lan" className="text-sm font-medium text-foreground">
                {i18nService.t('localInferenceAccessAllowLan')}
              </Label>
              <p className="text-sm text-muted-foreground">
                {allowLanAccess
                  ? i18nService.t('localInferenceAccessAllowLanEnabledHint')
                  : i18nService.t('localInferenceAccessAllowLanDisabledHint')}
              </p>
            </div>
            <Switch
              id="llamacpp-allow-lan"
              checked={allowLanAccess}
              onCheckedChange={onAllowLanAccessChange}
              disabled={saving}
              className="border-border data-unchecked:bg-muted data-checked:border-primary data-checked:bg-primary"
            />
          </div>

          <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/20 p-4">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-background text-foreground">
              {allowLanAccess ? <Globe /> : <Lock />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-foreground">
                {i18nService.t('localInferenceAccessCurrentMode')}
              </div>
              <div className="mt-2 flex flex-col gap-2 text-sm text-muted-foreground">
                <span>
                  {i18nService.t('localInferenceAccessListenAddress').replace('{host}', listenHost)}
                </span>
                <span className="break-all">
                  {i18nService.t('localInferenceAccessEndpoint').replace('{endpoint}', endpointBase)}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/20 p-4">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-background text-foreground">
              <RefreshCw />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-foreground">
                {willRestartOnSave
                  ? i18nService.t('localInferenceAccessRestartOnSaveTitle')
                  : i18nService.t('localInferenceAccessRestartRequiredTitle')}
              </div>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {willRestartOnSave
                  ? i18nService.t('localInferenceAccessRestartOnSaveHint')
                  : i18nService.t('localInferenceAccessRestartRequiredHint')}
              </p>
            </div>
          </div>

          <div className="rounded-lg border border-border bg-muted/20 p-4">
            <div className="mb-2 text-sm font-medium text-foreground">
              {i18nService.t('localInferenceAccessRequestExample')}
            </div>
            <p className="mb-3 text-sm text-muted-foreground">
              {i18nService.t('localInferenceAccessRequestExampleHint')}
            </p>
            <pre className="overflow-x-auto rounded-md border border-border bg-background p-3 text-xs leading-5 text-foreground">
{`POST ${endpointBase}/chat/completions
Content-Type: application/json

{
  "model": "${modelName}",
  "messages": [
    { "role": "user", "content": "Hello" }
  ]
}`}
            </pre>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            {i18nService.t('cancel')}
          </Button>
          <Button type="button" disabled={saving} onClick={onSave}>
            {i18nService.t('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
