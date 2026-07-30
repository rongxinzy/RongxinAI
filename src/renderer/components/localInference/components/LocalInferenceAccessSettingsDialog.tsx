import { Button } from '@shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shared/components/ui/dialog';
import { Input } from '@shared/components/ui/input';
import { Label } from '@shared/components/ui/label';
import { Switch } from '@shared/components/ui/switch';
import { Globe, Lock, RefreshCw } from 'lucide-react';

import { i18nService } from '../../../services/i18n';
import { localInferenceCompactButtonClass } from '../constants';
import { isValidLlamaCppPort } from '../hooks/useLocalInferenceAccessSettings';

type LocalInferenceAccessSettingsDialogProps = {
  isOpen: boolean;
  saving: boolean;
  allowLanAccess: boolean;
  willRestartOnSave: boolean;
  port: string;
  exampleModelName?: string;
  onAllowLanAccessChange: (value: boolean) => void;
  onPortChange: (value: string) => void;
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
  port,
  exampleModelName,
  onAllowLanAccessChange,
  onPortChange,
  onClose,
  onSave,
}: LocalInferenceAccessSettingsDialogProps) {
  const resolvedPort = port.trim() || DEFAULT_PORT;
  const portValid = isValidLlamaCppPort(port);
  const listenHost = allowLanAccess ? LAN_HOST : LOCALHOST_HOST;
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
          <div className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-2 sm:gap-4">
            <div className="flex min-w-0 items-center justify-between gap-4">
              <div className="flex min-w-0 flex-col gap-1">
                <Label htmlFor="llamacpp-allow-lan" className="text-sm font-medium text-foreground">
                  {i18nService.t('localInferenceAccessAllowLan')}
                </Label>
              </div>
              <Switch
                id="llamacpp-allow-lan"
                checked={allowLanAccess}
                onCheckedChange={onAllowLanAccessChange}
                disabled={saving}
                className="border-border data-unchecked:bg-muted data-checked:border-primary data-checked:bg-primary"
              />
            </div>
            <div className="flex min-w-0 items-center gap-3 sm:border-l sm:border-border sm:pl-4">
              <div className="min-w-0 flex-1">
                <Label htmlFor="llamacpp-port" className="text-sm font-medium text-foreground">
                  {i18nService.t('localInferenceServiceConfigPortLabel')}
                </Label>
              </div>
              <Input
                id="llamacpp-port"
                type="number"
                inputMode="numeric"
                min={1}
                max={65535}
                step={1}
                value={port}
                onChange={event => onPortChange(event.target.value)}
                disabled={saving}
                aria-invalid={!portValid}
                className="w-24 shrink-0"
              />
            </div>
          </div>

          <div className="flex items-center gap-3 rounded-lg border border-border p-3">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              {allowLanAccess ? <Globe /> : <Lock />}
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <p className="text-xs leading-4 text-muted-foreground">
                {allowLanAccess
                  ? i18nService.t('localInferenceAccessAllowLanEnabledHint')
                  : i18nService.t('localInferenceAccessAllowLanDisabledHint')}
              </p>
              <span className="break-all text-sm leading-5 text-foreground">{endpointBase}</span>
            </div>
          </div>

          <div className="rounded-lg border border-border bg-muted/20 p-3">
            <div className="mb-1.5 text-xs font-medium text-foreground">
              {i18nService.t('localInferenceAccessRequestExample')}
            </div>
            <pre className="overflow-x-auto rounded-md bg-background px-2.5 py-2 font-sans text-xs leading-5 text-foreground">
              {`POST ${endpointBase}/chat/completions
model: "${modelName}"`}
            </pre>
          </div>
        </div>

        <DialogFooter className="items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-2 text-xs leading-5 text-muted-foreground">
            <RefreshCw className="size-3.5 shrink-0" />
            <div className="min-w-0">
              <span className="font-medium text-foreground">
                {willRestartOnSave
                  ? i18nService.t('localInferenceAccessRestartOnSaveTitle')
                  : i18nService.t('localInferenceAccessRestartRequiredTitle')}
              </span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              variant="outline"
              className={localInferenceCompactButtonClass}
              onClick={onClose}
              disabled={saving}
            >
              {i18nService.t('cancel')}
            </Button>
            <Button
              type="button"
              variant="outline"
              className={localInferenceCompactButtonClass}
              disabled={saving || !portValid}
              onClick={onSave}
            >
              {i18nService.t('save')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
