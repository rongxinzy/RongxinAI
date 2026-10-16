import { Button } from '@shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shared/components/ui/dialog';
import { useEffect, useRef, useState } from 'react';
import type { MagpieStatus } from '../../../../shared/magpie/types';
import { i18nService } from '../../../services/i18n';

export function MagpieSubscriptionControl({
  status,
  disabled,
  onStatusChange,
  onBusyChange,
}: {
  status: MagpieStatus;
  disabled: boolean;
  onStatusChange: (status: MagpieStatus) => void | Promise<void>;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [target, setTarget] = useState(false);
  const mounted = useRef(false);
  const locked = useRef(false);
  const enabled = status.subscriptionAccountsEnabled === true;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const confirm = async () => {
    if (locked.current) return;
    locked.current = true;
    onBusyChange?.(true);
    setBusy(true);
    setFailed(false);
    try {
      const next = await window.electron.magpie.setSubscriptionAccounts(target);
      if (!mounted.current) return;
      await onStatusChange(next);
      if (next.state === 'failed' || next.subscriptionAccountsEnabled !== target) setFailed(true);
      else setOpen(false);
    } catch {
      if (mounted.current) {
        setFailed(true);
        try {
          const next = await window.electron.magpie.status();
          if (mounted.current) await onStatusChange(next);
        } catch {
          /* keep failure visible */
        }
      }
    } finally {
      locked.current = false;
      if (mounted.current) {
        setBusy(false);
        onBusyChange?.(false);
      }
    }
  };
  return (
    <div className="space-y-2 border-t border-border pt-4">
      <p className="text-sm font-medium">
        {i18nService.t(enabled ? 'magpieSubscriptionsOn' : 'magpieSubscriptionsOff')}
      </p>
      <p className="text-sm text-muted-foreground">{i18nService.t('magpieSubscriptionsHint')}</p>
      <Button
        type="button"
        variant="outline"
        disabled={disabled || busy}
        onClick={() => {
          setTarget(!enabled);
          setFailed(false);
          setOpen(true);
        }}
      >
        {i18nService.t(enabled ? 'magpieSubscriptionsDisable' : 'magpieSubscriptionsEnable')}
      </Button>
      <Dialog
        open={open}
        onOpenChange={value => {
          if (!busy) setOpen(value);
        }}
      >
        <DialogContent className="sm:max-w-lg" showCloseButton={!busy}>
          <DialogHeader>
            <DialogTitle>
              {i18nService.t(target ? 'magpieSubscriptionsEnable' : 'magpieSubscriptionsDisable')}
            </DialogTitle>
            <DialogDescription>
              {i18nService.t(
                target ? 'magpieSubscriptionsEnableConsent' : 'magpieSubscriptionsDisableConsent',
              )}
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {i18nService.t('magpieSubscriptionsRestartNotice')}
          </p>
          {failed && (
            <p role="alert" className="text-sm text-destructive">
              {i18nService.t('magpieActionFailed')}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
              {i18nService.t('cancel')}
            </Button>
            <Button type="button" disabled={busy} onClick={() => void confirm()}>
              {i18nService.t('magpieSubscriptionsConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
