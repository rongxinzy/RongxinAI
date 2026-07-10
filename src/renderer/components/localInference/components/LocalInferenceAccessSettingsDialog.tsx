import { Button } from '@shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shared/components/ui/dialog';
import { Label } from '@shared/components/ui/label';
import { Switch } from '@shared/components/ui/switch';
import { Globe, Link, Lock, RefreshCw } from 'lucide-react';

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
      <DialogContent className="w-[min(32rem,calc(100%-2rem))] max-h-[80vh] gap-3 overflow-y-auto sm:max-w-lg">
        <DialogHeader className="gap-1 pr-8">
          <DialogTitle>{i18nService.t('localInferenceAccessSettings')}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
            <div className="flex min-w-0 flex-col gap-1">
              <Label htmlFor="llamacpp-allow-lan" className="text-sm font-medium text-foreground">
                {i18nService.t('localInferenceAccessAllowLan')}
              </Label>
              <p className="text-xs leading-4 text-muted-foreground">
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

          <div className="flex items-center gap-3 rounded-lg border border-border p-3">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
              {allowLanAccess ? <Globe /> : <Lock />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Link className="size-3.5" />
                {i18nService.t('localInferenceAccessCurrentMode')}
              </div>
              <div className="mt-1 flex flex-col gap-0.5 text-sm">
                <span className="break-all font-mono text-foreground">{endpointBase}</span>
                <span className="text-xs text-muted-foreground">
                  {i18nService.t('localInferenceAccessListenAddress').replace('{host}', listenHost)}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-start gap-2 px-1 text-xs leading-5 text-muted-foreground">
            <RefreshCw className="mt-0.5 size-3.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <span className="font-medium text-foreground">
                {willRestartOnSave
                  ? i18nService.t('localInferenceAccessRestartOnSaveTitle')
                  : i18nService.t('localInferenceAccessRestartRequiredTitle')}
              </span>
              <span className="ml-1">
                {willRestartOnSave
                  ? i18nService.t('localInferenceAccessRestartOnSaveHint')
                  : i18nService.t('localInferenceAccessRestartRequiredHint')}
              </span>
            </div>
          </div>

          <div className="rounded-lg border border-border bg-muted/20 p-3">
            <div className="mb-1.5 text-xs font-medium text-foreground">
              {i18nService.t('localInferenceAccessRequestExample')}
            </div>
            <pre className="overflow-x-auto rounded-md bg-background px-2.5 py-2 text-xs leading-5 text-foreground">
{`POST ${endpointBase}/chat/completions
model: "${modelName}"`}
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
